'use client'

// PROOFLOOM application shell: hash-based routing across all product
// surfaces, session state, organization switching, theme, and the command
// surface. One route (`/`) serves every surface; navigation is internal so
// the preview gateway can serve the entire product.

import { useEffect, useState, useCallback, createContext, useContext } from 'react'
import { api, ClientError } from '@/lib/client'
import { Wordmark, Emblem } from '@/components/atelier/emblem'
import { ProofSeal } from '@/components/atelier/kit'
import { LandingView } from '@/components/views/landing'
import { AuthView } from '@/components/views/auth'
import { WorkspaceView } from '@/components/views/workspace'
import { ProjectView } from '@/components/views/project'
import { ReleaseView } from '@/components/views/release'
import { AgentsView } from '@/components/views/agents'
import { VerifyPortalView } from '@/components/views/verify-portal'
import { ExplorerView } from '@/components/views/explorer'
import { AtlasView } from '@/components/views/atlas'
import { AnalyticsView } from '@/components/views/analytics'
import { AuditView } from '@/components/views/audit'
import { SettingsView } from '@/components/views/settings'
import { StatusView } from '@/components/views/status'
import { DocsView } from '@/components/views/docs'
import { BillingView } from '@/components/views/billing'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sun, Moon, ChevronDown, LayoutDashboard, Boxes, Radar, Landmark, ScrollText, Settings, Activity, BookOpen, ShieldCheck, FileSearch, Network, LogIn, Bell, Menu, CreditCard, Zap } from 'lucide-react'

// ─── Router ──────────────────────────────────────────────────────────────────

export type Route =
  | { view: 'landing' } | { view: 'auth' }
  | { view: 'workspace' } | { view: 'project'; projectId: string; tab?: string }
  | { view: 'release'; releaseId: string }
  | { view: 'agents' } | { view: 'verify'; query?: string }
  | { view: 'explore'; query?: string } | { view: 'atlas' }
  | { view: 'analytics' } | { view: 'audit' }
  | { view: 'settings'; tab?: string }
  | { view: 'status' } | { view: 'docs'; section?: string }
  | { view: 'billing' }

function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  const [head, a, b] = h.split('/')
  switch (head) {
    case 'auth': return { view: 'auth' }
    case 'workspace': return { view: 'workspace' }
    case 'project': return { view: 'project', projectId: a ?? '', tab: b }
    case 'release': return { view: 'release', releaseId: a ?? '' }
    case 'agents': return { view: 'agents' }
    case 'verify': return { view: 'verify', query: a ? decodeURIComponent(a) : undefined }
    case 'explore': return { view: 'explore', query: a ? decodeURIComponent(a) : undefined }
    case 'atlas': return { view: 'atlas' }
    case 'analytics': return { view: 'analytics' }
    case 'audit': return { view: 'audit' }
    case 'settings': return { view: 'settings', tab: a }
    case 'status': return { view: 'status' }
    case 'billing': return { view: 'billing' }
    case 'docs': return { view: 'docs', section: a }
    default: return { view: 'landing' }
  }
}

export function navigate(route: Route) {
  const parts: string[] = []
  switch (route.view) {
    case 'auth': parts.push('auth'); break
    case 'workspace': parts.push('workspace'); break
    case 'project': parts.push('project', route.projectId, route.tab ?? 'overview'); break
    case 'release': parts.push('release', route.releaseId); break
    case 'agents': parts.push('agents'); break
    case 'verify': parts.push('verify', route.query ? encodeURIComponent(route.query) : ''); break
    case 'explore': parts.push('explore', route.query ? encodeURIComponent(route.query) : ''); break
    case 'atlas': parts.push('atlas'); break
    case 'analytics': parts.push('analytics'); break
    case 'audit': parts.push('audit'); break
    case 'settings': parts.push('settings', route.tab ?? 'organization'); break
    case 'status': parts.push('status'); break
    case 'billing': parts.push('billing'); break
    case 'docs': parts.push('docs', route.section ?? ''); break
    default: break
  }
  window.location.hash = '#/' + parts.filter(Boolean).join('/')
}

// ─── App context ─────────────────────────────────────────────────────────────

export interface SessionUser {
  id: string; email: string; displayName: string
  gnoAddress?: string | null; mfaEnabled: boolean; avatarSeed: string
}
export interface SessionOrgBilling {
  planId: string
  status: string
  trialEndsAt?: string
  daysLeftInTrial?: number
  trialExpired?: boolean
}
export interface SessionOrg {
  id: string; slug: string; name: string; role: string
  capabilities: string[]; projects: number; members: number
  billing?: SessionOrgBilling
}
export interface Session {
  authenticated: boolean
  user?: SessionUser
  organizations?: SessionOrg[]
  unreadNotifications?: number
  chain: { chainId: string; label: string; rpc: string; realmPrefix: string }
}

