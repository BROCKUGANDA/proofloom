import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess, requireMembership } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { evaluateReleasePolicy, policyFromRow, simulatePolicy, isValidCategory } from '@/lib/policy-engine'
import { isValidGnoAddress } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// GET /api/policies?projectId= | ?orgId=
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const url = new URL(req.url)
    const projectId = url.searchParams.get('projectId')
    const orgId = url.searchParams.get('orgId')
    if (projectId) {
      await requireProjectAccess(user.id, projectId, 'policy.read')
      const policies = await db.policy.findMany({ where: { projectId }, orderBy: [{ active: 'desc' }, { version: 'desc' }] })
      return { policies: policies.map(p => ({ ...p, input: policyFromRow(p) })) }
    }
    if (orgId) {
      await requireMembership(user.id, orgId, 'policy.read')
      const policies = await db.policy.findMany({ where: { organizationId: orgId }, orderBy: { updatedAt: 'desc' } })
      return { policies: policies.map(p => ({ ...p, input: policyFromRow(p) })) }
    }
    throw err('VALIDATION_FAILED', { missing: ['projectId or orgId'] })
  })
}

// POST /api/policies — set policy, simulate
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const body = await readJson<Record<string, unknown>>(req)
    const op = (body.op as string) ?? 'set'
    const ip = clientIp(req)

    if (op === 'set') {
      const projectId = body.projectId as string
      const project = await requireProjectAccess(user.id, projectId, 'policy.write')
      const categories = ((body.requireCategories as string[]) ?? []).map(c => c.toUpperCase())
      for (const c of categories) if (!isValidCategory(c)) throw err('VALIDATION_FAILED', { field: 'requireCategories', invalid: c })
      const issuers = ((body.allowedIssuers as string[]) ?? [])
      for (const i of issuers) if (!isValidGnoAddress(i)) throw err('INVALID_ADDRESS', { address: i })
      const minApprovals = (body.minApprovals as number) ?? 0
      if (minApprovals < 0 || minApprovals > 16) throw err('VALIDATION_FAILED', { field: 'minApprovals' })

      // deactivate prior versions, create the new one
      await db.policy.updateMany({ where: { projectId, active: true }, data: { active: false } })
      const prior = await db.policy.findFirst({ where: { projectId }, orderBy: { version: 'desc' } })
      const policy = await db.policy.create({
        data: {
          projectId,
          organizationId: project.organizationId,
          name: ((body.name as string) ?? 'Publication policy').slice(0, 80),
          version: (prior?.version ?? 0) + 1,
          requireCategories: categories.join(','),
          minApprovals,
          allowedIssuers: issuers.join(','),
          requireNoCritical: !!body.requireNoCritical,
          requireValidSBOM: !!body.requireValidSBOM,
          requireSignedEvidence: !!body.requireSignedEvidence,
          active: true,
          updatedBy: user.id,
        },
      })
      await audit({
        organizationId: project.organizationId, projectId, actorUserId: user.id,
        action: 'policy.set', targetType: 'POLICY', targetId: policy.id,
        metadata: { version: policy.version, categories, minApprovals }, ip, traceId,
      })
      return { id: policy.id, version: policy.version }
    }

    if (op === 'clear') {
      const projectId = body.projectId as string
      await requireProjectAccess(user.id, projectId, 'policy.write')
      await db.policy.updateMany({ where: { projectId, active: true }, data: { active: false } })
      await audit({ projectId, actorUserId: user.id, action: 'policy.clear', targetType: 'POLICY', targetId: projectId, ip, traceId })
      return { ok: true }
    }

    if (op === 'simulate') {
      const projectId = body.projectId as string
      await requireProjectAccess(user.id, projectId, 'policy.read')
      const result = await simulatePolicy(projectId, body.releaseId as string | undefined)
      return result ?? { passed: true, checks: [{ requirement: 'NO_POLICY', passed: true, detail: 'no active policy; baseline applies' }] }
    }

    throw err('VALIDATION_FAILED', { field: 'op', allowed: ['set', 'clear', 'simulate'] })
  })
}
