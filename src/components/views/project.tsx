'use client'

// Project workspace: the operational surface for a project — releases,
// evidence, components, dependencies, tasks, policies.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ClientError } from '@/lib/client'
import { useApp, navigate, type Route } from '@/components/proofloom-app'
import { ProofSeal, EmptyState, PanelSkeleton, HashChip, CopyButton, ProvenanceRail, PolicyVerdict } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, ArrowLeft, GitBranch, Boxes, FileSearch, RefreshCw, Trash2, Archive } from 'lucide-react'

interface ProjectDetail {
  project: {
    id: string; slug: string; name: string; description: string; repoUrl: string
    category: string; visibility: string; status: string; techStack: string[]
    gnoRegistered: boolean; onChainRef?: string | null; organizationId: string; createdAt: string
  }
  onChain: { id: string; name: string; owner: string } | null
  components: { id: string; name: string; artifactType: string; license: string; deprecated: boolean }[]
  dependencies: { id: string; name: string; ecosystem: string; version: string; risk: string; isDirect: boolean }[]
  releases: {
    id: string; protocolId: string; version: string; commitHash: string; status: string
    artifactDigest?: string | null; publishedAt?: string | null; createdAt: string
    attestations: { protocolId: string; category: string; status: string; onChain: boolean }[]
    evidenceCount: number
  }[]
  tasks: { id: string; title: string; state: string; priority: string; assigneeType: string; agent?: { name: string } | null }[]
  policies: { id: string; name: string; version: number; active: boolean; requireCategories: string; minApprovals: number }[]
  agents: { id: string; name: string; slug: string; status: string; version: string }[]
}