interface AppCtx {
  session: Session | null
  refreshSession: () => Promise<void>
  orgId: string | null
  setOrgId: (id: string) => void
  theme: 'dark' | 'light'
  toggleTheme: () => void
  toast: (kind: 'success' | 'error' | 'info', title: string, detail?: string) => void
  reduceMotion: boolean
  setReduceMotion: (v: boolean) => void
}
const Ctx = createContext<AppCtx>(null!)
export const useApp = () => useContext(Ctx)

// ─── Toasts ──────────────────────────────────────────────────────────────────

interface Toast { id: number; kind: 'success' | 'error' | 'info'; title: string; detail?: string }

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2 max-w-sm" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`loom-panel-raised p-3.5 shadow-lg cursor-pointer ${t.kind === 'error' ? 'border-[color:var(--critical)]' : ''}`}
          onClick={() => dismiss(t.id)}
          role="alert"
        >
          <div className="flex items-center gap-2">
            <span className="status-dot" style={{ background: t.kind === 'success' ? 'var(--verified)' : t.kind === 'error' ? 'var(--critical)' : 'var(--accent-info)' }} />
            <p className="text-sm font-medium">{t.title}</p>
          </div>
          {t.detail && <p className="text-xs text-muted-foreground mt-1">{t.detail}</p>}
        </div>
      ))}
    </div>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

const NAV = [
  { view: 'workspace', label: 'Workspace', icon: LayoutDashboard, auth: true },
  { view: 'agents', label: 'Agent Command', icon: Boxes, auth: true },
  { view: 'analytics', label: 'Analytics', icon: Activity, auth: true },
  { view: 'audit', label: 'Audit Explorer', icon: ScrollText, auth: true },
  { view: 'billing', label: 'Plan & Billing', icon: CreditCard, auth: true },
  { view: 'atlas', label: 'Proof Atlas', icon: Network, auth: false },
  { view: 'explore', label: 'Explorers', icon: Radar, auth: false },
  { view: 'verify', label: 'Verification Portal', icon: FileSearch, auth: false },
  { view: 'docs', label: 'Documentation', icon: BookOpen, auth: false },
  { view: 'status', label: 'Service Status', icon: Activity, auth: false },
]

