import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson } from '@/lib/api'
import { requireAuth } from '@/lib/auth'
import { err } from '@/lib/errors'
import { webhookSignature, constantTimeEqual } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// GET /api/notifications — unread + recent
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return { notifications, unread: notifications.filter(n => !n.readAt).length }
  })
}

// PATCH /api/notifications — mark read
export async function PATCH(req: NextRequest) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const body = await readJson<{ ids?: string[]; all?: boolean }>(req)
    if (body.all) {
      await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } })
      return { ok: true }
    }
    if (body.ids?.length) {
      await db.notification.updateMany({ where: { userId: user.id, id: { in: body.ids } }, data: { readAt: new Date() } })
      return { ok: true, updated: body.ids.length }
    }
    throw err('VALIDATION_FAILED', { missing: ['ids or all'] })
  })
}

// ─── GitHub webhook endpoint (separate concern, same file family) ───────────

// POST /api/notifications is not the webhook path; see /api/webhooks/github
export async function PUT(req: NextRequest) {
  return withApi(async () => {
    throw err('NOT_FOUND')
  })
}
