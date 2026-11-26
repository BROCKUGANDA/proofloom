'use client'

// Executive workspace: organization overview, project registry, creation.

import { useCallback, useEffect, useState } from 'react'
import { api, ClientError, walletStatus, type WalletAdapter } from '@/lib/client'
import { useApp, navigate, type Route } from '@/components/proofloom-app'
import { ProofSeal, EmptyState, PanelSkeleton, HashChip } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Search, ArrowUpRight, Boxes, GitBranch, ScrollText, FileSearch } from 'lucide-react'

interface ProjectRow {
  id: string; slug: string; name: string; description: string; repoUrl: string
  category: string; visibility: string; status: string; techStack: string[]
  gnoRegistered: boolean; onChainRef?: string | null
  counts: { releases: number; components: number; tasks: number }
  latestRelease: { version: string; status: string } | null
  policy: { name: string; version: number } | null
  updatedAt: string
}

export function WorkspaceView(_props: unknown) {
  const { session, orgId, toast } = useApp()
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [wallet, setWallet] = useState<WalletAdapter | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const rows = await api.get<ProjectRow[]>(`/api/projects?orgId=${orgId}`)
      setProjects(rows)
    } catch (e) {
      setProjects([])
      if (e instanceof ClientError) toast('error', e.apiError.message, e.apiError.recovery)
    }
  }, [orgId, toast])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void walletStatus().then(setWallet) }, [])

  const visible = (projects ?? []).filter(p =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.slug.includes(filter.toLowerCase()))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>Workspace</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Projects, releases and evidence for {session?.organizations?.find(o => o.id === orgId)?.name}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate({ view: 'atlas' })} className="btn-press">
            <Boxes size={14} className="mr-1.5" /> Proof Atlas
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="btn-press"><Plus size={14} className="mr-1.5" /> New project</Button>
            </DialogTrigger>
            <CreateProjectDialog onCreated={() => { setCreateOpen(false); void load() }} wallet={wallet} />
          </Dialog>
        </div>
      </div>

      {/* Wallet status strip */}
      <div className="loom-panel p-4 flex items-center gap-3 flex-wrap">
        <span className="eyebrow">Wallet</span>
        {wallet?.available ? (
          <>
            <ProofSeal status="ACTIVE" label="Adena detected" />
            {wallet.address && <HashChip value={wallet.address} display={`${wallet.address.slice(0, 12)}…${wallet.address.slice(-6)}`} />}
            {wallet.chainId && <span className="text-xs text-muted-foreground">chain: {wallet.chainId}</span>}
            {wallet.chainId && wallet.chainId !== 'onyx-1' && <ProofSeal status="DISPUTED" label="network mismatch" />}
          </>
        ) : (
          <>
            <ProofSeal status="UNKNOWN" label="no wallet detected" />
            <span className="text-xs text-muted-foreground">
              Install Adena to sign on-chain operations with your own keys. Platform sessions can still register
              projects and verify records; on-chain signing uses the operator flow where enabled.
            </span>
          </>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid md:grid-cols-4 gap-3">
        {[
          { label: 'Verification portal', detail: 'public, no account', icon: FileSearch, r: { view: 'verify' } as Route },
          { label: 'Public explorers', detail: 'projects & releases', icon: Search, r: { view: 'explore' } as Route },
          { label: 'Agent Command', detail: 'registry & executions', icon: Boxes, r: { view: 'agents' } as Route },
          { label: 'Audit explorer', detail: 'immutable trail', icon: ScrollText, r: { view: 'audit' } as Route },
        ].map(q => (
          <button key={q.label} onClick={() => navigate(q.r)} className="loom-panel p-4 text-left hover:border-[var(--border-strong)] transition-colors btn-press">
            <q.icon size={16} className="text-[var(--accent)] mb-2" />
            <p className="text-sm font-medium">{q.label}</p>
            <p className="text-xs text-muted-foreground">{q.detail}</p>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter projects" className="pl-8" aria-label="Filter projects" />
        </div>
        <span className="text-xs text-muted-foreground">{visible.length} project{visible.length === 1 ? '' : 's'}</span>
      </div>

      {projects === null ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <PanelSkeleton key={i} rows={2} />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="A project is the provenance root: releases, evidence, attestations and agents all hang off it. Create your first project to start building the record."
          action={<Button onClick={() => setCreateOpen(true)} className="btn-press"><Plus size={14} className="mr-1.5" /> Create project</Button>}
        />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map(p => (
            <button key={p.id} onClick={() => navigate({ view: 'project', projectId: p.id })} className="loom-panel p-5 text-left hover:border-[var(--border-strong)] transition-colors btn-press group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.name}</p>
                  <p className="font-mono-sm text-muted-foreground">{p.slug}</p>
                </div>
                <ArrowUpRight size={15} className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </div>
              {p.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{p.description}</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                <ProofSeal status={p.visibility === 'public' ? 'ACTIVE' : 'DRAFT'} label={p.visibility} />
                {p.status === 'ARCHIVED' && <ProofSeal status="ARCHIVED" />}
                {p.latestRelease && <ProofSeal status={p.latestRelease.status} label={`v${p.latestRelease.version}`} />}
                {p.policy && <ProofSeal status="ACTIVE" label={`policy v${p.policy.version}`} />}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span>{p.counts.releases} releases</span>
                <span>{p.counts.components} components</span>
                {p.gnoRegistered && (
                  <span className="inline-flex items-center gap-1 text-[var(--accent)]"><GitBranch size={11} /> on-chain</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateProjectDialog({ onCreated, wallet }: { onCreated: () => void; wallet: WalletAdapter | null }) {
  const { orgId, session, toast } = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [category, setCategory] = useState('service')
  const [visibility, setVisibility] = useState('public')
  const [tech, setTech] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const org = session?.organizations?.find(o => o.id === orgId)
  const canCreate = org?.capabilities.includes('project.create')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await api.post<{ id: string; slug: string }>('/api/projects', {
        orgId, name, description, repoUrl, category, visibility,
        techStack: tech.split(',').map(t => t.trim()).filter(Boolean),
      })
      toast('success', 'Project created', `${created.slug} — register releases and evidence next.`)
      onCreated()
      navigate({ view: 'project', projectId: created.id })
    } catch (e) {
      setError(e instanceof ClientError ? `${e.apiError.message} — ${e.apiError.recovery}` : 'Unexpected error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Create project</DialogTitle>
        <DialogDescription>
          A project gets a protocol slug. Its releases and attestations address it on-chain as
          <span className="font-mono-sm"> &lt;slug&gt;-&lt;version&gt;</span>.
        </DialogDescription>
      </DialogHeader>
      {!canCreate ? (
        <p className="text-sm text-[var(--critical)]">Your role in this organization cannot create projects.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120} placeholder="Core API" />
          </div>
          <div>
            <Label htmlFor="p-desc">Description</Label>
            <Input id="p-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} placeholder="Primary service — releases published with evidence" />
          </div>
          <div>
            <Label htmlFor="p-repo">Repository URL</Label>
            <Input id="p-repo" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/you/core-api" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-cat">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="p-cat"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['service', 'library', 'agent', 'tool', 'infrastructure'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-vis">Visibility</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger id="p-vis"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">public — appears in explorers</SelectItem>
                  <SelectItem value="private">private — organization only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="p-tech">Tech stack (comma separated)</Label>
            <Input id="p-tech" value={tech} onChange={e => setTech(e.target.value)} placeholder="go, react, k8s" />
          </div>
          {error && <p className="text-sm text-[var(--critical)]" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onCreated()}>Cancel</Button>
            <Button type="submit" disabled={busy} className="btn-press">
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        </form>
      )}
    </DialogContent>
  )
}
