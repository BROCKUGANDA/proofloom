# PROOFLOOM — Product Vision

> Status of this document: describes the product as **actually implemented** in this repository
> (Next.js 16 frontend + TypeScript API routes + Prisma/SQLite + Gno realms in `chain/realms/proofloom/`).
> Where a capability is planned but absent, it is explicitly marked **Planned**.

---

## 1. The problem

Modern software ships faster than it can be trusted. Three failure modes persist across the industry:

1. **Claims outrun evidence.** A release notes page says "tested, scanned, approved", but nobody can
   independently check which build produced the artifact, which tests ran against *that exact digest*,
   or who approved publication. Provenance lives in CI logs, ticket systems and Slack threads that
   no verifier can reach.
2. **AI agents act without accountability.** Autonomous agents now write code, run pipelines and
   prepare releases, yet their actions are rarely bound to scoped permissions, recorded receipts, or
   a human approval gate. When an agent's output enters a release, the provenance chain stops.
3. **Verification depends on the vendor.** Even where provenance tooling exists, the state that
   verifiers query usually lives in the same centralized dashboard operated by the party being
   verified. A revocation can be quietly edited; an audit log can be rewritten.

PROOFLOOM exists to make engineering claims **checkable**: every claim is distinguishable from its
evidence, every attestation names an accountable issuer, and the decisive state lives on a public
chain that no dashboard operator controls.

## 2. What PROOFLOOM is

PROOFLOOM is a **verifiable software provenance and AI-agent accountability platform** built on
Gno.land. It is implemented in this repository as:

- **A web platform** (`src/app`, `src/components`, `src/lib`): workspaces for organizations,
  projects, releases, evidence, attestations, agents, tasks and policies — with a public,
  account-free verification portal and explorer.
- **An evidence-backed release lifecycle**: releases move through an enforced state machine
  (`DRAFT → EVIDENCE_PENDING → VALIDATING → REVIEW_REQUIRED → APPROVED → PUBLISHED → VERIFIED`,
  with terminal `REJECTED / REVOKED / SUPERSEDED / DISPUTED`) — see
  `src/app/api/releases/[releaseId]/route.ts` (`TRANSITIONS`) and the on-chain mirror in
  `chain/realms/proofloom/releases/releases.gno`. Publication is gated by a deterministic policy
  engine (`src/lib/policy-engine.ts`); the `VERIFIED` state additionally requires at least one
  active **on-chain** attestation commitment.
- **Content-addressed evidence**: evidence payloads are stored with a sha256 `contentHash`
  (`src/app/api/releases/[releaseId]/evidence/route.ts`); attestations commit to that digest, and
  the verification engine re-computes digests from inline evidence bytes at verification time
  (`src/lib/verification.ts`, check `digest_integrity`).
- **AI-agent accountability**: agents are registered records with scoped, expiring, revocable
  per-project grants (`AgentGrant`, scopes `READ | EVIDENCE | VERIFY_REQUEST | TASK_UPDATE |
  REVIEW_PROPOSE | PUBLISH_REQUEST`), executions produce digest-stamped reports
  (`src/lib/agent-runtime.ts`), anything that would publish requires explicit human approval, and
  completed executions can be attested (`AGENT_TASK_COMPLETION`).
- **A Gno.land protocol layer**: seven realm packages under `chain/realms/proofloom/` — `core`,
  `registry`, `releases`, ` attestations`, `agents`, `policies`, `verify` — deployed via
  `chain/scripts/deploy.sh` with the manifest recorded in `chain/deployments/deployment-dev.json`
  (local dev-chain deployment verified; Onyx testnet deployment pending faucet funding, per the
  manifest itself).
- **Public verification**: `GET /api/verify/release|attestation|digest/{id}` needs no account, is
  rate-limited per IP, and returns a machine-readable check-by-check report including explicit
  *limitations* (a valid signature proves origin and integrity, not artifact safety).

## 3. Audiences

| Audience | What PROOFLOOM gives them (as implemented) |
| --- | --- |
| **Engineering leaders** | `WorkspaceView` organization overview; release lifecycle rail (`ProvenanceRail`); analytics computed only from persisted records with labeled data sources (`/api/analytics`). |
| **Security & compliance teams** | Deterministic publication policies (`/api/policies`, `src/lib/policy-engine.ts`); append-only audit trail (`/api/audit`, `src/lib/audit.ts`); attestation categories covering build/source provenance, security assessment, dependency verification, compliance evidence and incident remediation. |
| **Developers** | Draft releases, upload evidence with content addressing, track policy verdicts check-by-check (`ProjectView`, `ReleaseView`). |
| **Agent operators** | `AgentsView` ("Agent Command"): register agents, grant scoped permissions per project, execute, review and approve/reject executions, attest completion. |
| **Auditors / external verifiers** | Account-free verification portal (`VerifyPortalView`, `/api/verify/...`), public explorer (`ExplorerView`, `/api/public/explore`), digest lookup ("which published releases commit to this sha256?"), and the read-only on-chain `verify` realm for third-party integration. |

