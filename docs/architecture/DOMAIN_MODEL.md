# PROOFLOOM — Domain Model

Source of truth: `prisma/schema.prisma` (datasource `sqlite`, generator `prisma-client-js`).
The schema header states the tenancy rule that governs the whole model:

> Tenancy: every tenant-scoped row carries `organizationId`; all queries filter by membership
> server-side. Audit events are append-only.

All models use cuid string primary keys (`@id @default(cuid())`). Enumerations are stored as
`String` fields with the allowed values documented in comments — there are no Prisma `enum` types.

---

## 1. Model catalog

### Identity

**User** — a human account.
`email` (unique), `passwordHash` (scrypt), `displayName`, `avatarSeed` (default `"loom"`),
`gnoAddress` (unique, nullable — linked wallet), `walletLinkedAt`, `emailVerified`,
`totpSecret` (base32, null when MFA off), `mfaEnabled`, `status` (`ACTIVE | SUSPENDED | DELETED`).
Relations: `sessions`, `wallets`, `memberships`, `organizations` (as `OrgOwner`),
`attestations` (as `AttestIssuer`), `apiCredentials`, `notifications`.
Index: `@@index([status])`.

**Wallet** — a linked Gno wallet. `address` (unique, `g1…` bech32), `provider`
(`adena | gnoconnect | gnokey`), `chainId` (reported at link time), `verified` (default false),
`challenge` (pending signature challenge), `linkedAt`. Belongs to `User` (`onDelete: Cascade`).
Index: `@@index([userId])`.

