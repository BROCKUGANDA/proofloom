import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp, requireAuthShim } from '@/lib/api'
import { requireAuth, requireMembership } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// GET /api/projects?orgId=... — projects of an organization (tenant-scoped)
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireAuthShim()
    if (!auth) throw err('AUTH_REQUIRED')
    const orgId = new URL(req.url).searchParams.get('orgId')
    if (!orgId) throw err('VALIDATION_FAILED', { missing: ['orgId'] })
    const membership = await requireMembership(auth.user.id, orgId, 'project.read')
    void membership
    const projects = await db.project.findMany({
      where: { organizationId: orgId },
      include: {
        _count: { select: { releases: true, components: true, tasks: true } },
        releases: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, version: true } },
        policies: { where: { active: true }, select: { name: true, version: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })
    return projects.map(p => ({
      id: p.id, slug: p.slug, name: p.name, description: p.description,
      repoUrl: p.repoUrl, category: p.category, visibility: p.visibility, status: p.status,
      techStack: p.techStack.split(',').filter(Boolean),
      gnoRegistered: p.gnoRegistered, onChainRef: p.onChainRef,
      counts: p._count,
      latestRelease: p.releases[0] ?? null,
      policy: p.policies[0] ?? null,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    }))
  })
}

// POST /api/projects — create a project
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const body = await readJson<{
      orgId?: string; name?: string; description?: string; repoUrl?: string
      category?: string; visibility?: string; techStack?: string[]
      registerOnChain?: boolean
    }>(req)
    if (!body.orgId) throw err('VALIDATION_FAILED', { missing: ['orgId'] })
    if (!body.name || body.name.length < 2 || body.name.length > 120) throw err('VALIDATION_FAILED', { field: 'name' })
    await requireMembership(user.id, body.orgId, 'project.create')

    const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)}-${Math.random().toString(36).slice(2, 6)}`
    if (body.visibility && !['public', 'private'].includes(body.visibility)) throw err('VALIDATION_FAILED', { field: 'visibility' })

    const project = await db.project.create({
      data: {
        organizationId: body.orgId,
        slug,
        name: body.name,
        description: (body.description ?? '').slice(0, 1000),
        repoUrl: body.repoUrl ?? '',
        category: body.category ?? 'service',
        visibility: body.visibility ?? 'public',
        techStack: (body.techStack ?? []).slice(0, 12).join(','),
        createdBy: user.id,
      },
    })

    // Note: on-chain registration happens through the user's wallet signing
    // (client-initiated) or the operator flow; the flag records intent and
    // the UI drives the signing flow. No fabricated on-chain refs.
    await audit({
      organizationId: body.orgId, projectId: project.id, actorUserId: user.id,
      action: 'project.create', targetType: 'PROJECT', targetId: project.id,
      metadata: { slug: project.slug, visibility: project.visibility, registerOnChain: !!body.registerOnChain },
      ip: clientIp(req), traceId,
    })
    return { id: project.id, slug: project.slug, name: project.name }
  })
}
