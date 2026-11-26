import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireMembership } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { randomToken, sha256Token } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// GET /api/keys?orgId= — API credentials (prefixes only, never raw keys)
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const orgId = new URL(req.url).searchParams.get('orgId')
    if (!orgId) throw err('VALIDATION_FAILED', { missing: ['orgId'] })
    await requireMembership(user.id, orgId, 'apikeys.manage')
    const keys = await db.apiCredential.findMany({
      where: { organizationId: orgId, revokedAt: null },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return keys
  })
}

// POST /api/keys — create credential. The raw key is returned EXACTLY ONCE.
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const body = await readJson<{ orgId?: string; name?: string; scopes?: string[] }>(req)
    if (!body.orgId || !body.name) throw err('VALIDATION_FAILED', { missing: ['orgId', 'name'] })
    await requireMembership(user.id, body.orgId, 'apikeys.manage')
    const scopes = (body.scopes ?? ['read']).join(',')
    const raw = `plk_${randomToken(24)}`
    const credential = await db.apiCredential.create({
      data: {
        organizationId: body.orgId,
        userId: user.id,
        name: body.name.slice(0, 80),
        prefix: raw.slice(0, 12),
        keyHash: sha256Token(raw),
        scopes,
      },
    })
    await audit({ organizationId: body.orgId, actorUserId: user.id, action: 'apikey.create', targetType: 'API_CREDENTIAL', targetId: credential.id, metadata: { scopes }, ip: clientIp(req), traceId })
    return { id: credential.id, name: credential.name, prefix: credential.prefix, scopes, key: raw, warning: 'Store this key now. It is not retrievable after this response.' }
  })
}

// DELETE /api/keys?id=
export async function DELETE(req: NextRequest) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const id = new URL(req.url).searchParams.get('id')
    if (!id) throw err('VALIDATION_FAILED', { missing: ['id'] })
    const credential = await db.apiCredential.findUnique({ where: { id } })
    if (!credential) throw err('NOT_FOUND')
    await requireMembership(user.id, credential.organizationId, 'apikeys.manage')
    await db.apiCredential.update({ where: { id }, data: { revokedAt: new Date() } })
    await audit({ organizationId: credential.organizationId, actorUserId: user.id, action: 'apikey.revoke', targetType: 'API_CREDENTIAL', targetId: id, ip: clientIp(req), traceId })
    return { ok: true }
  })
}
