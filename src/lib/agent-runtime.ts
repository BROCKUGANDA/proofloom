import { db } from '@/lib/db'
import { llm, validateAgentReport } from '@/lib/llm'
import { sha256Hex, isValidDigest } from '@/lib/crypto'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { limits } from '@/lib/rate-limit'

// Agent runtime (off-chain).
//
// The runtime executes authorized agent workflows: it inspects project and
// policy context, runs the configured LLM provider under a scoped prompt,
// validates output against the report schema, and records an execution
// receipt. It NEVER publishes on-chain by itself — publication requires an
// explicit human approval, enforced server-side.

const MAX_TASK_CONTEXT_CHARS = 8000

function sanitize(text: string): string {
  // Strip potential prompt-injection instruction blocks and truncate.
  return text
    .replace(/```/g, '\`\u0060\`\u0060')
    .slice(0, MAX_TASK_CONTEXT_CHARS)
}

export async function startExecution(params: {
  agentId: string
  taskId?: string
  trigger?: string
  userId: string
  organizationId: string
  ip?: string
}) {
  const agent = await db.agent.findUnique({ where: { id: params.agentId } })
  if (!agent) throw err('NOT_FOUND')
  if (agent.status !== 'ACTIVE') throw err('AGENT_SUSPENDED')
  if (agent.organizationId !== params.organizationId) throw err('TENANT_ISOLATION')

  const rl = await limits.agentExec(params.organizationId)
  if (!rl.allowed) throw err('RATE_LIMITED', { resetAt: rl.resetAt })

  let task = null as null | { id: string; title: string; description: string; projectId: string | null }
  if (params.taskId) {
    task = await db.task.findUnique({ where: { id: params.taskId } })
    if (!task) throw err('NOT_FOUND')
  }

  // Permission gate: agent must hold EVIDENCE or TASK_UPDATE scope on the
  // target project (mirrors the on-chain rule).
  const projectId = task?.projectId ?? agent.projectId
  if (projectId) {
    const grant = await db.agentGrant.findUnique({
      where: { agentId_projectId: { agentId: agent.id, projectId } },
    })
    const active = grant && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt.getTime() > Date.now())
    if (!active) throw err('AGENT_NOT_AUTHORIZED', { projectId })
    const scopes = (grant.scopes ?? '').split(',')
    if (!scopes.includes('EVIDENCE') && !scopes.includes('TASK_UPDATE')) {
      throw err('AGENT_NOT_AUTHORIZED', { missing: 'EVIDENCE or TASK_UPDATE' })
    }
  }

  const execution = await db.agentExecution.create({
    data: {
      agentId: agent.id,
      taskId: params.taskId,
      projectId: projectId,
      trigger: params.trigger ?? 'manual',
      status: 'RUNNING',
    },
  })

  await audit({
    organizationId: params.organizationId,
    projectId,
    actorUserId: params.userId,
    action: 'agent.execution.start',
    targetType: 'AGENT_EXECUTION',
    targetId: execution.id,
    metadata: { agentId: agent.id, taskId: params.taskId },
    ip: params.ip,
  })

  // Kick off the run without blocking the API response.
  void runExecution(execution.id, agent.id, task?.title, task?.description).catch(() => {})
  return execution
}

async function runExecution(executionId: string, agentId: string, taskTitle?: string, taskDescription?: string) {
  try {
    const agent = await db.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new Error('agent vanished')

    const project = agent.projectId
      ? await db.project.findUnique({ where: { id: agent.projectId }, include: { releases: { take: 5, orderBy: { createdAt: 'desc' } } } })
      : null

    const policy = project
      ? await db.policy.findFirst({ where: { projectId: project.id, active: true } })
      : null

    const contextParts = [
      `Agent: ${agent.name} (${agent.capabilities || 'general assistance'})`,
      project ? `Project: ${project.name} — ${project.description || 'no description'}` : '',
      project?.releases?.length ? `Recent releases: ${project.releases.map(r => `${r.version} [${r.status}]`).join(', ')}` : '',
      policy ? `Publication policy: requires [${policy.requireCategories || 'baseline'}], min approvals ${policy.minApprovals}` : '',
      taskTitle ? `Assigned task: ${taskTitle}` : '',
      taskDescription ? `Task details: ${sanitize(taskDescription)}` : '',
    ].filter(Boolean)

    const result = await llm.complete({
      messages: [
        {
          role: 'system',
          content: `You are ${agent.name}, an engineering agent operating inside PROOFLOOM, a software provenance platform. Complete the assigned task and respond with ONLY a JSON object matching: {"summary": string, "findings": [{"severity": "info"|"warning"|"critical", "title": string, "detail": string}], "evidenceRefs": string[], "conclusion": "PASS"|"FAIL"|"NEEDS_REVIEW"}. Be precise and factual. Never invent test results, digests, or transaction data.`,
        },
        { role: 'user', content: contextParts.join('\n') },
      ],
      thinking: false,
    })

    const report = validateAgentReport(result.content)
    if (!report) {
      await db.agentExecution.update({
        where: { id: executionId },
        data: { status: 'FAILED', error: 'LLM_OUTPUT_INVALID', finishedAt: new Date(), tokensUsed: result.tokensUsed },
      })
      return
    }

    const reportJson = JSON.stringify(report)
    const reportDigest = sha256Hex(reportJson)

    // Agent executions that would publish anything require human approval.
    const needsApproval = report.conclusion !== 'NEEDS_REVIEW' && !!project

    await db.agentExecution.update({
      where: { id: executionId },
      data: {
        status: needsApproval ? 'AWAITING_APPROVAL' : 'COMPLETED',
        report: reportJson,
        reportDigest,
        outputDigest: reportDigest,
        tokensUsed: result.tokensUsed,
        finishedAt: new Date(),
        policyVerdict: JSON.stringify({ provider: result.provider, model: result.model, durationMs: result.durationMs }),
      },
    })
  } catch (e) {
    const message = (e as Error)?.message ?? 'unknown error'
    const isProviderDown = message.includes('unavailable')
    await db.agentExecution.update({
      where: { id: executionId },
      data: {
        status: 'FAILED',
        error: isProviderDown ? 'LLM_PROVIDER_UNAVAILABLE' : message.slice(0, 500),
        finishedAt: new Date(),
      },
    }).catch(() => {})
  }
}

export async function approveExecution(params: {
  executionId: string
  reviewerUserId: string
  organizationId: string
  decision: 'APPROVED' | 'REJECTED'
  comment?: string
  ip?: string
}) {
  const execution = await db.agentExecution.findUnique({
    where: { id: params.executionId },
    include: { agent: true },
  })
  if (!execution) throw err('NOT_FOUND')
  if (execution.agent.organizationId !== params.organizationId) throw err('TENANT_ISOLATION')
  if (execution.status !== 'AWAITING_APPROVAL') throw err('INVALID_TRANSITION', { current: execution.status })

  const updated = await db.agentExecution.update({
    where: { id: params.executionId },
    data: {
      status: params.decision === 'APPROVED' ? 'COMPLETED' : 'REJECTED',
      approvedBy: params.reviewerUserId,
      approvedAt: new Date(),
      error: params.decision === 'REJECTED' ? (params.comment ?? 'rejected by reviewer').slice(0, 500) : null,
    },
  })

  await audit({
    organizationId: params.organizationId,
    projectId: execution.projectId,
    actorUserId: params.reviewerUserId,
    action: `agent.execution.${params.decision === 'APPROVED' ? 'approve' : 'reject'}`,
    targetType: 'AGENT_EXECUTION',
    targetId: execution.id,
    metadata: { reportDigest: execution.reportDigest },
    ip: params.ip,
  })
  return updated
}

// Attest an agent execution: binds the report digest as evidence.
export async function attestExecution(params: {
  executionId: string
  issuerUserId: string
  issuerAddress: string
  organizationId: string
  onChain?: boolean
  chainTxHash?: string
  ip?: string
}) {
  const execution = await db.agentExecution.findUnique({
    where: { id: params.executionId },
    include: { agent: true },
  })
  if (!execution) throw err('NOT_FOUND')
  if (execution.status !== 'COMPLETED') throw err('INVALID_TRANSITION', { current: execution.status })
  if (!isValidDigest(execution.reportDigest ?? '')) throw err('INVALID_DIGEST')

  const existing = await db.attestation.findUnique({
    where: {
      protocolId: `${execution.id}-agent_task_completion-${params.issuerAddress}`,
    },
  })
  if (existing && existing.status === 'ACTIVE') throw err('DUPLICATE')

  const attestation = await db.attestation.create({
    data: {
      protocolId: `${execution.id}-agent_task_completion-${params.issuerAddress}`,
      subjectType: 'AGENT_EXECUTION',
      subjectId: execution.id,
      category: 'AGENT_TASK_COMPLETION',
      issuerId: params.issuerUserId,
      issuerAddress: params.issuerAddress,
      digest: execution.reportDigest!,
      status: 'ACTIVE',
      projectId: execution.projectId,
      organizationId: params.organizationId,
      onChain: params.onChain ?? false,
      chainTxHash: params.chainTxHash,
    },
  })

  await audit({
    organizationId: params.organizationId,
    projectId: execution.projectId,
    actorUserId: params.issuerUserId,
    actorAddress: params.issuerAddress,
    action: 'attestation.issue',
    targetType: 'ATTESTATION',
    targetId: attestation.id,
    metadata: { category: 'AGENT_TASK_COMPLETION', subjectId: execution.id, onChain: params.onChain },
    ip: params.ip,
  })
  return attestation
}
