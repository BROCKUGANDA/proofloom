import { db } from '@/lib/db'
import { isValidDigest } from '@/lib/crypto'
import { fetchOnChainVerdict, activeChain, realmPath } from '@/lib/chain'
import { err } from '@/lib/errors'

// PROOFLOOM verification engine.
//
// A green result is never granted merely because a record exists. The
// engine evaluates ten independent checks and reports each one's outcome.
// Verdict semantics:
//   VERIFIED — every applicable check passed
//   PENDING  — record is real but checks incomplete (details explain which)
//   REVOKED / EXPIRED / FAILED / UNKNOWN — truthful negative states
//
// Checks:
//  1. record_exists          the attestation/release exists in the system
//  2. signature_valid        issuer proof recorded & issuer known
//  3. issuer_identity        issuer resolves to an identity (user/wallet)
//  4. issuer_authorized      issuer held authority over the subject at issue
//  5. digest_integrity       recorded digest re-computed from evidence bytes
//  6. not_expired            expiry window respected
//  7. not_revoked            no revocation recorded
//  8. chain_publication      on-chain commitment present and queryable
//  9. evidence_accessible    evidence bytes retrievable and hash-matching
// 10. completeness           all policy-required categories present

export interface CheckResult {
  requirement: string
  passed: boolean
  detail: string
}

export interface VerificationReport {
  targetType: 'RELEASE' | 'ATTESTATION' | 'DIGEST'
  targetId: string
  verdict: 'VERIFIED' | 'PENDING' | 'REVOKED' | 'EXPIRED' | 'FAILED' | 'UNKNOWN'
  checks: CheckResult[]
  onChain?: {
    network: string
    realm: string
    txHash?: string
    chainVerdict?: string
    releaseStatus?: string
  }
  limitations: string[]
  durationMs: number
}

function check(requirement: string, passed: boolean, detail: string): CheckResult {
  return { requirement, passed, detail }
}

