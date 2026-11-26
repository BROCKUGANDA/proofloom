# PROOFLOOM — Feature Matrix

Implementation status per product domain, verified against the source files listed.
Status vocabulary:

- **Implemented & verified** — code reviewed in this pass; behavior confirmed from the source.
- **Implemented, verification pending** — code exists and is wired end-to-end, but no runtime
  verification (e.g. against a funded Onyx deployment) is recorded in the repo.
- **Externally blocked** — implementation depends on an external resource that is absent
  (faucet funding, credentials, provider availability).
- **Planned / Not implemented** — model, stub or nothing exists; no invented features.

---

## 1. Identity & authentication

| Capability | Status | Evidence (files) |
| --- | --- | --- |
| Email/password registration, scrypt hashing, strength checks | Implemented & verified | `src/app/api/auth/[action]/route.ts` (`register`), `src/lib/crypto.ts` (`hashPassword`, `passwordStrength`) |
| Login with per-IP and per-email rate limits | Implemented & verified | `auth/[action]/route.ts` (`login`, `guardRate('login-ip', …)`, `login-fail` bucket) |
| Opaque 256-bit session tokens, sha256-hashed at rest, httpOnly cookie, 30-day TTL | Implemented & verified | `src/lib/auth.ts` (`createSession`, `getAuth`) |
| Session rotation on privileged actions (older than 7 days) + revocation | Implemented & verified | `src/lib/auth.ts` (`requireAuth`, `rotateSession`, `revokeSession`) |
| TOTP MFA (RFC 6238): setup / enable / disable | Implemented & verified | `auth/[action]/route.ts` (`mfa-setup|mfa-enable|mfa-disable`), `src/lib/crypto.ts` (`generateTotpSecret`, `verifyTotp`) |
| Wallet linking (Adena/GnoConnect) with signature challenge | Implemented, verification pending — the challenge is stored and the `verified` flag recorded, but the sandboxed preview records an UNVERIFIED association when no signature is presented (honest, documented in-code) | `auth/[action]/route.ts` (`wallet-link`), `src/lib/client.ts` (`walletSignMessage`) |
| API-key authentication on API routes | **Not implemented** — keys are issued/revoked but no route validates `Authorization`/`x-api-key` against `keyHash` | `src/app/api/keys/route.ts` (issuance only) |

Key endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
`POST /api/auth/mfa-setup`, `POST /api/auth/mfa-enable`, `POST /api/auth/mfa-disable`,
`POST /api/auth/wallet-link`, `GET /api/session`.

## 2. Organizations & membership

| Capability | Status | Evidence |
| --- | --- | --- |
| Org listing with member/project counts | Implemented & verified | `src/app/api/orgs/route.ts` (`GET`) |
| Org creation with OWNER membership + audit event | Implemented & verified | `src/app/api/orgs/route.ts` (`POST`) |
| Member roster incl. capabilities per role | Implemented & verified | `src/app/api/orgs/[orgId]/members/route.ts` (`GET`) |
| Member invitation (hashed token, 7-day expiry, invite URL returned — no email provider assumed) | Implemented & verified | same file (`POST`) |
| Member removal / invitation revocation, owner-protection rules | Implemented & verified | same file (`DELETE`) |
| RBAC: 8 roles (`VIEWER…OWNER`), capability map, rank guard (cannot invite ≥ OWNER) | Implemented & verified | `src/lib/auth.ts` (`ROLE_RANK`, `CAPS`, `requireMembership`) |

Endpoints: `GET/POST /api/orgs`; `GET/POST/DELETE /api/orgs/[orgId]/members`.

## 3. Projects

| Capability | Status | Evidence |
| --- | --- | --- |
| Tenant-scoped project listing w/ counts, latest release, active policy | Implemented & verified | `src/app/api/projects/route.ts` (`GET`) |
| Project creation (slug, visibility, tech stack, audit) | Implemented & verified | same file (`POST`) |
| Project detail payload (components, deps, releases, tasks, policies, agents, attestations) + live on-chain mirror query | Implemented, verification pending (on-chain part depends on deployed realm) | `src/app/api/projects/[projectId]/route.ts` (`GET`) |
| Metadata update, archive/restore, on-chain registration recording (requires tx hash) | Implemented & verified | same file (`PATCH`) |

