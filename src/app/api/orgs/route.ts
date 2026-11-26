import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp, requireAuthShim } from '@/lib/api'
import { requireAuth } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// GET /api/orgs — list the user's organizations
export async function GET() {
  return withApi(async () => {
    const auth = await requireAuthShim()
    if (!auth) throw err('AUTH_REQUIRED')
    const memberships = await db.membership.findMany({
      where: { userId: auth.user.id },
      include: { organization: { include: { _count: { select: { projects: true, memberships: true } } } } },
      orderBy: { createdAt: 'asc' },
    })
    return memberships.map(m => ({
      id: m.organizationId,
      slug: m.organization.slug,
      name: m.organization.name,
      role: m.role,
      archived: m.organization.archived,
      projects: m.organization._count.projects,
      members: m.organization._count.memberships,
      createdAt: m.organization.createdAt,
    }))
  })
}

// POST /api/orgs — create an organization
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const { user, session } = await requireAuth()
    const body = await readJson<{ name?: string; slug?: string }>(req)
    if (!body.name || body.name.length < 2 || body.name.length > 80) throw err('VALIDATION_FAILED', { field: 'name' })
    const baseSlug = (body.slug ?? body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const slug = `${baseSlug || 'org'}-${Math.random().toString(36).slice(2, 6)}`
    const org = await db.organization.create({
      data: { slug, name: body.name, ownerId: user.id },
    })
    await db.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'OWNER' } })
    await audit({
      organizationId: org.id, actorUserId: user.id, action: 'org.create',
      targetType: 'ORGANIZATION', targetId: org.id, ip: clientIp(req), traceId,
    })
    return { id: org.id, slug: org.slug, name: org.name }
  })
}
