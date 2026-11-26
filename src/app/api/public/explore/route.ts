import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, clientIp, guardRate } from '@/lib/api'
import { verifyChainIdentity, activeChain, fetchRegistryStats, fetchOnChainProject, fetchReleaseStatus } from '@/lib/chain'

export const dynamic = 'force-dynamic'

// GET /api/public/explore — public explorer data: projects, releases,
// attestations, protocol stats, live chain status. No auth.
export async function GET(req: NextRequest) {
  return withApi(async (traceId) => {
    await guardRate('public-explore', clientIp(req), 240, 60_000)
    const url = new URL(req.url)
    const want = url.searchParams.get('kind') ?? 'summary'
    const id = url.searchParams.get('id')

    if (want === 'summary') {
      const [projects, releases, attestations, agents] = await Promise.all([
        db.project.findMany({
          where: { visibility: 'public', status: 'ACTIVE' },
          select: { id: true, slug: true, name: true, description: true, category: true, repoUrl: true, techStack: true, gnoRegistered: true, createdAt: true, _count: { select: { releases: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.release.findMany({
          where: { status: { in: ['PUBLISHED', 'VERIFIED', 'REVOKED', 'SUPERSEDED', 'DISPUTED'] }, project: { visibility: 'public' } },
          include: { project: { select: { slug: true, name: true, visibility: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.attestation.findMany({
          where: { status: 'ACTIVE', subjectType: 'RELEASE' },
          include: { release: { select: { version: true, project: { select: { visibility: true, slug: true } } } } },
          orderBy: { issuedAt: 'desc' },
          take: 50,
        }),
        db.agent.count({ where: { status: 'ACTIVE' } }),
      ])
      const attCountByRelease = new Map(
        (await db.attestation.groupBy({ by: ['subjectId'], where: { subjectType: 'RELEASE', status: 'ACTIVE' }, _count: { subjectId: true } }))
          .map(g => [g.subjectId, g._count.subjectId]))
      let chainStats = null
      try {
        chainStats = await fetchRegistryStats()
      } catch { /* on-chain stats optional */ }
      return {
        projects: projects.map(p => ({ ...p, techStack: p.techStack.split(',').filter(Boolean), releaseCount: p._count.releases })),
        releases: releases.map(r => ({
          id: r.id, protocolId: `${r.project.slug}-${r.version.toLowerCase()}`,
          project: r.project.slug, projectName: r.project.name, version: r.version,
          commitHash: r.commitHash, status: r.status, artifactDigest: r.artifactDigest,
          publishedAt: r.publishedAt, createdAt: r.createdAt,
          activeAttestations: attCountByRelease.get(r.id) ?? 0,
        })),
        attestations: attestations
          .filter(a => a.release?.project?.visibility === 'public')
          .map(a => ({
            id: a.id, protocolId: a.protocolId, category: a.category, issuerAddress: a.issuerAddress,
            digest: a.digest, issuedAt: a.issuedAt, onChain: a.onChain,
            subjectType: a.subjectType, subjectVersion: a.release?.version,
          })),
        agents,
        chain: { chainId: activeChain().chainId, label: activeChain().label, realmPrefix: activeChain().realmPrefix, rpc: activeChain().rpc },
        onChainStats: chainStats,
      }
    }

    if (want === 'project' && id) {
      const project = await db.project.findFirst({
        where: { slug: id, visibility: 'public', status: 'ACTIVE' },
        include: {
          releases: { orderBy: { createdAt: 'desc' } },
          components: true,
          policies: { where: { active: true } },
        },
      })
      if (!project) return { error: 'project not found or not public' }
      const publicAttsByRelease = new Map(
        (await db.attestation.findMany({
          where: { subjectType: 'RELEASE', status: 'ACTIVE', subjectId: { in: project.releases.map(r => r.id) } },
        })).map(a => [a.subjectId, [a]]))
      let onChain = null
      try {
        onChain = await fetchOnChainProject(project.slug)
      } catch { /* optional */ }
      return {
        project: {
          id: project.id, slug: project.slug, name: project.name, description: project.description,
          repoUrl: project.repoUrl, category: project.category, techStack: project.techStack.split(',').filter(Boolean),
          gnoRegistered: project.gnoRegistered, onChainRef: project.onChainRef, createdAt: project.createdAt,
        },
        onChain,
        releases: project.releases.map(r => ({
          id: r.id, protocolId: `${project.slug}-${r.version.toLowerCase()}`, version: r.version,
          commitHash: r.commitHash, status: r.status, artifactDigest: r.artifactDigest,
          publishedAt: r.publishedAt,
          attestations: (publicAttsByRelease.get(r.id) ?? []).map(a => ({ protocolId: a.protocolId, category: a.category, status: a.status, issuerAddress: a.issuerAddress, onChain: a.onChain, digest: a.digest })),
        })),
        components: project.components,
        policy: project.policies[0] ? {
          version: project.policies[0].version,
          requireCategories: project.policies[0].requireCategories.split(',').filter(Boolean),
          minApprovals: project.policies[0].minApprovals,
        } : null,
      }
    }

    if (want === 'release-status' && id) {
      // direct protocol id status: proxies the on-chain realm when deployed
      const platform = await db.release.findFirst({
        where: { project: { slug: id.split('-').slice(0, -1).join('-'), visibility: 'public' } },
        orderBy: { createdAt: 'desc' },
      })
      let chainStatus: string | null = null
      try {
        chainStatus = await fetchReleaseStatus(id)
      } catch { /* optional */ }
      return { protocolId: id, onChainStatus: chainStatus, onChainRecorded: chainStatus !== null }
    }

    void traceId
    return { error: 'unknown kind', allowed: ['summary', 'project', 'release-status'] }
  })
}