Endpoints: `GET/POST /api/projects`; `GET/PATCH /api/projects/[projectId]`.

## 4. Components & dependencies

| Capability | Status | Evidence |
| --- | --- | --- |
| Component CRUD (create / list / deprecate-restore via PATCH), artifact-type validation | Implemented & verified | `src/app/api/projects/[projectId]/components/route.ts` |
| Dependency registry (ecosystems: npm, pypi, maven, go, cargo, oci, other; risk levels) + graph/summary shape | Implemented & verified | `src/app/api/projects/[projectId]/dependencies/route.ts` |
| SBOM ingestion/validation tooling | **Not implemented** (SBOM exists only as an evidence `kind` and a policy flag `requireValidSBOM`) | `src/lib/policy-engine.ts` |

## 5. Releases & lifecycle

| Capability | Status | Evidence |
| --- | --- | --- |
| Draft release creation (version/commit validation, uniqueness per project) | Implemented & verified | `src/app/api/projects/[projectId]/releases/route.ts` (`POST`) |
| Release listing with protocolId, evidence, transactions, attestations | Implemented & verified | same file (`GET`) |
| Server-enforced state machine incl. capability per transition and digest requirements | Implemented & verified | `src/app/api/releases/[releaseId]/route.ts` (`TRANSITIONS`, `PATCH`) |
| Publication policy gate (deterministic, server-side) | Implemented & verified | same file + `src/lib/policy-engine.ts:evaluateReleasePolicy` |
| `VERIFIED` requires ≥1 active on-chain attestation | Implemented & verified | `releases/[releaseId]/route.ts` (`PATCH`, `VERIFIED` branch) |
| Supersede semantics (same project, successor must be published) | Implemented & verified | same file |

Endpoints: `GET/POST /api/projects/[projectId]/releases`; `GET/PATCH /api/releases/[releaseId]`.

## 6. Evidence

| Capability | Status | Evidence |
| --- | --- | --- |
| Evidence ingest with server-computed sha256, client digest cross-check, 512 KiB inline cap | Implemented & verified | `src/app/api/releases/[releaseId]/evidence/route.ts` (`POST`) |
| Evidence listing + single-body fetch with `integrityOk` recomputation | Implemented & verified | same file (`GET`, `PUT`) |
| Auto-advance DRAFT → EVIDENCE_PENDING when artifact digest is present | Implemented & verified | same file |
| Object-storage adapter for >512 KiB artifacts | **Planned** — `Evidence.storage`/`storageKey` fields exist; only `storage: 'inline'` is written | `prisma/schema.prisma` (model `Evidence`) |

Endpoints: `GET/POST/PUT /api/releases/[releaseId]/evidence`.

## 7. Attestations

| Capability | Status | Evidence |
| --- | --- | --- |
| Issue release attestation (13 categories, issuer address required, deterministic protocolId, idempotent upsert, expiry) | Implemented & verified | `src/app/api/releases/[releaseId]/attest/route.ts`, `src/lib/categories.ts` |
| Fetch by id or protocolId with live verification report | Implemented & verified | `src/app/api/attestations/[attestationId]/route.ts` (`GET`) |
| Revocation with reason (issuer or `attestation.revoke` capability) | Implemented & verified | same file (`DELETE`) |
| Agent-execution attestations (`AGENT_TASK_COMPLETION`) | Implemented & verified | `src/lib/agent-runtime.ts:attestExecution`, `src/app/api/executions/[executionId]/route.ts` (`POST op=attest`) |

Endpoints: `POST /api/releases/[releaseId]/attest`; `GET/DELETE /api/attestations/[attestationId]`.

## 8. Agents

