# PROOFLOOM — Database Architecture

Source of truth: `prisma/schema.prisma`, `src/lib/db.ts`, `package.json` scripts, and the
environment configuration (`DATABASE_URL`). Model-by-model field detail lives in
`DOMAIN_MODEL.md`; this document covers engine choice, indexing, integrity, migrations and the
transaction-lifecycle table.

---

## 1. Engine choice

- **Current**: SQLite, single file, resolved from `DATABASE_URL`. In this deployment the `.env`
  contains `DATABASE_URL=file:/home/z/my-project/db/custom.db`. Datasource block:

  ```prisma
  datasource db {
    provider = "sqlite"
    url      = env("DATABASE_URL")
  }
  ```

- **Client**: standard `prisma-client-js`; a single `PrismaClient` is cached on `globalThis` in
  dev to survive HMR (`src/lib/db.ts`), with query logging enabled (`log: ['query']`).
- **PostgreSQL for production**: **Planned, not implemented.** The schema is written for SQLite
  (no Postgres-specific types in use), and nothing in the repo references a Postgres provider.
  Moving to Postgres will require a provider switch plus revisiting the `String`-based
  enumerations and JSON-in-TEXT columns (`metadata`, `checks`, `config`, `policyVerdict`).
- **Concurrency envelope**: SQLite + single-process Next.js = single-node semantics. This matches
  the DB-backed fixed-window rate limiter (`src/lib/rate-limit.ts`), which is explicitly
  documented "single-node safe". Horizontal scaling is **Planned** and depends on both the
  Postgres move and an external rate-limit store.

## 2. Model inventory

21 models, grouped (details in `DOMAIN_MODEL.md`):

| Group | Models |
| --- | --- |
| Identity | `User`, `Wallet`, `Session` |
| Organizations | `Organization`, `Membership`, `Invitation` |
| Projects | `Project`, `Component`, `Dependency` |
| Releases | `Release` |
| Evidence & attestations | `Evidence`, `Attestation` |
| Agents | `Agent`, `AgentGrant`, `AgentExecution` |
| Tasks & reviews | `Task`, `Review` |
| Policies | `Policy` |
| Chain | `ChainTransaction` |
| Platform | `AuditEvent`, `ApiCredential`, `WebhookDelivery`, `Integration`, `Notification`, `UsageRecord`, `VerificationResult` |

## 3. Indexing strategy

All indexes declared in the schema, with the query each serves:

| Model | Index / constraint | Serving |
| --- | --- | --- |
| `User` | `@@index([status])` | account-status filtering (auth checks `status !== 'ACTIVE'`) |
| `User` | `email @unique`, `gnoAddress @unique` | login lookup; wallet identity |
| `Wallet` | `address @unique`, `@@index([userId])` | challenge verification, user's wallets |
| `Session` | `tokenHash @unique`, `@@index([userId])`, `@@index([expiresAt])` | token-hash session resolution (the hot auth path); expiry sweeps |
| `Organization` | `slug @unique`, `@@index([ownerId])` | slug addressing; owner listings |
| `Membership` | `@@unique([userId, organizationId])`, `@@index([organizationId])` | RBAC membership resolution (every request); org roster |
| `Invitation` | `tokenHash @unique`, `@@index([organizationId, status])` | invite redemption; pending-invite listings |
| `Project` | `slug @unique`, `@@index([organizationId])`, `@@index([visibility, status])` | protocol-id resolution; tenant listing; public-explorer filters |
| `Component` / `Dependency` | `@@index([projectId])` | project-scoped listing |
| `Release` | `@@unique([projectId, version])`, `@@index([status])`, `@@index([artifactDigest])` | version uniqueness; lifecycle boards; **digest-based public verification** (`verifyDigest`, on-chain `FindByDigest` parity) |
| `Evidence` | `@@index([contentHash])`, `@@index([releaseId])` | content addressing; release evidence lists |
| `Attestation` | `protocolId @unique`, `@@index([subjectType, subjectId])`, `@@index([status])`, `@@index([organizationId])` | deterministic protocol id; polymorphic subject lookups (the policy engine's core query); active filtering; tenant scoping |
| `Agent` | `slug @unique`, `@@index([organizationId])` | registry addressing; tenant listing |
| `AgentGrant` | `@@unique([agentId, projectId])` | O(1) permission gate in `startExecution` |
| `AgentExecution` | `@@index([agentId])`, `@@index([status])` | per-agent history; approval queues |
| `Task` | `@@index([projectId])`, `@@index([state])` | boards; state filtering |
| `Review` | `@@index([decision])` | decision summaries |
| `Policy` | `@@index([projectId])`, `@@index([organizationId])` | active-policy lookup (`findFirst({ where: { projectId, active: true } })`) |
| `ChainTransaction` | `txHash @unique`, `idempotencyKey @unique`, `@@index([status])`, `@@index([kind])` | explorer links; retry safety; reconciliation sweeps |
| `AuditEvent` | `@@index([organizationId, createdAt])`, `@@index([targetType, targetId])` | the audit explorer's primary query (org + time desc); target-history lookups |
| `ApiCredential` | `keyHash @unique`, `@@index([organizationId])` | future key auth; org key listing |
| `WebhookDelivery` | `@@index([status])` | delivery/retry sweeps (Planned consumer) |
| `Integration` | `@@unique([organizationId, kind])` | one integration per kind per org |
| `Notification` | `@@index([userId, readAt])` | unread counts |
| `UsageRecord` | `@@unique([key, window])`, `@@index([window])` | atomic rate-limit upsert; window cleanup |
| `VerificationResult` | `@@index([targetType, targetId])`, `@@index([createdAt])` | per-target verification history; 30-day analytics window |

## 4. Integrity rules

- **Uniqueness constraints** carry most of the domain invariants (see table above), including
  `Release.(projectId, version)`, `Attestation.protocolId`, `Membership.(userId, organizationId)`,
  `AgentGrant.(agentId, projectId)`, `ChainTransaction.txHash`/`idempotencyKey`,
  `UsageRecord.(key, window)`.
- **Cascading deletes** (`onDelete: Cascade`): `Session`, `Wallet`, `Membership`, `Component`,
  `Dependency`, `Task`, `AgentGrant`, `AgentExecution`, `Notification` (all with respect to their
  parent `User`/`Organization`/`Project`/`Agent`). Deleting an organization cascades memberships,
  invitations and integrations; projects cascade components/dependencies/tasks/agent-grants.
- **Soft state instead of deletion** for domain records: releases are `REVOKED`/`SUPERSEDED`
  (never deleted), attestations are `REVOKED` with reason + timestamp, agents are `SUSPENDED`/
  `REVOKED`, API credentials get `revokedAt`, sessions get `revokedAt` + reason, organizations and
  projects are `archived`. Audit events have no delete path at all.
- **Nullable vs required**: `Release.artifactDigest` is nullable until evidence lands (transitions
  to `EVIDENCE_PENDING`/`APPROVED`/`PUBLISHED` require a valid sha256 — enforced in
  `releases/[releaseId]/route.ts`); `Attestation.issuerAddress` is required (issuer proof is
  mandatory), `issuerId` is nullable for address-only issuers.
- **Application-enforced state machines** (releases, tasks, agent executions, attestation
  revocation) complement the schema; SQLite itself enforces none of them.

## 5. Chain transaction lifecycle table

`ChainTransaction` is the durable ledger that makes on-chain interaction recoverable:

- **Fields**: `kind` (`REGISTER_PROJECT | PUBLISH_RELEASE | ATTEST | REVOKE | REGISTER_AGENT |
  AGENT_EXECUTION`), `status`, `chainId` (default `onyx-1`), `txHash` (unique), `gasUsed`,
  `height`, `error`, `attempts`, `idempotencyKey` (unique), `createdBy`, `confirmedAt`, plus
  nullable links `releaseId` / `attestationId`.
- **States** (mirrored in `src/lib/chain.ts:TX_STATES` and echoed by `GET /api/chain`):
  `CREATED → SIMULATED → AWAITING_SIGNATURE → SIGNED → BROADCAST → PENDING → CONFIRMED` with
  failure/exception states `FAILED`, `EXPIRED`, `RECONCILIATION_REQUIRED`.
- **Writers**:
  - Wallet-signed flow: the client records lifecycle transitions via `POST /api/chain`
    (`op=record`, `op=transition`) after Adena signing.
  - Operator flow: `op=publish-on-chain` / `op=attest-on-chain` broadcast via `gnokey`
    (`src/lib/operator.ts`) and create rows at `BROADCAST`; `op=confirm-on-chain` runs
    **state-based reconciliation** (`reconcileTransaction`) — it re-queries the realm expression
    that must succeed once the tx landed (`releases.ReleaseStatus(...)` or
    `attestations.GetAttestation(...)`), increments `attempts`, sets `CONFIRMED` + `confirmedAt`
    or leaves the row for retry, and on confirmation stamps the release
    `gnoRegistered`/`onChainRef`.
- **Design rule** (`chain.ts` header): the gateway only reads state and tracks lifecycle — it
  never holds keys, and confirmation is never inferred from a hash alone.
- **Honest caveat**: `EXPIRED` and `RECONCILIATION_REQUIRED` are valid states in the vocabulary,
  but no background sweeper transitions rows into them today (a reconciliation job is Planned;
  reconciliation currently happens when `op=confirm-on-chain` is invoked).

## 6. Migration approach

- **Scripts** (`package.json`):
  - `db:push` → `prisma db push --accept-data-loss` — the working method in this repo; the schema
    is pushed directly to `db/custom.db`.
  - `db:generate` → `prisma generate` — client generation.
  - `db:migrate` → `prisma migrate dev` and `db:reset` → `prisma migrate reset` are available,
    but **no `prisma/migrations` directory exists** — no migration history has been committed.
  - There is no seed script.
- **Consequence**: schema changes in this repository are applied by `db push` against the local
  SQLite file. For production (Postgres, Planned), introducing a real migration history via
  `prisma migrate dev` is a prerequisite.
- **Dev ergonomics**: `PrismaClient` is memoized on `globalThis` outside production to avoid
  connection storms during Next.js hot reload (`src/lib/db.ts`).
