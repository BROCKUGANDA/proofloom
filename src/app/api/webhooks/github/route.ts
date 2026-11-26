import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, clientIp } from '@/lib/api'
import { err } from '@/lib/errors'
import { webhookSignature, constantTimeEqual, sha256Hex } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// POST /api/webhooks/github — signed GitHub webhook ingestion.
// Requires PROOFLOOM_GITHUB_WEBHOOK_SECRET; validates the x-hub-signature-256
// HMAC before any processing. Unconfigured secret => 503 with an honest
// status (not a silent success).
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const secret = process.env.PROOFLOOM_GITHUB_WEBHOOK_SECRET
    if (!secret) {
      throw err('GITHUB_UNAUTHORIZED', { reason: 'webhook secret not configured (PROOFLOOM_GITHUB_WEBHOOK_SECRET)' })
    }
    const raw = await req.text()
    const signature = req.headers.get('x-hub-signature-256') ?? ''
    const timestamp = req.headers.get('x-proofloom-timestamp') ?? Math.floor(Date.now() / 1000).toString()
    const expected = `sha256=${webhookSignature(secret, timestamp, raw)}`

    // GitHub sends its own HMAC over the raw body; accept either GitHub's
    // native format or the timestamped double-HMAC used by PROOFLOOM relays.
    const ghSig = req.headers.get('x-hub-signature-256')
    let valid = false
    if (ghSig) {
      const { createHmac } = await import('crypto')
      valid = ghSig.startsWith('sha256=') && constantTimeEqual(
        ghSig, 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
      )
    } else {
      valid = constantTimeEqual(signature, expected)
    }
    if (!valid) throw err('WEBHOOK_SIGNATURE_INVALID')

    const event = req.headers.get('x-github-event') ?? 'ping'
    const deliveryId = req.headers.get('x-github-delivery') ?? sha256Hex(raw).slice(0, 16)

    // Idempotent ingestion: delivery id deduped.
    const dedupe = await db.webhookDelivery.findFirst({ where: { url: `github:${deliveryId}`, event } })
    if (dedupe) return { ok: true, deduped: true, deliveryId }

    const payload = JSON.parse(raw || '{}')
    await db.webhookDelivery.create({
      data: {
        url: `github:${deliveryId}`,
        event,
        payload: raw.slice(0, 40_000),
        signature: expected,
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    })

    // Record the event into audit for connected organizations when
    // repository mapping is available; without an integration mapping the
    // event is stored for later correlation (never dropped silently).
    const repoFullName = payload?.repository?.full_name
    if (repoFullName) {
      const integration = await db.integration.findFirst({ where: { kind: 'github', status: 'CONNECTED' } })
      await db.auditEvent.create({
        data: {
          organizationId: integration?.organizationId ?? null,
          action: `github.${event}`,
          targetType: 'GITHUB_EVENT',
          targetId: deliveryId,
          metadata: JSON.stringify({ repo: repoFullName, action: payload.action }),
          ip: clientIp(req),
          traceId,
        },
      })
    }

    return { ok: true, event, deliveryId }
  })
}