| Capability | Status | Evidence |
| --- | --- | --- |
| Agent registry (org-scoped, optional project scope, owner address, model metadata) | Implemented & verified | `src/app/api/agents/route.ts` (`POST op=register`, `GET`) |
| Scoped, expiring, revocable per-project grants (6 scopes) | Implemented & verified | `agents/route.ts` (`op=grant`, `op=revoke-grant`) |
| Agent lifecycle (ACTIVE/SUSPENDED/REVOKED) with role guard | Implemented & verified | `agents/route.ts` (`op=set-status`) |
| Execution trigger with server-side scope + rate-limit gates | Implemented & verified | `src/lib/agent-runtime.ts:startExecution` |
| Human approval gate (`AWAITING_APPROVAL` → COMPLETED/REJECTED) | Implemented & verified | `src/lib/agent-runtime.ts:approveExecution`, `executions/[executionId]/route.ts` |
| Digest-stamped execution reports (no raw prompts stored) | Implemented & verified | `src/lib/agent-runtime.ts:runExecution` |

Endpoints: `GET/POST /api/agents` (POST ops: `register`, `grant`, `revoke-grant`, `set-status`,
`execute`, `simulate`); `GET/POST /api/executions/[executionId]` (POST ops: `approve`, `reject`,
`attest`).

## 9. Tasks

| Capability | Status | Evidence |
| --- | --- | --- |
| Task creation (human/agent assignee, priority, evidence requirement) | Implemented & verified | `src/app/api/tasks/route.ts` (`POST`) |
| Task board query per project | Implemented & verified | same file (`GET`) |
| Task state transitions with completion-digest receipt and review records | **Implemented, endpoint unreachable** — the `PATCH` handler is written against a `[taskId]` dynamic segment, but no `src/app/api/tasks/[taskId]/route.ts` file exists, so `taskId` is undefined at runtime; transitions are therefore not reachable over HTTP | `src/app/api/tasks/route.ts` (`PATCH`, `TRANSITIONS`) |

Endpoints: `GET/POST /api/tasks` (functional); `PATCH /api/tasks` (dead — see above).

## 10. Policies

| Capability | Status | Evidence |
| --- | --- | --- |
| Policy set/clear with versioning (prior versions deactivated) | Implemented & verified | `src/app/api/policies/route.ts` (`POST op=set|clear`) |
| Deterministic evaluation: required categories, min approvals (+ issuer allow-list), no-critical, valid SBOM, signed evidence | Implemented & verified | `src/lib/policy-engine.ts:evaluateReleasePolicy` |
| Policy simulation endpoint for the UI | Implemented & verified | `policies/route.ts` (`POST op=simulate`) |
| On-chain policy realm mirror | Implemented, verification pending — `chain/realms/proofloom/policies/policies.gno` exists with tests; platform queries currently evaluate from the database | `chain/realms/proofloom/policies/` |

Endpoints: `GET /api/policies?projectId=|orgId=`; `POST /api/policies`.

## 11. Verification portal (public)

| Capability | Status | Evidence |
| --- | --- | --- |
| Public release verification (10 checks, verdicts, limitations, persisted `VerificationResult`) | Implemented & verified | `src/lib/verification.ts:verifyRelease`, `src/app/api/verify/[...path]/route.ts` |
| Public attestation verification | Implemented & verified | `src/lib/verification.ts:verifyAttestation` |
| Digest lookup across published releases | Implemented & verified | `src/lib/verification.ts:verifyDigest` |
| Per-IP rate limiting (120/min) | Implemented & verified | `verify/[...path]/route.ts` (`guardRate`) |
| Portal UI with check-by-check rendering + JSON API hand-off | Implemented & verified | `src/components/views/verify-portal.tsx` |

Endpoints: `GET /api/verify/release/{id-or-protocolId}`, `GET /api/verify/attestation/{protocolId}`,
`GET /api/verify/digest/{sha256}` (no auth).

## 12. Public explorer

