import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { assertMetered, recordUsage } from '@/lib/entitlements'
import { isValidDigest, isValidGnoAddress } from '@/lib/crypto'
import { CATEGORIES } from '@/lib/categories'

export const dynamic = 'force-dynamic'

// POST /api/releases/[releaseId]/attest — issue an attestation commitment
export async function POST(req: NextRequest, ctx: { params: Promise<{ releaseId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { releaseId } = await ctx.params
    const release = await db.release.findUnique({ where: { id: releaseId }, include: { project: true } })
    if (!release) throw err('NOT_FOUND')
    // AUDITORs and up may issue attestations
    await requireProjectAccess(user.id, release.projectId, 'attestation.issue')
    // Entitlement: monthly attestation allowance for the owning org's plan.
    await assertMetered(release.project.organizationId, 'attestations')

    const body = await readJson<{
      category?: string; digest?: string; evidenceId?: string
      issuerAddress?: string; expiresAt?: string; onChain?: boolean; chainTxHash?: string
    }>(req)
    const category = body.category ?? ''
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) throw err('VALIDATION_FAILED', { field: 'category', allowed: CATEGORIES })
    const digest = body.evidenceId
      ? (await db.evidence.findUnique({ where: { id: body.evidenceId } }))?.contentHash
      : body.digest
    if (!digest || !isValidDigest(digest)) throw err('INVALID_DIGEST')

    const issuerAddress = body.issuerAddress ?? user.gnoAddress
    if (!issuerAddress || !isValidGnoAddress(issuerAddress)) {
      throw err('INVALID_ADDRESS', { reason: 'link a Gno wallet or pass issuerAddress; attestations carry an issuer proof' })
    }

    const protocolId = `${release.project.slug}-${release.version.toLowerCase()}-${category.toLowerCase()}-${issuerAddress}`
    const existing = await db.attestation.findUnique({ where: { protocolId } })
    if (existing && existing.status === 'ACTIVE') {
      throw err('DUPLICATE', { reason: 'an active attestation from this issuer for this subject and category already exists', protocolId })
    }

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw err('VALIDATION_FAILED', { reason: 'expiry must be in the future' })

    const attestation = await db.attestation.upsert({
      where: { protocolId },
      create: {
        protocolId,
        subjectType: 'RELEASE',
        subjectId: releaseId,
        category,
        issuerId: user.id,
        issuerAddress,
        digest,
        evidenceId: body.evidenceId,
        projectId: release.projectId,
        organizationId: release.project.organizationId,
        expiresAt,
        onChain: !!body.onChain,
        chainTxHash: body.chainTxHash,
      },
      update: {
        digest, evidenceId: body.evidenceId, status: 'ACTIVE',
        issuedAt: new Date(), expiresAt, revokedAt: null, revokedReason: null,
        onChain: !!body.onChain, chainTxHash: body.chainTxHash,
      },
    })

    await audit({
      organizationId: release.project.organizationId, projectId: release.projectId,
      actorUserId: user.id, actorAddress: issuerAddress, action: 'attestation.issue',
      targetType: 'ATTESTATION', targetId: attestation.id,
      metadata: { category: body.category, subjectId: releaseId, protocolId, onChain: !!body.onChain, chainTxHash: body.chainTxHash },
      ip: clientIp(req), traceId,
    })
    // Entitlement metering: record the consumption after the successful issue.
    await recordUsage(release.project.organizationId, 'attestations')
    return { id: attestation.id, protocolId, status: attestation.status, digest }
  })
}
