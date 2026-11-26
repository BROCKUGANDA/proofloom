import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireMembership } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { webhookSignature, constantTimeEqual } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// GET /api/analytics?orgId= — real data only, sources labeled.
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const orgId = new URL(req.url).searchParams.get('orgId')
    if (!orgId) throw err('VALIDATION_FAILED', { missing: ['orgId'] })
    await requireMembership(user.id, orgId, 'analytics.read')

    const [projects, releases, attestations, agents, executions, verifications, txs] = await Promise.all([
      db.project.count({ where: { organizationId: orgId } }),
      db.release.findMany({
        where: { project: { organizationId: orgId } },
        select: { id: true, status: true, createdAt: true, publishedAt: true, projectId: true },
      }),
      db.attestation.findMany({
        where: { organizationId: orgId },
        select: { id: true, status: true, category: true, onChain: true, issuedAt: true },
      }),
      db.agent.count({ where: { organizationId: orgId } }),
      db.agentExecution.findMany({
        where: { agent: { organizationId: orgId } },
        select: { id: true, status: true, startedAt: true, tokensUsed: true },
        orderBy: { startedAt: 'desc' },
        take: 500,
      }),
      db.verificationResult.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
        select: { verdict: true, createdAt: true, durationMs: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      db.chainTransaction.findMany({
        where: { createdBy: { in: (await db.membership.findMany({ where: { organizationId: orgId }, select: { userId: true } })).map(m => m.userId) } },
        select: { status: true, kind: true, createdAt: true },
        take: 500,
      }),
    ])

    const releasesByStatus = releases.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {} as Record<string, number>)
    const attestationsByCategory = attestations.reduce((acc, a) => { acc[a.category] = (acc[a.category] ?? 0) + 1; return acc }, {} as Record<string, number>)
    const attestationStatus = attestations.reduce((acc, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc }, {} as Record<string, number>)
    const onChainAttestations = attestations.filter(a => a.onChain).length
    const executionsByStatus = executions.reduce((acc, e) => { acc[e.status] = (acc[e.status] ?? 0) + 1; return acc }, {} as Record<string, number>)

    // verification latency from real verification results
    const avgVerifyMs = verifications.length > 0
      ? Math.round(verifications.reduce((s, v) => s + v.durationMs, 0) / verifications.length)
      : null

    // 14-day activity series from real record timestamps
    const days: { date: string; releases: number; attestations: number; verifications: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 24 * 3600 * 1000)
      const key = day.toISOString().slice(0, 10)
      const next = new Date(day.getTime() + 24 * 3600 * 1000)
      days.push({
        date: key,
        releases: releases.filter(r => r.createdAt >= day && r.createdAt < next).length,
        attestations: attestations.filter(a => a.issuedAt >= day && a.issuedAt < next).length,
        verifications: verifications.filter(v => v.createdAt >= day && v.createdAt < next).length,
      })
    }

    return {
      // Every metric below is computed from persisted application records.
      // No fabricated adoption, transaction or performance numbers.
      dataSources: {
        platform: 'application database (PROOFLOOM platform records)',
        onChain: 'gno.land Onyx testnet realm state (live queries when deployed)',
        note: 'Platform metrics count platform activity. On-chain metrics reflect the deployed protocol realms only.',
      },
      totals: {
        projects,
        releases: releases.length,
        attestations: attestations.length,
        onChainAttestations,
        agents,
        executions: executions.length,
        avgVerificationMs: avgVerifyMs,
      },
      releasesByStatus,
      attestationsByCategory,
      attestationStatus,
      executionsByStatus,
      transactionStats: {
        byStatus: txs.reduce((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc }, {} as Record<string, number>),
        byKind: txs.reduce((acc, t) => { acc[t.kind] = (acc[t.kind] ?? 0) + 1; return acc }, {} as Record<string, number>),
      },
      activity14d: days,
      verificationVerdicts30d: verifications.reduce((acc, v) => { acc[v.verdict] = (acc[v.verdict] ?? 0) + 1; return acc }, {} as Record<string, number>),
    }
  })
}
