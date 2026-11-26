'use client'

// Public explorers: projects / releases / attestations. Server data, no auth.

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/client'
import { navigate, type Route } from '@/components/proofloom-app'
import { ProofSeal, HashChip, EmptyState, PanelSkeleton } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Boxes, GitBranch, ShieldCheck, ArrowUpRight } from 'lucide-react'

interface Summary {
  projects: { id: string; slug: string; name: string; description: string; category: string; repoUrl: string; techStack: string[]; gnoRegistered: boolean; releaseCount: number }[]
  releases: { id: string; protocolId: string; project: string; projectName: string; version: string; commitHash: string; status: string; artifactDigest?: string | null; publishedAt?: string | null; createdAt: string; activeAttestations: number }[]
  attestations: { id: string; protocolId: string; category: string; issuerAddress: string; digest: string; issuedAt: string; onChain: boolean; subjectVersion?: string }[]
  chain: { chainId: string; label: string; realmPrefix: string }
  onChainStats: { projects: number; components: number; releases: number; attestations: number } | null
}

type Tab = 'projects' | 'releases' | 'attestations'

export function ExplorerView({ route }: { route: Route; go: (r: Route) => void; session: unknown; orgId: unknown }) {
  const initialTab = ((route as { query?: string }).query as Tab) || 'projects'
  const [tab, setTab] = useState<Tab>(['projects', 'releases', 'attestations'].includes(initialTab) ? initialTab : 'projects')
  const [data, setData] = useState<Summary | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await api.get<Summary>('/api/public/explore?kind=summary'))
    } catch {
      setData(null)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!data) return <div className="mx-auto max-w-[1100px] px-4 py-10 space-y-3"><PanelSkeleton rows={4} /></div>

  const q = filter.toLowerCase()
  const projects = data.projects.filter(p => !q || p.name.toLowerCase().includes(q) || p.slug.includes(q))
  const releases = data.releases.filter(r => !q || r.protocolId.includes(q) || r.project.includes(q))
  const attestations = data.attestations.filter(a => !q || a.category.toLowerCase().includes(q) || a.issuerAddress.includes(q))

  return (
    <div className="mx-auto max-w-[1100px] px-4 lg:px-6 py-10 space-y-6">
      <header>
        <p className="eyebrow mb-3">Public explorers</p>
        <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>The open registry</h1>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <HashChip value={data.chain.chainId} display={`network ${data.chain.chainId}`} />
          <span className="font-mono-sm text-muted-foreground break-all">{"realms: " + data.chain.realmPrefix + "/*"}</span>
        </div>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
          {(['projects', 'releases', 'attestations'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm capitalize transition-colors ${tab === t ? 'bg-[var(--surface-raised)] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {t} ({t === 'projects' ? projects.length : t === 'releases' ? releases.length : attestations.length})
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter" className="pl-8" aria-label="Filter explorer" />
        </div>
      </div>

      {tab === 'projects' && (
        projects.length === 0 ? <EmptyState title="No public projects" hint="Public projects appear here as they are registered." />
          : (
            <div className="grid md:grid-cols-2 gap-3">
              {projects.map(p => (
                <div key={p.id} className="loom-panel p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="font-mono-sm text-muted-foreground">{p.slug}</p>
                    </div>
                    <Boxes size={16} className="text-muted-foreground" />
                  </div>
                  {p.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{p.description}</p>}
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground flex-wrap">
                    <span>{p.category}</span>
                    <span>{p.releaseCount} releases</span>
                    {p.gnoRegistered && <span className="text-[var(--accent)] inline-flex items-center gap-1"><GitBranch size={11} /> on-chain</span>}
                    {p.techStack.length > 0 && <span>{p.techStack.join(' · ')}</span>}
                  </div>
                </div>
              ))}
            </div>
          )
      )}

      {tab === 'releases' && (
        releases.length === 0 ? <EmptyState title="No published releases" hint="Published releases appear here with their protocol ids and verification state." />
          : (
            <div className="loom-panel divide-y divide-[var(--border)]">
              {releases.map(r => (
                <div key={r.id} className="flex items-center gap-3 p-4 flex-wrap">
                  <HashChip value={r.protocolId} display={r.protocolId} />
                  <ProofSeal status={r.status} />
                  <span className="text-xs text-muted-foreground">{r.activeAttestations} active attestations</span>
                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" className="btn-press" onClick={() => navigate({ view: 'verify', query: r.protocolId })}>
                    verify <ArrowUpRight size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )
      )}

      {tab === 'attestations' && (
        attestations.length === 0 ? <EmptyState title="No attestations" hint="Active attestations with issuer proofs appear here." />
          : (
            <div className="space-y-2">
              {attestations.map(a => (
                <div key={a.id} className="loom-panel p-4 flex items-center gap-3 flex-wrap">
                  <ShieldCheck size={15} className="text-[var(--accent)]" />
                  <span className="text-sm font-medium">{a.category.replaceAll('_', ' ').toLowerCase()}</span>
                  {a.onChain && <ProofSeal status="ACTIVE" label="on-chain" />}
                  <HashChip value={a.issuerAddress} display={`issuer ${a.issuerAddress.slice(0, 10)}…`} />
                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" className="btn-press" onClick={() => navigate({ view: 'verify', query: a.protocolId })}>
                    verify <ArrowUpRight size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )
      )}
    </div>
  )
}
