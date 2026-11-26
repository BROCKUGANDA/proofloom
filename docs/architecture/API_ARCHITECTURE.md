# PROOFLOOM — API Architecture

Everything below is derived from `src/lib/api.ts`, `src/lib/errors.ts`, `src/lib/rate-limit.ts`,
`src/lib/auth.ts`, `src/lib/client.ts` and the 26 `route.ts` files under `src/app/api/`
(each read in full for this document).

---

## 1. The `withApi` wrapper

Every route handler delegates its body to `withApi(fn)` (`src/lib/api.ts`):

```ts
export async function withApi<T>(fn: (traceId: string) => Promise<T>): Promise<NextResponse> {
  const traceId = Math.random().toString(16).slice(2) + Date.now().toString(16)
  try {
    const data = await fn(traceId)
    const res = ok(data)                     // 200, { data }
    res.headers.set('X-Trace-Id', traceId)
    return res
  } catch (e) {
    const res = handleError(e, traceId)      // error envelope
    res.headers.set('X-Trace-Id', traceId)
    return res
  }
}
```

- **Trace ids**: generated per request (random hex + timestamp), returned in the `X-Trace-Id`
  response header, present in the error envelope body, and persisted on audit events when the
  route forwards them.
- **Envelope**: success is `{ data: … }`; failure is
  `{ error: { code, message, recovery, details }, traceId }` with the HTTP status from the error
  definition. `handleError` converts non-`ProofloomError` exceptions into `INTERNAL` (500) and logs
  them server-side as one-line JSON (`{ level, traceId, message }`) — internal details never leak.
- **Helpers**: `readJson<T>` (malformed body → `VALIDATION_FAILED`), `requireFields` (missing
  fields → `VALIDATION_FAILED` with a `missing` detail), `clientIp` (leftmost
  `x-forwarded-for`, else `'local'`), `guardRate` (rate limiting, below),
  `requireAuthShim` (non-throwing `getAuth()` for routes that branch on anonymous access).

## 2. Error envelope format

`src/lib/errors.ts` defines a fixed catalog of machine-readable codes; each carries HTTP status,
message, recovery guidance and retryability. Selected codes (full list in the file):

| Code | Status | Recovery (abridged) |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | Sign in and retry |
| `AUTH_INVALID_CREDENTIALS` | 401 | Check credentials or reset password |
| `AUTH_MFA_REQUIRED` / `AUTH_MFA_INVALID` | 401 | Enter / check authenticator code |
| `AUTH_WEAK_PASSWORD` | 400 | ≥10 chars mixing letters, digits, symbols |
| `FORBIDDEN` | 403 | Ask an org administrator |
| `NOT_A_MEMBER` | 403 | Accept an invitation or create an org |
| `TENANT_ISOLATION` | 403 | Switch organizations |
| `VALIDATION_FAILED` | 400 | Fix highlighted fields |
| `INVALID_DIGEST` | 400 | Digest must be 64 lowercase hex chars (sha256) |
| `INVALID_ADDRESS` | 400 | Not a valid `g1`-prefixed Gno address |
| `INVALID_TRANSITION` | 409 | Follow permitted transitions |
| `DUPLICATE` | 409 | Review existing record |
| `NOT_FOUND` | 404 | Verify the identifier |
| `ARCHIVED` | 409 | Restore the project first |
| `CHAIN_UNAVAILABLE` | 503 | Try again shortly |
| `CHAIN_ID_MISMATCH` | 409 | Switch wallet to the configured testnet |
| `TX_FAILED` | 502 | Check the explorer, retry with corrected args |
| `TX_TIMEOUT` | 504 | Gateway reconciles automatically |
| `FAUCET_DEPLETED` | 503 | Fund deployment account / retry later |
| `GITHUB_UNAUTHORIZED` | 502 | Reconnect GitHub integration |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Confirm signing secret |
| `AGENT_NOT_AUTHORIZED` | 403 | Grant missing scope |
| `AGENT_SUSPENDED` | 409 | Resume or re-register agent |
| `LLM_PROVIDER_UNAVAILABLE` | 503 | Retry or switch providers |
| `LLM_OUTPUT_INVALID` | 502 | Retry execution |
| `RATE_LIMITED` | 429 | Wait for retry window (details include `resetAt`) |
| `INTERNAL` | 500 | Retry; include trace id in bug report |