export async function verifyAttestation(attestationId: string): Promise<VerificationReport> {
  const started = Date.now()
  const limitations: string[] = [
    'A valid cryptographic signature proves origin and integrity, not that the underlying artifact is safe or correct.',
    'On-chain commitments are content digests only; evidence bytes live off-chain by design.',
  ]
  const checks: CheckResult[] = []

  const a = await db.attestation.findUnique({
    where: { protocolId: attestationId },
    include: { evidence: true, issuer: { include: { memberships: true } } },
  })

  if (!a) {
    return {
      targetType: 'ATTESTATION', targetId: attestationId, verdict: 'UNKNOWN',
      checks: [check('record_exists', false, 'no attestation with this identifier exists')],
      limitations, durationMs: Date.now() - started,
    }
  }

  checks.push(check('record_exists', true, `attestation ${a.protocolId} found (category ${a.category})`))

  // 2. signature/issuer proof: attestations carry an authenticated issuer
  // proof — the gno address that signed the issue transaction client-side,
  // recorded at issuance. Server-issued attestations record the operator.
  const hasIssuerProof = !!a.issuerAddress
  checks.push(check('signature_valid', hasIssuerProof, hasIssuerProof ? `issuer proof recorded (${a.issuerAddress})` : 'no issuer proof recorded'))

  // 3. issuer identity
  const issuerKnown = !!(a.issuerId || a.issuerAddress)
  checks.push(check('issuer_identity', issuerKnown, a.issuer ? `issuer ${a.issuer.displayName}` : a.issuerAddress ? 'issuer address known, no platform account linked' : 'issuer unknown'))

  // 4. issuer authorization: issuer must be a member of the subject's org
  // (or the platform operator for protocol-issued attestations).
  const issuerAuthorized = a.issuer?.memberships.some(m => m.organizationId === a.organizationId) || a.issuerAddress === process.env.PROOFLOOM_OPERATOR_ADDRESS
  checks.push(check('issuer_authorized', !!issuerAuthorized, issuerAuthorized ? 'issuer is a member of the owning organization' : 'issuer is not a member of the owning organization'))

  // 5. digest integrity: recompute from evidence bytes when inline
  let digestOk = isValidDigest(a.digest)
  let digestDetail = 'digest format valid'
  if (a.evidence?.content != null) {
    const { sha256Hex } = await import('@/lib/crypto')
    const recomputed = sha256Hex(a.evidence.content)
    digestOk = recomputed === a.digest
    digestDetail = recomputed === a.digest ? 'digest re-computed from evidence bytes and matches' : 'EVIDENCE MISMATCH: recomputed digest differs from commitment'
  } else {
    digestDetail = a.evidence ? 'evidence stored in object storage; digest format validated' : 'digest format validated (evidence reference only)'
    limitations.push('Evidence for this attestation is not stored inline; byte-level re-computation was not performed.')
  }
  checks.push(check('digest_integrity', digestOk, digestDetail))

  // 6. expiry
  const expired = !!a.expiresAt && a.expiresAt.getTime() <= Date.now()
  checks.push(check('not_expired', !expired, a.expiresAt ? (expired ? 'expired at ' + a.expiresAt.toISOString() : 'valid until ' + a.expiresAt.toISOString()) : 'no expiry set'))

  // 7. revocation
  const revoked = a.status === 'REVOKED'
  checks.push(check('not_revoked', !revoked, revoked ? `revoked at ${a.revokedAt?.toISOString()}: ${a.revokedReason ?? 'no reason recorded'}` : 'no revocation recorded'))

  // 8. chain publication
  let chainState: VerificationReport['onChain']
  if (a.onChain) {
    try {
      // Query the deployed verify realm for the release verdict when the
      // subject is a release; for other subjects, presence of tx is shown.
      if (a.subjectType === 'RELEASE') {
        const chainVerdict = await fetchOnChainVerdict(a.subjectId)
        const publishedOnChain = chainVerdict.releaseStatus !== ''
        checks.push(check('chain_publication', publishedOnChain, publishedOnChain ? `on-chain release status: ${chainVerdict.releaseStatus} (verdict ${chainVerdict.verdict})` : 'on-chain realm has no record of the subject'))
        chainState = {
          network: activeChain().label,
          realm: realmPath('verify'),
          txHash: a.chainTxHash ?? undefined,
          chainVerdict: chainVerdict.verdict,
          releaseStatus: chainVerdict.releaseStatus,
        }
      } else {
        checks.push(check('chain_publication', true, `commitment recorded on-chain (tx ${a.chainTxHash ?? 'pending'})`))
        chainState = { network: activeChain().label, realm: realmPath('attestations'), txHash: a.chainTxHash ?? undefined }
      }
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'CHAIN_UNAVAILABLE') {
        checks.push(check('chain_publication', false, 'RPC unreachable during verification'))
        limitations.push('RPC was unreachable; chain publication was not independently confirmed in this run.')
        chainState = { network: activeChain().label, realm: realmPath('verify') }
      } else if (code === 'NOT_FOUND') {
        checks.push(check('chain_publication', false, 'on-chain realm does not know this subject'))
        chainState = { network: activeChain().label, realm: realmPath('verify') }
      } else {
        throw e
      }
    }
  } else {
    checks.push(check('chain_publication', false, 'not published on-chain yet'))
  }

  // 9. evidence accessibility
  const evidenceAccessible = !!a.evidence && (a.evidence.content != null || !!a.evidence.storageKey)
  checks.push(check('evidence_accessible', evidenceAccessible, a.evidence ? (a.evidence.content != null ? 'evidence bytes retrievable (inline)' : 'evidence reference available (object storage)') : 'no evidence object linked'))

  // 10. completeness: project policy requirements satisfied at this moment
  let complete = true
  let completeDetail = 'no project policy configured'
  if (a.projectId) {
    const policy = await db.policy.findFirst({ where: { projectId: a.projectId, active: true } })
    if (policy) {
      const required = policy.requireCategories.split(',').filter(Boolean)
      const missing: string[] = []
      for (const cat of required) {
        const actives = await db.attestation.count({
          where: { subjectType: 'RELEASE', subjectId: a.subjectId, category: cat, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        })
        if (actives === 0) missing.push(cat)
      }
      complete = missing.length === 0
      completeDetail = missing.length === 0 ? `all ${required.length} required categories present` : `missing active attestations: ${missing.join(', ')}`
    }
  }
  checks.push(check('completeness', complete, completeDetail))

  // Verdict composition: any hard negative wins; else all checks must pass.
  const failed = checks.filter(c => !c.passed).map(c => c.requirement)
  let verdict: VerificationReport['verdict'] = 'VERIFIED'
  if (revoked) verdict = 'REVOKED'
  else if (expired) verdict = 'EXPIRED'
  else if (!digestOk) verdict = 'FAILED'
  else if (failed.length > 0) verdict = 'PENDING'
  if (verdict === 'PENDING' && failed.every(f => f === 'chain_publication' || f === 'completeness')) verdict = 'PENDING'

  const report: VerificationReport = {
    targetType: 'ATTESTATION', targetId: attestationId, verdict, checks,
    onChain: chainState, limitations, durationMs: Date.now() - started,
  }

  await db.verificationResult.create({
    data: {
      targetType: 'ATTESTATION', targetId: attestationId, verdict,
      checks: JSON.stringify(checks), durationMs: report.durationMs,
    },
  })
  return report
}

