# PROOFLOOM Threat Model

Scope: the PROOFLOOM application (Next.js API + Prisma/SQLite) and the
PROOFLOOM Gno realms. Assets: user credentials & sessions, organization data,
evidence artifacts, on-chain commitments, operator mnemonic, webhook secrets.
Method: threat-by-threat with the **control that exists in code** (file cited)
or an explicit **gap**. STRIDE summary at the end.

---

## T1. Cross-tenant data exposure

- **Control:** every tenant-scoped route resolves the org from the resource
  and calls `requireMembership` / `requireProjectAccess` server-side
  (`src/lib/auth.ts`), e.g. `src/app/api/releases/[releaseId]/route.ts`,
  `.../evidence/route.ts`, `src/app/api/projects/route.ts`. Agent execution
  checks `agent.organizationId !== params.organizationId → TENANT_ISOLATION`
  (`src/lib/agent-runtime.ts`). Execution detail requires org membership
  (`src/app/api/executions/[executionId]/route.ts`).
- **Control (public surfaces):** `/api/public/explore` filters
  `visibility: 'public'` and manually joins attestations only to releases of
  public projects (`src/app/api/public/explore/route.ts`); `/api/verify/*`
  exposes verification reports only.
- **Gap:** `GET /api/attestations/[attestationId]` resolves by protocol id
  first and enforces `requireProjectAccess` **only when
  `att.organizationId` is set** — attestations without an org owner bypass
  the membership check (`src/app/api/attestations/[attestationId]/route.ts`).
  On-chain, `registry.GetProject` returns private projects to any caller
  (existence probe; documented in `SECURITY_MODEL.md` §8).

## T2. Privilege escalation

- **Control:** capability RBAC with fixed per-role lists
  (`src/lib/auth.ts` `CAPS`), enforced server-side per request. Invites
  cannot grant ≥ OWNER (`orgs/[orgId]/members/route.ts`:
  `ROLE_RANK[role] >= ROLE_RANK.OWNER` rejected). Owners cannot be removed.
  Agent status changes restricted to OWNER/ADMIN/SECURITY_ADMIN/
  AGENT_OPERATOR or the agent's owner (`src/app/api/agents/route.ts`).
- **Control (on-chain):** admin set once at `registry.Init`; admin power
  limited to registrar allow-list + archive; `TestAdminCannotBeUsurped`.
- **Gap:** `GET /api/agents` uses `requireMembershipShim` (membership only,
  no capability), and `POST /api/agents op=register` calls
  `requireMembership(...'agent.register')` but ignores its rejection risk
  only via thrown error — fine — yet the `grant` op relies on
  `requireProjectAccess(..., 'agent.grant')` which is correct; the shim on
  GET is weaker than the RBAC used elsewhere.

## T3. Agent permission abuse

- **Control (on-chain):** least-privilege scopes, no wildcard
  (`core` scope constants); grants are per (agent, project), expiring,
  revocable; `HasPermission` re-checks revocation/expiry/agent status on
  every call; `RevokeAgent` cascades revocation to all grants;
  `RecordExecution` requires EVIDENCE or TASK_UPDATE scope.
- **Control (off-chain):** `startExecution` re-validates the grant +
  scopes (`src/lib/agent-runtime.ts`), rate-limits per org
  (`limits.agentExec`), sanitizes task context against prompt injection
  (`sanitize`), validates LLM output against a report schema
  (`validateAgentReport`, `src/lib/llm.ts`), and **never publishes on-chain
  without explicit human approval** (approve op requires `agent.approve`
  capability; attest op requires `attestation.issue`).
- **Gap:** no automatic expiry sweeper for DB grants — expired grants are
  filtered at evaluation time but rows persist.

## T4. Replay attacks (transactions)

- **Control:** deterministic protocol ids —
  `core.ComposeReleaseID`, `core.ComposeAttestationID`; on-chain duplicates
  panic (`releases`, `attestations`, `agents` realms). Broadcast hashes are
  `@unique` in `ChainTransaction`; confirmation is **state-based**
  (`reconcileTransaction` queries the realm rather than trusting a hash,
  `src/lib/chain.ts`).
- **Gap:** `idempotencyKey` values embed `Date.now()`
  (`publish:<id>:<ts>`), so they are trace ids, not dedupe keys; a double
  click could broadcast twice (each tx individually rejected on-chain by the
  deterministic-id panic, costing gas only).

## T5. Forged attestations

- **Control:** the issuer identity on-chain is the tx signer
  (`cur.Previous().Address()`), not a claim; subject existence is verified
  (`attestations.subjectExists`); categories/types whitelisted; duplicate
  active attestations impossible.
- **Control (off-chain):** issuing requires `attestation.issue`
  capability; the platform records `issuerAddress` and validates
  `isValidGnoAddress` (`src/app/api/releases/[releaseId]/attest/route.ts`);
  policy approval counting can restrict to allow-listed issuers
  (`policies.SetPolicy`, `src/lib/policy-engine.ts`).
- **Gap:** client-supplied `issuerAddress` in the attest route is trusted as
  the signer address without a signature challenge at that endpoint (wallet
  link does challenge, but linking may be UNVERIFIED —
  `src/app/api/auth/[action]/route.ts`). Verification reports flag this via
  the `issuer_authorized` check rather than blocking.