| Capability | Status | Evidence |
| --- | --- | --- |
| Public summary (projects, releases, attestations, agent count, chain profile, on-chain stats) | Implemented & verified | `src/app/api/public/explore/route.ts` (`kind=summary`) |
| Public project drill-down incl. active policy | Implemented & verified | same file (`kind=project`) |
| Direct protocol-id status proxy to the releases realm | Implemented, verification pending (chain part) | same file (`kind=release-status`) |
| Explorer UI (public, no auth) | Implemented & verified | `src/components/views/explorer.tsx`, `src/components/views/atlas.tsx` (Proof Atlas evidence graph) |

Endpoints: `GET /api/public/explore?kind=summary|project|release-status&id=…` (no auth).

## 13. Analytics

| Capability | Status | Evidence |
| --- | --- | --- |
| Org analytics from persisted records only, with labeled data sources (no fabricated numbers) | Implemented & verified | `src/app/api/analytics/route.ts` |
| 14-day activity series, verdict distribution, verification latency, tx stats | Implemented & verified | same file |
| Analytics UI | Implemented & verified | `src/components/views/analytics.tsx` |

Endpoint: `GET /api/analytics?orgId=`.

## 14. Audit

| Capability | Status | Evidence |
| --- | --- | --- |
| Append-only audit trail written as a side effect of privileged actions | Implemented & verified | `src/lib/audit.ts`, used across all mutating routes |
| Filterable audit query (org/project/action-prefix/limit ≤ 500) + action summary | Implemented & verified | `src/app/api/audit/route.ts` (`GET`) |
| Direct client writes rejected by design | Implemented & verified | same file (`POST` → `FORBIDDEN`) |
| Off-chain anchoring / tamper-evidence of audit rows | **Planned** — rows are append-only in SQLite; no hash chain or external anchor exists | — |

Endpoint: `GET /api/audit?orgId=…`.

## 15. Notifications

| Capability | Status | Evidence |
| --- | --- | --- |
| Notification read + mark-read API | Implemented & verified | `src/app/api/notifications/route.ts` (`GET`, `PATCH`) |
| Notification **production** (any code path that creates rows) | **Not implemented** — no `db.notification.create` exists anywhere in `src/`; the inbox stays empty unless rows are written externally | grep of `src/` |
| Email/push delivery | **Planned** | — |

Endpoints: `GET/PATCH /api/notifications`.

## 16. API keys

| Capability | Status | Evidence |
| --- | --- | --- |
| Credential issuance (`plk_…`, sha256-hashed at rest, raw key returned once) | Implemented & verified | `src/app/api/keys/route.ts` (`POST`) |
| Listing (prefixes only) + revocation | Implemented & verified | same file (`GET`, `DELETE`) |
| Using keys to authenticate requests | **Not implemented** (see §1) | — |

Endpoints: `GET/POST/DELETE /api/keys`.

## 17. GitHub webhooks

| Capability | Status | Evidence |
| --- | --- | --- |
| Signed ingestion (`x-hub-signature-256` HMAC or timestamped double-HMAC), constant-time compare | Implemented & verified | `src/app/api/webhooks/github/route.ts` |
| Delivery dedupe by `x-github-delivery` id | Implemented & verified | same file |
| Storage of deliveries + audit event per repo event | Implemented & verified | same file |
| Repository → organization mapping | **Not implemented** — the route attributes events to the *first* CONNECTED github integration, else stores with `organizationId: null` (documented in-code as later correlation) | same file |
| Reacting to push/release events (auto-creating releases etc.) | **Planned** | — |

Endpoint: `POST /api/webhooks/github` (requires `PROOFLOOM_GITHUB_WEBHOOK_SECRET`).

## 18. Chain gateway & on-chain protocol

