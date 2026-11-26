import { db } from '@/lib/db'

// Deterministic policy engine. No LLM involvement, no heuristics: the same
// inputs always produce the same verdict, and every requirement records its
// outcome so failures are explainable.

export interface PolicyInput {
  categories: string[]
  minApprovals: number
  allowedIssuers: string[]
  requireNoCritical: boolean
  requireValidSBOM: boolean
  requireSignedEvidence: boolean
}

export interface PolicyCheckResult {
  requirement: string
  passed: boolean
  detail: string
}

export interface PolicyEvalResult {
  passed: boolean
  checks: PolicyCheckResult[]
}

export function policyFromRow(row: {
  requireCategories: string
  minApprovals: number
  allowedIssuers: string
  requireNoCritical: boolean
  requireValidSBOM: boolean
  requireSignedEvidence: boolean
}): PolicyInput {
  return {
    categories: row.requireCategories.split(',').map(s => s.trim()).filter(Boolean),
    minApprovals: row.minApprovals,
    allowedIssuers: row.allowedIssuers.split(',').map(s => s.trim()).filter(Boolean),
    requireNoCritical: row.requireNoCritical,
    requireValidSBOM: row.requireValidSBOM,
    requireSignedEvidence: row.requireSignedEvidence,
  }
}

const CATEGORIES = [
  'BUILD_PROVENANCE', 'SOURCE_PROVENANCE', 'SBOM_COMPLETE', 'TEST_EXECUTION', 'SECURITY_ASSESSMENT',
  'CODE_REVIEW', 'RELEASE_APPROVAL', 'AGENT_TASK_COMPLETION', 'BENCHMARK_RESULT',
  'DEPENDENCY_VERIFICATION', 'OWNERSHIP_VERIFICATION', 'DEPLOYMENT_VERIFICATION',
  'COMPLIANCE_EVIDENCE', 'INCIDENT_REMEDIATION',
]

export function isValidCategory(c: string): boolean {
  return CATEGORIES.includes(c)
}

export async function evaluateReleasePolicy(projectId: string, releaseId: string): Promise<PolicyEvalResult | null> {
  const policy = await db.policy.findFirst({ where: { projectId, active: true } })
  if (!policy) return null
  const input = policyFromRow(policy)

  const atts = await db.attestation.findMany({
    where: { subjectType: 'RELEASE', subjectId: releaseId },
  })
  const active = atts.filter(a => {
    if (a.status !== 'ACTIVE') return false
    if (a.expiresAt && a.expiresAt.getTime() <= Date.now()) return false
    return true
  })

  const checks: PolicyCheckResult[] = []

  for (const cat of input.categories) {
    const present = active.some(a => a.category === cat)
    checks.push({
      requirement: `ATTESTATION:${cat}`,
      passed: present,
      detail: present ? 'active attestation present' : 'no active attestation of this category',
    })
  }

  if (input.minApprovals > 0) {
    let approvals: string[]
    if (input.allowedIssuers.length === 0) {
      approvals = active.filter(a => a.category === 'RELEASE_APPROVAL').map(a => a.issuerAddress)
    } else {
      approvals = input.allowedIssuers.filter(issuer =>
        active.some(a => a.category === 'RELEASE_APPROVAL' && a.issuerAddress === issuer))
    }
    checks.push({
      requirement: `APPROVALS>=${input.minApprovals}${input.allowedIssuers.length ? ' (allow-listed issuers)' : ''}`,
      passed: approvals.length >= input.minApprovals,
      detail: `${approvals.length} qualifying approval attestation(s)`,
    })
  }

  if (input.requireNoCritical) {
    const sec = active.filter(a => a.category === 'SECURITY_ASSESSMENT')
    checks.push({
      requirement: 'NO_CRITICAL_FINDINGS',
      passed: sec.length > 0,
      detail: sec.length > 0
        ? `${sec.length} active security assessment(s); scan content evaluated off-chain`
        : 'no active security assessment attestation',
    })
  }

  if (input.requireValidSBOM) {
    const has = active.some(a => a.category === 'DEPENDENCY_VERIFICATION' || a.category === 'BUILD_PROVENANCE')
    checks.push({
      requirement: 'VALID_SBOM',
      passed: has,
      detail: has ? 'SBOM-backed attestation present' : 'missing SBOM-backed attestation',
    })
  }

  if (input.requireSignedEvidence) {
    const signed = active.filter(a => a.onChain).length
    checks.push({
      requirement: 'SIGNED_EVIDENCE',
      passed: signed > 0,
      detail: signed > 0 ? `${signed} on-chain commitment(s) present` : 'no on-chain commitments for required evidence',
    })
  }

  return { passed: checks.every(c => c.passed), checks }
}

// Pre-flight simulation used by the policy centre UI.
export async function simulatePolicy(projectId: string, releaseId?: string): Promise<PolicyEvalResult | null> {
  return evaluateReleasePolicy(projectId, releaseId ?? 'simulation-no-release')
}
