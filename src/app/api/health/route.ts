import { db } from '@/lib/db'
import { verifyChainIdentity, activeChain, fetchRegistryStats } from '@/lib/chain'
import { llm } from '@/lib/llm'
import { withApi } from '@/lib/api'

export const dynamic = 'force-dynamic'

// GET /api/health — readiness probe: database, chain identity, provider health.
export async function GET() {
  return withApi(async () => {
    const checks: Record<string, unknown> = {}
    checks.database = await db.usageRecord.count().then(() => 'ok').catch(e => ({ status: 'error', detail: String(e).slice(0, 200) }))
    try {
      const identity = await verifyChainIdentity()
      checks.chain = { status: 'ok', chainId: identity.chainId, network: activeChain().label }
    } catch (e) {
      checks.chain = { status: 'degraded', detail: String((e as Error)?.message ?? e).slice(0, 200) }
    }
    checks.llmProviders = await llm.health()
    checks.stats = await fetchRegistryStats()
    checks.version = '1.0.0'
    const degraded = Object.values(checks).some(c =>
      typeof c === 'object' && c !== null && (c as { status?: string }).status === 'error')
    return { status: degraded ? 'degraded' : 'healthy', checks }
  })
}
