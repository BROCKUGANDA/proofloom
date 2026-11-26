'use client'

// Agent Command: registry, scoped grants, execution console with approvals.

import { useCallback, useEffect, useState } from 'react'
import { api, ClientError } from '@/lib/client'
import { useApp, navigate, type Route } from '@/components/proofloom-app'
import { ProofSeal, EmptyState, PanelSkeleton, HashChip, AgentSigil, TrustMeter, Spinner } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Play, ShieldCheck, Check, X, RefreshCw, Ban } from 'lucide-react'

interface AgentRow {
  id: string; slug: string; name: string; description: string; ownerAddress: string
  runtime: string; modelProvider: string; modelId: string; capabilities: string
  version: string; status: string; onChain: boolean; executionCount: number
  project?: { id: string; name: string } | null
  grants: { id: string; projectId: string; scopes: string; active: boolean; expiresAt?: string | null }[]
  executions: { id: string; status: string; startedAt: string; reportDigest?: string | null }[]
}
interface AgentsPayload {
  providers: { provider: string; available: boolean; model: string }[]
  agents: AgentRow[]
}
interface OrgProjects { id: string; name: string; slug: string }[]

const SCOPES = ['READ', 'EVIDENCE', 'VERIFY_REQUEST', 'TASK_UPDATE', 'REVIEW_PROPOSE', 'PUBLISH_REQUEST']

export function AgentsView(_props: unknown) {
  const { orgId, toast } = useApp()
  const [data, setData] = useState<AgentsPayload | null>(null)
  const [projects, setProjects] = useState<OrgProjects>([])
  const [executions, setExecutions] = useState<ExecutionRow[] | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const payload = await api.get<AgentsPayload>(`/api/agents?orgId=${orgId}`)
      setData(payload)
      // gather execution ids across agents for the console
      const ids = payload.agents.flatMap(a => a.executions.map(e => ({ agent: a, exec: e })))
      setExecutions(ids.map(x => ({ ...x.exec, agentName: x.agent.name, agentId: x.agent.id })) as ExecutionRow[])
    } catch (e) {
      if (e instanceof ClientError) toast('error', e.apiError.message, e.apiError.recovery)
      setData({ providers: [], agents: [] })
      setExecutions([])
    }
  }, [orgId, toast])

  const loadProjects = useCallback(async () => {
    if (!orgId) return
    try {
      setProjects(await api.get<OrgProjects>(`/api/projects?orgId=${orgId}`))
    } catch { setProjects([]) }
  }, [orgId])

  useEffect(() => { void load(); void loadProjects() }, [load, loadProjects])

  if (!data) return <div className="space-y-3"><PanelSkeleton rows={4} /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>Agent Command</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Registry, least-privilege grants, and the execution console. Agents never publish without a human approval.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} className="btn-press" aria-label="Refresh">
            <RefreshCw size={14} />
          </Button>
          <RegisterAgentDialog projects={projects} onRegistered={async () => { await load() }} />
        </div>
      </div>

      {/* Provider health */}
      <div className="loom-panel p-4 flex items-center gap-3 flex-wrap">
        <span className="eyebrow">LLM providers</span>
        {data.providers.map(p => (
          <ProofSeal key={p.provider} status={p.available ? 'ACTIVE' : 'EXPIRED'} label={`${p.provider} · ${p.model}`} />
        ))}
        {data.providers.length === 0 && <span className="text-xs text-muted-foreground">No providers configured — executions will report LLM_PROVIDER_UNAVAILABLE; manual workflows remain available.</span>}
      </div>

      {/* Registry */}
      {data.agents.length === 0 ? (
        <EmptyState
          title="No agents registered"
          hint="Register an agent, grant it scoped permissions on a project (READ, EVIDENCE, TASK_UPDATE…), then assign it a task. Every execution produces a digest-bound report."
          action={<RegisterAgentDialog projects={projects} onRegistered={async () => { await load() }} />}
        />
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {data.agents.map(a => (
            <AgentCard key={a.id} agent={a} onReload={load} />
          ))}
        </div>
      )}

      {/* Execution console */}
      <div className="space-y-3">
        <p className="eyebrow">Execution console</p>
        {!executions || executions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No executions recorded yet. Start one from an agent card.</p>
        ) : (
          <div className="space-y-2">
            {executions.map(e => <ExecutionRowCard key={e.id} execution={e} onReload={load} />)}
          </div>
        )}
      </div>
    </div>
  )
}