The client mirrors this: `src/lib/client.ts` unwraps `{ data }` and throws `ClientError(apiError)`
when `res.ok` is false or an `error` object is present.

## 3. Auth requirements per route family

| Route family | Auth | Authorization mechanics |
| --- | --- | --- |
| `/api/verify/**`, `/api/public/explore` | **Public** (no account) | per-IP rate limits (`guardRate`) |
| `/api/health` | **Public** | readiness probe |
| `/api/webhooks/github` | **HMAC-signed** | `x-hub-signature-256` verified against `PROOFLOOM_GITHUB_WEBHOOK_SECRET` |
| `/api/auth/{register,login}` | Public | per-IP/email rate limits; MFA challenge when enabled |
| `/api/auth/{logout,mfa-*,wallet-link}` | Session | `getAuth()` → 401 if absent |
| `/api/session` | Branches: anonymous payload or full session payload | `requireAuthShim` |
| `/api/orgs`, `/api/projects`, `/api/audit`, `/api/analytics`, `/api/keys`, `/api/agents`, `/api/tasks`, `/api/policies`, `/api/chain` | Session | `requireAuth()` + `requireMembership(userId, orgId, capability)` |
| `/api/projects/[projectId]/**`, `/api/releases/[releaseId]/**`, `/api/attestations/[attestationId]`, `/api/executions/[executionId]` | Session | `requireAuth()` + `requireProjectAccess(userId, projectId, capability)` (org derived from the record) |
| `/api/orgs/[orgId]/members` | Session | capabilities `project.read` (GET), `org.invite` (POST), `org.manage` (DELETE) |

Capability names come from `src/lib/auth.ts` (`CAPS` map): e.g. `project.create/write/archive`,
`release.create/write/publish/revoke`, `evidence.write`, `attestation.issue/revoke`,
`agent.register/grant/operate/approve`, `task.write/review`, `policy.read/write`,
`audit.read`, `analytics.read`, `apikeys.manage`, `org.manage/invite/billing`.

## 4. Rate limiting

`src/lib/rate-limit.ts`: fixed-window counters persisted in the `UsageRecord` table
(`@@unique([key, window])`, atomic upsert). Buckets actually used:

| Bucket | Key | Limit | Window | Applied at |
| --- | --- | --- | --- | --- |
| `registration` | IP | 10 | 1 h | `POST /api/auth/register` (via `limits.registration`) |
| `login-ip` | IP | 30 | 5 min | `POST /api/auth/login` (`guardRate`) |
| `login-fail` | email | 10 | 15 min | failed logins only |
| `public-verify` | IP | 120 | 1 min | `GET /api/verify/**` |
| `public-explore` | IP | 240 | 1 min | `GET /api/public/explore` |
| `agent-exec` | org | 30 | 1 min | `agent-runtime.startExecution` (via `limits.agentExec`) |
| `auth` (global) | `'global'` | 50 | 5 min | defined in `limits.authAttempt` |
| `api` (default) | org | 600 | 1 min | defined in `limits.apiDefault` |

`guardRate` throws `RATE_LIMITED` (429) with `details.resetAt`. Note: the last two buckets are
defined but not wired to a generic middleware — per-route limits above are the enforced set.

## 5. Idempotency patterns

- **Deterministic protocol ids**: attestations upsert on unique `protocolId`
  (`{slug}-{version}-{category}-{issuer}`); an active duplicate returns `DUPLICATE` rather than
  creating a second row. Agent-execution attestations follow the same rule.
- **Webhook delivery dedupe**: `POST /api/webhooks/github` looks up `WebhookDelivery` by
  `url = 'github:{x-github-delivery}'` + event before processing; duplicates return `{ deduped: true }`.
- **Tx idempotency keys**: `ChainTransaction.idempotencyKey` is `@unique`. The wallet-path
  `op=record` accepts a caller-supplied key; the operator publish/attest paths stamp
  `` `${op}:${protocolId}:${Date.now()}` `` — meaning operator retries currently produce *new*
  records (the timestamp defeats the key). Honest caveat; a stable key would be needed for true
  operator retry-safety.
- **Release uniqueness**: `@@unique([projectId, version])` with an explicit `DUPLICATE` error.
- **API keys / invites**: raw secrets are returned exactly once; only hashes are stored.

## 6. Pagination patterns

There is **no cursor/offset pagination envelope**. Routes cap result sets with `take`/`limit`:

- `GET /api/audit` — `limit` query param, clamped to ≤ 500, plus `action` prefix filter.
- `GET /api/public/explore` — fixed `take: 50` for projects, releases, attestations.
- `GET /api/notifications` — `take: 50`; `GET /api/session` unread — `take: 20`.
- `GET /api/agents` — last 10 executions per agent embedded.
- `/api/analytics` — internal `take: 500` (executions, txs) / `take: 1000` (verification results).
- Everything else returns unbounded lists scoped by tenant (acceptable at current scale; a real
  pagination scheme is a natural next step).

## 7. Complete endpoint catalog

Auth column: `public` = no account; `session` = session cookie required; `hmac` = webhook
signature. All routes are `dynamic = 'force-dynamic'`.

### Root & health
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api` | public | Legacy placeholder — returns `{ message: "Hello, world!" }` (leftover scaffold) |
| GET | `/api/health` | public | Readiness: database, chain identity, LLM provider health, on-chain registry stats, version `1.0.0` |

### Session & auth
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/session` | public/session | Client boot payload: user, orgs with capabilities, unread notifications, chain profile |
| POST | `/api/auth/register` | public | Create user + default org (OWNER membership), start session |
| POST | `/api/auth/login` | public | Password login, MFA challenge, per-IP/email limits |
| POST | `/api/auth/logout` | session | Revoke session, audit |
| POST | `/api/auth/mfa-setup` | session | Generate TOTP secret + otpauth URI |
| POST | `/api/auth/mfa-enable` | session | Verify code, enable MFA |
| POST | `/api/auth/mfa-disable` | session | Requires TOTP + current password |
| POST | `/api/auth/wallet-link` | session | Link `g1…` address; records signature-verified flag when provided |

### Organizations
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/orgs` | session | List user's orgs with counts |
| POST | `/api/orgs` | session | Create org (creator becomes OWNER) |
| GET | `/api/orgs/[orgId]/members` | session (`project.read`) | Roster + pending invitations |
| POST | `/api/orgs/[orgId]/members` | session (`org.invite`) | Invite member (token-hashed, 7-day expiry, returns invite URL) |
| DELETE | `/api/orgs/[orgId]/members?userId=│invitationId=` | session (`org.manage`) | Remove member / revoke invite; owner protection |

### Projects
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/projects?orgId=` | session (`project.read`) | Org project list with counts, latest release, policy |
| POST | `/api/projects` | session (`project.create`) | Create project |
| GET | `/api/projects/[projectId]` | session (`project.read`) | Full workspace payload + on-chain mirror |
| PATCH | `/api/projects/[projectId]` | session (`project.write`; `project.archive` for archive) | Metadata, archive/restore, record on-chain registration (tx hash required) |

### Components & dependencies
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/projects/[projectId]/components` | session (`project.read`) | List components |
| POST | `/api/projects/[projectId]/components` | session (`project.write`) | Create component (artifact-type validated) |
| PATCH | `/api/projects/[projectId]/components` | session (`project.write`) | Deprecate/restore via `{ componentId, deprecate }` |
| GET | `/api/projects/[projectId]/dependencies` | session (`project.read`) | Dependencies + graph summary |
| POST | `/api/projects/[projectId]/dependencies` | session (`project.write`) | Add dependency |

### Releases & evidence
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/projects/[projectId]/releases` | session (`project.read`) | Releases with protocolId, evidence, txs, attestations |
| POST | `/api/projects/[projectId]/releases` | session (`release.create`) | Create DRAFT release |
| GET | `/api/releases/[releaseId]` | session (`project.read`) | Release detail + allowed transitions + policy verdict |
| PATCH | `/api/releases/[releaseId]` | session (capability per target state) | State transition (`submit-evidence`, `validate`, `require-review`, `approve`, `reject`, `publish`, `verify`, `revoke`, `supersede`, `dispute`); policy gate on publish; on-chain attestation required for `verify` |
| GET | `/api/releases/[releaseId]/evidence` | session (`project.read`) | Evidence metadata list |
| POST | `/api/releases/[releaseId]/evidence` | session (`evidence.write`) | Ingest inline evidence (≤512 KiB), sha256 content addressing, digest cross-check |
| PUT | `/api/releases/[releaseId]/evidence` | session (`project.read`) | Fetch single evidence body (`{ evidenceId }`) with `integrityOk` recomputation |

