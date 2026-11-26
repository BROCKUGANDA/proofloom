export const CATEGORIES = [
  'BUILD_PROVENANCE',
  'SOURCE_PROVENANCE',
  'SBOM_COMPLETE',
  'TEST_EXECUTION',
  'SECURITY_ASSESSMENT',
  'CODE_REVIEW',
  'RELEASE_APPROVAL',
  'AGENT_TASK_COMPLETION',
  'BENCHMARK_RESULT',
  'DEPENDENCY_VERIFICATION',
  'OWNERSHIP_VERIFICATION',
  'DEPLOYMENT_VERIFICATION',
  'COMPLIANCE_EVIDENCE',
  'INCIDENT_REMEDIATION',
] as const

export const CATEGORY_META: Record<string, { label: string; glyph: string; description: string }> = {
  BUILD_PROVENANCE: { label: 'Build provenance', glyph: 'build', description: 'Records which build produced the artifact and from which source revision.' },
  SOURCE_PROVENANCE: { label: 'Source provenance', glyph: 'source', description: 'Binds the release to a verified source revision and repository.' },
  TEST_EXECUTION: { label: 'Test execution', glyph: 'test', description: 'Test suite ran against this exact artifact.' },
  SECURITY_ASSESSMENT: { label: 'Security assessment', glyph: 'security', description: 'Security scan or review verdict for the artifact.' },
  SBOM_COMPLETE: { label: 'SBOM complete', glyph: 'source', description: 'A software bill of materials covering every dependency ships with the artifact.' },
  CODE_REVIEW: { label: 'Code review', glyph: 'review', description: 'Human or agent review of the changeset.' },
  RELEASE_APPROVAL: { label: 'Release approval', glyph: 'approve', description: 'Authorized approval for publication.' },
  AGENT_TASK_COMPLETION: { label: 'Agent task completion', glyph: 'agent', description: 'Autonomous agent completed its assigned task.' },
  BENCHMARK_RESULT: { label: 'Benchmark result', glyph: 'benchmark', description: 'Performance benchmarks against the artifact.' },
  DEPENDENCY_VERIFICATION: { label: 'Dependency verification', glyph: 'deps', description: 'SBOM verified against known dependencies.' },
  OWNERSHIP_VERIFICATION: { label: 'Ownership verification', glyph: 'owner', description: 'Ownership claim over a project or component.' },
  DEPLOYMENT_VERIFICATION: { label: 'Deployment verification', glyph: 'deploy', description: 'Artifact was deployed to a named environment.' },
  COMPLIANCE_EVIDENCE: { label: 'Compliance evidence', glyph: 'compliance', description: 'Compliance control evidence for the release.' },
  INCIDENT_REMEDIATION: { label: 'Incident remediation', glyph: 'incident', description: 'Incident fixed and remediation verified.' },
}

export const SUBJECT_TYPES = ['RELEASE', 'PROJECT', 'COMPONENT', 'TASK', 'AGENT_EXECUTION'] as const