interface ExecutionRow {
  id: string; status: string; startedAt: string; reportDigest?: string | null
  agentName?: string; agentId?: string; taskId?: string | null
}

function AgentCard({ agent, onReload }: { agent: AgentRow; onReload: () => Promise<void> }) {
  const { toast } = useApp()
  const [grantOpen, setGrantOpen] = useState(false)

  const setStatus = async (status: string) => {
    try {
      await api.post('/api/agents', { op: 'set-status', agentId: agent.id, status })
      toast('success', `Agent ${status.toLowerCase()}`)
      await onReload()
    } catch (e) {
      toast('error', e instanceof ClientError ? e.apiError.message : 'Failed')
    }
  }

  const execute = async () => {
    try {
      const res = await api.post<{ executionId: string; status: string }>('/api/agents', { op: 'execute', agentId: agent.id })
      toast('info', 'Execution started', `receipt ${res.executionId.slice(0, 12)}… — the run streams into the console below`)
      await onReload()
    } catch (e) {
      toast('error', e instanceof ClientError ? `${e.apiError.message}` : 'Failed to start', e instanceof ClientError ? e.apiError.recovery : undefined)
    }
  }

  return (
    <div className="loom-panel p-4">
      <div className="flex items-start gap-3">
        <AgentSigil name={agent.name} active={agent.status === 'ACTIVE'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{agent.name}</p>
            <ProofSeal status={agent.status} />
            <span className="font-mono-sm text-muted-foreground">v{agent.version}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{agent.description || 'No description'}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
            <HashChip value={agent.ownerAddress || 'unlinked'} display={`owner ${agent.ownerAddress ? agent.ownerAddress.slice(0, 10) + '…' + agent.ownerAddress.slice(-6) : 'unlinked'}`} />
            {agent.modelProvider && <span className="text-muted-foreground">model: {agent.modelProvider}{agent.modelId ? `/${agent.modelId}` : ''}</span>}
            {agent.project && <span className="text-muted-foreground">project: {agent.project.name}</span>}
          </div>
        </div>
      </div>

      {/* Grants */}
      <div className="mt-3 space-y-1.5">
        {agent.grants.length === 0 ? (
          <p className="text-xs text-muted-foreground">No grants — this agent cannot touch any project.</p>
        ) : agent.grants.map(g => (
          <div key={g.id} className="flex items-center gap-2 text-xs flex-wrap">
            <span className={`proof-seal ${g.active ? 'seal-info' : 'seal-unknown'}`}>{g.active ? 'grant active' : 'grant revoked/expired'}</span>
            <span className="font-mono-sm text-muted-foreground">{g.scopes}</span>
            {g.expiresAt && <span className="text-muted-foreground">expires {new Date(g.expiresAt).toLocaleDateString()}</span>}
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-3 flex-wrap">
        <GrantDialog agent={agent} open={grantOpen} setOpen={setGrantOpen} onGranted={onReload} />
        <Button size="sm" className="btn-press" disabled={agent.status !== 'ACTIVE'} onClick={() => void execute()}>
          <Play size={13} className="mr-1.5" /> Execute
        </Button>
        {agent.status === 'ACTIVE' && (
          <Button size="sm" variant="outline" className="btn-press" onClick={() => void setStatus('SUSPENDED')}>
            <Ban size={13} className="mr-1.5" /> Suspend
          </Button>
        )}
        {agent.status === 'SUSPENDED' && (
          <Button size="sm" variant="outline" className="btn-press" onClick={() => void setStatus('ACTIVE')}>Resume</Button>
        )}
        {agent.status !== 'REVOKED' && (
          <Button size="sm" variant="ghost" className="btn-press text-[var(--critical)]" onClick={() => void setStatus('REVOKED')}>
            Revoke
          </Button>
        )}
      </div>
    </div>
  )
}

function GrantDialog({ agent, open, setOpen, onGranted }: { agent: AgentRow; open: boolean; setOpen: (v: boolean) => void; onGranted: () => Promise<void> }) {
  const { toast } = useApp()
  const [scopes, setScopes] = useState<string[]>(['READ'])
  const [projectId, setProjectId] = useState<string>('')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="btn-press"><ShieldCheck size={13} className="mr-1.5" /> Grant</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Grant permissions — {agent.name}</DialogTitle>
          <DialogDescription>Least privilege: pick exactly what this agent may do on one project.</DialogDescription>
        </DialogHeader>
        <GrantForm agentId={agent.id} scopes={scopes} setScopes={setScopes} projectId={projectId} setProjectId={setProjectId}
          onDone={async () => { setOpen(false); await onGranted() }} />
      </DialogContent>
    </Dialog>
  )
}

function GrantForm({ agentId, scopes, setScopes, projectId, setProjectId, onDone }: {
  agentId: string; scopes: string[]; setScopes: (s: string[]) => void
  projectId: string; setProjectId: (s: string) => void; onDone: () => Promise<void>
}) {
  const { orgId, toast } = useApp()
  const [projects, setProjects] = useState<OrgProjects>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!orgId) return
    api.get<OrgProjects>(`/api/projects?orgId=${orgId}`).then(setProjects).catch(() => setProjects([]))
  }, [orgId])

  return (
    <form onSubmit={async (e) => {
      e.preventDefault()
      setBusy(true)
      try {
        await api.post('/api/agents', { op: 'grant', agentId, projectId, scopes })
        toast('success', 'Grant issued', `${scopes.join(', ')} on project`)
        await onDone()
      } catch (e2) {
        toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed')
      } finally { setBusy(false) }
    }} className="space-y-4">
      <div>
        <Label htmlFor="g-project">Project</Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger id="g-project"><SelectValue placeholder="Choose a project" /></SelectTrigger>
          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label>Scopes</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {SCOPES.map(s => {
            const on = scopes.includes(s)
            return (
              <button key={s} type="button" aria-pressed={on}
                onClick={() => setScopes(on ? scopes.filter(x => x !== s) : [...scopes, s])}
                className={`proof-seal ${on ? 'seal-verified' : 'seal-unknown'}`}>
                {s}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          PUBLISH_REQUEST only lets an agent request publication — a human still approves every on-chain action.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost">Cancel</Button>
        <Button type="submit" disabled={busy || !projectId || scopes.length === 0} className="btn-press">
          {busy ? 'Granting…' : 'Issue grant'}
        </Button>
      </div>
    </form>
  )
}

function RegisterAgentDialog({ projects, onRegistered }: { projects: OrgProjects; onRegistered: () => Promise<void> }) {
  const { toast, session, orgId } = useApp()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [modelProvider, setModelProvider] = useState('zai')
  const [capabilities, setCapabilities] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" className="btn-press"><Plus size={14} className="mr-1.5" /> Register agent</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register agent</DialogTitle>
          <DialogDescription>Agents are identities. The runtime executes off-chain; the chain records identity, grants and receipts.</DialogDescription>
        </DialogHeader>
        <form onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const created = await api.post<{ id: string; slug: string }>('/api/agents', {
              op: 'register',
              organizationId: (window as unknown as { __plOrgId?: string }).__plOrgId,
              name, description, modelProvider,
              capabilities: capabilities.split(',').map(s => s.trim()).filter(Boolean),
              ownerAddress: session?.user?.gnoAddress ?? undefined,
            })
            toast('success', 'Agent registered', created.slug)
            setOpen(false)
            await onRegistered()
          } catch (e2) {
            toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed')
          } finally { setBusy(false) }
        }} className="space-y-4">
          <div>
            <Label htmlFor="ag-name">Name</Label>
            <Input id="ag-name" value={name} onChange={e => setName(e.target.value)} required minLength={2} placeholder="Dep-Auditor" />
          </div>
          <div>
            <Label htmlFor="ag-desc">Description</Label>
            <Input id="ag-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Audits dependency manifests for known risks" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ag-provider">Model provider</Label>
              <Select value={modelProvider} onValueChange={setModelProvider}>
                <SelectTrigger id="ag-provider"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="zai">zai (managed)</SelectItem>
                  <SelectItem value="custom">custom (operator)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ag-caps">Capabilities</Label>
              <Input id="ag-caps" value={capabilities} onChange={e => setCapabilities(e.target.value)} placeholder="dependency-audit, sbom-check" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} className="btn-press">{busy ? 'Registering…' : 'Register'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ExecutionRowCard({ execution, onReload }: { execution: ExecutionRow; onReload: () => Promise<void> }) {
  const { toast } = useApp()
  const [detail, setDetail] = useState<ExecutionDetail | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadDetail = useCallback(async () => {
    try {
      setDetail(await api.get<ExecutionDetail>(`/api/executions/${execution.id}`))
    } catch { setDetail(null) }
  }, [execution.id])
  useEffect(() => { if (expanded) void loadDetail() }, [expanded, loadDetail])

  const report = detail?.report ? (typeof detail.report === 'string' ? JSON.parse(detail.report) : detail.report) : null

  return (
    <div className="loom-panel p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setExpanded(!expanded)} className="font-mono-sm text-muted-foreground hover:text-foreground" aria-expanded={expanded}>
          {execution.id.slice(0, 14)}…
        </button>
        <ProofSeal status={execution.status} />
        <span className="text-xs text-muted-foreground">{execution.agentName}</span>
        {execution.taskId && <span className="text-xs text-muted-foreground">task {execution.taskId.slice(0, 8)}…</span>}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">{new Date(execution.startedAt).toLocaleTimeString()}</span>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {!detail ? <Spinner label="loading receipt" /> : (
            <>
              {report && (
                <div className="space-y-2">
                  <p className="text-sm">{report.summary}</p>
                  {report.findings?.map((f: { severity: string; title: string; detail: string }, i: number) => (
                    <div key={i} className="flex gap-2 text-sm">
                      <ProofSeal status={f.severity === 'critical' ? 'REJECTED' : f.severity === 'warning' ? 'PENDING' : 'ACTIVE'} label={f.severity} />
                      <div><p className="font-medium">{f.title}</p><p className="text-xs text-muted-foreground">{f.detail}</p></div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">conclusion: <span className="font-mono-sm">{report.conclusion}</span></p>
                </div>
              )}
              {detail.reportDigest && (
                <div className="flex items-center gap-2">
                  <HashChip value={detail.reportDigest} display={`report sha256 ${detail.reportDigest.slice(0, 14)}…`} />
                </div>
              )}
              {detail.error && <p className="text-xs text-[var(--critical)]">{detail.error}</p>}
              {detail.status === 'RUNNING' && <Spinner label="agent executing" />}

              {detail.status === 'AWAITING_APPROVAL' && (
                <div className="flex gap-2">
                  <Button size="sm" className="btn-press" disabled={busy} onClick={async () => {
                    setBusy(true)
                    try {
                      await api.post(`/api/executions/${execution.id}`, { op: 'approve' })
                      toast('success', 'Execution approved')
                      await onReload()
                    } catch (e) { toast('error', e instanceof ClientError ? e.apiError.message : 'Failed') }
                    finally { setBusy(false) }
                  }}><Check size={13} className="mr-1.5" /> Approve</Button>
                  <Button size="sm" variant="outline" className="btn-press text-[var(--critical)]" disabled={busy} onClick={async () => {
                    setBusy(true)
                    try {
                      await api.post(`/api/executions/${execution.id}`, { op: 'reject', comment: 'Rejected by reviewer' })
                      toast('success', 'Execution rejected')
                      await onReload()
                    } catch (e) { toast('error', e instanceof ClientError ? e.apiError.message : 'Failed') }
                    finally { setBusy(false) }
                  }}><X size={13} className="mr-1.5" /> Reject</Button>
                </div>
              )}

              {detail.status === 'COMPLETED' && !detail.attested && (
                <Button size="sm" variant="outline" className="btn-press" disabled={busy} onClick={async () => {
                  setBusy(true)
                  try {
                    const res = await api.post<{ protocolId: string }>('/api/executions/' + execution.id, { op: 'attest' })
                    toast('success', 'Execution attested', res.protocolId)
                    await onReload()
                  } catch (e) { toast('error', e instanceof ClientError ? `${e.apiError.message} — ${e.apiError.recovery}` : 'Failed') }
                  finally { setBusy(false) }
                }}>
                  <ShieldCheck size={13} className="mr-1.5" /> Attest completion
                </Button>
              )}
              {detail.attested && (
                <div className="flex items-center gap-2">
                  <ProofSeal status="ACTIVE" label="attested" />
                  {detail.attestationDigest && <HashChip value={detail.attestationDigest} display={`digest ${detail.attestationDigest.slice(0, 12)}…`} />}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface ExecutionDetail {
  id: string; status: string; report?: string | null; reportDigest?: string | null
  error?: string | null; tokensUsed: number; attested?: boolean; attestationDigest?: string | null
}