### Attestations
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/releases/[releaseId]/attest` | session (`attestation.issue`) | Issue attestation (13 categories, issuer address required, deterministic protocolId, upsert) |
| GET | `/api/attestations/[attestationId]` | session (`project.read` for tenant-scoped) | Record by id or protocolId + live verification report |
| DELETE | `/api/attestations/[attestationId]?reason=` | session (issuer or `attestation.revoke`) | Revoke with reason |

### Agents & executions
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/agents?orgId=` | session (membership) | Registry with grants + last 10 executions + LLM provider health |
| POST | `/api/agents` | session | Operation dispatch by `op`: `register` (`agent.register`), `grant` / `revoke-grant` (`agent.grant`), `set-status` (role-guarded), `execute` (runtime scope gate), `simulate` (provider health, dry-run) |
| GET | `/api/executions/[executionId]` | session (membership) | Execution detail incl. attestation linkage |
| POST | `/api/executions/[executionId]` | session | `op=approve`/`reject` (`agent.approve` or org-role fallback), `op=attest` (`attestation.issue` + gno address) |

### Tasks
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/tasks?projectId=` | session (`project.read`) | Task board (agents, assignees, reviews) |
| POST | `/api/tasks` | session (`task.write`) | Create task (human/agent assignee; agent tenant check) |
| PATCH | `/api/tasks` | session (`task.write`) | ⚠ Written against a `[taskId]` segment that **does not exist** — the handler is unreachable as deployed; task transitions are not exposed over HTTP |

### Policies
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/policies?projectId=│orgId=` | session (`policy.read`) | List policies (+ parsed `input`) |
| POST | `/api/policies` | session | `op=set` (`policy.write`; versioned, deactivates prior), `op=clear`, `op=simulate` (`policy.read`; deterministic dry-run) |

### Verification & public explorer
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/verify` (no path) | public (rate-limited) | Usage manifest: protocol version, network info, endpoint usage |
| GET | `/api/verify/release/{id-or-protocolId}` | public (120/min/IP) | Release verification report |
| GET | `/api/verify/attestation/{protocolId}` | public | Attestation verification report |
| GET | `/api/verify/digest/{sha256}` | public | Digest → published releases lookup |
| GET | `/api/public/explore?kind=summary` | public (240/min/IP) | Public projects/releases/attestations + chain profile + on-chain stats |
| GET | `/api/public/explore?kind=project&id={slug}` | public | Public project drill-down |
| GET | `/api/public/explore?kind=release-status&id={protocolId}` | public | On-chain release status proxy |

### Analytics & audit
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/analytics?orgId=` | session (`analytics.read`) | Org metrics from persisted records, labeled data sources |
| GET | `/api/audit?orgId=&projectId=&action=&limit=` | session (`audit.read`) | Append-only trail (limit ≤ 500) + action summary |
| POST | `/api/audit` | session | **Always 403** — audit is platform-written by design |

### Notifications & keys
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/notifications` | session | Latest 50 + unread count |
| PATCH | `/api/notifications` | session | Mark read (`{ ids }` or `{ all: true }`) |
| PUT | `/api/notifications` | session | **Always 404** (explicit placeholder guarding the webhook path) |
| GET | `/api/keys?orgId=` | session (`apikeys.manage`) | Credential list (prefixes only) |
| POST | `/api/keys` | session (`apikeys.manage`) | Create `plk_…` credential; raw key returned exactly once |
| DELETE | `/api/keys?id=` | session (`apikeys.manage`) | Revoke credential |

### Webhooks & chain
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/webhooks/github` | hmac | Signed GitHub ingestion: dedupe, store delivery, audit `github.{event}` |
| GET | `/api/chain` | public | Chain profile, live identity check, realm paths, tx-state vocabulary, last 50 transactions |
| POST | `/api/chain` | session | Operation dispatch by `op`: `record`, `transition` (wallet-path lifecycle writes), `query-release`, `operator-status`, `publish-on-chain` (operator broadcast of `releases.PublishRelease`; release must be APPROVED/PUBLISHED), `attest-on-chain` (operator broadcast of `attestations.Issue`), `confirm-on-chain` (state-based reconciliation) |

## 8. Client-side contract

`src/lib/client.ts` is the single fetch wrapper used by every view: it sends JSON, never caches,
unwraps `{ data }`, throws `ClientError` carrying `{ code, message, recovery, details }`, and
exposes Adena wallet adapters (`detectAdena`, `walletStatus`, `walletConnect`,
`walletSignMessage`, `walletSendTransaction`) used by workspace/settings/release flows.
