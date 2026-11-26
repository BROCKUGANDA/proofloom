# PROOFLOOM Security Controls

Concrete controls as implemented. Every item cites the enforcing file.
"Gaps" are listed at the end — nothing here is aspirational.

---

## 1. Password hashing

- **Algorithm: scrypt** (not bcrypt/argon2) — `src/lib/crypto.ts`
  `hashPassword`/`verifyPassword` with `N=16384, r=8, p=1`, 64-byte key,
  16-byte random salt, stored as
  `scrypt$N$r$p$saltHex$keyHex`, compared with `timingSafeEqual`.
- Strength gate: `passwordStrength` requires ≥10 chars, lower + upper + digit
  (`AUTH_WEAK_PASSWORD` otherwise) — enforced at registration
  (`src/app/api/auth/[action]/route.ts`).

## 2. Session handling

`src/lib/auth.ts`:

- Opaque 256-bit tokens (`randomToken(32)` = base64url of 32 random bytes).
- Only `sha256(token)` stored (`Session.tokenHash @unique`); raw token never
  persisted.
- Cookie `pl_session`: `httpOnly: true`, `sameSite: 'lax'`, `secure: true`,
  `path: '/'`, 30-day expiry.
- Rotation: `requireAuth` rotates sessions older than 7 days
  (`rotateSession` re-issues the token and updates `lastRotatedAt`).
- Revocation: `revokeSession` stamps `revokedAt`/`revokedReason` and deletes
  the cookie; `getAuth` rejects revoked/expired sessions and users whose
  `status !== 'ACTIVE'`.
- MFA: TOTP (RFC 6238, base32 secret, 6 digits, 30s step, ±1 step window)
  implemented in `src/lib/crypto.ts` (`generateTotpSecret`, `verifyTotp`);
  gated by `checkMfa` at login and MFA enable/disable. `mfa-disable` also
  requires the current password.
- Login throttling: per-IP 30/5min (`guardRate('login-ip', …)`) plus
  per-email failure counter 10/15min (`guardRate('login-fail', …)`).

## 3. Cookie flags

Set in `createSession`/`rotateSession` (above). Note: `secure: true` assumes
HTTPS termination in front of the app (`Caddyfile` present in repo root);
on plain-HTTP local dev the cookie still works in most browsers only via
localhost exemptions — worth verifying per environment.

## 4. RBAC permission checks (server-side enforcement)

`src/lib/auth.ts`:

- Role ranks: `VIEWER 10, DEVELOPER 20, AGENT_OPERATOR 25, AUDITOR 30,
  ENGINEERING_LEAD 40, SECURITY_ADMIN 50, ADMIN 60, OWNER 100`.
- Capability sets per role (`CAPS` map, 25 capabilities from `org.manage` to
  `admin.platform`).
- Enforcement points (server-side, in route handlers):
  - `requireMembership(userId, orgId, capability)` → `NOT_A_MEMBER` /
    `FORBIDDEN` — used by audit, keys, org members, chain operator ops.
  - `requireProjectAccess(userId, projectId, capability)` resolves the
    project → its org → membership check — used by releases, evidence,
    attestations, agents grant/revoke, executions.
- Examples of capability gates: `evidence.write` (evidence POST),
  `attestation.issue` / `attestation.revoke`, `release.write` /
  `release.publish` / `release.revoke` (PATCH transition map), `agent.grant`,
  `agent.approve`, `apikeys.manage`, `org.invite`, `org.manage`,
  `audit.read`.
- Invite ceiling: cannot invite at/above OWNER
  (`src/app/api/orgs/[orgId]/members/route.ts`).

## 5. Rate limits (exact numbers, `src/lib/rate-limit.ts`)

Fixed-window counters persisted in `UsageRecord` (upsert + increment),
keyed `name:identifier` per window:

| Bucket | Key | Limit | Window |
|---|---|---|---|
| `authAttempt` | global | 50 | 5 min |
| `verifyPublic` | per IP | 120 | 1 min |
| `apiDefault` | per org | 600 | 1 min |
| `agentExec` | per org | 30 | 1 min |
| `registration` | per IP | 10 | 1 h |

Additional ad-hoc buckets via `guardRate`: `login-ip` 30/5min,
`login-fail` (per email) 10/15min, `public-verify` 120/min per IP
(`src/app/api/verify/[...path]/route.ts`), `public-explore` 240/min per IP
(`src/app/api/public/explore/route.ts`). Exceeding a limit raises
`RATE_LIMITED` (HTTP 429) with `resetAt` in details.

## 6. Webhook HMAC verification

`src/app/api/webhooks/github/route.ts` + `src/lib/crypto.ts`:

