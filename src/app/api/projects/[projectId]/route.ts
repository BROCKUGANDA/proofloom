import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { isValidGnoAddress } from '@/lib/crypto'
import { fetchOnChainProject } from '@/lib/chain'

export const dynamic = 'force-dynamic'

// GET /api/projects/[projectId] — full project workspace payload
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    const project = await requireProjectAccess(user.id, projectId, 'project.read')

    const [components, dependencies, releases, tasks, policies, agents, allAtts] = await Promise.all([
      db.component.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      db.dependency.findMany({ where: { projectId }, orderBy: [{ isDirect: 'desc' }, { name: 'asc' }] }),
      db.release.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, include: { evidence: true } }),
      db.task.findMany({ where: { projectId }, orderBy: { updatedAt: 'desc' }, include: { agent: { select: { name: true, slug: true } }, reviews: true } }),
      db.policy.findMany({ where: { projectId }, orderBy: { version: 'desc' } }),
      db.agent.findMany({ where: { projectId }, select: { id: true, name: true, slug: true, status: true, version: true } }),
      db.attestation.findMany({ where: { subjectType: 'RELEASE', subjectId: { in: (await db.release.findMany({ where: { projectId }, select: { id: true } })).map(r => r.id) } } }),
    ])
    const attsByRelease = new Map(allAtts.map(a => [a.subjectId, [{ id: a.id, protocolId: a.protocolId, category: a.category, status: a.status, onChain: a.onChain }]]))

    // on-chain mirror (live query when the realm is deployed)
    let onChainProject: Awaited<ReturnType<typeof fetchOnChainProject>> = null
    try {
      onChainProject = await fetchOnChainProject(project.slug)
    } catch { /* chain unavailable: report platform data only */ }

    return {
      project: {
        id: project.id, slug: project.slug, name: project.name, description: project.description,
        repoUrl: project.repoUrl, category: project.category, visibility: project.visibility,
        status: project.status, techStack: project.techStack.split(',').filter(Boolean),
        gnoRegistered: project.gnoRegistered, onChainRef: project.onChainRef,
        organizationId: project.organizationId, createdAt: project.createdAt,
      },
      onChain: onChainProject,
      components, dependencies,
      releases: releases.map(r => ({
        id: r.id, version: r.version, commitHash: r.commitHash, branch: r.branch,
        artifactDigest: r.artifactDigest, artifactName: r.artifactName, status: r.status,
        publishedAt: r.publishedAt, supersededBy: r.supersededBy, createdAt: r.createdAt,
        attestations: attsByRelease.get(r.id) ?? [],
        evidenceCount: r.evidence.length,
      })),
      tasks,
      policies,
      agents,
    }
  })
}

// PATCH /api/projects/[projectId] — update metadata, archive/restore, transfer
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    const project = await requireProjectAccess(user.id, projectId, 'project.write')
    const body = await readJson<{
      name?: string; description?: string; repoUrl?: string; category?: string
      visibility?: string; techStack?: string[]; archive?: boolean; gnoRegistered?: boolean; onChainRef?: string
    }>(req)

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = body.name.slice(0, 120)
    if (body.description !== undefined) data.description = body.description.slice(0, 1000)
    if (body.repoUrl !== undefined) data.repoUrl = body.repoUrl.slice(0, 300)
    if (body.category !== undefined) data.category = body.category.slice(0, 40)
    if (body.visibility !== undefined) {
      if (!['public', 'private'].includes(body.visibility)) throw err('VALIDATION_FAILED', { field: 'visibility' })
      data.visibility = body.visibility
    }
    if (body.techStack !== undefined) data.techStack = body.techStack.slice(0, 12).join(',')
    if (body.archive !== undefined) {
      await requireProjectAccess(user.id, projectId, 'project.archive')
      data.status = body.archive ? 'ARCHIVED' : 'ACTIVE'
    }
    if (body.gnoRegistered !== undefined) {
      // Only the platform records on-chain success after tx confirmation; the
      // client sends the tx hash from the wallet callback.
      if (body.gnoRegistered && !body.onChainRef) throw err('VALIDATION_FAILED', { reason: 'onChainRef (tx hash) required to mark on-chain registration' })
      if (body.onChainRef && !/^[\w.-]{6,120}$/.test(body.onChainRef)) throw err('VALIDATION_FAILED', { field: 'onChainRef' })
      data.gnoRegistered = body.gnoRegistered
      if (body.onChainRef) data.onChainRef = body.onChainRef
    }

    const updated = await db.project.update({ where: { id: projectId }, data })
    await audit({
      organizationId: project.organizationId, projectId, actorUserId: user.id,
      action: 'project.update', targetType: 'PROJECT', targetId: projectId,
      metadata: { fields: Object.keys(data) }, ip: clientIp(req), traceId,
    })
    return { id: updated.id, status: updated.status, gnoRegistered: updated.gnoRegistered }
  })
}
