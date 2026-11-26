'use client'

// Auth view — register, login, MFA. Honest error surfacing.

import { useState, useEffect } from 'react'
import { api, ClientError } from '@/lib/client'
import { useApp, navigate, type Route } from '@/components/proofloom-app'
import { Wordmark } from '@/components/atelier/emblem'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Zap, Check } from 'lucide-react'

export function AuthView(_props: unknown) {
  const { refreshSession, session, toast } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [totp, setTotp] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)
  const [error, setError] = useState<{ message: string; recovery: string } | null>(null)

  useEffect(() => {
    if (session?.authenticated) navigate({ view: 'workspace' })
  }, [session?.authenticated])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') {
        await api.post('/api/auth/register', { email, password, displayName })
      } else {
        await api.post('/api/auth/login', { email, password, totp: totp || undefined })
      }
      await refreshSession()
      navigate({ view: 'workspace' })
      toast('success', mode === 'register' ? 'Workspace created' : 'Welcome back')
    } catch (err) {
      const ce = err instanceof ClientError ? err.apiError : null
      if (ce?.code === 'AUTH_MFA_REQUIRED') {
        setNeedsTotp(true)
      }
      setError({
        message: ce?.message ?? 'Something went wrong.',
        recovery: ce?.recovery ?? 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  const startDemo = async () => {
    setDemoBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/demo', {})
      await refreshSession()
      navigate({ view: 'workspace' })
      toast('success', 'Trial workspace ready', '14-day Pro trial started — explore everything; upgrade any time.')
    } catch (err) {
      const ce = err instanceof ClientError ? err.apiError : null
      setError({
        message: ce?.message ?? 'Could not start the demo.',
        recovery: ce?.recovery ?? 'Please try again in a minute.',
      })
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h))] flex items-center justify-center px-4 py-12 obs-grid">
      <div className="w-full max-w-md">
        <div className="loom-panel-raised p-8">
          <div className="flex justify-center mb-6"><Wordmark size={15} /></div>
          <div className="flex mb-6 border border-[var(--border)] rounded-md overflow-hidden">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setNeedsTotp(false) }}
                className={`flex-1 py-2 text-sm transition-colors ${mode === m ? 'bg-[var(--surface-raised)] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <Label htmlFor="displayName">Display name</Label>
                <Input id="displayName" value={displayName} onChange={e => setDisplayName(e.target.value)}
                  placeholder="Ada Lovelace" required minLength={2} maxLength={80} autoComplete="name" />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@company.dev" required autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'register' ? '10+ chars, mixed case, digits' : '••••••••'} required autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
              {mode === 'register' && (
                <p className="text-xs text-muted-foreground mt-1">Hashed with scrypt; never stored in plain text.</p>
              )}
            </div>
            {needsTotp && (
              <div>
                <Label htmlFor="totp">Authenticator code</Label>
                <Input id="totp" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={totp}
                  onChange={e => setTotp(e.target.value.replace(/\D/g, ''))} placeholder="000000" required />
              </div>
            )}

            {error && (
              <div className="destructive-zone p-3" role="alert">
                <p className="text-sm text-[var(--critical)] font-medium">{error.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{error.recovery}</p>
              </div>
            )}

            <Button type="submit" disabled={busy} className="w-full btn-press">
              {busy ? <Loader2 className="animate-spin" size={15} /> : mode === 'register' ? 'Create workspace' : 'Sign in'}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center" aria-hidden="true"><span className="w-full border-t border-[var(--border)]" /></div>
            <div className="relative flex justify-center"><span className="bg-[var(--surface-raised)] px-3 text-xs text-muted-foreground uppercase tracking-wider">or</span></div>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={demoBusy || busy}
            onClick={() => void startDemo()}
            className="w-full btn-press h-11"
          >
            {demoBusy
              ? <Loader2 className="animate-spin" size={15} />
              : <><Zap size={15} className="mr-2 text-[var(--accent-warm)]" /> One-click demo — try the full product</>}
          </Button>
          <ul className="text-xs text-muted-foreground mt-3 space-y-1" aria-label="What the demo includes">
            <li className="flex items-center gap-1.5"><Check size={11} className="text-[var(--verified)]" /> Instant workspace on a 14-day Pro trial — no card, no email</li>
            <li className="flex items-center gap-1.5"><Check size={11} className="text-[var(--verified)]" /> Publish releases, issue attestations, run the agent console</li>
            <li className="flex items-center gap-1.5"><Check size={11} className="text-[var(--verified)]" /> Downgrades to Free automatically at trial end — data is kept</li>
          </ul>

          <p className="text-xs text-muted-foreground mt-6 text-center">
            Sessions are httpOnly, rotated, and revocable. Wallet linking happens after sign-in —
            signing always stays in your wallet.
          </p>
        </div>
      </div>
    </div>
  )
}
