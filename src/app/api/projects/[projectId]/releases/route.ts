import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { assertMetered, recordUsage, refundUsage } from '@/lib/entitlements'
import { isValidDigest } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// The on-chain project id is the slug; releases compose their protocol id
// from it (core.ComposeReleaseID: projectID + '-' + version).
const slugOf = (r: { project?: { slug?: string } | null; projectId: string }) =>
  r.project?.slug ?? ''

// GET /api/projects/[projectId]/releases
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    await requireProjectAccess(user.id, projectId, 'project.read')
    const releases = await db.release.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        evidence: { select: { id: true, kind: true, title: true, contentHash: true } },
        transactions: { select: { id: true, kind: true, status: true, txHash: true, createdAt: true } },
      },
    })
    const relIds = releases.map(r => r.id)
    const atts = relIds.length > 0
      ? await db.attestation.findMany({ where: { subjectType: 'RELEASE', subjectId: { in: relIds } } })
      : []
    const attsByRelease = new Map(atts.map(a => [a.subjectId, a]))
    return releases.map(r => ({
      id: r.id,
      protocolId: `${slugOf(r)}-${r.version.toLowerCase()}`,
      version: r.version, commitHash: r.commitHash, branch: r.branch, repoUrl: r.repoUrl,
      buildEnv: r.buildEnv, pipelineRef: r.pipelineRef,
      artifactDigest: r.artifactDigest, artifactName: r.artifactName,
      status: r.status, publishedAt: r.publishedAt, supersededBy: r.supersededBy,
      createdAt: r.createdAt,
      attestations: atts.filter(a => a.subjectId === r.id).map(a => ({ id: a.id, protocolId: a.protocolId, category: a.category, status: a.status, issuerAddress: a.issuerAddress, onChain: a.onChain, digest: a.digest })),
      evidence: r.evidence,
      transactions: r.transactions,
    }))
  })
}

// POST /api/projects/[projectId]/releases — create a release in DRAFT
export async function POST(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    const project = await requireProjectAccess(user.id, projectId, 'release.create')
    if (project.status === 'ARCHIVED') throw err('ARCHIVED')
    const body = await readJson<{
      version?: string; commitHash?: string; branch?: string; repoUrl?: string
      buildEnv?: string; pipelineRef?: string; componentId?: string
      artifactDigest?: string; artifactName?: string
    }>(req)
    if (!body.version || !/^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,31}$/.test(body.version)) {
      throw err('VALIDATION_FAILED', { field: 'version', reason: 'version looks like neither semver nor a valid tag' })
    }
    if (!body.commitHash || !/^[0-9a-f]{7,64}$/.test(body.commitHash)) throw err('VALIDATION_FAILED', { field: 'commitHash' })
    if (body.artifactDigest && !isValidDigest(body.artifactDigest)) throw err('INVALID_DIGEST')

    const dup = await db.release.findUnique({ where: { projectId_version: { projectId, version: body.version } } })
    if (dup) throw err('DUPLICATE', { reason: `version ${body.version} already exists` })

    // Entitlement: monthly release allowance for the org's plan.
    await assertMetered(project.organizationId, 'releases')

    const release = await db.release.create({
      data: {
        projectId,
        componentId: body.componentId,
        version: body.version,
        commitHash: body.commitHash,
        branch: (body.branch ?? 'main').slice(0, 120),
        repoUrl: (body.repoUrl ?? project.repoUrl).slice(0, 300),
        buildEnv: (body.buildEnv ?? '').slice(0, 200),
        pipelineRef: (body.pipelineRef ?? '').slice(0, 200),
        artifactDigest: body.artifactDigest,
        artifactName: (body.artifactName ?? '').slice(0, 200),
        status: 'DRAFT',
        createdBy: user.id,
      },
    })
    await audit({
      organizationId: project.organizationId, projectId, actorUserId: user.id,
      action: 'release.create', targetType: 'RELEASE', targetId: release.id,
      metadata: { version: release.version, commit: release.commitHash },
      ip: clientIp(req), traceId,
    })
    // Entitlement metering: record the consumption after the successful create.
    await recordUsage(project.organizationId, 'releases')
    return { id: release.id, version: release.version, status: release.status }
  })
}