**Session** — opaque-token session. `tokenHash` (unique — sha256 of the token; "raw token never
stored"), `ip`, `userAgent`, `lastRotatedAt`, `expiresAt`, `revokedAt`, `revokedReason`.
Belongs to `User` (cascade). Indexes: `userId`, `expiresAt`.

### Organizations

**Organization** — the tenant root. `slug` (unique), `name`, `ownerId`, `archived`.
Relations: `memberships`, `projects`, `policies`, `agents`, `apiKeys` (ApiCredential),
`auditEvents`, `integrations`, `invitations`. Index: `ownerId`.

**Membership** — joins User↔Organization with `role`
(`OWNER | ADMIN | SECURITY_ADMIN | ENGINEERING_LEAD | DEVELOPER | AUDITOR | VIEWER |
AGENT_OPERATOR`). `@@unique([userId, organizationId])`; indexes on `organizationId`. Cascades on
both sides.

**Invitation** — pending org invite. `email`, `role`, `tokenHash` (unique), `invitedBy`,
`status` (`PENDING | ACCEPTED | REVOKED | EXPIRED`), `expiresAt` (7 days at creation).
`@@index([organizationId, status])`.

### Projects & components

**Project** — `organizationId`, `slug` (unique; "protocol-facing identifier"), `name`,
`description`, `repoUrl`, `category` (default `service`), `visibility` (`public | private`),
`status` (`ACTIVE | ARCHIVED`), `techStack` (comma-separated tags), `gnoRegistered`
(project commitment registered on-chain), `onChainRef` (tx hash of registration), `createdBy`.
Relations: organization, `components`, `dependencies`, `releases`, `policies`, `tasks`, `agents`
(as `AgentProjectScope`), `auditEvents`. Indexes: `organizationId`, `(visibility, status)`.

**Component** — an artifact the project produces. `name`, `namespace`, `artifactType`
(`source | container | binary | sbom | docs | library`), `license`, `version`, `deprecated`.
Belongs to `Project` (cascade); has many `releases`. Index: `projectId`.

**Dependency** — declared third-party dependency. `name`, `ecosystem`
(`npm | pypi | maven | go | cargo | oci`), `version`, `license`, `risk`
(`UNKNOWN | LOW | MEDIUM | HIGH`), `isDirect`. Belongs to `Project` (cascade). Index: `projectId`.

### Releases

**Release** — the provenance subject. `projectId`, `componentId` (nullable), `version`,
`commitHash`, `branch`, `repoUrl`, `buildEnv`, `pipelineRef`, `artifactDigest` (sha256 hex of the
primary artifact, nullable), `artifactName`, `status`, `publishedAt`, `supersededBy`, `createdBy`.
Status machine (schema comment):
`DRAFT | EVIDENCE_PENDING | VALIDATING | REVIEW_REQUIRED | APPROVED | PUBLISHED | VERIFIED |
REJECTED | REVOKED | SUPERSEDED | DISPUTED`.
`@@unique([projectId, version])`; indexes on `status` and `artifactDigest` (the latter powers
digest-based verification). Relations: project, component, `evidence`, `transactions`
(ChainTransaction), `reviews`.

### Evidence & attestations

**Evidence** — content-addressed artifact. `releaseId` (nullable), `projectId` (nullable), `kind`
(`build_log | test_report | security_scan | sbom | approval | agent_report | deployment | other`),
`title`, `contentHash` (sha256 hex, "content-addressed"), `mimeType`, `sizeBytes`, `storage`
(`inline | object`), `content` (inline payloads only), `storageKey`, `uploadedBy`.
Indexes: `contentHash`, `releaseId`. Relations: release (nullable), `attestations`.

**Attestation** — a signed claim committing to a digest. Key fields:
- `protocolId` (**unique**) — "mirrors the on-chain deterministic id" (see §3).
- `subjectType` (`RELEASE | PROJECT | COMPONENT | TASK | AGENT_EXECUTION`) + `subjectId` — the
  polymorphic subject (see §2).
- `category` — one of the 13 categories in `src/lib/categories.ts` (BUILD_PROVENANCE,
  SOURCE_PROVENANCE, TEST_EXECUTION, SECURITY_ASSESSMENT, CODE_REVIEW, RELEASE_APPROVAL,
  AGENT_TASK_COMPLETION, BENCHMARK_RESULT, DEPENDENCY_VERIFICATION, OWNERSHIP_VERIFICATION,
  DEPLOYMENT_VERIFICATION, COMPLIANCE_EVIDENCE, INCIDENT_REMEDIATION).
- `issuerId` (nullable platform user) + `issuerAddress` (gno address — always present, this is the
  issuer proof), `digest` (committed evidence digest), `evidenceId` (nullable link to Evidence),
- `status` (`ACTIVE | REVOKED | EXPIRED`), `issuedAt`, `expiresAt`, `revokedAt`, `revokedReason`.
- `onChain` + `chainTxHash` — whether the commitment was broadcast to the attestations realm.
- `projectId` / `organizationId` — **denormalized for tenant scoping** (schema comment), because
  the polymorphic subject cannot be joined generically.
Indexes: `(subjectType, subjectId)`, `status`, `organizationId`. Relations: issuer (User, named
`AttestIssuer`), evidence.

### Agents

**Agent** — a registered autonomous agent. `organizationId`, `projectId` (optional scope),
`slug` (unique), `name`, `description`, `ownerAddress` (gno address of agent owner), `ownerUserId`,
`runtime`, `modelProvider` ("abstracted provider name; never a key"), `modelId`, `capabilities`
(comma-separated), `version`, `status` (`ACTIVE | SUSPENDED | REVOKED`), `onChain`, `chainTxHash`.
Indexes: `organizationId`. Relations: organization, project (`AgentProjectScope`), `grants`,
`executions`, `tasks`.

**AgentGrant** — scoped permission per project. `agentId`, `projectId`, `scopes` (comma-separated:
`READ, EVIDENCE, VERIFY_REQUEST, TASK_UPDATE, REVIEW_PROPOSE, PUBLISH_REQUEST`), `expiresAt`,
`grantedBy`, `revokedAt`. `@@unique([agentId, projectId])` (so `revoke-grant` then re-grant
upserts). Cascade delete with agent.

**AgentExecution** — one run. `agentId`, `taskId` (nullable), `projectId` (nullable), `trigger`
(`manual | webhook | schedule | api`), `status` (`RUNNING | COMPLETED | FAILED |
AWAITING_APPROVAL | REJECTED`), `inputDigest` ("digest of protected input (never raw prompt)"),
`outputDigest`, `report` ("structured execution report (sanitized)"), `reportDigest`,
`policyVerdict` (JSON array of policy checks — in practice the runtime stores provider/model/
duration info here), `tokensUsed`, `costMicros`, `error`, `approvedBy`, `approvedAt`, `startedAt`,
`finishedAt`. Indexes: `agentId`, `status`.

### Tasks & reviews

**Task** — work item bound to a project. `projectId`, `title`, `description`, `state`
(`OPEN | ASSIGNED | IN_PROGRESS | EVIDENCE_SUBMITTED | REVIEW | APPROVED | REJECTED | COMPLETED |
EXPIRED | CANCELLED`), `priority` (`LOW | MEDIUM | HIGH | CRITICAL`), `assigneeType`
(`HUMAN | AGENT`), `assigneeUserId`, `assigneeAgentId`, `requiresEvidence`, `dueAt`, `createdBy`,
`completionDigest` (sha256 of completion evidence — required to reach COMPLETED), `completedAt`.
Indexes: `projectId`, `state`. Relations: project (cascade), agent (optional assignee), `reviews`.

**Review** — a human decision record. `releaseId` (nullable), `taskId` (nullable), `reviewerId`,
`decision` (`PENDING | APPROVED | REJECTED | CHANGES_REQUESTED`), `comment`, `decidedAt`.
Index: `decision`. Created automatically when a task is approved/rejected
(`src/app/api/tasks/route.ts`).

### Policies

**Policy** — publication policy, versioned. `organizationId` (nullable), `projectId` (nullable),
`name`, `version` (int, incremented per set), `requireCategories` (comma-separated attestation
categories), `minApprovals`, `allowedIssuers` (comma-separated gno addresses; "empty = any"),
`requireNoCritical`, `requireValidSBOM`, `requireSignedEvidence`, `active`, `updatedBy`.
Indexes: `projectId`, `organizationId`. Setting a policy deactivates prior versions
(`POST /api/policies op=set`).

### Chain

**ChainTransaction** — the tx lifecycle ledger (see `DATABASE_ARCHITECTURE.md` §5 for the
lifecycle deep-dive). `releaseId` (nullable), `attestationId` (nullable), `kind`
(`REGISTER_PROJECT | PUBLISH_RELEASE | ATTEST | REVOKE | REGISTER_AGENT | AGENT_EXECUTION`),
`status` (default `CREATED`), `chainId` (default `onyx-1`), `txHash` (**unique**, nullable),
`gasUsed`, `height`, `error`, `attempts`, `idempotencyKey` (**unique**, nullable), `createdBy`,
`confirmedAt`. Indexes: `status`, `kind`. Relation: release.

### Platform

**AuditEvent** — append-only trail. `organizationId`, `projectId`, `actorUserId`, `actorAddress`,
`action` (dotted verb, e.g. `project.create`, `release.publish`, `attestation.revoke`,
`agent.grant`), `targetType`, `targetId`, `metadata` (JSON string), `ip`, `traceId`.
Indexes: `(organizationId, createdAt)`, `(targetType, targetId)`. No update/delete paths exist in
application code or the API.

**ApiCredential** — org-scoped API key. `organizationId`, `userId`, `name`, `prefix` ("first 8
chars for identification" — the API writes 12), `keyHash` (unique), `scopes` (default `read`),
`lastUsedAt`, `revokedAt`. Index: `organizationId`. *Note: issuance/revocation is implemented;
request authentication with these keys is not (no route resolves `keyHash`).*

**WebhookDelivery** — inbound webhook record. `url`, `event`, `payload`, `signature`, `status`
(`PENDING | DELIVERED | FAILED | DEAD`), `attempts`, `lastError`, `nextRetryAt`, `deliveredAt`.
Index: `status`. *Used by the GitHub webhook ingestion for dedupe (`url` stores
`github:{deliveryId}`) and audit; the outbound delivery/retry machinery that the
`PENDING/FAILED/DEAD/nextRetryAt` fields anticipate is **Planned**.*

**Integration** — external integration per org. `organizationId`, `kind`
(`github | github_actions | generic_webhook`), `status` (`CONNECTED | DISCONNECTED | ERROR`),
`config` (JSON, "never secrets in plaintext"), `secretRef` ("reference to encrypted secret store"),
`lastSyncAt`, `lastError`. `@@unique([organizationId, kind])`.

**Notification** — per-user notification. `userId`, `kind`, `title`, `body`, `link`, `readAt`.
Index: `(userId, readAt)`. *No producer exists in the codebase (see EVENT_ARCHITECTURE.md).*

**UsageRecord** — rate-limit bucket. `organizationId` (nullable), `key` ("rate-limit bucket or
metric key"), `window` (window start), `count`. `@@unique([key, window])`, index on `window`.
Powered by atomic upsert in `src/lib/rate-limit.ts`.

**VerificationResult** — persisted verification run. `targetType`
(`RELEASE | ATTESTATION | DIGEST`), `targetId`, `verdict`, `checks` (JSON array of
`{requirement, passed, detail}`), `chainState` (JSON of on-chain state at verification time),
`requesterIp`, `durationMs`. Indexes: `(targetType, targetId)`, `createdAt`.
Written by `src/lib/verification.ts` on every verification (digest lookups are not persisted).

## 2. Tenant boundaries

- **Tenant root**: `Organization`. Every tenant-scoped row carries `organizationId` either
  directly (`Project`, `Policy`, `Agent`, `ApiCredential`, `AuditEvent`, `Integration`,
  `Invitation`, `Attestation` [denormalized]) or via a parent (`Release → Project → Organization`,
  `Evidence → Release/Project`, `Task → Project`, `AgentExecution → Agent`).
- **Server-side enforcement**: routes never trust client org claims —
  `requireMembership(userId, organizationId, capability)` and
  `requireProjectAccess(userId, projectId, capability)` (`src/lib/auth.ts`) resolve the org from
  the record itself. Cross-tenant access attempts throw `TENANT_ISOLATION` (e.g.
  `agent-runtime.ts:startExecution`, `executions/[executionId]/route.ts`).
- **Public surface**: `visibility` on `Project` gates the public explorer and verification flows;
  private projects never appear in `/api/public/explore` or digest lookups
  (`verifyDigest` filters on public releases).
- **Personal data**: `Notification` and `Session` are user-scoped, not org-scoped; audit events
  may have `organizationId: null` for platform-level events (e.g. unmapped webhook deliveries,
  auth login).

## 3. Polymorphic attestation subject pattern

`Attestation.subjectType` + `subjectId` is a **polymorphic union** over five subject kinds
(`RELEASE | PROJECT | COMPONENT | TASK | AGENT_EXECUTION` — see also `SUBJECT_TYPES` in
`src/lib/categories.ts`). Consequences visible in the code:

- There is **no foreign key** from `Attestation` to any subject table; lookups are by
  `(subjectType, subjectId)` index (e.g. policy engine:
  `db.attestation.findMany({ where: { subjectType: 'RELEASE', subjectId: releaseId } })`).
- Tenant scoping cannot traverse the union, so `Attestation` **denormalizes** `projectId` and
  `organizationId` at write time; access control uses those columns
  (`attestations/[attestationId]/route.ts`).
- The public explorer joins attestations to releases manually (schema comment: "Attestation →
  Release is polymorphic (subjectType/subjectId), so join manually") and filters public visibility
  in application code.
- The only implemented issuer today is the **release** subject
  (`POST /api/releases/[releaseId]/attest`) and the **agent execution** subject
  (`src/lib/agent-runtime.ts:attestExecution`). `PROJECT`, `COMPONENT` and `TASK` subjects are
  declared in the vocabulary but have **no issuing endpoint yet** (Planned).

### protocolId conventions

`protocolId` is deterministic and mirrors the on-chain id; it is the unique, externally citable
name of an attestation:

| Subject | Format | Example source |
| --- | --- | --- |
| Release | `{project.slug}-{version.lower()}-{category.lower()}-{issuerAddress}` | `src/app/api/releases/[releaseId]/attest/route.ts` |
| Agent execution | `{executionId}-agent_task_completion-{issuerAddress}` | `src/lib/agent-runtime.ts` |
| Release (verification lookup alias) | `{project.slug}-{version.lower()}` | `verifyRelease`, `verifyDigest`, `GET /api/projects/[projectId]/releases` (returned as `protocolId` for the release itself) |

The same convention exists on-chain: `core.ComposeReleaseID(projectID, version)` builds release
ids (see `chain/realms/proofloom/core/core.gno` usage in `releases.gno`), so a platform protocolId
and a realm release id coincide for release subjects.

## 4. Integrity rules

- **Referential**: `onDelete: Cascade` on `Session`, `Wallet`, `Membership`, `Component`,
  `Dependency`, `Task`, `AgentGrant`, `AgentExecution`, `Notification`; `SetNull`-style nullable
  links for `Release.component`, `Evidence.release`, `Attestation.issuer/evidence`,
  `Review.release/task`, `ChainTransaction.release`.
- **Uniqueness**: `User.email`, `User.gnoAddress`, `Wallet.address`, `Session.tokenHash`,
  `Organization.slug`, `Invitation.tokenHash`, `Project.slug`, `Release.(projectId, version)`,
  `Attestation.protocolId`, `Agent.slug`, `AgentGrant.(agentId, projectId)`,
  `ChainTransaction.txHash`, `ChainTransaction.idempotencyKey`, `ApiCredential.keyHash`,
  `Integration.(organizationId, kind)`, `UsageRecord.(key, window)`,
  `Policy` uniqueness comes from the version+deactivate flow rather than a constraint.
- **State machines** are enforced in application code, not the database:
  releases (`src/app/api/releases/[releaseId]/route.ts`), tasks (`src/app/api/tasks/route.ts`),
  agent executions and attestations (`src/lib/agent-runtime.ts`, `INVALID_TRANSITION` errors).
