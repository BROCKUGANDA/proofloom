import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { verifyAttestation } from '@/lib/verification'

export const dynamic = 'force-dynamic'

// GET /api/attestations/[attestationId] — full attestation record (members)
export async function GET(req: NextRequest, ctx: { params: Promise<{ attestationId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { attestationId } = await ctx.params
    const att = await db.attestation.findUnique({ where: { id: attestationId } })
    if (!att) {
      // also accept protocol id
      const byProtocol = await db.attestation.findUnique({ where: { protocolId: attestationId } })
      if (!byProtocol) throw err('NOT_FOUND')
      if (byProtocol.organizationId) await requireProjectAccess(user.id, byProtocol.projectId ?? '', 'project.read')
      return { ...byProtocol, report: await verifyAttestation(byProtocol.protocolId) }
    }
    if (att.organizationId) await requireProjectAccess(user.id, att.projectId ?? '', 'project.read')
    return { ...att, report: await verifyAttestation(att.protocolId) }
  })
}

// DELETE /api/attestations/[attestationId] — revoke (issuer or authorized role)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ attestationId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { attestationId } = await ctx.params
    const att = await db.attestation.findUnique({ where: { id: attestationId } })
      ?? await db.attestation.findUnique({ where: { protocolId: attestationId } })
    if (!att) throw err('NOT_FOUND')

    const isIssuer = att.issuerId === user.id
    if (!isIssuer && att.organizationId) {
      await requireProjectAccess(user.id, att.projectId ?? '', 'attestation.revoke')
    } else if (!isIssuer && !att.organizationId) {
      throw err('FORBIDDEN')
    }
    if (att.status === 'REVOKED') throw err('INVALID_TRANSITION', { from: 'REVOKED' })
    const reason = new URL(req.url).searchParams.get('reason') ?? 'revoked via PROOFLOOM'

    const updated = await db.attestation.update({
      where: { id: att.id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason.slice(0, 400) },
    })
    await audit({
      organizationId: att.organizationId, projectId: att.projectId,
      actorUserId: user.id, actorAddress: att.issuerAddress, action: 'attestation.revoke',
      targetType: 'ATTESTATION', targetId: att.id,
      metadata: { protocolId: att.protocolId, reason }, ip: clientIp(req), traceId,
    })
    return { id: updated.id, protocolId: updated.protocolId, status: updated.status }
  })
}
