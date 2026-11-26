# Webhook Architecture

Two distinct webhook surfaces exist in the code. Anything not found in code
is marked planned.

---

## 1. Inbound — `POST /api/webhooks/github` (implemented)

The single inbound webhook endpoint (`src/app/api/webhooks/github/route.ts`).

**Security requirements enforced by the code:**

1. Shared secret required: `PROOFLOOM_GITHUB_WEBHOOK_SECRET`. Unconfigured ⇒
   `GITHUB_UNAUTHORIZED` error (honest failure, not a silent 200).
2. HMAC-SHA256 over the **raw** body (`req.text()`), never over parsed JSON:
   - GitHub-native: `x-hub-signature-256 == "sha256=" + HMAC(secret, body)`,
     compared with `constantTimeEqual` (`src/lib/crypto.ts`).
   - PROOFLOOM relay fallback: `HMAC(secret, "<x-proofloom-timestamp>.<body>")`
     when the GitHub header is absent.
3. Constant-time comparison for signatures.
4. Replay protection: delivery id (`x-github-delivery`, fallback sha256
   prefix of body) deduped against the `webhookDelivery` table before any
   processing.
5. Payload cap: stored payload truncated to 40,000 chars.
6. Full audit: every accepted delivery produces an `AuditEvent`
   (`github.<event>`), including request IP and trace id.

**Known gap:** the relay scheme's timestamp header is accepted but its
freshness is not validated (no skew window) — see `THREAT_MODEL.md` T8.

## 2. Outbound — PROOFLOOM → external systems (planned)

There is **no outbound webhook dispatcher in the code**: no signing of
outbound deliveries, no retry queue, no subscription model. The pieces that
exist and are ready to support one:

- `webhookSignature(secret, timestamp, body)` (`src/lib/crypto.ts`) — the
  exact HMAC scheme outbound deliveries should use
  (`sha256=` + HMAC over `"<timestamp>.<body>"`), mirroring the relay
  verification inbound.
- `WebhookDelivery` model (`prisma/schema.prisma`) — delivery log with url,
  event, payload, signature, status, timestamps.
- The `audit` stream (`src/lib/audit.ts`) — the natural event source for
  fan-out (release published, attestation revoked, agent executed…).

Until an outbound dispatcher is built, integrations should poll the public
verification API (`GET /api/verify/...`, rate-limited 120/min/IP) or the
explore feed (`GET /api/public/explore`, 240/min/IP).

## 3. Requirements for any future outbound sender (derived from this codebase)

- Sign every delivery with `webhookSignature` over raw serialized body +
  timestamp; include both in headers so receivers can verify exactly like
  the inbound route does.
- Persist a `webhookDelivery` row per attempt (dedupe id, status, response)
  before/after send; make receiver-visible delivery ids unique and stable
  so consumer-side dedupe works (mirroring `github:<deliveryId>`).
- Cap payload sizes; never include evidence bytes or personal data in
  webhook payloads (see `PRIVACY_MODEL.md` §2) — send ids and digests, let
  receivers pull details through authenticated APIs.
- Validate the timestamp freshness of relayed inbound deliveries symmetric
  with what outbound stamps (close the T8 gap on both sides).
