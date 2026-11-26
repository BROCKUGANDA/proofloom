# GitHub Integration

Source of truth: `src/app/api/webhooks/github/route.ts` (the only GitHub-
related code in `src/`). There is no GitHub API client in the repository —
no repo-sync, no OAuth app flow.

---

## Inbound webhook ingestion — implemented

`POST /api/webhooks/github` (`dynamic = 'force-dynamic'`).

### 1. Configuration gate

The endpoint requires `PROOFLOOM_GITHUB_WEBHOOK_SECRET`. If unset it throws
`GITHUB_UNAUTHORIZED` with a detail naming the missing variable — an honest
503-class failure, never a silent success.

### 2. Signature verification

- Raw body read via `req.text()` (signature computed over the exact bytes).
- **GitHub-native scheme (primary):** if `x-hub-signature-256` is present it
  must equal `sha256=` + HMAC-SHA256(secret, rawBody), compared using
  `constantTimeEqual` (`src/lib/crypto.ts`, length-safe `timingSafeEqual`).
- **PROOFLOOM relay scheme (fallback):** when the GitHub header is absent,
  the expected signature is `sha256=` + HMAC-SHA256 over
  `"<timestamp>.<body>"` where timestamp comes from `x-proofloom-timestamp`
  (defaults to "now" server-side). This accepts deliveries forwarded through
  a relay that re-signs with the shared secret.
- Failure → `WEBHOOK_SIGNATURE_INVALID` (401).

### 3. Event handling and what gets recorded

- `x-github-event` (default `ping`) and `x-github-delivery` (fallback: first
  16 hex chars of `sha256Hex(raw)`) are extracted.
- **Idempotent ingestion:** a `webhookDelivery` row keyed `github:<deliveryId>`
  with the same event short-circuits to `{ ok: true, deduped: true }` —
  replays from GitHub are harmless.
- Accepted deliveries are stored: event name, payload (truncated to 40,000
  chars), computed signature, status `DELIVERED`, timestamp.
- If `payload.repository.full_name` exists, an `AuditEvent` is written with
  action `github.<event>`, target type `GITHUB_EVENT`, target id = delivery
  id, metadata `{ repo, action }`, plus request IP and trace id. The
  organizationId is taken from the first `Integration` row with
  `kind: 'github'`, `status: 'CONNECTED'` — when no integration mapping
  exists the audit row is stored with `organizationId: null` "for later
  correlation (never dropped silently)" (route comment).

That is the complete behavior: **ingest → verify → dedupe → store → audit**.
No event triggers domain logic (no release creation from `push`, no
attestation from `workflow_run`).

## Repository sync — planned

Not implemented. There is no code that:
- calls the GitHub REST/GraphQL API,
- creates/updates `Project` rows from repositories,
- imports releases or workflow runs,
- manages an installation/OAuth handshake (the `Integration` model exists in
  `prisma/schema.prisma` and the webhook audit path reads it, but nothing
  writes or refreshes it).

Plumbing that exists for a future sync: the `Integration` table, the
`GITHUB_UNAUTHORIZED` error code (`src/lib/errors.ts`), and the audit
correlation above.

## Operational notes

- Configure the webhook secret in the GitHub repo/org settings ("Let me
  select individual events" or send-all) pointing at
  `POST <base>/api/webhooks/github`; the endpoint replies 200 with
  `{ ok: true, event, deliveryId }` on success.
- The `ping` event is processed like any other (stored + audited) — no
  special-casing beyond the default event name.
- See `WEBHOOKS.md` for the security requirements shared by all webhook
  surfaces (HMAC over raw bytes, dedupe, payload caps) and the known gap on
  relay-timestamp freshness.