| Capability | Status | Evidence |
| --- | --- | --- |
| JSON-RPC `abci_query` transport with 12 s timeout, base64 payload, realm-log-based `NOT_FOUND` mapping | Implemented & verified | `src/lib/chain.ts:abciQuery` |
| Chain identity check via `status` RPC, 60 s cache, hard `CHAIN_ID_MISMATCH` failure | Implemented & verified | `src/lib/chain.ts:verifyChainIdentity` |
| Realm queries: `VerifyRelease`, `ReleaseStatus`, `RegistryStats`, `GetPublicProject` | Implemented, verification pending (needs deployed realms) | `src/lib/chain.ts` |
| Seven Gno realms + tests | Implemented & verified (source); deployed to local dev chain | `chain/realms/proofloom/*`, `chain/deployments/deployment-dev.json` |
| **Onyx testnet deployment** | **Externally blocked** — manifest records "Onyx deployment pending faucet funding" | `chain/deployments/deployment-dev.json` |
| Tx lifecycle table with 10 states, explorer URLs, state-based reconciliation | Implemented & verified | `src/lib/chain.ts` (`TX_STATES`, `reconcileTransaction`), `src/app/api/chain/route.ts` |
| Operator-signed publish/attest broadcasts via `gnokey` | Implemented, verification pending — requires `PROOFLOOM_OPERATOR_MNEMONIC`; without it the API returns an explicit activation error (`FAUCET_DEPLETED`) | `src/lib/operator.ts`, `src/app/api/chain/route.ts` (`op=publish-on-chain|attest-on-chain|confirm-on-chain`) |
| Wallet-signed (Adena) client-side transactions | Implemented, verification pending | `src/lib/client.ts` (`walletSendTransaction`), `POST /api/chain op=record|transition` |

Endpoints: `GET /api/chain`; `POST /api/chain` (ops: `record`, `transition`, `query-release`,
`operator-status`, `publish-on-chain`, `attest-on-chain`, `confirm-on-chain`).

## 19. LLM integration & agent runtime

| Capability | Status | Evidence |
| --- | --- | --- |
| Provider abstraction with health + fallback registry | Implemented & verified | `src/lib/llm.ts` (`LLMProvider`, `ProviderRegistry`) |
| Z.ai provider (`glm-4.6`, server-side only via `z-ai-web-dev-sdk`) | Implemented & verified (externally blocked when SDK unavailable — reported honestly by `llm.health()`) | `src/lib/llm.ts:ZaiProvider` |
| Additional providers (OpenAI/Anthropic/local) | **Planned** — registry supports multiple providers; only one is registered | `src/lib/llm.ts` |
| Structured output schema + validation (`AgentReportSchema`) | Implemented & verified | `src/lib/llm.ts:validateAgentReport` |
| Prompt-injection sanitization and context truncation (8 000 chars) | Implemented & verified | `src/lib/agent-runtime.ts:sanitize` |
| Fire-and-forget execution runs with digest receipts and approval workflow | Implemented & verified | `src/lib/agent-runtime.ts` |
| Durable job queue / worker process for executions | **Planned** — runs are in-process (`void runExecution(...)`) and die with the server | `src/lib/agent-runtime.ts` |

## 20. Platform plumbing

| Capability | Status | Evidence |
| --- | --- | --- |
| Uniform `{data}` / `{error:{code,message,recovery,…}}` envelope with trace ids | Implemented & verified | `src/lib/api.ts` (`withApi`, `ok`, `fail`), `src/lib/errors.ts` |
| Fixed-window DB-backed rate limiting (UsageRecord upsert) | Implemented & verified | `src/lib/rate-limit.ts` |
| Health probe (database, chain identity, LLM providers, registry stats) | Implemented & verified | `src/app/api/health/route.ts` |
| Service status UI | Implemented & verified | `src/components/views/status.tsx` |
| Pagination (cursor/offset envelopes) | **Not implemented** — simple `take`/`limit` caps only (audit ≤500, explorer 50, notifications 50) | route files |
| Background job/queue infrastructure | **Not implemented** (see §19; also `WebhookDelivery` retry fields unused) | — |
| Multi-region / horizontal scaling concerns | **Planned** — rate limiter is documented single-node | `src/lib/rate-limit.ts` |
