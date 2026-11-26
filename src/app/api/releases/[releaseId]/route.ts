import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { isValidDigest } from '@/lib/crypto'
import { evaluateReleasePolicy } from '@/lib/policy-engine'

export const dynamic = 'force-dynamic'

// Release state machine — server-enforced, mirrors the on-chain realm.
const TRANSITIONS: Record<string, { next: string[]; capability: string; requireDigest?: boolean }> = {
  DRAFT: { next: ['EVIDENCE_PENDING', 'REJECTED'], capability: 'release.write' },
  EVIDENCE_PENDING: { next: ['VALIDATING', 'REJECTED'], capability: 'release.write', requireDigest: true },
  VALIDATING: { next: ['REVIEW_REQUIRED', 'APPROVED', 'REJECTED'], capability: 'release.write' },
  REVIEW_REQUIRED: { next: ['APPROVED', 'REJECTED'], capability: 'release.write' },
  APPROVED: { next: ['PUBLISHED', 'REJECTED'], capability: 'release.publish', requireDigest: true },
  PUBLISHED: { next: ['VERIFIED', 'REVOKED', 'SUPERSEDED', 'DISPUTED'], capability: 'release.revoke' },
  VERIFIED: { next: ['REVOKED', 'SUPERSEDED', 'DISPUTED'], capability: 'release.revoke' },
  REJECTED: { next: [] },
  REVOKED: { next: [] },
  SUPERSEDED: { next: [] },
  DISPUTED: { next: [] },
}

// GET /api/releases/[releaseId]
export async function GET(req: NextRequest, ctx: { params: Promise<{ releaseId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { releaseId } = await ctx.params
    const release = await db.release.findUnique({
      where: { id: releaseId },
      include: {
        project: true,
        component: true,
        evidence: true,
        transactions: true,
        reviews: true,
      },
    })
    if (!release) throw err('NOT_FOUND')
    await requireProjectAccess(user.id, release.projectId, 'project.read')
    const attestations = await db.attestation.findMany({ where: { subjectType: 'RELEASE', subjectId: releaseId } })
    const policyVerdict = await evaluateReleasePolicy(release.projectId, releaseId)
    return {
      release: {
        id: release.id, version: release.version, commitHash: release.commitHash,
        branch: release.branch, repoUrl: release.repoUrl, buildEnv: release.buildEnv,
        pipelineRef: release.pipelineRef, artifactDigest: release.artifactDigest,
        artifactName: release.artifactName, status: release.status,
        publishedAt: release.publishedAt, supersededBy: release.supersededBy, createdAt: release.createdAt,
        component: release.component, evidence: release.evidence,
        attestations,
        transactions: release.transactions,
        reviews: release.reviews,
        protocolId: `${release.project.slug}-${release.version.toLowerCase()}`,
        allowedTransitions: (TRANSITIONS[release.status]?.next ?? []).map(next => ({ next, capability: TRANSITIONS[release.status].capability })),
      },
      policyVerdict,
    }
  })
}

// PATCH /api/releases/[releaseId] — perform a state transition
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ releaseId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { releaseId } = await ctx.params
    const body = await readJson<{ action?: string; artifactDigest?: string; supersededBy?: string; evidenceId?: string }>(req)
    const action = body.action ?? ''
    const release = await db.release.findUnique({ where: { id: releaseId }, include: { project: true } })
    if (!release) throw err('NOT_FOUND')

    // map action -> target state
    const actionMap: Record<string, string> = {
      'submit-evidence': 'EVIDENCE_PENDING',
      'validate': 'VALIDATING',
      'require-review': 'REVIEW_REQUIRED',
      'approve': 'APPROVED',
      'reject': 'REJECTED',
      'publish': 'PUBLISHED',
      'verify': 'VERIFIED',
      'revoke': 'REVOKED',
      'supersede': 'SUPERSEDED',
      'dispute': 'DISPUTED',
    }
    const target = actionMap[action]
    if (!target) throw err('VALIDATION_FAILED', { field: 'action', allowed: Object.keys(actionMap) })

    const rule = TRANSITIONS[release.status]
    if (!rule || !rule.next.includes(target)) {
      throw err('INVALID_TRANSITION', { from: release.status, to: target, allowed: rule?.next ?? [] })
    }

    // capability checks per target
    const capFor: Record<string, 'release.write' | 'release.publish' | 'release.revoke'> = {
      EVIDENCE_PENDING: 'release.write', VALIDATING: 'release.write', REVIEW_REQUIRED: 'release.write',
      APPROVED: 'release.write', REJECTED: 'release.write', PUBLISHED: 'release.publish',
      VERIFIED: 'release.revoke', REVOKED: 'release.revoke', SUPERSEDED: 'release.revoke', DISPUTED: 'release.revoke',
    }
    await requireProjectAccess(user.id, release.projectId, capFor[target])

    // data requirements
    const data: Record<string, unknown> = { status: target }
    if (target === 'EVIDENCE_PENDING' || target === 'APPROVED' || target === 'PUBLISHED') {
      const digest = body.artifactDigest ?? release.artifactDigest
      if (!isValidDigest(digest)) throw err('INVALID_DIGEST', { reason: 'a sha256 artifact digest is required before this transition' })
      data.artifactDigest = digest
    }
    if (target === 'PUBLISHED') {
      // policy gate: deterministic, server-side. Publication is blocked when
      // the project's active policy is not satisfied.
      const verdict = await evaluateReleasePolicy(release.projectId, releaseId)
      if (verdict && !verdict.passed) {
        throw err('INVALID_TRANSITION', { reason: 'publication policy not satisfied', policyChecks: verdict.checks })
      }
      data.publishedAt = new Date()
    }
    if (target === 'SUPERSEDED') {
      if (!body.supersededBy) throw err('VALIDATION_FAILED', { missing: ['supersededBy'] })
      const nextRelease = await db.release.findUnique({ where: { id: body.supersededBy } })
      if (!nextRelease || nextRelease.projectId !== release.projectId) throw err('VALIDATION_FAILED', { field: 'supersededBy', reason: 'must reference a release of the same project' })
      if (!['PUBLISHED', 'VERIFIED'].includes(nextRelease.status)) throw err('VALIDATION_FAILED', { reason: 'superseding release must be published' })
      data.supersededBy = body.supersededBy
    }
    if (target === 'VERIFIED') {
      // VERIFIED requires at least one active on-chain attestation — evidence
      // published to the protocol, not merely recorded.
      const onChainAtts = await db.attestation.count({
        where: { subjectType: 'RELEASE', subjectId: releaseId, status: 'ACTIVE', onChain: true },
      })
      if (onChainAtts === 0) {
        throw err('INVALID_TRANSITION', { reason: 'VERIFIED requires at least one on-chain attestation commitment' })
      }
    }

    const updated = await db.release.update({ where: { id: releaseId }, data })
    await audit({
      organizationId: release.project.organizationId, projectId: release.projectId,
      actorUserId: user.id, action: `release.${action}`, targetType: 'RELEASE',
      targetId: releaseId, metadata: { from: release.status, to: target }, ip: clientIp(req), traceId,
    })
    return { id: updated.id, status: updated.status, publishedAt: updated.publishedAt, supersededBy: updated.supersededBy }
  })
}