## T6. Malicious evidence uploads

- **Control:** inline evidence capped at 512 KiB
  (`MAX_INLINE_BYTES`, `src/app/api/releases/[releaseId]/evidence/route.ts`);
  server computes sha256 itself (`sha256Hex(content)`) and rejects a
  client-supplied digest that mismatches (`INVALID_DIGEST`); kind whitelist;
  content-addressed storage (`contentHash`); integrity re-check on read
  (PUT handler recomputes and returns `integrityOk`).
- **Control:** verification recomputes digests from evidence bytes
  (`digest_integrity`, `src/lib/verification.ts`) and reports mismatches as
  verdict `FAILED`.
- **Gap:** MIME type and title are length-capped but not content-sniffed;
  evidence bytes are stored inline in SQLite — no AV/anti-malware scanning.

## T7. Duplicate transactions

- **Control:** on-chain deterministic-id panics (T4); `reconcileTransaction`
  maps `NOT_FOUND → PENDING` so retried confirmations don't double-apply;
  release state machine rejects invalid transitions (`TRANSITIONS` table in
  the releases PATCH route; `INVALID_TRANSITION`).
- **Gap:** as T4 — idempotency keys are timestamped; the gateway does not
  dedupe *broadcast attempts* (only records).

## T8. Webhook replay / forgery

- **Control:** `/api/webhooks/github` requires
  `PROOFLOOM_GITHUB_WEBHOOK_SECRET` (503-class `GITHUB_UNAUTHORIZED` when
  unset — no silent success); verifies `x-hub-signature-256` HMAC-sha256 over
  the raw body with `constantTimeEqual`; supports the PROOFLOOM relay scheme
  (timestamped HMAC via `webhookSignature(secret, timestamp, body)`) when
  GitHub's header is absent; delivery id (`x-github-delivery`) is deduped via
  `db.webhookDelivery` before processing; payloads truncated to 40 KB.
- **Gap:** the relay scheme's timestamp is **not checked for freshness**
  (accepted header, no skew window) — replay of a captured relay-signed
  delivery within the dedupe window is blocked by delivery id, but the
  timestamp itself is unenforced.

## T9. Credential leakage

- **Control:** operator mnemonic only via env at runtime, temp keybase
  deleted per call (`src/lib/operator.ts`); API keys stored as sha256 hashes
  with prefix display only, raw key returned exactly once
  (`src/app/api/keys/route.ts`); passwords scrypt-hashed
  (`src/lib/crypto.ts`); session tokens sha256-hashed (`src/lib/auth.ts`).
- **GAP (verified in repo):** `.env`, `.keys/keystore.pw` and the
  `.keys/gnokey/` keybase database are **tracked by git** (`git ls-files`
  lists them; `.gitignore` has no `.keys/` rule and `.env` was committed
  before the `.env*` rule was added). This is the highest-priority
  remediation item: `git rm --cached`, add ignore rules, rotate the affected
  keys, and consider history rewrite. Testnet-only today, but treat as
  exposed.

## T10. Rate-limit bypass / abuse

- **Control:** DB-backed fixed-window limiter (`src/lib/rate-limit.ts`) with
  distinct buckets: auth global 50/5min, login per-IP 30/5min +
  per-email-failure 10/15min, registration per-IP 10/h, public verify 120/min
  per IP, public explore 240/min, agent exec 30/min per org, default API
  600/min per org.
- **Gap:** single-node SQLite counter (no distributed limiter);
  `clientIp` trusts `x-forwarded-for` first value (`src/lib/api.ts`).

## STRIDE summary

| Threat | Control present? | Where |
|---|---|---|
| **S**poofing | Session tokens (hashed at rest), wallet challenge link, on-chain signer identity (`cur.Previous().Address()`), webhook HMAC | auth.ts, auth/[action]/route.ts, realms, webhooks/github |
| **T**ampering | Digest re-computation, content-addressed evidence, append-only audit, on-chain immutability + explicit supersede/revoke | evidence route, verification.ts, audit.ts, releases realm |
| **R**epudiation | Audit trail on every privileged action (org, actor, ip, traceId), execution receipts on-chain, audit API read-only (POST forbidden) | audit.ts, audit/route.ts, agents realm |
| **I**nformation disclosure | Tenant-scoped queries, public endpoints filtered to `visibility: 'public'`, 300-char log truncation, limitations in verify reports | auth.ts, public/explore, chain.ts, verification.ts |
| **D**enial of service | Rate limits (multiple buckets), 12s RPC timeouts, 512 KiB evidence cap, 40 KB webhook payload cap | rate-limit.ts, chain.ts, evidence route, webhook route |
| **E**levation of privilege | Capability RBAC, role-rank invite ceiling, on-chain admin set-once + delegation, agent scope re-validation | auth.ts, members route, registry realm, agent-runtime.ts |

Top remediation priorities: (1) untrack secrets in git (T9), (2) enforce
timestamp freshness + org-scoped secret choice for webhook relays (T8), (3)
require verified wallet links before trusting client `issuerAddress` (T5),
(4) true idempotency keys for operator broadcasts (T4/T7), (5) capability
check on `GET /api/agents` (T2).