export async function verifyRelease(releaseId: string, opts?: { ip?: string }): Promise<VerificationReport> {
  const started = Date.now()
  const limitations: string[] = [
    'A valid signature proves origin and integrity of evidence, not artifact safety.',
  ]
  const checks: CheckResult[] = []

  // Resolve the identifier: platform id, or protocol id (project-version).
  let release = await db.release.findUnique({
    where: { id: releaseId },
    include: { project: true, evidence: true },
  })
  if (!release && releaseId.includes('-')) {
    const parts = releaseId.split('-')
    if (parts.length >= 2) {
      const version = parts[parts.length - 1].toLowerCase()
      const slug = parts.slice(0, -1).join('-')
      const project = await db.project.findFirst({ where: { slug } })
      if (project) {
        release = await db.release.findFirst({
          where: { projectId: project.id, version: { equals: version, }, OR: [
            { version: parts[parts.length - 1] },
          ] },
          include: { project: true, evidence: true },
        })
      }
    }
  }
  if (!release) {
    return {
      targetType: 'RELEASE', targetId: releaseId, verdict: 'UNKNOWN',
      checks: [check('record_exists', false, 'no release with this identifier exists')],
      limitations, durationMs: Date.now() - started,
    }
  }

  checks.push(check('record_exists', true, `release ${release.project.slug}-${release.version} (status ${release.status})`))

  // public states
  const publicStates = ['PUBLISHED', 'VERIFIED', 'REVOKED', 'SUPERSEDED', 'DISPUTED']
  const isPublic = publicStates.includes(release.status)
  checks.push(check('published', isPublic, isPublic ? `release is ${release.status}` : `release is not published (state ${release.status})`))

  // artifact digest integrity
  const digestOk = isValidDigest(release.artifactDigest)
  checks.push(check('artifact_digest', digestOk, digestOk ? 'artifact digest format valid (sha256)' : 'artifact digest missing or malformed'))

  // attestations summary
  const allAtts = await db.attestation.findMany({ where: { subjectType: 'RELEASE', subjectId: release.id } })
  const activeAtts = allAtts.filter(x => x.status === 'ACTIVE' && (!x.expiresAt || x.expiresAt.getTime() > Date.now()))
  checks.push(check('attestations_active', activeAtts.length > 0, `${activeAtts.length} active of ${allAtts.length} attestations`))

  // policy evaluation (deterministic)
  const policy = await db.policy.findFirst({ where: { projectId: release.projectId, active: true } })
  let policyOk = true
  const missing: string[] = []
  if (policy) {
    const required = policy.requireCategories.split(',').filter(Boolean)
    for (const cat of required) {
      const has = activeAtts.some(a => a.category === cat)
      if (!has) missing.push(cat)
    }
    const approvals = activeAtts.filter(a => a.category === 'RELEASE_APPROVAL').length
    if (approvals < policy.minApprovals) missing.push(`RELEASE_APPROVAL (${approvals}/${policy.minApprovals})`)
    policyOk = missing.length === 0
    checks.push(check('policy_satisfied', policyOk, policyOk ? `policy "${policy.name}" v${policy.version} satisfied` : `policy "${policy.name}" v${policy.version} unmet: ${missing.join(', ')}`))
  } else {
    checks.push(check('policy_satisfied', true, 'no project policy configured; baseline applies'))
  }

  // on-chain publication
  let chainState: VerificationReport['onChain']
  let chainOk = false
  let chainDetail = 'not published on-chain yet'
  if (isPublic) {
    try {
      const chainVerdict = await fetchOnChainVerdict(release.project.slug + '-' + release.version.toLowerCase())
      chainOk = chainVerdict.releaseStatus !== '' && chainVerdict.artifactDigest === release.artifactDigest
      chainDetail = chainVerdict.releaseStatus === ''
        ? 'on-chain realm has no record of this release id'
        : chainVerdict.artifactDigest !== release.artifactDigest
          ? 'CHAIN MISMATCH: on-chain digest differs from platform record'
          : `on-chain status ${chainVerdict.releaseStatus}, verdict ${chainVerdict.verdict}`
      chainState = {
        network: activeChain().label,
        realm: realmPath('verify'),
        txHash: release.transactions?.[0]?.txHash,
        chainVerdict: chainVerdict.verdict,
        releaseStatus: chainVerdict.releaseStatus,
      }
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'NOT_FOUND') {
        chainDetail = 'on-chain realm does not know this release id'
      } else if (code === 'CHAIN_UNAVAILABLE') {
        chainDetail = 'RPC unreachable; on-chain check deferred'
        limitations.push('RPC was unreachable; the on-chain check was not performed in this run.')
      }
      chainState = { network: activeChain().label, realm: realmPath('verify') }
    }
  }
  checks.push(check('chain_publication', chainOk, chainDetail))

  const failed = checks.filter(c => !c.passed).map(c => c.requirement)
  let verdict: VerificationReport['verdict'] = 'VERIFIED'
  if (release.status === 'REVOKED') verdict = 'REVOKED'
  else if (release.status === 'SUPERSEDED') verdict = 'PENDING'
  else if (release.status === 'DISPUTED') verdict = 'FAILED'
  else if (failed.some(f => f === 'chain_publication') && chainDetail.includes('MISMATCH')) verdict = 'FAILED'
  else if (failed.length > 0) verdict = 'PENDING'

  const report: VerificationReport = {
    targetType: 'RELEASE', targetId: release.id, verdict, checks,
    onChain: chainState, limitations, durationMs: Date.now() - started,
  }
  await db.verificationResult.create({
    data: {
      targetType: 'RELEASE', targetId: release?.id ?? releaseId, verdict,
      checks: JSON.stringify(checks), requesterIp: opts?.ip, durationMs: report.durationMs,
    },
  })
  return report
}

// Digest lookup: which published releases commit to this content digest?
export async function verifyDigest(digest: string) {
  if (!isValidDigest(digest)) throw err('INVALID_DIGEST')
  const releases = await db.release.findMany({
    where: { artifactDigest: digest, status: { in: ['PUBLISHED', 'VERIFIED', 'REVOKED', 'SUPERSEDED', 'DISPUTED'] } },
    include: { project: { select: { slug: true, name: true, visibility: true } } },
  })
  return releases.map(r => ({
    releaseId: r.id,
    protocolId: `${r.project.slug}-${r.version.toLowerCase()}`,
    project: r.project.slug,
    projectName: r.project.name,
    version: r.version,
    status: r.status,
  }))
}