export function ProofloomApp() {
  const [route, setRoute] = useState<Route>(() => parseHash(typeof window !== 'undefined' ? window.location.hash : ''))
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [orgId, setOrgIdState] = useState<string | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [reduceMotion, setReduceMotion] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const refreshSession = useCallback(async () => {
    try {
      const s = await api.get<Session>('/api/session')
      setSession(s)
      if (s.organizations?.length) {
        setOrgIdState(prev => prev && s.organizations!.some(o => o.id === prev) ? prev : s.organizations![0].id)
      } else {
        setOrgIdState(null)
      }
    } catch {
      setSession({ authenticated: false, chain: { chainId: 'onyx-1', label: 'Gno.land Onyx Testnet', rpc: '', realmPrefix: '' } })
    } finally {
      setSessionLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refreshSession()
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(media.matches)
    return () => window.removeEventListener('hashchange', onHash)
  }, [refreshSession])

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
  }, [theme, reduceMotion])

  const toast = useCallback((kind: Toast['kind'], title: string, detail?: string) => {
    const id = Date.now() + Math.random()
    setToasts(ts => [...ts.slice(-4), { id, kind, title, detail }])
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), kind === 'error' ? 7000 : 3800)
  }, [])

  const setOrgId = useCallback((id: string) => setOrgIdState(id), [])
  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])

  const go = useCallback((r: Route) => {
    navigate(r)
    setSidebarOpen(false)
  }, [])

  const ctx: AppCtx = { session, refreshSession, orgId, setOrgId, theme, toggleTheme, toast, reduceMotion, setReduceMotion }

  const activeOrg = session?.organizations?.find(o => o.id === orgId)
  const authed = !!session?.authenticated

  const viewProps = { route, go, session, orgId }

  return (
    <Ctx.Provider value={ctx}>
      <div className="min-h-screen flex flex-col">
        <a href="#main" className="sr-only">Skip to content</a>
        <Header
          route={route} go={go} session={session} authed={authed}
          theme={theme} toggleTheme={toggleTheme}
          activeOrg={activeOrg} orgId={orgId} setOrgId={setOrgId}
          sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        />
        <main id="main" className="flex-1">
          {!sessionLoaded ? (
            <div className="min-h-[60vh] flex items-center justify-center"><ProofSeal status="PENDING" label="connecting" pulse /></div>
          ) : (
            <>
              {(route.view === 'workspace' || route.view === 'analytics' || route.view === 'audit' || route.view === 'settings' || route.view === 'billing') && authed && activeOrg ? (
                <ShellLayout nav={NAV} route={route} go={go} authed={authed} org={activeOrg}>
                  {route.view === 'workspace' && <WorkspaceView {...viewProps} />}
                  {route.view === 'analytics' && <AnalyticsView {...viewProps} />}
                  {route.view === 'audit' && <AuditView {...viewProps} />}
                  {route.view === 'settings' && <SettingsView {...viewProps} />}
                  {route.view === 'billing' && <BillingView />}
                </ShellLayout>
              ) : (
                <>
                  {route.view === 'landing' && <LandingView {...viewProps} />}
                  {route.view === 'auth' && <AuthView {...viewProps} />}
                  {route.view === 'project' && <ProjectView {...viewProps} />}
                  {route.view === 'release' && <ReleaseView {...viewProps} />}
                  {route.view === 'agents' && <AgentsView {...viewProps} />}
                  {route.view === 'verify' && <VerifyPortalView {...viewProps} />}
                  {route.view === 'explore' && <ExplorerView {...viewProps} />}
                  {route.view === 'atlas' && <AtlasView {...viewProps} />}
                  {route.view === 'status' && <StatusView {...viewProps} />}
                  {route.view === 'docs' && <DocsView {...viewProps} />}
                  {(route.view === 'workspace' || route.view === 'analytics' || route.view === 'audit' || route.view === 'settings' || route.view === 'billing') && !authed && <AuthView {...viewProps} />}
                </>
              )}
            </>
          )}
        </main>
        <Footer go={go} />
        <ToastStack toasts={toasts} dismiss={id => setToasts(ts => ts.filter(t => t.id !== id))} />
      </div>
    </Ctx.Provider>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({ route, go, session, authed, theme, toggleTheme, activeOrg, orgId, setOrgId, sidebarOpen, setSidebarOpen }: {
  route: Route; go: (r: Route) => void; session: Session | null; authed: boolean
  theme: 'dark' | 'light'; toggleTheme: () => void
  activeOrg?: SessionOrg; orgId: string | null; setOrgId: (id: string) => void
  sidebarOpen: boolean; setSidebarOpen: (v: boolean) => void
}) {
  const showOrgSwitcher = authed && route.view !== 'landing' && route.view !== 'auth'
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--background)_86%,transparent)] backdrop-blur-md">
      <div className="mx-auto max-w-[1400px] px-4 lg:px-6 h-[var(--header-h)] flex items-center gap-4">
        <button className="lg:hidden p-1 -ml-1 text-muted-foreground hover:text-foreground" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation" aria-expanded={sidebarOpen}>
          <Menu size={22} />
        </button>
        <button onClick={() => go({ view: 'landing' })} className="flex items-center" aria-label="PROOFLOOM home">
          <Wordmark size={13} />
        </button>

        <nav className="hidden lg:flex items-center gap-1 ml-6" aria-label="Primary">
          {NAV.filter(n => !n.auth || authed).map(n => (
            <button
              key={n.view}
              onClick={() => go({ view: n.view } as Route)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                route.view === n.view ? 'text-foreground bg-[var(--surface-raised)]' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        {showOrgSwitcher && session?.organizations && session.organizations.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 btn-press max-w-[220px]">
                <span className="status-dot" style={{ background: 'var(--accent)' }} />
                <span className="truncate">{activeOrg?.name}</span>
                <ChevronDown size={13} className="shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              {session.organizations.map(o => (
                <DropdownMenuItem key={o.id} onClick={() => setOrgId(o.id)} className={o.id === orgId ? 'bg-[var(--surface-raised)]' : ''}>
                  <div className="flex flex-col">
                    <span className="text-sm">{o.name}</span>
                    <span className="text-xs text-muted-foreground">{o.role} · {o.projects} projects</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {authed && (session?.unreadNotifications ?? 0) > 0 && (
          <button className="relative p-2 text-muted-foreground hover:text-foreground" aria-label={`${session?.unreadNotifications} unread notifications`} onClick={() => go({ view: 'settings', tab: 'notifications' })}>
            <Bell size={16} />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
          </button>
        )}

        <button onClick={toggleTheme} className="p-2 text-muted-foreground hover:text-foreground" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {authed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2" aria-label="Account menu">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}
                >
                  {session?.user?.displayName.slice(0, 2).toUpperCase()}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>{session?.user?.displayName}</span>
                  <span className="text-xs text-muted-foreground font-normal">{session?.user?.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => go({ view: 'settings', tab: 'account' })}>Account security</DropdownMenuItem>
              <DropdownMenuItem onClick={() => go({ view: 'settings', tab: 'organization' })}>Organization</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => { await api.post('/api/auth/logout'); window.location.hash = '#/'; window.location.reload() }}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => go({ view: 'auth' })} className="btn-press">
              <LogIn size={14} className="mr-1" /> Sign in
            </Button>
            <Button size="sm" onClick={() => go({ view: 'auth' })} className="btn-press">Get started</Button>
          </div>
        )}
      </div>
      <TrialBanner billing={activeOrg?.billing} go={go} />
    </header>
  )
}

