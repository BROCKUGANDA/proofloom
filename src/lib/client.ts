'use client'

// Typed client for the PROOFLOOM API. Uniform error envelope handling.

export interface ApiError {
  code: string
  message: string
  recovery: string
  details?: Record<string, unknown>
}

export class ClientError extends Error {
  constructor(public readonly apiError: ApiError) {
    super(apiError.message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({ error: { code: 'INTERNAL', message: 'Malformed response', recovery: 'Retry.' } }))
  if (!res.ok || json.error) {
    throw new ClientError(json.error as ApiError)
  }
  return json.data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body == null ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// ─── Wallet abstraction (Adena-first, GnoConnect-shaped) ─────────────────────

export interface WalletAdapter {
  name: string
  available: boolean
  address?: string
  chainId?: string
}

interface AdenaLike {
  getAccount?: () => Promise<{ address: string; chainId?: string }>
  addAccount?: (cfg: unknown) => Promise<unknown>
  signAmino?: (chainId: string, doc: unknown) => Promise<{ signed?: unknown; signature?: unknown; encoded?: string }>
  signEcdsa?: (chainId: string, msg: string) => Promise<{ signature: string; pubKey: string }>
  sendTransaction?: (req: { messages?: unknown[]; gas?: number }, chainId?: string) => Promise<{ hash: string; height?: number }>
}

export function detectAdena(): AdenaLike | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { adena?: AdenaLike; gno?: AdenaLike }
  return w.adena ?? w.gno ?? null
}

export async function walletStatus(): Promise<WalletAdapter> {
  const adena = detectAdena()
  if (!adena) return { name: 'Adena', available: false }
  try {
    const acct = await adena.getAccount?.()
    return { name: 'Adena', available: true, address: acct?.address, chainId: acct?.chainId }
  } catch {
    return { name: 'Adena', available: true }
  }
}

export async function walletConnect(): Promise<WalletAdapter> {
  const adena = detectAdena()
  if (!adena) throw new Error('Adena wallet not detected. Install the extension to sign with your own keys, or continue with a platform session (verification and read flows do not need a wallet).')
  const acct = await adena.getAccount!()
  return { name: 'Adena', available: true, address: acct.address, chainId: acct.chainId }
}

export async function walletSignMessage(message: string, chainId: string): Promise<string | null> {
  const adena = detectAdena()
  if (!adena?.signEcdsa) return null
  const res = await adena.signEcdsa(chainId, message)
  return res.signature
}

export async function walletSendTransaction(chainId: string, messages: unknown[], gas: number): Promise<{ hash: string; height?: number } | null> {
  const adena = detectAdena()
  if (!adena?.sendTransaction) return null
  const res = await adena.sendTransaction({ messages, gas }, chainId)
  return { hash: res.hash, height: res.height }
}
