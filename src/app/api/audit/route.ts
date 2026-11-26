import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireMembership } from '@/lib/auth'
import { err } from '@/lib/errors'

export const dynamic = 'force-dynamic'

// GET /api/audit?orgId= — the immutable audit trail
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const url = new URL(req.url)
    const orgId = url.searchParams.get('orgId')
    const projectId = url.searchParams.get('projectId')
    const action = url.searchParams.get('action')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 500)
    if (!orgId) throw err('VALIDATION_FAILED', { missing: ['orgId'] })
    await requireMembership(user.id, orgId, 'audit.read')
    const events = await db.auditEvent.findMany({
      where: {
        organizationId: orgId,
        ...(projectId ? { projectId } : {}),
        ...(action ? { action: { startsWith: action } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    const actions = await db.auditEvent.groupBy({
      by: ['action'], where: { organizationId: orgId }, _count: { action: true },
    })
    return {
      events,
      actionSummary: actions.sort((a, b) => b._count.action - a._count.action),
      immutable: true,
      note: 'Audit events are append-only; the API exposes no update or delete path.',
    }
  })
}

// POST is intentionally absent: the audit trail is written by the platform
// as a side effect of privileged actions, never directly by clients.
export async function POST() {
  return withApi(async () => {
    throw err('FORBIDDEN', { reason: 'audit events are append-only and platform-written' })
  })
}
