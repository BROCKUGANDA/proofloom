import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { requireFeature, assertCap } from '@/lib/entitlements'
import { sha256Hex } from '@/lib/crypto'
import { llm, validateAgentReport } from '@/lib/llm'
import { startExecution, approveExecution, attestExecution } from '@/lib/agent-runtime'
import { limits } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// GET /api/agents?orgId= — agent registry for an organization
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const orgId = new URL(req.url).searchParams.get('orgId')
    if (!orgId) throw err('VALIDATION_FAILED', { missing: ['orgId'] })
    await requireMembershipShim(user.id, orgId)
    const agents = await db.agent.findMany({
      where: { organizationId: orgId },
      include: {
        project: { select: { id: true, name: true, slug: true } },
        grants: true,
        executions: { orderBy: { startedAt: 'desc' }, take: 10 },
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const providerHealth = await llm.health()
    return {
      providers: providerHealth,
      agents: agents.map(a => ({
        ...a,
        grants: a.grants.map(g => ({ ...g, active: !g.revokedAt && (!g.expiresAt || g.expiresAt.getTime() > Date.now()) })),
        executionCount: a._count.executions,
      })),
    }
  })
}

async function requireMembershipShim(userId: string, orgId: string) {
  const m = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: orgId } } })
  if (!m) throw err('NOT_A_MEMBER')
  return m
}

// POST /api/agents — register an agent, grant permissions, execute, approve, attest
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const body = await readJson<Record<string, unknown>>(req)
    const op = (body.op as string) ?? ''
    const ip = clientIp(req)

    if (op === 'register') {
      const orgId = body.organizationId as string
      await requireMembershipShim(user.id, orgId)
      const caps = await import('@/lib/auth').then(m => m.requireMembership(user.id, orgId, 'agent.register'))
      void caps
      // Entitlement: Agent Command is a Pro feature; agents also have a plan cap.
      await requireFeature(orgId, 'agentCommand')
      await assertCap(orgId, 'agents', await db.agent.count({ where: { organizationId: orgId, status: 'ACTIVE' } }))
      const name = (body.name as string) ?? ''
      if (!name || name.length < 2) throw err('VALIDATION_FAILED', { field: 'name' })
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`
      const ownerAddress = (body.ownerAddress as string) ?? user.gnoAddress
      const agent = await db.agent.create({
        data: {
          organizationId: orgId,
          projectId: (body.projectId as string) || null,
          slug,
          name: name.slice(0, 80),
          description: ((body.description as string) ?? '').slice(0, 500),
          ownerAddress: ownerAddress ?? '',
          ownerUserId: user.id,
          runtime: ((body.runtime as string) ?? '').slice(0, 100),
          modelProvider: ((body.modelProvider as string) ?? 'zai').slice(0, 40),
          modelId: ((body.modelId as string) ?? '').slice(0, 60),
          capabilities: ((body.capabilities as string[]) ?? []).slice(0, 12).join(','),
          version: ((body.version as string) ?? '1.0.0').slice(0, 20),
        },
      })
      await audit({ organizationId: orgId, projectId: agent.projectId, actorUserId: user.id, action: 'agent.register', targetType: 'AGENT', targetId: agent.id, metadata: { slug, ownerAddress }, ip, traceId })
      return { id: agent.id, slug: agent.slug }
    }

    if (op === 'grant') {
      const agentId = body.agentId as string
      const agent = await db.agent.findUnique({ where: { id: agentId }, include: { project: true } })
      if (!agent) throw err('NOT_FOUND')
      const projectId = (body.projectId as string) ?? agent.projectId
      if (!projectId) throw err('VALIDATION_FAILED', { missing: ['projectId'] })
      await requireProjectAccess(user.id, projectId, 'agent.grant')
      const VALID_SCOPES = ['READ', 'EVIDENCE', 'VERIFY_REQUEST', 'TASK_UPDATE', 'REVIEW_PROPOSE', 'PUBLISH_REQUEST']
      const scopes = (body.scopes as string[]) ?? []
      if (scopes.length === 0 || scopes.some(s => !VALID_SCOPES.includes(s))) throw err('VALIDATION_FAILED', { field: 'scopes', allowed: VALID_SCOPES })
      const expiresAt = body.expiresAt ? new Date(body.expiresAt as string) : null
      if (expiresAt && expiresAt.getTime() <= Date.now()) throw err('VALIDATION_FAILED', { reason: 'expiry must be in the future' })
      const grant = await db.agentGrant.upsert({
        where: { agentId_projectId: { agentId, projectId } },
        create: { agentId, projectId, scopes: scopes.join(','), grantedBy: user.id, expiresAt },
        update: { scopes: scopes.join(','), grantedBy: user.id, expiresAt, revokedAt: null },
      })
      await audit({ projectId, actorUserId: user.id, action: 'agent.grant', targetType: 'AGENT_GRANT', targetId: grant.id, metadata: { agentId, scopes, expiresAt }, ip, traceId })
      return grant
    }

    if (op === 'revoke-grant') {
      const grant = await db.agentGrant.findUnique({ where: { id: body.grantId as string }, include: { agent: true } })
      if (!grant) throw err('NOT_FOUND')
      await requireProjectAccess(user.id, grant.projectId, 'agent.grant')
      await db.agentGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } })
      await audit({ projectId: grant.projectId, actorUserId: user.id, action: 'agent.grant_revoke', targetType: 'AGENT_GRANT', targetId: grant.id, ip, traceId })
      return { ok: true }
    }

    if (op === 'set-status') {
      const agentId = body.agentId as string
      const status = body.status as string
      if (!['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(status)) throw err('VALIDATION_FAILED', { field: 'status' })
      const agent = await db.agent.findUnique({ where: { id: agentId } })
      if (!agent) throw err('NOT_FOUND')
      const m = await requireMembershipShim(user.id, agent.organizationId)
      const allowed = ['OWNER', 'ADMIN', 'SECURITY_ADMIN', 'AGENT_OPERATOR'].includes(m.role) || agent.ownerUserId === user.id
      if (!allowed) throw err('FORBIDDEN')
      const updated = await db.agent.update({ where: { id: agentId }, data: { status } })
      await audit({ organizationId: agent.organizationId, actorUserId: user.id, action: `agent.${status.toLowerCase()}`, targetType: 'AGENT', targetId: agentId, ip, traceId })
      return updated
    }

    if (op === 'execute') {
      const agentId = body.agentId as string
      const agent = await db.agent.findUnique({ where: { id: agentId } })
      if (!agent) throw err('NOT_FOUND')
      const execution = await startExecution({
        agentId, taskId: body.taskId as string | undefined,
        trigger: (body.trigger as string) ?? 'manual',
        userId: user.id, organizationId: agent.organizationId, ip,
      })
      return { executionId: execution.id, status: execution.status }
    }

    if (op === 'simulate') {
      // Dry-run without touching execution records: reports provider health.
      const health = await llm.health()
      return { providers: health, validationReady: typeof validateAgentReport('{"summary":"x","findings":[],"conclusion":"PASS"}') === 'object' }
    }

    throw err('VALIDATION_FAILED', { field: 'op', allowed: ['register', 'grant', 'revoke-grant', 'set-status', 'execute', 'simulate'] })
  })
}
