'use client'

// Settings: organization & members, API keys, notifications, account security
// (MFA + wallet linking), integrations.

import { useCallback, useEffect, useState } from 'react'
import { api, ClientError, walletStatus, walletConnect, type WalletAdapter } from '@/lib/client'
import { useApp, navigate, type Route } from '@/components/proofloom-app'
import { ProofSeal, EmptyState, PanelSkeleton, HashChip, CopyButton } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Link2, ShieldCheck, KeyRound, BellRing, Copy } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Member {
  userId: string; email: string; displayName: string; gnoAddress?: string | null
  role: string; capabilities: string[]; joinedAt: string
}
interface Invitation { id: string; email: string; role: string; expiresAt: string }

export function SettingsView({ route }: { route: Route; go: (r: Route) => void; session: unknown; orgId: unknown }) {
  const tab = (route as { tab?: string }).tab ?? 'organization'
  const { session } = useApp()
  const org = session?.organizations?.find(o => o.id === orgId)
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>Settings</h1>
        {org && <p className="text-sm text-muted-foreground mt-1">{org.name} · your role: {org.role}</p>}
      </div>
      <Tabs defaultValue={tab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="apikeys">API credentials</TabsTrigger>
          <TabsTrigger value="account">Account security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>
        <TabsContent value="organization" className="mt-4"><OrgMembers /></TabsContent>
        <TabsContent value="apikeys" className="mt-4"><ApiKeys /></TabsContent>
        <TabsContent value="account" className="mt-4"><AccountSecurity /></TabsContent>
        <TabsContent value="notifications" className="mt-4"><Notifications /></TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Organization & members ──────────────────────────────────────────────────

function OrgMembers() {
  const { orgId, toast, refreshSession } = useApp()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('DEVELOPER')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await api.get<{ members: Member[]; invitations: Invitation[] }>(`/api/orgs/${orgId}/members`)
      setMembers(res.members)
      setInvitations(res.invitations)
      setCanManage(true)
    } catch (e) {
      setMembers([])
      if (e instanceof ClientError && e.apiError.code === 'FORBIDDEN') setCanManage(false)
    }
  }, [orgId])

  useEffect(() => { void load() }, [load])

  if (!members) return <PanelSkeleton rows={4} />

  return (
    <div className="space-y-4">
      <div className="loom-panel p-5">
        <p className="eyebrow mb-3">Invite a member</p>
        <form onSubmit={async (e) => {
          e.preventDefault()
          try {
            const res = await api.post<{ inviteUrl: string; email: string }>(`/api/orgs/${orgId}/members`, { email: inviteEmail, role: inviteRole })
            setInviteUrl(res.inviteUrl)
            setInviteEmail('')
            toast('success', 'Invitation created', `Share the invite link with ${res.email} — no email provider is configured, so the link is surfaced here.`)
            await load()
          } catch (e2) {
            toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed')
          }
        }} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[220px]">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="colleague@company.dev" />
          </div>
          <div className="w-[180px]">
            <Label htmlFor="inv-role">Role</Label>
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger id="inv-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['DEVELOPER', 'AUDITOR', 'AGENT_OPERATOR', 'ENGINEERING_LEAD', 'SECURITY_ADMIN', 'ADMIN'].map(r => <SelectItem key={r} value={r}>{r.replaceAll('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="btn-press"><Plus size={14} className="mr-1.5" /> Invite</Button>
        </form>
        {inviteUrl && (
          <div className="flex items-center gap-2 mt-3 p-3 loom-panel">
            <code className="font-mono-sm text-xs flex-1 break-all">{typeof window !== 'undefined' ? window.location.origin : ''}/#{inviteUrl}</code>
            <CopyButton text={`${typeof window !== 'undefined' ? window.location.origin : ''}/#${inviteUrl}`} />
          </div>
        )}
      </div>

      <div className="loom-panel divide-y divide-[var(--border)]">
        {members.map(m => (
          <div key={m.userId} className="flex items-center gap-3 p-4 flex-wrap">
            <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}>
              {m.displayName.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{m.displayName}</p>
              <p className="text-xs text-muted-foreground">{m.email}</p>
            </div>
            <ProofSeal status={m.role === 'OWNER' ? 'VERIFIED' : 'ACTIVE'} label={m.role.replaceAll('_', ' ').toLowerCase()} />
            {m.gnoAddress && <HashChip value={m.gnoAddress} display={`${m.gnoAddress.slice(0, 10)}…`} />}
            {m.role !== 'OWNER' && (
              <Button size="sm" variant="ghost" className="btn-press text-[var(--critical)]" onClick={async () => {
                try {
                  await api.del(`/api/orgs/${orgId}/members?userId=${m.userId}`)
                  toast('success', 'Member removed')
                  await load()
                  await refreshSession()
                } catch (e) { toast('error', e instanceof ClientError ? e.apiError.message : 'Failed') }
              }}><Trash2 size={13} /></Button>
            )}
          </div>
        ))}
      </div>

      {invitations.length > 0 && (
        <div className="loom-panel divide-y divide-[var(--border)]">
          <div className="p-4"><p className="eyebrow">Pending invitations</p></div>
          {invitations.map(inv => (
            <div key={inv.id} className="flex items-center gap-3 p-4 flex-wrap">
              <span className="text-sm">{inv.email}</span>
              <span className="eyebrow">{inv.role}</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="btn-press text-[var(--critical)]" onClick={async () => {
                try {
                  await api.del(`/api/orgs/${orgId}/members?invitationId=${inv.id}`)
                  await load()
                } catch (e) { toast('error', e instanceof ClientError ? e.apiError.message : 'Failed') }
              }}>Revoke</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── API keys ────────────────────────────────────────────────────────────────

function ApiKeys() {
  const { orgId, toast } = useApp()
  const [keys, setKeys] = useState<{ id: string; name: string; prefix: string; scopes: string; createdAt: string }[] | null>(null)
  const [name, setName] = useState('')
  const [freshKey, setFreshKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    try { setKeys(await api.get(`/api/keys?orgId=${orgId}`)) } catch { setKeys([]) }
  }, [orgId])
  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <form onSubmit={async (e) => {
        e.preventDefault()
        try {
          const res = await api.post<{ key: string; prefix: string }>('/api/keys', { orgId, name })
          setFreshKey(res.key)
          setName('')
          await load()
          toast('success', 'Credential created', 'Copy the key now — it is shown once.')
        } catch (e2) { toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed') }
      }} className="loom-panel p-4 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <Label htmlFor="key-name">Credential name</Label>
          <Input id="key-name" value={name} onChange={e => setName(e.target.value)} required placeholder="ci-pipeline" />
        </div>
        <Button type="submit" className="btn-press"><KeyRound size={14} className="mr-1.5" /> Create key</Button>
      </form>

      {freshKey && (
        <div className="loom-panel p-4 border-[color:var(--verified)]">
          <p className="text-sm font-medium mb-1">Copy your key now</p>
          <div className="flex items-center gap-2">
            <code className="font-mono-sm text-xs flex-1 break-all">{freshKey}</code>
            <CopyButton text={freshKey} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">Stored hashed (sha256). Use as <code className="font-mono-sm">Authorization: Bearer …</code></p>
        </div>
      )}

      {!keys ? <PanelSkeleton rows={2} /> : keys.length === 0 ? (
        <EmptyState title="No API credentials" hint="Create a key for CI pipelines and the verification API." />
      ) : (
        <div className="loom-panel divide-y divide-[var(--border)]">
          {keys.map(k => (
            <div key={k.id} className="flex items-center gap-3 p-4 flex-wrap">
              <span className="text-sm font-medium">{k.name}</span>
              <code className="font-mono-sm text-xs text-muted-foreground">{k.prefix}…</code>
              <span className="eyebrow">{k.scopes}</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="btn-press text-[var(--critical)]" onClick={async () => {
                try {
                  await api.del(`/api/keys?id=${k.id}`)
                  toast('success', 'Key revoked')
                  await load()
                } catch (e) { toast('error', e instanceof ClientError ? e.apiError.message : 'Failed') }
              }}><Trash2 size={13} /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Account security ────────────────────────────────────────────────────────

function AccountSecurity() {
  const { session, refreshSession, toast } = useApp()
  const [wallet, setWallet] = useState<WalletAdapter | null>(null)
  const [mfaSecret, setMfaSecret] = useState<{ secret: string; otpauth: string } | null>(null)
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)

  const loadWallet = useCallback(() => { void walletStatus().then(setWallet) }, [])
  useEffect(() => { loadWallet() }, [loadWallet])

  const user = session?.user

  return (
    <div className="space-y-4">
      {/* Wallet */}
      <div className="loom-panel p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2"><Link2 size={14} /> Gno wallet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Signing stays in your wallet (Adena). PROOFLOOM never receives a mnemonic or private key.
            </p>
          </div>
          {user?.gnoAddress ? <ProofSeal status="VERIFIED" label="linked" /> : <ProofSeal status="PENDING" label="not linked" />}
        </div>
        {user?.gnoAddress && (
          <div className="flex items-center gap-2">
            <HashChip value={user.gnoAddress} display={user.gnoAddress} />
            <CopyButton text={user.gnoAddress} />
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="btn-press" onClick={async () => {
            try {
              const w = await walletConnect()
              const sig = await (await import('@/lib/client')).walletSignMessage(`proofloom-link:${user?.id ?? ''}`, w.chainId ?? 'onyx-1').catch(() => null)
              await api.post('/api/auth/wallet-link', {
                address: w.address, provider: w.name.toLowerCase(), chainId: w.chainId ?? 'onyx-1', signature: sig ?? undefined,
              })
              await refreshSession()
              toast('success', 'Wallet linked', sig ? 'Signature verified.' : 'Linked without signature (Adena did not return one) — recorded as unverified.')
              loadWallet()
            } catch (e) {
              toast('error', e instanceof Error ? e.message : 'Wallet link failed')
            }
          }}>
            {user?.gnoAddress ? 'Re-link wallet' : 'Link Adena wallet'}
          </Button>
          {wallet && !wallet.available && (
            <span className="text-xs text-muted-foreground self-center">Adena extension not detected in this browser.</span>
          )}
        </div>
        {wallet?.chainId && wallet.chainId !== 'onyx-1' && (
          <p className="text-sm text-[var(--warning)]">Wallet reports chain {wallet.chainId}; the platform targets onyx-1. Switch networks in Adena before signing.</p>
        )}
      </div>

      {/* MFA */}
      <div className="loom-panel p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2"><ShieldCheck size={14} /> Multi-factor authentication</p>
            <p className="text-xs text-muted-foreground mt-1">TOTP (RFC 6238). Required at login once enabled.</p>
          </div>
          <ProofSeal status={user?.mfaEnabled ? 'VERIFIED' : 'PENDING'} label={user?.mfaEnabled ? 'enabled' : 'disabled'} />
        </div>
        {!user?.mfaEnabled && !mfaSecret && (
          <Button size="sm" variant="outline" className="btn-press" onClick={async () => {
            try { setMfaSecret(await api.post('/api/auth/mfa-setup')) } catch (e) { toast('error', e instanceof ClientError ? e.apiError.message : 'Failed') }
          }}>Set up authenticator</Button>
        )}
        {mfaSecret && (
          <div className="space-y-2">
            <p className="text-sm">Add this secret to your authenticator:</p>
            <div className="flex items-center gap-2">
              <code className="font-mono-sm p-2 rounded border border-[var(--border)] break-all">{mfaSecret.secret}</code>
              <CopyButton text={mfaSecret.secret} />
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await api.post('/api/auth/mfa-enable', { totp })
                await refreshSession()
                setMfaSecret(null)
                setTotp('')
                toast('success', 'MFA enabled')
              } catch (e2) { toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Invalid code') }
              finally { setBusy(false) }
            }} className="flex gap-2 items-end">
              <div className="w-[140px]">
                <Label htmlFor="totp-confirm">Confirm 6-digit code</Label>
                <Input id="totp-confirm" inputMode="numeric" maxLength={6} value={totp} onChange={e => setTotp(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
              </div>
              <Button type="submit" size="sm" disabled={busy || totp.length !== 6} className="btn-press">Enable</Button>
            </form>
          </div>
        )}
        {user?.mfaEnabled && (
          <form onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await api.post('/api/auth/mfa-disable', { totp, currentPassword: (document.getElementById('mfa-disable-pw') as HTMLInputElement)?.value })
              await refreshSession()
              toast('success', 'MFA disabled')
            } catch (e2) { toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed') }
            finally { setBusy(false) }
          }} className="flex flex-wrap gap-2 items-end">
            <div className="w-[140px]">
              <Label htmlFor="mfa-disable-totp">Current code</Label>
              <Input id="mfa-disable-totp" inputMode="numeric" maxLength={6} value={totp} onChange={e => setTotp(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="w-[180px]">
              <Label htmlFor="mfa-disable-pw">Password</Label>
              <Input id="mfa-disable-pw" type="password" autoComplete="current-password" />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={busy} className="btn-press text-[var(--critical)]">Disable MFA</Button>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── Notifications ───────────────────────────────────────────────────────────

function Notifications() {
  const { toast } = useApp()
  const [items, setItems] = useState<{ id: string; title: string; body: string; kind: string; readAt: string | null; createdAt: string }[] | null>(null)

  const load = useCallback(async () => {
    try { setItems((await api.get<{ notifications: typeof items }>('/api/notifications')).notifications ?? []) } catch { setItems([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><BellRing size={14} /> Notifications</p>
        <Button size="sm" variant="outline" className="btn-press" onClick={async () => {
          await api.patch('/api/notifications', { all: true })
          await load()
        }}>Mark all read</Button>
      </div>
      {!items ? <PanelSkeleton rows={3} /> : items.length === 0 ? (
        <EmptyState title="No notifications" hint="Approvals, revocations and integration events land here." />
      ) : (
        <div className="loom-panel divide-y divide-[var(--border)]">
          {items.map(n => (
            <div key={n.id} className="p-4 flex items-start gap-3">
              <span className="status-dot mt-1.5" style={{ background: n.readAt ? 'var(--border-strong)' : 'var(--accent)' }} />
              <div className="flex-1">
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
              </div>
              <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
