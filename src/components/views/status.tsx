'use client'

// Service status: real health from /api/health + honest integration states.

import { useEffect, useState } from 'react'
import { api } from '@/lib/client'
import { useApp, type Route } from '@/components/proofloom-app'
import { ProofSeal, PanelSkeleton, HashChip } from '@/components/atelier/kit'

interface Health {
  status: string
  checks: {
    database?: string | { status: string; detail?: string }
    chain?: { status: string; chainId?: string; network?: string; detail?: string }
    llmProviders?: { provider: string; available: boolean; model: string }[]
    stats?: { projects: number; releases: number; attestations: number } | null
    version?: string
  }
}

export function StatusView(_props: unknown) {
  const { toast } = useApp()
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    const load = () => api.get<Health>('/api/health').then(setHealth).catch(() => setHealth(null))
    void load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [toast])

  if (!health) return <div className="mx-auto max-w-3xl px-4 py-10 space-y-3"><PanelSkeleton rows={4} /></div>

  const chain = health.checks.chain
  const db = health.checks.database

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-6 py-10 space-y-6">
      <header>
        <p className="eyebrow mb-3">Service status</p>
        <div className="flex items-center gap-3">
          <ProofSeal status={health.status === 'healthy' ? 'HEALTHY' : 'DEGRADED'} label={health.status} pulse />
          <span className="text-sm text-muted-foreground">v{health.checks.version ?? '1.0.0'} · refreshed every 30s</span>
        </div>
      </header>

      <div className="loom-panel divide-y divide-[var(--border)]">
        <div className="p-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium w-40">Database</span>
          <ProofSeal status={db === 'ok' ? 'HEALTHY' : 'ERROR'} label={db === 'ok' ? 'operational' : 'error'} />
        </div>
        <div className="p-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium w-40">Gno.land RPC</span>
          <ProofSeal status={chain?.status === 'ok' ? 'HEALTHY' : 'DEGRADED'} label={chain?.status === 'ok' ? `connected · ${chain.chainId}` : 'unreachable'} />
          {chain?.network && <span className="text-xs text-muted-foreground">{chain.network}</span>}
          {chain?.detail && <span className="text-xs text-muted-foreground">{chain.detail}</span>}
        </div>
        {(health.checks.llmProviders ?? []).map(p => (
          <div key={p.provider} className="p-4 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium w-40">LLM provider · {p.provider}</span>
            <ProofSeal status={p.available ? 'HEALTHY' : 'DEGRADED'} label={p.available ? `${p.model} available` : 'unavailable'} />
          </div>
        ))}
        <div className="p-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium w-40">Protocol realms</span>
          <ProofSeal status={(health.checks.stats?.releases ?? 0) > 0 ? 'HEALTHY' : 'PENDING'} label={(health.checks.stats?.releases ?? 0) > 0 ? 'records present' : 'no records yet'} />
          {health.checks.stats && (
            <span className="text-xs text-muted-foreground">
              {health.checks.stats.projects} projects · {health.checks.stats.releases} releases · {health.checks.stats.attestations} attestations
            </span>
          )}
        </div>
      </div>

      <div className="parchment-section rounded-md p-5">
        <p className="eyebrow mb-2">Integration states (truthful)</p>
        <div className="space-y-2 text-sm">
          {[
            ['GitHub webhooks', 'Signature-validated endpoint live; requires PROOFLOOM_GITHUB_WEBHOOK_SECRET to accept payloads.'],
            ['Operator (platform-signed) transactions', 'Active only when the deployment account credential is configured in the environment.'],
            ['Adena wallet signing', 'Available wherever the extension is installed; signing is client-side only.'],
            ['LLM agent runtime', 'Uses the configured managed provider; falls back to explicit unavailability, never silent failure.'],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="font-medium w-56 shrink-0">{k}</span>
              <span style={{ color: 'color-mix(in oklab, var(--text-on-editorial) 72%, transparent)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