export function ProjectView({ route, go }: { route: Route; go: (r: Route) => void; session: unknown; orgId: unknown }) {
  const { toast, session } = useApp()
  const projectId = (route as { projectId?: string }).projectId ?? ''
  const initialTab = (route as { tab?: string }).tab ?? 'releases'
  const [data, setData] = useState<ProjectDetail | null>(null)
  const load = useCallback(async () => {
    if (!projectId) return
    try {
      setData(await api.get<ProjectDetail>(`/api/projects/${projectId}`))
    } catch (e) {
      if (e instanceof ClientError) {
        toast('error', e.apiError.message, e.apiError.recovery)
        navigate({ view: 'workspace' })
      }
    }
  }, [projectId, toast])

  useEffect(() => { void load() }, [load])

  const role = session?.organizations?.find(o => o.id === data?.project.organizationId)?.role
  const canWrite = role && !['VIEWER', 'AUDITOR'].includes(role)

  if (!data) return <div className="space-y-3"><PanelSkeleton rows={4} /></div>
  const p = data.project

  return (
    <div className="space-y-6">
      <button onClick={() => go({ view: 'workspace' })} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
        <ArrowLeft size={14} /> Workspace
      </button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>{p.name}</h1>
            <ProofSeal status={p.status} />
            <ProofSeal status={p.visibility === 'public' ? 'ACTIVE' : 'DRAFT'} label={p.visibility} />
            {p.gnoRegistered && <ProofSeal status="ACTIVE" label="on-chain" />}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <HashChip value={p.slug} />
            <CopyButton text={p.slug} />
            {p.repoUrl && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><GitBranch size={11} /> {p.repoUrl}</span>}
            {p.techStack.length > 0 && <span className="text-xs text-muted-foreground">{p.techStack.join(' · ')}</span>}
          </div>
          {p.description && <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{p.description}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} className="btn-press" aria-label="Refresh">
            <RefreshCw size={14} />
          </Button>
          {canWrite && (
            <Button
              variant="outline" size="sm" className="btn-press"
              onClick={async () => {
                try {
                  await api.patch(`/api/projects/${projectId}`, { archive: p.status === 'ACTIVE' })
                  toast('success', p.status === 'ACTIVE' ? 'Project archived' : 'Project restored')
                  void load()
                } catch (e) {
                  toast('error', e instanceof ClientError ? e.apiError.message : 'Failed')
                }
              }}
            >
              <Archive size={14} className="mr-1.5" /> {p.status === 'ACTIVE' ? 'Archive' : 'Restore'}
            </Button>
          )}
        </div>
      </div>

      {p.gnoRegistered && p.onChainRef && (
        <div className="loom-panel p-3 flex items-center gap-2 flex-wrap">
          <span className="eyebrow">on-chain ref</span>
          <HashChip value={p.onChainRef} display={p.onChainRef.slice(0, 18) + '…'} />
          <CopyButton text={p.onChainRef} />
        </div>
      )}

      <Tabs defaultValue={initialTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="releases">Releases ({data.releases.length})</TabsTrigger>
          <TabsTrigger value="components">Components ({data.components.length})</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies ({data.dependencies.length})</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({data.tasks.length})</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
          <TabsTrigger value="agents">Agents ({data.agents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="releases" className="mt-4">
          <ReleasesTab data={data} canWrite={!!canWrite} reload={load} />
        </TabsContent>
        <TabsContent value="components" className="mt-4">
          <ComponentsTab data={data} canWrite={!!canWrite} reload={load} />
        </TabsContent>
        <TabsContent value="dependencies" className="mt-4">
          <DependenciesTab data={data} canWrite={!!canWrite} reload={load} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <TasksTab data={data} canWrite={!!canWrite} reload={load} />
        </TabsContent>
        <TabsContent value="policy" className="mt-4">
          <PolicyTab data={data} canWrite={!!canWrite} reload={load} />
        </TabsContent>
        <TabsContent value="agents" className="mt-4">
          <EmptyState
            title="Agents for this project"
            hint="Register agents and manage their scoped grants in Agent Command — executions tied to this project appear here."
            action={<Button onClick={() => go({ view: 'agents' })} className="btn-press">Open Agent Command</Button>}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Releases ────────────────────────────────────────────────────────────────

function ReleasesTab({ data, canWrite, reload }: { data: ProjectDetail; canWrite: boolean; reload: () => Promise<void> }) {
  const { toast } = useApp()
  const [open, setOpen] = useState(false)

  const transition = async (releaseId: string, action: string, extra?: Record<string, unknown>) => {
    try {
      await api.patch(`/api/releases/${releaseId}`, { action, ...extra })
      toast('success', `Release ${action.replaceAll('-', ' ')}`)
      await reload()
    } catch (e) {
      if (e instanceof ClientError) {
        const details = e.apiError.details as { policyChecks?: { requirement: string; passed: boolean; detail: string }[] } | undefined
        toast('error', e.apiError.message,
          details?.policyChecks
            ? `Policy verdict: ${details.policyChecks.filter(c => !c.passed).map(c => c.requirement).join(', ')} unmet`
            : e.apiError.recovery)
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Release provenance lifecycle — server-enforced state machine mirrored on-chain.</p>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" className="btn-press"><Plus size={14} className="mr-1.5" /> New release</Button></DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>Create release</DialogTitle>
                <DialogDescription>The protocol id is <span className="font-mono-sm">{data.project.slug}-&lt;version&gt;</span></DialogDescription></DialogHeader>
              <CreateReleaseForm slug={data.project.slug} onCreated={async () => { setOpen(false); await reload() }} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {data.releases.length === 0 ? (
        <EmptyState title="No releases yet" hint="Create a release, attach evidence (build logs, test reports, SBOM), then walk it to PUBLISHED." />
      ) : (
        <div className="space-y-3">
          {data.releases.map(r => (
            <div key={r.id} className="loom-panel p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => navigate({ view: 'release', releaseId: r.id })} className="font-mono text-sm font-semibold hover:underline text-left">
                      {r.protocolId}
                    </button>
                    <ProofSeal status={r.status} />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs text-muted-foreground">
                    <HashChip value={r.commitHash} display={`commit ${r.commitHash.slice(0, 10)}`} />
                    <span>{r.evidenceCount} evidence</span>
                    <span>{r.attestations.filter(a => a.status === 'ACTIVE').length} active attestations</span>
                  </div>
                  <div className="mt-3"><ProvenanceRail status={r.status} /></div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {canWrite && nextActions(r.status).map(a => (
                    <Button key={a.action} size="sm" variant={a.action === 'publish' ? 'default' : 'outline'} className="btn-press"
                      onClick={() => void transition(r.id, a.action)}>
                      {a.label}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => navigate({ view: 'release', releaseId: r.id })}>
                    Open <FileSearch size={13} className="ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function nextActions(status: string): { action: string; label: string }[] {
  const map: Record<string, { action: string; label: string }[]> = {
    DRAFT: [{ action: 'submit-evidence', label: 'Submit evidence' }],
    EVIDENCE_PENDING: [{ action: 'validate', label: 'Start validation' }],
    VALIDATING: [{ action: 'approve', label: 'Approve' }, { action: 'require-review', label: 'Require review' }],
    REVIEW_REQUIRED: [{ action: 'approve', label: 'Approve' }],
    APPROVED: [{ action: 'publish', label: 'Publish' }],
    PUBLISHED: [{ action: 'verify', label: 'Mark verified*' }],
    VERIFIED: [{ action: 'revoke', label: 'Revoke' }],
  }
  return map[status] ?? []
}

function CreateReleaseForm({ slug, onCreated }: { slug: string; onCreated: () => Promise<void> }) {
  const { toast } = useApp()
  const [version, setVersion] = useState('')
  const [commit, setCommit] = useState('')
  const [branch, setBranch] = useState('main')
  const [buildEnv, setBuildEnv] = useState('')
  const [digest, setDigest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form onSubmit={async (e) => {
      e.preventDefault()
      setBusy(true); setError(null)
      try {
        const projectId = window.location.hash.split('/')[2]
        const created = await api.post<{ id: string }>(`/api/projects/${projectId}/releases`, {
          version, commitHash: commit, branch, buildEnv, artifactDigest: digest || undefined,
        })
        toast('success', `Release ${slug}-${version.toLowerCase()} created`)
        await onCreated()
        navigate({ view: 'release', releaseId: created.id })
      } catch (e2) {
        setError(e2 instanceof ClientError ? `${e2.apiError.message} — ${e2.apiError.recovery}` : 'Unexpected error')
      } finally { setBusy(false) }
    }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="r-version">Version</Label>
          <Input id="r-version" value={version} onChange={e => setVersion(e.target.value)} required placeholder="1.2.0" pattern="[a-zA-Z0-9][a-zA-Z0-9.+-]{0,31}" />
        </div>
        <div>
          <Label htmlFor="r-commit">Commit hash</Label>
          <Input id="r-commit" value={commit} onChange={e => setCommit(e.target.value)} required placeholder="0123abcd…" pattern="[0-9a-f]{7,64}" className="font-mono-sm" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="r-branch">Branch</Label>
          <Input id="r-branch" value={branch} onChange={e => setBranch(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="r-env">Build environment</Label>
          <Input id="r-env" value={buildEnv} onChange={e => setBuildEnv(e.target.value)} placeholder="gh-runner:ubuntu-24.04" />
        </div>
      </div>
      <div>
        <Label htmlFor="r-digest">Artifact digest (sha256, optional now)</Label>
        <Input id="r-digest" value={digest} onChange={e => setDigest(e.target.value)} placeholder="64 hex chars — required before publish" className="font-mono-sm" />
      </div>
      {error && <p className="text-sm text-[var(--critical)]" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={busy} className="btn-press">{busy ? 'Creating…' : 'Create release'}</Button>
      </div>
    </form>
  )
}

// ─── Components ──────────────────────────────────────────────────────────────

function ComponentsTab({ data, canWrite, reload }: { data: ProjectDetail; canWrite: boolean; reload: () => Promise<void> }) {
  const { toast } = useApp()
  const [name, setName] = useState('')
  const [type, setType] = useState('library')
  const [license, setLicense] = useState('')

  return (
    <div className="space-y-4">
      {canWrite && (
        <form onSubmit={async (e) => {
          e.preventDefault()
          try {
            await api.post(`/api/projects/${data.project.id}/components`, { name, artifactType: type, license })
            toast('success', 'Component registered')
            setName(''); setLicense('')
            await reload()
          } catch (e2) { toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed') }
        }} className="loom-panel p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <Label htmlFor="c-name">Component name</Label>
            <Input id="c-name" value={name} onChange={e => setName(e.target.value)} required placeholder="core-api-container" />
          </div>
          <div className="w-[150px]">
            <Label htmlFor="c-type">Artifact type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="c-type"><SelectValue /></SelectTrigger>
              <SelectContent>{['source', 'container', 'binary', 'sbom', 'docs', 'library'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-[140px]">
            <Label htmlFor="c-license">License</Label>
            <Input id="c-license" value={license} onChange={e => setLicense(e.target.value)} placeholder="Apache-2.0" />
          </div>
          <Button type="submit" size="sm" className="btn-press"><Plus size={14} className="mr-1" /> Register</Button>
        </form>
      )}
      {data.components.length === 0 ? (
        <EmptyState title="No components registered" hint="Components are the addressable artifacts: source archives, container images, binaries, SBOMs." />
      ) : (
        <div className="loom-panel divide-y divide-[var(--border)]">
          {data.components.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3.5 flex-wrap">
              <Boxes size={15} className="text-muted-foreground" />
              <span className="text-sm font-medium">{c.name}</span>
              <span className="eyebrow">{c.artifactType}</span>
              {c.license && <span className="text-xs text-muted-foreground">{c.license}</span>}
              {c.deprecated && <ProofSeal status="REVOKED" label="deprecated" />}
              <span className="flex-1" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Dependencies ────────────────────────────────────────────────────────────

function DependenciesTab({ data, canWrite, reload }: { data: ProjectDetail; canWrite: boolean; reload: () => Promise<void> }) {
  const { toast } = useApp()
  const [name, setName] = useState('')
  const [ecosystem, setEcosystem] = useState('npm')
  const [version, setVersion] = useState('')
  const [risk, setRisk] = useState('UNKNOWN')

  const grouped = useMemo(() => {
    const direct = data.dependencies.filter(d => d.isDirect)
    const transitive = data.dependencies.filter(d => !d.isDirect)
    return { direct, transitive }
  }, [data.dependencies])

  return (
    <div className="space-y-4">
      {canWrite && (
        <form onSubmit={async (e) => {
          e.preventDefault()
          try {
            await api.post(`/api/projects/${data.project.id}/dependencies`, { name, ecosystem, version, risk })
            toast('success', 'Dependency recorded')
            setName(''); setVersion('')
            await reload()
          } catch (e2) { toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed') }
        }} className="loom-panel p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <Label htmlFor="d-name">Package</Label>
            <Input id="d-name" value={name} onChange={e => setName(e.target.value)} required placeholder="express" />
          </div>
          <div className="w-[120px]">
            <Label htmlFor="d-eco">Ecosystem</Label>
            <Select value={ecosystem} onValueChange={setEcosystem}>
              <SelectTrigger id="d-eco"><SelectValue /></SelectTrigger>
              <SelectContent>{['npm', 'pypi', 'maven', 'go', 'cargo', 'oci', 'other'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-[120px]">
            <Label htmlFor="d-ver">Version</Label>
            <Input id="d-ver" value={version} onChange={e => setVersion(e.target.value)} placeholder="4.18.2" />
          </div>
          <div className="w-[120px]">
            <Label htmlFor="d-risk">Risk</Label>
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger id="d-risk"><SelectValue /></SelectTrigger>
              <SelectContent>{['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="submit" size="sm" className="btn-press"><Plus size={14} className="mr-1" /> Add</Button>
        </form>
      )}

      {data.dependencies.length === 0 ? (
        <EmptyState title="No dependencies recorded" hint="Recorded dependencies feed the DependencyConstellation and SBOM verification." />
      ) : (
        <>
          <div className="loom-panel p-4">
            <p className="eyebrow mb-3">Dependency constellation — direct ({grouped.direct.length}) · transitive ({grouped.transitive.length})</p>
            <div className="flex flex-wrap gap-2">
              {data.dependencies.map(d => (
                <span key={d.id} className={`proof-seal ${d.risk === 'HIGH' ? 'seal-critical' : d.risk === 'MEDIUM' ? 'seal-pending' : 'seal-unknown'}`}>
                  {d.name}@{d.version || '*'} {d.isDirect ? '' : '(t)'}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

function TasksTab({ data, canWrite, reload }: { data: ProjectDetail; canWrite: boolean; reload: () => Promise<void> }) {
  const { toast } = useApp()
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState('MEDIUM')

  const transition = async (taskId: string, action: string) => {
    try {
      await api.patch('/api/tasks', { taskId, action })
      await reload()
      toast('success', `Task ${action.replaceAll('-', ' ')}`)
    } catch (e) {
      toast('error', e instanceof ClientError ? `${e.apiError.message} — ${e.apiError.recovery}` : 'Failed')
    }
  }
  void transition

  return (
    <div className="space-y-4">
      {canWrite && (
        <form onSubmit={async (e) => {
          e.preventDefault()
          try {
            await api.post('/api/tasks', { projectId: data.project.id, title, description: desc, priority })
            toast('success', 'Task created')
            setTitle(''); setDesc('')
            await reload()
          } catch (e2) { toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed') }
        }} className="loom-panel p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="t-title">Task</Label>
              <Input id="t-title" value={title} onChange={e => setTitle(e.target.value)} required placeholder="Audit dependency X before release" />
            </div>
            <div className="w-[130px]">
              <Label htmlFor="t-prio">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="t-prio"><SelectValue /></SelectTrigger>
                <SelectContent>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" className="btn-press"><Plus size={14} className="mr-1" /> Create</Button>
          </div>
          <Textarea id="t-desc" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Acceptance criteria, evidence requirements…" rows={2} />
        </form>
      )}

      {data.tasks.length === 0 ? (
        <EmptyState title="No tasks" hint="Tasks connect engineering work to verified outcomes — completion requires an evidence digest." />
      ) : (
        <div className="space-y-2">
          {data.tasks.map(t => (
            <div key={t.id} className="loom-panel p-4 flex items-center gap-3 flex-wrap">
              <ProofSeal status={t.state} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t.priority.toLowerCase()} · {t.assigneeType === 'AGENT' ? `agent: ${t.agent?.name ?? 'unassigned'}` : 'human'}
                </p>
              </div>
              {canWrite && t.state === 'OPEN' && (
                <Button size="sm" variant="outline" className="btn-press" onClick={async () => {
                  try {
                    await api.patch('/api/tasks', { taskId: t.id, action: 'start' })
                    await reload()
                  } catch (e) { toast('error', e instanceof ClientError ? e.apiError.message : 'Failed') }
                }}>Start</Button>
              )}
              {canWrite && t.state === 'IN_PROGRESS' && (
                <Button size="sm" variant="outline" className="btn-press" onClick={async () => {
                  try {
                    await api.patch('/api/tasks', { taskId: t.id, action: 'submit-evidence' })
                    await reload()
                  } catch (e) { toast('error', e instanceof ClientError ? e.apiError.message : 'Failed') }
                }}>Submit evidence</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Policy ──────────────────────────────────────────────────────────────────

const ALL_CATEGORIES = ['BUILD_PROVENANCE', 'TEST_EXECUTION', 'SECURITY_ASSESSMENT', 'CODE_REVIEW', 'RELEASE_APPROVAL', 'DEPENDENCY_VERIFICATION']

function PolicyTab({ data, canWrite, reload }: { data: ProjectDetail; canWrite: boolean; reload: () => Promise<void> }) {
  const { toast } = useApp()
  const active = data.policies.find(p => p.active)
  const [cats, setCats] = useState<string[]>([])
  const [minApprovals, setMinApprovals] = useState(1)
  const [simResult, setSimResult] = useState<{ passed: boolean; checks: { requirement: string; passed: boolean; detail: string }[] } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (active) setCats(active.requireCategories.split(',').filter(Boolean))
  }, [active])

  const simulate = async () => {
    setBusy(true)
    try {
      const res = await api.post<{ passed: boolean; checks: { requirement: string; passed: boolean; detail: string }[] }>('/api/policies', { op: 'simulate', projectId: data.project.id })
      setSimResult(res)
    } catch (e) {
      toast('error', e instanceof ClientError ? e.apiError.message : 'Simulation failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {active ? (
        <div className="loom-panel p-5">
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <p className="text-sm font-semibold">{active.name}</p>
            <ProofSeal status="ACTIVE" label={`v${active.version}`} />
          </div>
          <PolicyVerdict checks={active.requireCategories.split(',').filter(Boolean).map(c => ({
            requirement: `ATTESTATION:${c}`, passed: true, detail: 'required for publication',
          }))} />
          <p className="text-sm text-muted-foreground mt-3">
            Minimum approvals: <span className="font-mono-sm">{active.minApprovals}</span>
          </p>
        </div>
      ) : (
        <div className="loom-panel p-5">
          <p className="text-sm font-medium mb-1">No active policy</p>
          <p className="text-sm text-muted-foreground">
            Publications pass the protocol baseline (an active BUILD_PROVENANCE attestation).
            Set a policy to enforce stronger requirements server-side.
          </p>
        </div>
      )}

      {canWrite && (
        <div className="loom-panel p-5 space-y-4">
          <p className="eyebrow">Set publication policy</p>
          <div>
            <Label>Required attestation categories</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {ALL_CATEGORIES.map(c => {
                const on = cats.includes(c)
                return (
                  <button
                    key={c} type="button"
                    onClick={() => setCats(prev => on ? prev.filter(x => x !== c) : [...prev, c])}
                    className={`proof-seal ${on ? 'seal-verified' : 'seal-unknown'}`}
                    aria-pressed={on}
                  >
                    {c.replaceAll('_', ' ').toLowerCase()}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="w-[220px]">
            <Label htmlFor="min-appr">Minimum release approvals</Label>
            <Input id="min-appr" type="number" min={0} max={16} value={minApprovals}
              onChange={e => setMinApprovals(Math.max(0, Math.min(16, parseInt(e.target.value) || 0)))} />
          </div>
          <div className="flex gap-2">
            <Button className="btn-press" disabled={busy} onClick={async () => {
              setBusy(true)
              try {
                await api.post('/api/policies', { op: 'set', projectId: data.project.id, requireCategories: cats, minApprovals })
                toast('success', 'Policy set', `v${(active?.version ?? 0) + 1} — enforced server-side on publication`)
                await reload()
              } catch (e) {
                toast('error', e instanceof ClientError ? e.apiError.message : 'Failed')
              } finally { setBusy(false) }
            }}>Save policy</Button>
            <Button variant="outline" className="btn-press" disabled={busy} onClick={() => void simulate()}>
              Simulate on latest release
            </Button>
          </div>
          {simResult && (
            <div className="pt-2 border-t border-[var(--border)]">
              <p className="eyebrow mb-2">Simulation verdict: {simResult.passed ? 'PASS' : 'FAIL'}</p>
              <PolicyVerdict checks={simResult.checks} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