## 4. Product principles

These principles are visible in the code, not just in prose:

### 4.1 Evidence is distinguishable from claims
- `Evidence` rows are content-addressed (`contentHash`, sha256, `src/lib/crypto.ts:sha256Hex`).
- `Attestation` rows are **claims** that commit to a digest; they carry `issuerId`, `issuerAddress`,
  `category`, `status`, and expiry. The verification engine reports which checks passed and which
  did not (`src/lib/verification.ts` returns a `checks[]` array, never a bare boolean).

### 4.2 Every attestation has an issuer
- Issuing requires a valid `g1…` Gno address (`isValidGnoAddress`), taken from the linked wallet or
  explicitly supplied (`/api/releases/[releaseId]/attest`). The protocol id embeds the issuer:
  `{project-slug}-{version}-{category}-{issuerAddress}`.
- Agent-execution attestations are issued by a named human user with an address, never by the
  platform anonymously (`src/lib/agent-runtime.ts:attestExecution`).

### 4.3 Evidence is verifiable independently of the interface
- The public JSON API (`/api/verify/...`) returns the same report the portal renders, with
  `limitations` included.
- The on-chain `verify` realm (`chain/realms/proofloom/verify/verify.gno`) is a pure read facade —
  "no state is written, no authorization is granted" — exposing `VerifyRelease`, `VerifyAttestation`,
  `VerifyDigest`, `RegistryStats` as stable public API for other realms, dApps and indexers.
- The platform never fabricates on-chain references: marking a project registered requires a tx hash
  (`PATCH /api/projects/[projectId]`), and the gateway "never holds user keys"
  (`src/lib/chain.ts` header comment).

### 4.4 On-chain state is not dependent on a centralized dashboard
- Release status, attestations, agent permissions and policy evaluation all have realm
  implementations under `chain/realms/proofloom/`; the platform queries them through the gateway
  (`abci_query` / `vm/qeval`, `src/lib/chain.ts`) with explicit chain-id identity checks.
- Revocation on-chain is a *visible state, never a deletion* (`releases.gno`, `Revoke` doc comment).
- Honest status: the deployed manifest records a **local dev-chain deployment**; the Onyx testnet
  deployment is pending faucet funding (`chain/deployments/deployment-dev.json`). The gateway
  hard-fails with `CHAIN_UNAVAILABLE` / `CHAIN_ID_MISMATCH` rather than pretending the chain is
  healthy.

### 4.5 Private data stays private
- Visibility is a first-class field: projects are `public | private`; the public explorer and
  verification flows filter strictly by `visibility: 'public'` (`/api/public/explore`,
  `verifyDigest`).
- Tenant scoping: every tenant-scoped row carries `organizationId` and all queries filter by
  membership server-side (schema header comment; `requireMembership` / `requireProjectAccess` in
  `src/lib/auth.ts`; `TENANT_ISOLATION` errors in agents/execution routes).
- Agent prompts and protected inputs are never stored raw: `AgentExecution` stores `inputDigest` /
  `outputDigest` / sanitized `report`; the runtime sanitizes task context and strips potential
  prompt-injection blocks (`src/lib/agent-runtime.ts:sanitize`).
- LLM provider keys stay server-side (`src/lib/llm.ts`); API credentials are stored hashed with only
  a prefix kept for identification (`src/app/api/keys/route.ts`).

### 4.6 Agent permissions are scoped, revocable and auditable
- Grants are per `(agent, project)` with explicit scope lists and optional `expiresAt`
  (`AgentGrant`, `POST /api/agents op=grant`); revocation is a first-class operation
  (`op=revoke-grant`).
- The runtime enforces scope checks server-side before any execution (`startExecution` requires an
  active `EVIDENCE` or `TASK_UPDATE` grant) and rate-limits per organization.
- Executions that would publish anything halt in `AWAITING_APPROVAL` until a human approves
  (`approveExecution`); every step emits an audit event (`agent.execution.start/approve/reject`).

### 4.7 Principle → mechanics summary

| Principle | Concrete mechanics in this repo |
| --- | --- |
| Evidence ≠ claims | `Evidence.contentHash` (sha256, server-computed) vs `Attestation.digest` commitment; `verification.ts` re-computes digests from evidence bytes |
| Every attestation has an issuer | `issuerAddress` required (`INVALID_ADDRESS` otherwise); protocolId embeds the issuer |
| Verifiable independently of the UI | `GET /api/verify/...` public JSON API; on-chain `verify` realm as stable read API; `limitations[]` in every report |
| On-chain state not dashboard-dependent | 7 realms enforce the same state machine the platform enforces; gateway queries with chain-id identity checks; revocation is visible state |
| Private data stays private | `visibility` filtering in every public query; `organizationId` tenancy enforced server-side; digests instead of raw prompts; hashed keys |
| Agent permissions scoped/revocable/auditable | `AgentGrant` scopes+expiry, `revoke-grant` op, `TENANT_ISOLATION` guards, audit events on every agent action |

