'use client'

// Analytics — every metric from real persisted records with explicit source
// labels. No fabricated adoption numbers.

import { useCallback, useEffect, useState } from 'react'
import { api, ClientError } from '@/lib/client'
import { useApp, type Route } from '@/components/proofloom-app'
import { PanelSkeleton, ProofSeal } from '@/components/atelier/kit'
import { HashChip } from '@/components/atelier/kit'

interface Analytics {
  dataSources: { platform: string; onChain: string; note: string }
  totals: {
    projects: number; releases: number; attestations: number; onChainAttestations: number
    agents: number; executions: number; avgVerificationMs: number | null
  }
  releasesByStatus: Record<string, number>
  attestationsByCategory: Record<string, number>
  attestationStatus: Record<string, number>
  executionsByStatus: Record<string, number>
  transactionStats: { byStatus: Record<string, number>; byKind: Record<string, number> }
  activity14d: { date: string; releases: number; attestations: number; verifications: number }[]
  verificationVerdicts30d: Record<string, number>
}

function Bar({ label, value, max, tone = 'var(--accent)' }: { label: string; value: number; max: number; tone?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono-sm text-muted-foreground w-44 truncate" title={label}>{label.replaceAll('_', ' ').toLowerCase()}</span>
      <div className="flex-1 h-[10px] rounded-sm overflow-hidden" style={{ background: 'var(--surface-raised)' }}>
        <div className="h-full rounded-sm" style={{ width: `${max === 0 ? 0 : (value / max) * 100}%`, background: tone }} />
      </div>
      <span className="font-mono-sm w-8 text-right">{value}</span>
    </div>
  )
}

export function AnalyticsView({ route }: { route: Route; go: (r: Route) => void; session: unknown; orgId: unknown }) {
  const { orgId, toast } = useApp()
  const [data, setData] = useState<Analytics | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      setData(await api.get<Analytics>(`/api/analytics?orgId=${orgId}`))
    } catch (e) {
      if (e instanceof ClientError) toast('error', e.apiError.message, e.apiError.recovery)
    }
  }, [orgId, toast])

  useEffect(() => { void load() }, [load])

  if (!data) return <div className="space-y-3"><PanelSkeleton rows={5} /></div>

  const maxRel = Math.max(1, ...Object.values(data.releasesByStatus))
  const maxCat = Math.max(1, ...Object.values(data.attestationsByCategory))
  const maxDay = Math.max(1, ...data.activity14d.map(d => Math.max(d.releases, d.attestations, d.verifications)))
  const maxExec = Math.max(1, ...Object.values(data.executionsByStatus))

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">{data.dataSources.note}</p>
        <div className="flex gap-2 mt-2 flex-wrap">
          <span className="proof-seal seal-info">source: {data.dataSources.platform.split('(')[0].trim()}</span>
          <span className="proof-seal seal-unknown">on-chain: {data.dataSources.onChain.split('(')[0].trim()}</span>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Projects', value: data.totals.projects },
          { label: 'Releases', value: data.totals.releases },
          { label: 'Attestations', value: data.totals.attestations },
          { label: 'On-chain', value: data.totals.onChainAttestations },
          { label: 'Agents', value: data.totals.agents },
          { label: 'Executions', value: data.totals.executions },
          { label: 'Avg verify', value: data.totals.avgVerificationMs != null ? `${data.totals.avgVerificationMs}ms` : '—' },
        ].map(t => (
          <div key={t.label} className="loom-panel p-4">
            <p className="atelier-display text-2xl">{t.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{t.label}</p>
          </div>
        ))}
      </div>

      {/* 14-day activity */}
      <div className="loom-panel p-5">
        <p className="eyebrow mb-4">Activity — last 14 days (real record timestamps)</p>
        <div className="flex items-end gap-1.5 h-36" role="img" aria-label="14 day activity chart">
          {data.activity14d.map(d => {
            const total = d.releases + d.attestations + d.verifications
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                <div className="w-full flex flex-col justify-end gap-[2px] h-28">
                  {d.releases > 0 && <div className="w-full rounded-[2px]" style={{ height: `${(d.releases / maxDay) * 100}%`, background: 'var(--accent-info)', minHeight: 3 }} />}
                  {d.attestations > 0 && <div className="w-full rounded-[2px]" style={{ height: `${(d.attestations / maxDay) * 100}%`, background: 'var(--copper)', minHeight: 3 }} />}
                  {d.verifications > 0 && <div className="w-full rounded-[2px]" style={{ height: `${(d.verifications / maxDay) * 100}%`, background: 'var(--accent)', minHeight: 3 }} />}
                  {total === 0 && <div className="w-full h-[2px] rounded-[1px]" style={{ background: 'var(--border)' }} />}
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">{d.date.slice(5)}</span>
                <span className="absolute -top-6 text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--surface-raised)] px-1.5 py-0.5 rounded border border-[var(--border)] pointer-events-none">
                  {d.releases}r {d.attestations}a {d.verifications}v
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent-info)' }} /> releases</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--copper)' }} /> attestations</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} /> verifications</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="loom-panel p-5 space-y-2.5">
          <p className="eyebrow mb-3">Releases by state</p>
          {Object.entries(data.releasesByStatus).map(([k, v]) => <Bar key={k} label={k} value={v} max={maxRel} tone="var(--accent-info)" />)}
          {Object.keys(data.releasesByStatus).length === 0 && <p className="text-sm text-muted-foreground">No releases yet.</p>}
        </div>
        <div className="loom-panel p-5 space-y-2.5">
          <p className="eyebrow mb-3">Attestations by category</p>
          {Object.entries(data.attestationsByCategory).map(([k, v]) => <Bar key={k} label={k} value={v} max={maxCat} tone="var(--copper)" />)}
          {Object.keys(data.attestationsByCategory).length === 0 && <p className="text-sm text-muted-foreground">No attestations yet.</p>}
        </div>
        <div className="loom-panel p-5 space-y-2.5">
          <p className="eyebrow mb-3">Agent executions</p>
          {Object.entries(data.executionsByStatus).map(([k, v]) => <Bar key={k} label={k} value={v} max={maxExec} tone="var(--verified)" />)}
          {Object.keys(data.executionsByStatus).length === 0 && <p className="text-sm text-muted-foreground">No agent executions yet.</p>}
        </div>
        <div className="loom-panel p-5 space-y-2.5">
          <p className="eyebrow mb-3">Verification verdicts (30d)</p>
          {Object.entries(data.verificationVerdicts30d).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <ProofSeal status={k} />
              <span className="font-mono-sm text-muted-foreground">{v}</span>
            </div>
          ))}
          {Object.keys(data.verificationVerdicts30d).length === 0 && <p className="text-sm text-muted-foreground">No public verification queries recorded in the last 30 days.</p>}
        </div>
      </div>

      <div className="loom-panel p-5">
        <p className="eyebrow mb-3">On-chain transaction lifecycle</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.transactionStats.byStatus).map(([k, v]) => (
            <span key={k}><ProofSeal status={k} label={`${k.replaceAll('_', ' ').toLowerCase()} · ${v}`} /></span>
          ))}
          {Object.keys(data.transactionStats.byStatus).length === 0 && (
            <span className="text-sm text-muted-foreground">No chain transactions yet — publish a release on-chain to populate this panel.</span>
          )}
        </div>
      </div>
    </div>
  )
}
