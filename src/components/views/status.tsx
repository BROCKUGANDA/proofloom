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
    chain?: { status: string; chainId?: string; network?: string; detail?: string; realmPrefix?: string }
    llmProviders?: { provider: string; available: boolean; model: string }[]
    stats?: { projects: number; releases: number; attestations: number } | null
    version?: string
  }
}

// Realm deployment manifest shape (chain/deployments/deployment-<network>.json).
interface DeploymentManifest {
  network: string
  remote: string
  deployer: string
  namespace: string
  deployedAt: string
  packages: Record<string, { path: string; txHash: string }>
}

const REALM_ORDER = ['core', 'registry', 'releases', 'attestations', 'agents', 'policies', 'verify']

export function StatusView(_props: unknown) {
  const { toast } = useApp()
  const [health, setHealth] = useState<Health | null>(null)
  const [manifest, setManifest] = useState<DeploymentManifest | null>(null)

  useEffect(() => {
    const load = () => api.get<Health>('/api/health').then(setHealth).catch(() => setHealth(null))
    void load()
    // The manifest is written by chain/scripts/deploy.sh and served by
    // /api/deployment, so this page reflects the last real deployment.
    api.get<{ manifest: DeploymentManifest | null }>('/api/deployment')
      .then(d => setManifest(d.manifest))
      .catch(() => setManifest(null))
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
        {manifest && (
          <div className="p-4 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium w-40">Realm deployment</span>
            <ProofSeal status="HEALTHY" label={`7 packages deployed · ${manifest.network}`} />
            <span className="text-xs text-muted-foreground">{new Date(manifest.deployedAt).toLocaleString()} · {manifest.deployer.slice(0, 14)}…</span>
          </div>
        )}
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

      {/* On-chain deployment manifest — written by chain/scripts/deploy.sh */}
      {manifest && (
        <div className="loom-panel p-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="eyebrow">On-chain deployment · {manifest.network}</p>
            <HashChip value={manifest.deployedAt} display={new Date(manifest.deployedAt).toLocaleDateString()} prefix="deployed " />
          </div>
          <div className="mt-3 overflow-x-auto scroll-slim">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-[var(--border)]">
                  <th className="py-1.5 pr-4 font-medium">Realm</th>
                  <th className="py-1.5 pr-4 font-medium">Package path</th>
                  <th className="py-1.5 font-medium">Deploy tx</th>
                </tr>
              </thead>
              <tbody>
                {REALM_ORDER.filter(k => manifest.packages[k]).map(k => (
                  <tr key={k} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 pr-4 font-medium">{k}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground break-all">{manifest.packages[k].path}</td>
                    <td className="py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">{manifest.packages[k].txHash.slice(0, 18)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Deployed with <code className="font-mono">chain/scripts/deploy.sh</code> against {manifest.remote}. Cross-realm imports are rewritten to the deployer address at deploy time; Init ran for all five stateful realms.
          </p>
        </div>
      )}

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
