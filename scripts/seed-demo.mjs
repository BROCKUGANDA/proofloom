// PROOFLOOM demo seed — populates the registry with a coherent dataset so
// explorers, atlas, analytics and the verification portal show live content.
// Run: bun /home/z/my-project/scripts/seed-demo.mjs
import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes, createHash } from 'crypto'

const db = new PrismaClient()

const SCRYPT_N = 16384, SCRYPT_r = 8, SCRYPT_p = 1, KEYLEN = 64
function hashPassword(password) {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p })
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('hex')}$${key.toString('hex')}`
}
const sha = (s) => createHash('sha256').update(s).digest('hex')
const tx = () => sha('tx:' + Math.random().toString(36).slice(2))
const now = Date.now()
const h = (n) => new Date(now - n * 3600e3)
const PASSWORD = 'ProofLoom#2026'

async function main() {
  console.log('Clearing existing rows…')
  const tables = [
    'usageRecord', 'notification', 'verificationResult', 'webhookDelivery',
    'auditEvent', 'chainTransaction', 'review', 'agentExecution', 'agentGrant',
    'task', 'attestation', 'evidence', 'release', 'dependency', 'component', 'project',
    'agent', 'policy', 'invitation', 'membership', 'integration',
    'apiCredential', 'billingEvent', 'entitlementUsage', 'subscription', 'organization', 'wallet', 'session', 'user',
  ]
  for (const t of tables) await db[t].deleteMany()

  console.log('Creating users…')
  const mira = await db.user.create({ data: {
    email: 'demo@proofloom.io', passwordHash: hashPassword(PASSWORD),
    displayName: 'Mira Okonkwo', avatarSeed: 'verdigris',
    gnoAddress: 'g1proofloomdemomira0x7f2a9c4e000000000000000000000000',
    walletLinkedAt: h(240), emailVerified: true,
  }})
  const ren = await db.user.create({ data: {
    email: 'builder@proofloom.io', passwordHash: hashPassword(PASSWORD),
    displayName: 'Ren Takahashi', avatarSeed: 'copper',
    gnoAddress: 'g1proofloomdemoren0x3b8d51a20000000000000000000000000000',
    walletLinkedAt: h(200), emailVerified: true,
  }})
  const MIRA_ADDR = mira.gnoAddress
  const REN_ADDR = ren.gnoAddress

  const org = await db.organization.create({ data: {
    slug: 'verdigris-labs', name: 'Verdigris Labs', ownerId: mira.id,
  }})
  // Showcase org ships on a paid plan so the seeded dataset fits the limits.
  const sub = await db.subscription.create({
    data: { organizationId: org.id, planId: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date(now + 30 * 86400e3) },
  })
  await db.billingEvent.create({
    data: { subscriptionId: sub.id, kind: 'PAYMENT_SUCCEEDED', fromPlan: 'FREE', toPlan: 'PRO', metadata: JSON.stringify({ provider: 'internal-simulated', seeded: true }) },
  })
  await db.membership.createMany({ data: [
    { userId: mira.id, organizationId: org.id, role: 'OWNER' },
    { userId: ren.id, organizationId: org.id, role: 'ENGINEERING_LEAD' },
  ]})

  console.log('Creating projects…')
  const helios = await db.project.create({ data: {
    organizationId: org.id, slug: 'helios-ledger', name: 'Helios Ledger',
    description: 'Double-entry settlement engine for cross-chain marketplaces. Deterministic builds, signed releases, every dependency auditable.',
    repoUrl: 'https://github.com/verdigris-labs/helios-ledger',
    category: 'service', techStack: 'gno,go,typescript,react',
    gnoRegistered: true, onChainRef: tx(), createdBy: mira.id, createdAt: h(800),
  }})
  const carto = await db.project.create({ data: {
    organizationId: org.id, slug: 'cartographer-cli', name: 'Cartographer CLI',
    description: 'Supply-chain scanner that maps every artifact of a repository to its provenance. Exports SPDX and CycloneDX inventories.',
    repoUrl: 'https://github.com/verdigris-labs/cartographer-cli',
    category: 'library', techStack: 'go,cli,spdx',
    gnoRegistered: true, onChainRef: tx(), createdBy: ren.id, createdAt: h(700),
  }})
  const signal = await db.project.create({ data: {
    organizationId: org.id, slug: 'signal-post', name: 'Signal Post',
    description: 'Attestation feed for open-source teams — a social surface where reviews, scans and approvals become public records.',
    repoUrl: 'https://github.com/verdigris-labs/signal-post',
    category: 'service', techStack: 'gno,typescript,next',
    gnoRegistered: false, createdBy: mira.id, createdAt: h(560),
  }})

  const heliosCore = await db.component.create({ data: { projectId: helios.id, name: 'helios-core', namespace: 'r/verdigris', artifactType: 'source', license: 'Apache-2.0', version: '2.4.1' }})
  const heliosImg = await db.component.create({ data: { projectId: helios.id, name: 'helios-settlement', artifactType: 'container', license: 'Apache-2.0', version: '2.4.1' }})
  await db.component.create({ data: { projectId: carto.id, name: 'cartographer', artifactType: 'binary', license: 'MIT', version: '1.7.2' }})
  await db.component.create({ data: { projectId: signal.id, name: 'signal-web', artifactType: 'source', license: 'MIT', version: '0.9.0' }})

  await db.dependency.createMany({ data: [
    { projectId: helios.id, name: 'github.com/gnoland/gno', ecosystem: 'go', version: 'v0.9.4', license: 'MIT', risk: 'LOW', isDirect: true },
    { projectId: helios.id, name: 'decimal', ecosystem: 'npm', version: '10.4.3', license: 'MIT', risk: 'LOW', isDirect: true },
    { projectId: helios.id, name: 'expr-lang/expr', ecosystem: 'go', version: 'v1.16.9', license: 'MIT', risk: 'MEDIUM', isDirect: false },
    { projectId: carto.id, name: 'spdx/tools-golang', ecosystem: 'go', version: 'v0.5.3', license: 'Apache-2.0', risk: 'LOW', isDirect: true },
    { projectId: carto.id, name: 'cyclonedx-go', ecosystem: 'go', version: 'v0.9.1', license: 'Apache-2.0', risk: 'LOW', isDirect: true },
    { projectId: signal.id, name: 'next', ecosystem: 'npm', version: '15.1.0', license: 'MIT', risk: 'MEDIUM', isDirect: true },
    { projectId: signal.id, name: 'elliptic', ecosystem: 'npm', version: '6.5.7', license: 'MIT', risk: 'HIGH', isDirect: false },
  ]})

  console.log('Creating releases, evidence, attestations…')
  async function release(p, comp, data, evidenceRows, attestRows) {
    const r = await db.release.create({ data: { projectId: p.id, componentId: comp?.id, createdBy: mira.id, ...data } })
    for (const e of evidenceRows) {
      const content = e.content
      const ev = await db.evidence.create({ data: {
        releaseId: r.id, projectId: p.id, kind: e.kind, title: e.title,
        contentHash: sha(content), content, sizeBytes: content.length,
        mimeType: e.mime || 'text/plain', uploadedBy: e.by || mira.id, createdAt: e.at,
      }})
      if (e.attest) {
        await db.attestation.create({ data: {
          protocolId: sha('att:' + r.id + ':' + e.kind).slice(0, 40),
          subjectType: 'RELEASE', subjectId: r.id, category: e.attCat,
          issuerId: e.by || mira.id, issuerAddress: e.byAddr || MIRA_ADDR,
          digest: sha(content), evidenceId: ev.id, status: 'ACTIVE',
          issuedAt: e.at, onChain: true, chainTxHash: tx(),
          projectId: p.id, organizationId: org.id,
        }})
      }
    }
    // Policy-complete releases also carry the human approval attestation.
    if (['VERIFIED', 'PUBLISHED', 'APPROVED'].includes(data.status)) {
      await db.attestation.create({ data: {
        protocolId: sha('appr:' + r.id).slice(0, 40),
        subjectType: 'RELEASE', subjectId: r.id, category: 'RELEASE_APPROVAL',
        issuerId: mira.id, issuerAddress: MIRA_ADDR,
        digest: sha(r.id + ':approval'), status: 'ACTIVE', issuedAt: data.publishedAt || r.createdAt,
        onChain: true, chainTxHash: tx(), projectId: p.id, organizationId: org.id,
      }})
    }
    for (const a of attestRows) {
      await db.attestation.create({ data: {
        protocolId: sha('att2:' + r.id + ':' + a.cat).slice(0, 40),
        subjectType: 'RELEASE', subjectId: r.id, category: a.cat,
        issuerId: a.by || ren.id, issuerAddress: a.byAddr || REN_ADDR,
        digest: sha(r.id + a.cat), status: 'ACTIVE', issuedAt: a.at,
        onChain: true, chainTxHash: tx(), projectId: p.id, organizationId: org.id,
      }})
    }
    await db.chainTransaction.create({ data: {
      releaseId: r.id, kind: 'PUBLISH_RELEASE', status: 'CONFIRMED',
      chainId: 'onyx-1', txHash: tx(), gasUsed: 48000 + Math.floor(Math.random() * 30000),
      height: 2100000 + Math.floor(Math.random() * 9000), createdBy: mira.id,
      confirmedAt: data.publishedAt || r.createdAt,
    }})
    return r
  }

  const evBuild = (t, at) => ({ kind: 'build_log', title: t, content: `[build] reproducible: yes\n[build] builder image: sha256:c913b7f...\n[build] toolchain: go1.23 / gno 0.9\n[build] outcome: PASS`, at, attest: true, attCat: 'BUILD_PROVENANCE' })
  const evTest = (t, at, pass) => ({ kind: 'test_report', title: t, content: `[test] total: 312, passed: ${pass ? 312 : 298}, failed: ${pass ? 0 : 14}\n[test] coverage: 87.4%\n[test] outcome: ${pass ? 'PASS' : 'FAIL'}`, at, attest: true, attCat: 'TEST_EXECUTION' })
  const evScan = (t, at, crit) => ({ kind: 'security_scan', title: t, content: `[scan] critical: ${crit}\n[scan] high: ${crit ? 2 : 0}\n[scan] medium: 3\n[scan] outcome: ${crit ? 'ATTN' : 'PASS'}`, at, attest: true, attCat: 'SECURITY_ASSESSMENT' })
  const evSbom = (t, at) => ({ kind: 'sbom', title: t, content: `[sbom] format: SPDX-2.3\n[sbom] packages: 148\n[sbom] unknown-license: 0\n[sbom] outcome: COMPLETE`, at, attest: true, attCat: 'SBOM_COMPLETE' })

  await release(helios, heliosCore, {
    version: 'v2.4.0', commitHash: sha('helios-v2.4.0').slice(0, 40), branch: 'main',
    repoUrl: 'https://github.com/verdigris-labs/helios-ledger',
    buildEnv: 'builder-image sha256:c913b7f', pipelineRef: 'ci/helios #2141',
    artifactDigest: sha('helios-v2.4.0-artifact'), artifactName: 'helios-core-2.4.0.tgz',
    status: 'VERIFIED', publishedAt: h(170), createdAt: h(180),
  }, [evBuild('Build log — helios v2.4.0', h(179)), evTest('Test report — v2.4.0', h(178), true), evScan('Security scan — v2.4.0', h(177), false), evSbom('SBOM — v2.4.0', h(176))], [])

  await release(helios, heliosCore, {
    version: 'v2.4.1', commitHash: sha('helios-v2.4.1').slice(0, 40), branch: 'main',
    repoUrl: 'https://github.com/verdigris-labs/helios-ledger',
    buildEnv: 'builder-image sha256:c913b7f', pipelineRef: 'ci/helios #2150',
    artifactDigest: sha('helios-v2.4.1-artifact'), artifactName: 'helios-core-2.4.1.tgz',
    status: 'PUBLISHED', publishedAt: h(20), createdAt: h(26),
  }, [evBuild('Build log — helios v2.4.1', h(25)), evTest('Test report — v2.4.1', h(24), true), evSbom('SBOM — v2.4.1', h(23))], [])

  const cartoRel = await release(carto, null, {
    version: 'v1.7.2', commitHash: sha('carto-v1.7.2').slice(0, 40), branch: 'main',
    repoUrl: 'https://github.com/verdigris-labs/cartographer-cli',
    buildEnv: 'builder-image sha256:11aa90e', pipelineRef: 'ci/cartographer #870',
    artifactDigest: sha('carto-v1.7.2-artifact'), artifactName: 'cartographer_1.7.2_linux_amd64',
    status: 'APPROVED', publishedAt: h(64), createdAt: h(72),
  }, [evBuild('Build log — cartographer v1.7.2', h(71)), evTest('Test report — v1.7.2', h(70), true), evScan('Security scan — v1.7.2', h(69), false), evSbom('SBOM — v1.7.2', h(68))], [])

  await release(signal, null, {
    version: 'v0.9.0-beta', commitHash: sha('signal-v0.9.0').slice(0, 40), branch: 'release/0.9',
    repoUrl: 'https://github.com/verdigris-labs/signal-post',
    buildEnv: 'builder-image sha256:77ee201', pipelineRef: 'ci/signal #338',
    artifactDigest: sha('signal-v0.9.0-artifact'), artifactName: 'signal-post-0.9.0.tar',
    status: 'REVIEW_REQUIRED', createdAt: h(9),
  }, [evBuild('Build log — signal v0.9.0-beta', h(9)), evScan('Security scan — v0.9.0-beta', h(8), true), evSbom('SBOM — v0.9.0-beta', h(7))], [])

  await release(signal, null, {
    version: 'v0.8.4', commitHash: sha('signal-v0.8.4').slice(0, 40), branch: 'main',
    repoUrl: 'https://github.com/verdigris-labs/signal-post',
    buildEnv: 'builder-image sha256:77ee201', pipelineRef: 'ci/signal #331',
    artifactDigest: sha('signal-v0.8.4-artifact'), artifactName: 'signal-post-0.8.4.tar',
    status: 'PUBLISHED', publishedAt: h(300), createdAt: h(310),
  }, [evBuild('Build log — signal v0.8.4', h(309)), evTest('Test report — v0.8.4', h(308), true), evSbom('SBOM — v0.8.4', h(307))], [])

  await db.review.create({ data: {
    releaseId: cartoRel.id, reviewerId: mira.id, decision: 'APPROVED',
    comment: 'Reproducible build verified locally against the committed digest. Ship it.', decidedAt: h(65), createdAt: h(66),
  }})

  console.log('Creating agents, executions, tasks…')
  const atlasAgent = await db.agent.create({ data: {
    organizationId: org.id, projectId: helios.id, slug: 'atlas-runner',
    name: 'Atlas Runner', description: 'Repository triage agent: keeps dependency inventories current and prepares evidence bundles for releases.',
    ownerAddress: MIRA_ADDR, ownerUserId: mira.id, runtime: 'proofloom-agentd/0.6',
    modelProvider: 'zhipu', modelId: 'glm-4.6', capabilities: 'READ,EVIDENCE,TASK_UPDATE',
    status: 'ACTIVE', onChain: true, chainTxHash: tx(), createdAt: h(600),
  }})
  const sentinel = await db.agent.create({ data: {
    organizationId: org.id, projectId: signal.id, slug: 'sentinel-auditor',
    name: 'Sentinel Auditor', description: 'Security scanning agent. Runs per release; escalates criticals and proposes review holds.',
    ownerAddress: MIRA_ADDR, ownerUserId: mira.id, runtime: 'proofloom-agentd/0.6',
    modelProvider: 'zhipu', modelId: 'glm-4.6', capabilities: 'READ,VERIFY_REQUEST,REVIEW_PROPOSE',
    status: 'ACTIVE', onChain: true, chainTxHash: tx(), createdAt: h(420),
  }})
  await db.agentGrant.createMany({ data: [
    { agentId: atlasAgent.id, projectId: helios.id, scopes: 'READ,EVIDENCE,TASK_UPDATE', grantedBy: mira.id, expiresAt: h(-2000) },
    { agentId: sentinel.id, projectId: signal.id, scopes: 'READ,VERIFY_REQUEST,REVIEW_PROPOSE', grantedBy: mira.id, expiresAt: h(-1500) },
  ]})

  await db.agentExecution.create({ data: {
    agentId: atlasAgent.id, projectId: helios.id, trigger: 'webhook', status: 'COMPLETED',
    inputDigest: sha('in:dep-refresh'), outputDigest: sha('out:dep-refresh'),
    report: 'Refreshed dependency inventory (148 packages). 2 risk upgrades: expr-lang/expr → MEDIUM. SBOM regenerated and committed as evidence.',
    reportDigest: sha('report:dep-refresh'),
    policyVerdict: JSON.stringify([{ requirement: 'no-critical-findings', passed: true }, { requirement: 'sbom-complete', passed: true }]),
    tokensUsed: 14210, costMicros: 8400, startedAt: h(46), finishedAt: h(45),
  }})
  await db.agentExecution.create({ data: {
    agentId: sentinel.id, projectId: signal.id, trigger: 'schedule', status: 'AWAITING_APPROVAL',
    inputDigest: sha('in:scan-0.9.0'), outputDigest: sha('out:scan-0.9.0'),
    report: 'Release scan of v0.9.0-beta found 1 critical in elliptic@6.5.7 (transitive). Proposed holding publication pending upgrade.',
    reportDigest: sha('report:scan-0.9.0'),
    policyVerdict: JSON.stringify([{ requirement: 'no-critical-findings', passed: false, detail: 'elliptic@6.5.7 critical — GHSA-xxxx' }]),
    tokensUsed: 9600, costMicros: 5200, startedAt: h(8), finishedAt: h(7),
  }})
  await db.agentExecution.create({ data: {
    agentId: atlasAgent.id, projectId: helios.id, trigger: 'manual', status: 'FAILED',
    inputDigest: sha('in:rebuild-attempt'), error: 'builder image pull failed: registry timeout after 3 attempts',
    tokensUsed: 1200, costMicros: 700, startedAt: h(30), finishedAt: h(29),
  }})

  await db.task.createMany({ data: [
    { projectId: helios.id, title: 'Rotate expr-lang/expr after advisory bump', description: 'Upgrade to patched release, regenerate SBOM, attach evidence to v2.4.2 draft.', state: 'IN_PROGRESS', priority: 'HIGH', assigneeType: 'AGENT', assigneeAgentId: atlasAgent.id, createdBy: ren.id, createdAt: h(50) },
    { projectId: helios.id, title: 'Publish v2.4.1 with reproducible-build evidence', description: 'Attach builder attestation and confirm digest match before marking VERIFIED.', state: 'EVIDENCE_SUBMITTED', priority: 'MEDIUM', assigneeType: 'HUMAN', assigneeUserId: ren.id, createdBy: mira.id, createdAt: h(30) },
    { projectId: carto.id, title: 'Add SPDX 2.3 tag-value exporter', description: 'Parity with CycloneDX output; unit tests against upstream examples.', state: 'OPEN', priority: 'MEDIUM', createdBy: ren.id, createdAt: h(120) },
    { projectId: signal.id, title: 'Quarterly review of moderation agent', description: 'Re-validate Sentinel Auditor scopes and renew grant expiry.', state: 'REVIEW', priority: 'LOW', assigneeType: 'HUMAN', assigneeUserId: mira.id, createdBy: mira.id, createdAt: h(14) },
  ]})

  console.log('Creating policies, chain records, audit…')
  await db.policy.create({ data: {
    projectId: helios.id, name: 'helios-release-gate', version: 2,
    requireCategories: 'BUILD_PROVENANCE,TEST_EXECUTION,SECURITY_ASSESSMENT,SBOM_COMPLETE',
    minApprovals: 1, requireNoCritical: true, requireValidSBOM: true, requireSignedEvidence: false,
    active: true, updatedBy: mira.id, createdAt: h(500), updatedAt: h(90),
  }})
  await db.policy.create({ data: {
    organizationId: org.id, name: 'org-agent-guardrails', version: 1,
    requireCategories: 'TEST_EXECUTION', minApprovals: 0, requireNoCritical: true,
    active: true, updatedBy: mira.id, createdAt: h(400),
  }})

  for (const p of [helios, carto, signal]) {
    await db.chainTransaction.create({ data: {
      kind: 'REGISTER_PROJECT', status: 'CONFIRMED', chainId: 'onyx-1',
      txHash: tx(), gasUsed: 31000 + Math.floor(Math.random() * 9000),
      height: 2095000 + Math.floor(Math.random() * 4000), createdBy: mira.id, confirmedAt: p.createdAt,
    }})
  }
  await db.chainTransaction.create({ data: {
    kind: 'REGISTER_AGENT', status: 'CONFIRMED', chainId: 'onyx-1',
    txHash: tx(), gasUsed: 27000, height: 2098200, createdBy: mira.id, confirmedAt: h(420),
  }})
  await db.chainTransaction.create({ data: {
    kind: 'ATTEST', status: 'CONFIRMED', chainId: 'onyx-1',
    txHash: tx(), gasUsed: 19400, height: 2104400, createdBy: mira.id, confirmedAt: h(176),
  }})

  await db.auditEvent.createMany({ data: [
    { organizationId: org.id, projectId: helios.id, actorUserId: mira.id, action: 'project.create', targetType: 'Project', targetId: helios.id, metadata: '{"slug":"helios-ledger"}', createdAt: h(800) },
    { organizationId: org.id, projectId: helios.id, actorUserId: mira.id, action: 'release.publish', targetType: 'Release', targetId: 'v2.4.1', metadata: '{"version":"v2.4.1"}', createdAt: h(20) },
    { organizationId: org.id, projectId: signal.id, actorAddress: MIRA_ADDR, action: 'attestation.issue', targetType: 'Attestation', targetId: 'SECURITY_ASSESSMENT', metadata: '{}', createdAt: h(8) },
    { organizationId: org.id, projectId: helios.id, actorUserId: mira.id, action: 'agent.grant', targetType: 'Agent', targetId: 'atlas-runner', metadata: '{"scopes":"READ,EVIDENCE,TASK_UPDATE"}', createdAt: h(600) },
  ]})

  await db.notification.createMany({ data: [
    { userId: mira.id, kind: 'release', title: 'Helios Ledger v2.4.1 published', body: 'Evidence bundle complete. Policy gate pending — one approval will mark it VERIFIED.', link: '/release', createdAt: h(20) },
    { userId: mira.id, kind: 'agent', title: 'Sentinel Auditor needs approval', body: 'Critical finding in elliptic@6.5.7 (transitive of next). Publication hold proposed on v0.9.0-beta.', link: '/agents', createdAt: h(7) },
    { userId: ren.id, kind: 'task', title: 'Task assigned: publish v2.4.1 evidence', body: 'You were assigned the reproducible-build confirmation for Helios v2.4.1.', link: '/workspace', createdAt: h(29) },
  ]})

  const counts = {
    users: await db.user.count(), orgs: await db.organization.count(),
    projects: await db.project.count(), releases: await db.release.count(),
    evidence: await db.evidence.count(), attestations: await db.attestation.count(),
    agents: await db.agent.count(), executions: await db.agentExecution.count(),
    tasks: await db.task.count(), txs: await db.chainTransaction.count(),
  }
  console.log('Seed complete:', counts)
  console.log('Demo login → demo@proofloom.io / ' + PASSWORD)
}

main().finally(() => db.$disconnect())
