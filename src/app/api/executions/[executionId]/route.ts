import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { approveExecution, attestExecution } from '@/lib/agent-runtime'
import { isValidGnoAddress } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// GET /api/executions/[executionId] — execution detail
export async function GET(req: NextRequest, ctx: { params: Promise<{ executionId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { executionId } = await ctx.params
    const execution = await db.agentExecution.findUnique({
      where: { id: executionId },
      include: { agent: { include: { project: true, organization: true } } },
    })
    if (!execution) throw err('NOT_FOUND')
    const m = await db.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: execution.agent.organizationId } },
    })
    if (!m) throw err('TENANT_ISOLATION')
    const attestation = await db.attestation.findFirst({
      where: { subjectType: 'AGENT_EXECUTION', subjectId: executionId },
      select: { protocolId: true, digest: true, status: true, onChain: true },
    })
    return {
      ...execution,
      agent: { id: execution.agent.id, name: execution.agent.name, slug: execution.agent.slug, status: execution.agent.status },
      projectName: execution.agent.project?.name,
      attested: !!attestation && attestation.status === 'ACTIVE',
      attestationDigest: attestation?.digest ?? null,
      attestationProtocolId: attestation?.protocolId ?? null,
    }
  })
}

// POST /api/executions/[executionId] — approve | reject | attest
export async function POST(req: NextRequest, ctx: { params: Promise<{ executionId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { executionId } = await ctx.params
    const body = await readJson<{ op?: string; decision?: string; comment?: string; onChain?: boolean; chainTxHash?: string; issuerAddress?: string }>(req)
    const execution = await db.agentExecution.findUnique({ where: { id: executionId }, include: { agent: true } })
    if (!execution) throw err('NOT_FOUND')
    const ip = clientIp(req)

    if (body.op === 'approve' || body.op === 'reject') {
      const targetProject = execution.projectId ?? execution.agent.projectId
      if (targetProject) {
        await requireProjectAccess(user.id, targetProject, 'agent.approve')
      } else {
        // executions without a project are approved at organization level
        const m = await db.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: execution.agent.organizationId } } })
        if (!m || !['OWNER', 'ADMIN', 'SECURITY_ADMIN', 'AGENT_OPERATOR'].includes(m.role)) throw err('FORBIDDEN')
      }
      const updated = await approveExecution({
        executionId, reviewerUserId: user.id, organizationId: execution.agent.organizationId,
        decision: body.op === 'approve' ? 'APPROVED' : 'REJECTED',
        comment: body.comment, ip,
      })
      return { id: updated.id, status: updated.status }
    }

    if (body.op === 'attest') {
      const targetProject = execution.projectId ?? execution.agent.projectId
      if (targetProject) {
        await requireProjectAccess(user.id, targetProject, 'attestation.issue')
      } else {
        const m = await db.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: execution.agent.organizationId } } })
        if (!m) throw err('NOT_A_MEMBER')
      }
      const issuerAddress = body.issuerAddress ?? user.gnoAddress
      if (!issuerAddress || !isValidGnoAddress(issuerAddress)) throw err('INVALID_ADDRESS')
      if (body.onChain && !body.chainTxHash) throw err('VALIDATION_FAILED', { reason: 'chainTxHash required for on-chain attestations' })
      const attestation = await attestExecution({
        executionId, issuerUserId: user.id, issuerAddress,
        organizationId: execution.agent.organizationId,
        onChain: body.onChain, chainTxHash: body.chainTxHash, ip,
      })
      return { id: attestation.id, protocolId: attestation.protocolId, digest: attestation.digest, onChain: attestation.onChain }
    }

    throw err('VALIDATION_FAILED', { field: 'op', allowed: ['approve', 'reject', 'attest'] })
  })
}