## 5. Gno.land commitments

- **Chain**: Gno.land Onyx testnet by default (`PROOFLOOM_CHAIN_ID=onyx-1`,
  `https://rpc.onyx.testnets.gno.land:443`), configurable via env (`activeChain()`).
- **Realms**: `core`, `registry`, `releases`, `attestations`, `agents`, `policies`, `verify` —
  with test files (`*_test.gno`) for each. `core` is a stateless shared library; `verify` is the
  composability contract with stable read-only function signatures.
- **Signing model**: two explicit paths — user-owned operations signed client-side via
  Adena/GnoConnect (`src/lib/client.ts` wallet adapters), and platform-operated transactions signed
  by the deployment account through the `gnokey` CLI operator flow (`src/lib/operator.ts`), whose
  mnemonic arrives only via `PROOFLOOM_OPERATOR_MNEMONIC` and is never committed. Without it, the
  endpoints fail with an explicit activation error — **no simulated success is ever returned**.
- **Transaction lifecycle**: every on-chain interaction is tracked as a `ChainTransaction` row with
  states `CREATED → SIMULATED → AWAITING_SIGNATURE → SIGNED → BROADCAST → PENDING → CONFIRMED |
  FAILED | EXPIRED | RECONCILIATION_REQUIRED`, and confirmation is **state-based**: the gateway
  re-queries the realm to confirm the expected record exists, never trusting a hash alone
  (`reconcileTransaction`).

## 6. What this product is *not* (yet)

Stated plainly, to keep the vision honest:

- **Not** a full artifact registry: evidence beyond 512 KiB requires an object-storage adapter that
  is **Planned** (inline-only today).
- **Not** a multi-provider LLM gateway: the registry supports fallback, but only the Z.ai provider
  (`glm-4.6`) is registered today.
- **Not** yet on the live Onyx testnet: realms are pipeline-verified on a local `gnodev` chain;
  Onyx deployment is pending faucet funding.
- **Not** a notification producer: the `Notification` model and read/mark-read API exist, but no
  code path currently creates notifications (**Planned**).
- **Not** API-key authenticated: `ApiCredential` issuance/revocation works, but routes do not yet
  accept API keys as an auth method (**Planned**).

## 7. An end-to-end walkthrough (verifiable endpoint sequence)

The life of one release, using only endpoints that exist in `src/app/api/`:

1. **Register & get a workspace** — `POST /api/auth/register` creates the user plus a default
   organization with an OWNER membership.
2. **Create the project** — `POST /api/projects` (capability `project.create`); optionally record
   the on-chain commitment later via `PATCH /api/projects/[projectId]` (requires a tx hash).
3. **Set the publication policy** — `POST /api/policies op=set` (e.g. require
   `BUILD_PROVENANCE`, `TEST_EXECUTION`, `SECURITY_ASSESSMENT`; min 1 `RELEASE_APPROVAL`), and
   dry-run it with `op=simulate`.
4. **Draft the release** — `POST /api/projects/[projectId]/releases` with version + commit hash
   (status `DRAFT`).
5. **Attach evidence** — `POST /api/releases/[releaseId]/evidence` for the build log, test
   report and security scan; each is sha256 content-addressed and audit-logged. With an artifact
   digest present, the release auto-advances to `EVIDENCE_PENDING`.
6. **Attest** — `POST /api/releases/[releaseId]/attest` per category; each attestation commits to
   an evidence digest under a deterministic protocolId and requires an issuer address.
7. **Move through the machine** — `PATCH /api/releases/[releaseId]` with `validate`,
   `require-review`, `approve`; `publish` is refused by the server unless the policy evaluates
   green (`evaluateReleasePolicy`).
8. **Commit on-chain** — either wallet-signed (client records lifecycle via
   `POST /api/chain op=record|transition`) or operator-signed
   (`POST /api/chain op=publish-on-chain` → `releases.PublishRelease`), then
   `op=confirm-on-chain` reconciles by querying the realm, not by trusting the hash.
9. **Attest on-chain** — `POST /api/chain op=attest-on-chain` broadcasts `attestations.Issue` and
   marks the attestation `onChain` with its tx hash.
10. **Mark VERIFIED** — `PATCH /api/releases/[releaseId]` `verify` succeeds only with ≥1 active
    on-chain attestation commitment.
11. **Anyone can check it** — `GET /api/verify/release/{project-slug}-{version}` returns the
    check-by-check verdict (no account), `GET /api/verify/digest/{sha256}` answers "which
    published releases commit to this digest?", and the read-only `verify` realm answers the same
    questions for third parties directly on-chain.

Every step in that sequence emits an append-only `AuditEvent`, so the release's history is
reconstructable from the trail alone — which is the accountability property the product exists to
provide.