- Requires `PROOFLOOM_GITHUB_WEBHOOK_SECRET`; if unset the endpoint returns
  `GITHUB_UNAUTHORIZED` (honest failure, never a silent 200).
- GitHub-native scheme: `x-hub-signature-256` must equal
  `sha256=` + HMAC-SHA256(secret, rawBody), compared with
  `constantTimeEqual` (length-checked `timingSafeEqual`).
- PROOFLOOM relay scheme (when GitHub's header is absent):
  `sha256=` + HMAC-SHA256 over `"<timestamp>.<body>"` using
  `webhookSignature(secret, timestamp, body)`, timestamp taken from
  `x-proofloom-timestamp`. **Freshness of the timestamp is not validated**
  (gap — see THREAT_MODEL T8).
- Delivery dedupe: `x-github-delivery` (or sha256 prefix of the body)
  checked against `webhookDelivery` rows before processing; payload stored
  truncated to 40,000 chars.

## 7. Audit logging coverage

`src/lib/audit.ts` — append-only `AuditEvent` (application code never
updates or deletes rows; the API exposes no write path — `POST /api/audit`
returns `FORBIDDEN`). Actions recorded (all via `audit(...)` calls):

- `auth.register`, `auth.login`, `auth.logout`, `auth.mfa_enable`,
  `auth.mfa_disable`, `auth.wallet_link` (with verified flag, provider,
  chainId)
- `project.create`; `release.create` and every release transition
  (`release.<action>` with from→to metadata)
- `evidence.create` (kind, digest, size, resulting release status)
- `attestation.issue`, `attestation.revoke` (protocolId, reason)
- `agent.register`, `agent.grant`, `agent.grant_revoke`,
  `agent.active|suspended|revoked`, chain ops `chain.publish_release`,
  `chain.attest`
- `org.invite`, `org.invite_revoke`, `org.member_remove`
- `apikey.create`, `apikey.revoke`
- GitHub webhook events (`github.<event>`)

Each row carries organizationId/projectId/actor (userId + optional gno
address)/target/IP/traceId. Read access gated by `audit.read`
(`src/app/api/audit/route.ts`).

## 8. Secret management

- Runtime secrets arrive via env only: `PROOFLOOM_OPERATOR_MNEMONIC`
  (operator signing; consumed by `src/lib/operator.ts` and never logged),
  `PROOFLOOM_GITHUB_WEBHOOK_SECRET` (webhook HMAC),
  `PROOFLOOM_OPERATOR_ADDRESS` (verification issuer allowance),
  `DATABASE_URL`. API keys for LLM providers stay server-side
  (`src/lib/llm.ts` — "API keys never reach the browser or any realm").
- API credentials: stored hashed (`keyHash`), displayed as 12-char prefix,
  raw shown exactly once with an explicit warning.
- `.gitignore` contains `.env*` (env files ignored for new additions).
- **GAP (verified):** `.env`, `.keys/keystore.pw`, and the `.keys/gnokey/`
  keybase are currently **tracked by git** (`git ls-files` lists them; there
  is no `.keys/` ignore rule, and `.env` was committed before the `.env*`
  rule took effect). Required remediation: `git rm --cached` the files, add
  `.keys/` to `.gitignore`, rotate the affected deployer key + webhook
  secret, and evaluate history rewrite. Until then, treat those values as
  exposed. This contradicts the intended "keystore.pw NOT committed" posture
  and is documented here deliberately.

## 9. Input validation

- Hand-rolled validators (not zod — the dependency exists in
  `package.json` but no zod import occurs in `src/`; see
  `docs/testing/EDGE_CASE_REGISTER.md`):
  `isValidDigest` (64-hex), `isValidGnoAddress` (g1 prefix + charset),
  `passwordStrength`, email regex, version regex
  `/^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,31}$/`, commit hash `/^[0-9a-f]{7,64}$/`
  (`src/app/api/projects/[projectId]/releases/route.ts`), protocol id regex
  `/^[-a-z0-9]{1,80}$/` in `src/lib/chain.ts` and `/^[-a-z0-9]{1,100}$/` in
  the chain route, address regex `/^g1[a-z0-9]{36,40}$/` (wallet link).
- `requireFields` / `readJson` helpers (`src/lib/api.ts`) enforce JSON bodies
  and required fields with `VALIDATION_FAILED` errors.
- On-chain mirrors: `core.IsValid*` + `BoundedText` caps (see
  `docs/security/SECURITY_MODEL.md` §5).

## 10. Transport & misc

- `withApi` wraps handlers with trace ids (`X-Trace-Id`) and never leaks raw
  exception text (`handleError` returns a generic `INTERNAL` envelope;
  internal detail only to server logs).
- RPC calls are timeout-bounded (12s) and responses truncated before error
  attachment (`src/lib/chain.ts`).