// ─── Trial / plan banner ─────────────────────────────────────────────────────

function TrialBanner({ billing, go }: { billing?: SessionOrgBilling; go: (r: Route) => void }) {
  if (!billing) return null
  const trialing = billing.status === 'TRIALING' && billing.daysLeftInTrial !== undefined
  const expired = billing.trialExpired || billing.status === 'EXPIRED'
  if (!trialing && !expired) return null
  return (
    <div
      className="border-t border-[var(--border)] bg-[color-mix(in_oklab,var(--accent-warm)_10%,var(--background))] text-xs"
      role="status"
    >
      <div className="mx-auto max-w-[1400px] px-4 lg:px-6 h-9 flex items-center gap-2">
        {trialing ? (
          <>
            <Zap size={13} className="text-[var(--accent-warm)] shrink-0" />
            <span className="truncate">
              <strong>Pro trial:</strong> {billing.daysLeftInTrial} day{billing.daysLeftInTrial === 1 ? '' : 's'} remaining.
              Advanced features stay unlocked until {billing.trialEndsAt ? new Date(billing.trialEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'the trial end'} — then the workspace downgrades to Free automatically.
            </span>
            <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs shrink-0 btn-press" onClick={() => go({ view: 'billing' })}>
              Upgrade
            </Button>
          </>
        ) : (
          <>
            <span className="status-dot shrink-0" style={{ background: 'var(--critical)' }} />
            <span className="truncate">
              <strong>Trial ended.</strong> Agents, policies and API keys are locked; monthly allowances are reduced. Upgrade to restore Pro — your history is intact.
            </span>
            <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs shrink-0 btn-press" onClick={() => go({ view: 'billing' })}>
              See plans
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Authenticated shell with sidebar ────────────────────────────────────────

function ShellLayout({ nav, route, go, children, authed, org }: {
  nav: typeof NAV; route: Route; go: (r: Route) => void
  children: React.ReactNode; authed: boolean; org?: SessionOrg
}) {
  const [mobileNav, setMobileNav] = useState(false)
  return (
    <div className="mx-auto max-w-[1400px] w-full px-4 lg:px-6 flex gap-6 py-6">
      <aside className="hidden lg:block w-[var(--sidebar-w)] shrink-0">
        <SidebarNav nav={nav} route={route} go={go} authed={authed} org={org} />
      </aside>
      <div className="lg:hidden">
        <button onClick={() => setMobileNav(!mobileNav)} className="text-sm text-muted-foreground mb-4">
          {mobileNav ? 'Hide' : 'Show'} navigation
        </button>
        {mobileNav && <SidebarNav nav={nav} route={route} go={go} authed={authed} org={org} />}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function SidebarNav({ nav, route, go, authed, org }: { nav: typeof NAV; route: Route; go: (r: Route) => void; authed: boolean; org?: SessionOrg }) {
  return (
    <nav className="sticky top-[calc(var(--header-h)+24px)] space-y-1" aria-label="Section">
      {nav.filter(n => !n.auth || authed).map(n => (
        <button
          key={n.view}
          onClick={() => go({ view: n.view } as Route)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors ${
            route.view === n.view ? 'text-foreground bg-[var(--surface)] border border-[var(--border)]' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <n.icon size={15} />
          {n.label}
        </button>
      ))}
      <div className="pt-4 mt-4 border-t border-[var(--border)]">
        <p className="eyebrow px-3 mb-2">Network</p>
        <div className="px-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="status-dot" style={{ background: 'var(--accent)' }} />
          {org ? 'Testnet connected' : 'onyx-1'}
        </div>
      </div>
    </nav>
  )
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer({ go }: { go: (r: Route) => void }) {
  return (
    <footer className="border-t border-[var(--border)] mt-auto">
      <div className="mx-auto max-w-[1400px] px-4 lg:px-6 py-6 flex flex-col md:flex-row items-center gap-4 justify-between pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-4">
          <Emblem size={20} tone="mono" />
          <span className="text-xs text-muted-foreground">© 2026 PROOFLOOM — verifiable software provenance on Gno.land Onyx testnet</span>
        </div>
        <nav className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Footer">
          <button className="hover:text-foreground" onClick={() => go({ view: 'docs' })}>Docs</button>
          <button className="hover:text-foreground" onClick={() => go({ view: 'verify' })}>Verify</button>
          <button className="hover:text-foreground" onClick={() => go({ view: 'status' })}>Status</button>
          <a className="hover:text-foreground" href="/api/health" target="_blank" rel="noreferrer">API health</a>
        </nav>
      </div>
    </footer>
  )
}
