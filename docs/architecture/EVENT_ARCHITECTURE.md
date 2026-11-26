# PROOFLOOM — Event Architecture

Sources read for this document: `src/lib/audit.ts`, `src/app/api/webhooks/github/route.ts`,
`src/app/api/notifications/route.ts`, `prisma/schema.prisma` (`AuditEvent`, `WebhookDelivery`,
`Notification`), plus a repo-wide scan for producers of each record type. Absent infrastructure
is marked **Planned** — nothing here is invented.

---

## 1. Event landscape at a glance

PROOFLOOM has three event-like mechanisms, all currently **synchronous and in-process**:

| Mechanism | Model | Producer | Consumer |
| --- | --- | --- | --- |
| Audit trail | `AuditEvent` (append-only) | platform code, as a side effect of every privileged action | `GET /api/audit`, `AuditView` |
| Webhook ingestion | `WebhookDelivery` | GitHub → `POST /api/webhooks/github` | dedupe + audit only (no downstream automation yet) |
| Notifications | `Notification` | **none in the codebase** (Planned) | `GET /api/notifications`, settings UI |

There is no message broker, no durable queue, no worker process, and no cron/scheduler anywhere
in the repository. Agent executions run fire-and-forget inside the server process
(`void runExecution(...)` in `src/lib/agent-runtime.ts`); background job/queue infrastructure is
**Planned**.

## 2. Audit event generation (`src/lib/audit.ts`)

The audit trail is the platform's event backbone. `audit(input)` performs a single
`db.auditEvent.create` and is fire-and-forget from the caller's perspective (awaited, but its
failure is not part of the business transaction's error contract).

**Event shape** (`AuditInput`):

```ts
{
  organizationId?, projectId?      // tenancy (nullable: platform-level events)
  actorUserId?, actorAddress?      // human actor + optional gno address
  action                            // dotted verb: 'project.create', 'release.publish',
                                    // 'attestation.issue', 'agent.grant', 'auth.login', ...
  targetType, targetId              // what the action hit
  metadata?                         // JSON details (e.g. { from, to } for transitions)
  ip?, traceId?                     // correlation with the API layer
}
```

**Rules enforced by convention:**

- **Append-only**: rows are never updated or deleted by application code; `POST /api/audit`
  deliberately returns 403 ("audit events are append-only and platform-written").
- **Every privileged action writes one event.** Verified writers (non-exhaustive):
  - auth: `auth.register`, `auth.login`, `auth.logout`, `auth.mfa_enable`, `auth.mfa_disable`,
    `auth.wallet_link` (`auth/[action]/route.ts`)
  - orgs: `org.create`, `org.invite`, `org.invite_revoke`, `org.member_remove`
  - projects/components/deps: `project.create`, `project.update`, `component.create`,
    `component.deprecate`/`restore`, `dependency.create`
  - releases/evidence: `release.create`, `release.{submit-evidence|validate|approve|publish|...}`
    (metadata `{ from, to }`), `evidence.create` (metadata includes digest + size)
  - attestations: `attestation.issue`, `attestation.revoke` (metadata includes protocolId)
  - agents: `agent.register`, `agent.grant`, `agent.grant_revoke`, `agent.active|suspended|revoked`,
    `agent.execution.start`, `agent.execution.approve|reject`
  - chain: `chain.publish_release`, `chain.attest` (metadata includes txHash + `signing: 'operator'`)
  - api keys: `apikey.create`, `apikey.revoke`
- **Correlation**: routes forward the `traceId` from `withApi` into audit metadata lineage, and
  `clientIp()` provides the IP.
- **Indexing for reads**: `(organizationId, createdAt)` and `(targetType, targetId)` — the audit
  explorer queries by org + time-desc with an action-prefix filter; per-target history is a
  first-class read.
- **Known limitation** (honest): audit rows are plain SQLite rows. There is no hash-chain,
  signature, or off-chain anchoring making them tamper-evident at the storage layer; the
  append-only property is enforced by the application tier only. Off-chain anchoring is
  **Planned**.

## 3. Webhook ingestion (`src/app/api/webhooks/github/route.ts`)

The single inbound webhook endpoint. Flow, exactly as implemented:

1. **Configuration gate** — requires `PROOFLOOM_GITHUB_WEBHOOK_SECRET`; unconfigured →
   `GITHUB_UNAUTHORIZED` (502) with an explicit reason ("not a silent success", per the file
   header).
2. **Signature verification** — accepts either GitHub's native `x-hub-signature-256`
   (`sha256=` + HMAC over the raw body) or the PROOFLOOM relay format (timestamped double-HMAC
   `sha256=HMAC(secret, "{timestamp}.{body}")`), compared with `constantTimeEqual`. Failure →
   `WEBHOOK_SIGNATURE_INVALID` (401).
3. **Idempotent ingestion** — dedupe on `(url = 'github:{x-github-delivery}', event)`; a replayed
   delivery returns `{ ok: true, deduped: true, deliveryId }` without side effects. Unknown
   delivery ids fall back to `sha256(body).slice(0,16)`.
4. **Storage** — the delivery is stored in `WebhookDelivery` (`payload` truncated to 40 000
   chars) with status `DELIVERED` and `deliveredAt` set. The schema anticipates a retry
   lifecycle (`PENDING | FAILED | DEAD`, `attempts`, `nextRetryAt`, `lastError`) that **no code
   uses yet** — an outbound delivery worker is **Planned**.
5. **Audit projection** — when the payload names a repository, the event is written to the audit
   trail as `action = github.{event}`, `targetType = 'GITHUB_EVENT'`, metadata
   `{ repo, action }`. Caveat implemented as-is: without a repository→organization mapping, the
   event is attributed to the first `CONNECTED` github integration, or stored with
   `organizationId: null` "for later correlation (never dropped silently)".
6. **No reaction automation** — pushes/releases do not yet create platform records (draft
   releases, evidence); that is **Planned**.

## 4. Notification flow

- **Read path implemented**: `GET /api/notifications` returns the latest 50 plus an unread
  count; `PATCH /api/notifications` marks all or a set of ids read (`readAt`). The
  `Notification` model (`userId`, `kind`, `title`, `body`, `link`, `readAt`) and the
  `(userId, readAt)` index support an inbox. `GET /api/session` also reports
  `unreadNotifications`.
- **Write path missing**: a repo-wide scan finds **no `db.notification.create`** anywhere in
  `src/`. No platform event (release published, execution awaiting approval, attestation
  revoked, …) currently produces a notification. The inbox is therefore always empty unless rows
  are written externally (e.g. by hand against the DB). Event→notification generation is
  **Planned**.
- **Delivery channels** (email, push, in-app real-time): **Planned**; none exist. (The repo
  contains an unrelated WebSocket demo under `examples/websocket/` — it is not wired into the
  product.)

## 5. Execution events (agent runtime) — synchronous today

The closest thing to background processing is the agent runtime:

- `startExecution` persists an `AgentExecution` row and returns immediately; the LLM run proceeds
  in-process (`void runExecution(...).catch(() => {})`).
- State transitions (`RUNNING → COMPLETED | FAILED | AWAITING_APPROVAL | REJECTED`) are recorded
  on the row itself; there is no event stream — clients poll `GET /api/executions/{id}` and the
  Agent Command view refreshes.
- Every transition that matters (`start`, `approve`, `reject`) also lands in the audit trail, and
  completion can be attested (`AGENT_TASK_COMPLETION`) — that attestation *is* the durable,
  externally verifiable event record.
- If the server restarts mid-run, executions remain `RUNNING` forever (no supervisor/timeout
  sweeper) — a known consequence of the in-process model; a durable queue is **Planned**.

## 6. On-chain event surface (protocol realm)

The Gno realms emit their own observable "events" in the form of state: `releases`, `attestations`,
`agents` and `policies` realms keep on-chain records (`RecordExecution`, `Issue`, `Publish`,
`GrantPermission`, …), and the read-only `verify` realm exposes composite verdicts. The platform
consumes these through the gateway's `abci_query` reads and the `ChainTransaction` lifecycle
ledger. No on-chain event subscription/websocket streaming is implemented in the product today
(the gateway exposes a websocket URL in the chain profile, but nothing subscribes to it —
**Planned**).
