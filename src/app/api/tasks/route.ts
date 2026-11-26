import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { sha256Hex } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// GET /api/tasks?projectId= — task board
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const projectId = new URL(req.url).searchParams.get('projectId')
    if (!projectId) throw err('VALIDATION_FAILED', { missing: ['projectId'] })
    await requireProjectAccess(user.id, projectId, 'project.read')
    const tasks = await db.task.findMany({
      where: { projectId },
      include: {
        agent: { select: { id: true, name: true, slug: true, status: true } },
        assignee: { select: { id: true, displayName: true } },
        reviews: { include: { reviewer: { select: { displayName: true } } } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    })
    return tasks
  })
}

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['EVIDENCE_SUBMITTED', 'CANCELLED'],
  EVIDENCE_SUBMITTED: ['REVIEW'],
  REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['COMPLETED'],
  REJECTED: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  EXPIRED: [],
  CANCELLED: [],
}

// POST /api/tasks — create task
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const body = await readJson<{
      projectId?: string; title?: string; description?: string; assigneeType?: string
      assigneeAgentId?: string; assigneeUserId?: string; priority?: string; requiresEvidence?: boolean; dueAt?: string
    }>(req)
    if (!body.projectId || !body.title) throw err('VALIDATION_FAILED', { missing: ['projectId', 'title'] })
    const project = await requireProjectAccess(user.id, body.projectId, 'task.write')
    if (project.status === 'ARCHIVED') throw err('ARCHIVED')
    if (body.assigneeType === 'AGENT' && body.assigneeAgentId) {
      const agent = await db.agent.findUnique({ where: { id: body.assigneeAgentId } })
      if (!agent || agent.organizationId !== project.organizationId) throw err('TENANT_ISOLATION')
    }
    const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    if (body.priority && !priorities.includes(body.priority)) throw err('VALIDATION_FAILED', { field: 'priority' })

    const task = await db.task.create({
      data: {
        projectId: body.projectId,
        title: body.title.slice(0, 200),
        description: (body.description ?? '').slice(0, 4000),
        assigneeType: body.assigneeType === 'AGENT' ? 'AGENT' : 'HUMAN',
        assigneeAgentId: body.assigneeType === 'AGENT' ? body.assigneeAgentId : null,
        assigneeUserId: body.assigneeType !== 'AGENT' ? (body.assigneeUserId ?? null) : null,
        priority: body.priority ?? 'MEDIUM',
        requiresEvidence: body.requiresEvidence ?? true,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        createdBy: user.id,
        state: body.assigneeType === 'AGENT' || body.assigneeUserId ? 'ASSIGNED' : 'OPEN',
      },
    })
    await audit({ organizationId: project.organizationId, projectId: project.id, actorUserId: user.id, action: 'task.create', targetType: 'TASK', targetId: task.id, metadata: { title: task.title, assigneeType: task.assigneeType }, ip: clientIp(req), traceId })
    return task
  })
}

// PATCH /api/tasks/[taskId] — transition, complete with receipt
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { taskId } = await ctx.params
    const body = await readJson<{ action?: string; comment?: string; completionDigest?: string }>(req)
    const task = await db.task.findUnique({ where: { id: taskId }, include: { project: true } })
    if (!task) throw err('NOT_FOUND')
    await requireProjectAccess(user.id, task.projectId, 'task.write')

    const actionMap: Record<string, string> = {
      'assign': 'ASSIGNED', 'start': 'IN_PROGRESS', 'submit-evidence': 'EVIDENCE_SUBMITTED',
      'send-review': 'REVIEW', 'approve': 'APPROVED', 'reject': 'REJECTED',
      'complete': 'COMPLETED', 'cancel': 'CANCELLED', 'expire': 'EXPIRED',
    }
    const target = actionMap[body.action ?? '']
    if (!target) throw err('VALIDATION_FAILED', { field: 'action', allowed: Object.keys(actionMap) })
    if (!TRANSITIONS[task.state]?.includes(target)) {
      throw err('INVALID_TRANSITION', { from: task.state, to: target, allowed: TRANSITIONS[task.state] })
    }

    const data: Record<string, unknown> = { state: target }
    if (target === 'COMPLETED') {
      if (!body.completionDigest) {
        // completion requires an evidence digest: the receipt binds the task
        // to inspectable evidence
        throw err('VALIDATION_FAILED', { reason: 'completionDigest (sha256 of completion evidence) required' })
      }
      const digest = body.completionDigest.startsWith('0x')
        ? await Promise.resolve(sha256Hex(body.completionDigest.slice(2)))
        : body.completionDigest
      if (!/^[0-9a-f]{64}$/.test(digest)) throw err('INVALID_DIGEST')
      data.completionDigest = digest
      data.completedAt = new Date()
    }
    if (target === 'APPROVED') {
      await db.review.create({
        data: { taskId, reviewerId: user.id, decision: 'APPROVED', comment: body.comment ?? '', decidedAt: new Date() },
      })
    }
    if (target === 'REJECTED') {
      await db.review.create({
        data: { taskId, reviewerId: user.id, decision: 'REJECTED', comment: body.comment ?? 'changes requested', decidedAt: new Date() },
      })
    }

    const updated = await db.task.update({ where: { id: taskId }, data })
    await audit({
      organizationId: task.project.organizationId, projectId: task.projectId,
      actorUserId: user.id, action: `task.${body.action}`, targetType: 'TASK', targetId,
      metadata: { from: task.state, to: target }, ip: clientIp(req), traceId,
    })
    return updated
  })
}
