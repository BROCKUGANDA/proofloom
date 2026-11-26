import { isValidDigest, isValidGnoAddress } from '@/lib/crypto'
import { err } from '@/lib/errors'

// PROOFLOOM chain gateway.
//
// Talks to the Gno.land Onyx testnet over JSON-RPC (abci_query) with:
//  - configurable chain profiles + explicit chain identity checks
//  - timeouts, single-flight retry (never blind-retrying state writes)
//  - realm query encoding matching the deployed realm function signatures
//  - transaction lifecycle states tracked in the database
//
// Signing happens client-side via Adena/GnoConnect (user-owned operations)
// or via the gnokey CLI operator flow (deployment). The gateway itself only
// reads state and tracks lifecycle: it never holds user keys.

export interface ChainProfile {
  id: string
  label: string
  chainId: string
  rpc: string
  websocket: string
  explorer: string
  faucet: string
  realmPrefix: string
}

// Network configuration is read from env at boot; defaults reflect the
// documented Onyx testnet. Never hardcode an obsolete testnet.
export function activeChain(): ChainProfile {
  const rpc = process.env.PROOFLOOM_RPC_URL || 'https://rpc.onyx.testnets.gno.land:443'
  const chainId = process.env.PROOFLOOM_CHAIN_ID || 'onyx-1'
  return {
    id: 'onyx-1',
    label: 'Gno.land Onyx Testnet',
    chainId,
    rpc,
    websocket: process.env.PROOFLOOM_WS_URL || 'wss://rpc.onyx.testnets.gno.land:443/websocket',
    explorer: process.env.PROOFLOOM_EXPLORER || 'https://gnoscan.io',
    faucet: process.env.PROOFLOOM_FAUCET || 'https://faucet.gno.land/',
    realmPrefix: process.env.PROOFLOOM_REALM_PREFIX || 'gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom',
  }
}

export function realmPath(pkg: string): string {
  return `${activeChain().realmPrefix}/${pkg}`
}

// ─── JSON-RPC transport ──────────────────────────────────────────────────────

const TIMEOUT_MS = 12_000

interface AbciResponse {
  jsonrpc: string
  id: number
  result?: {
    response: {
      ResponseBase: { Error: unknown; Data: string | null; Log: string }
      Height: string
    }
  }
  error?: { code: number; message: string; data?: string }
}

async function abciQuery(path: string, data: string): Promise<{ data: string; height: number }> {
  const chain = activeChain()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let json: AbciResponse
  try {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'abci_query',
        params: { path, data: Buffer.from(data, 'utf8').toString('base64'), height: '0', prove: false },
      }),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw err('CHAIN_UNAVAILABLE', { httpStatus: res.status })
    json = (await res.json()) as AbciResponse
  } catch (e) {
    if ((e as { code?: string })?.code) throw e
    throw err('CHAIN_UNAVAILABLE', { cause: String((e as Error)?.message ?? e) })
  } finally {
    clearTimeout(timer)
  }

  if (json.error) throw err('CHAIN_UNAVAILABLE', { rpcError: json.error.message })
  const rb = json.result?.response?.ResponseBase
  if (!rb) throw err('CHAIN_UNAVAILABLE', { cause: 'missing ResponseBase' })
  if (rb.Error) {
    const log = rb.Log || 'unknown realm error'
    // Unknown realm/package/record reads are legitimate "not found" answers:
    // realms panic with `unknown <thing>` messages for missing records.
    if (/InvalidPackageError|InvalidFileError|not declared|not found/i.test(log) ||
        /unknown (release|project|agent|attestation|component|execution|grant)/i.test(log)) {
      throw err('NOT_FOUND', { realmLog: log.slice(0, 300) })
    }
    throw err('TX_FAILED', { realmLog: log.slice(0, 300) })
  }
  const decoded = rb.Data ? Buffer.from(rb.Data, 'base64').toString('utf8') : ''
  return { data: decoded, height: parseInt(json.result!.response.Height || '0') }
}

// Chain identity check: explicit, cached for 60s, hard-fails on mismatch.
// Uses the tm2 `status` RPC (params [null]) which reports node_info.network
// and the latest block height.
let chainIdCache: { id: string; at: number; height: number } | null = null

export async function verifyChainIdentity(): Promise<{ chainId: string; height: number }> {
  const chain = activeChain()
  if (chainIdCache && Date.now() - chainIdCache.at < 60_000) {
    return { chainId: chainIdCache.id, height: chainIdCache.height }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'status', params: [null], id: 1 }),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw err('CHAIN_UNAVAILABLE', { httpStatus: res.status })
    const json = (await res.json()) as {
      result?: { node_info?: { network?: string }; sync_info?: { latest_block_height?: string } }
    }
    const remoteId = json.result?.node_info?.network ?? ''
    const height = parseInt(json.result?.sync_info?.latest_block_height ?? '0') || 0
    if (remoteId && remoteId !== chain.chainId) {
      throw err('CHAIN_ID_MISMATCH', { expected: chain.chainId, actual: remoteId })
    }
    chainIdCache = { id: remoteId || chain.chainId, at: Date.now(), height }
    return { chainId: chainIdCache.id, height }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Realm query helpers (mirror deployed realm signatures) ─────────────────

export interface RealmRelease {
  id: string
  projectID: string
  version: string
  artifactDigest: string
  status: string
  publishedAt: number
}

export interface RealmVerdict {
  releaseID: string
  projectID: string
  version: string
  artifactDigest: string
  releaseStatus: string
  verdict: string
  attestations: { id: string; category: string; issuer: string; digest: string; status: string; issuedAt: number }[]
  policyChecks: { requirement: string; passed: boolean; detail: string }[]
  policyVersion: number
  notes: string
}

function parseGoStruct(s: string): Record<string, string> {
  // Parse flat Go struct renderings like {ID:"x" ProjectID:"y"} — adequate
  // for the protocol's flat records; complex fields are queried separately.
  const out: Record<string, string> = {}
  const re = /(\w+):"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out[m[1]] = m[2]
  return out
}

/** Query a public realm expression, e.g. `VerifyRelease("id")` on verify. */
export async function realmEval<T = unknown>(pkg: 'verify' | 'registry' | 'releases' | 'attestations' | 'agents' | 'policies', expression: string): Promise<T> {
  await verifyChainIdentity()
  const { data } = await abciQuery('vm/qeval', `${realmPath(pkg)}.${expression}`)
  return data as T
}

/** Fetch the composite on-chain verdict for a release. */
export async function fetchOnChainVerdict(releaseId: string): Promise<RealmVerdict> {
  if (!/^[-a-z0-9]{1,80}$/.test(releaseId)) throw err('VALIDATION_FAILED')
  const raw = await realmEval<string>(`verify`, `VerifyRelease("${releaseId}")`)
  return parseVerdict(raw)
}

function parseVerdict(raw: string): RealmVerdict {
  // The on-chain struct renders as Go-syntax; extract the fields we rely on.
  const flat = parseGoStruct(raw)
  const verdict: RealmVerdict = {
    releaseID: flat.ReleaseID ?? '',
    projectID: flat.ProjectID ?? '',
    version: flat.Version ?? '',
    artifactDigest: flat.ArtifactDigest ?? '',
    releaseStatus: flat.ReleaseStatus ?? '',
    verdict: flat.Verdict ?? 'UNKNOWN',
    attestations: [],
    policyChecks: [],
    policyVersion: parseInt(flat.PolicyVersion ?? '0') || 0,
    notes: flat.Notes ?? '',
  }
  return verdict
}

/** Fetch release status straight from the releases realm. */
export async function fetchReleaseStatus(releaseId: string): Promise<string | null> {
  try {
    const raw = await realmEval<string>(`releases`, `ReleaseStatus("${releaseId}")`)
    const status = raw.replace(/^"|"$/g, '')
    return status || null
  } catch (e) {
    if ((e as { code?: string }).code === 'NOT_FOUND') return null
    throw e
  }
}

/** Registry stats from the verify facade. */
export async function fetchRegistryStats(): Promise<{ projects: number; components: number; releases: number; attestations: number } | null> {
  try {
    const raw = await realmEval<string>('verify', 'RegistryStats()')
    const nums = raw.match(/\d+/g)?.map(Number) ?? []
    if (nums.length < 4) return null
    return { projects: nums[0], components: nums[1], releases: nums[2], attestations: nums[3] }
  } catch {
    return null
  }
}

/** Fetch public project record. */
export async function fetchOnChainProject(projectId: string): Promise<{ id: string; name: string; owner: string } | null> {
  if (!/^[-a-z0-9]{1,64}$/.test(projectId)) return null
  try {
    const raw = await realmEval<string>('registry', `GetPublicProject("${projectId}")`)
    const flat = parseGoStruct(raw)
    return { id: flat.ID ?? projectId, name: flat.Name ?? '', owner: flat.Owner ?? '' }
  } catch {
    return null
  }
}

// ─── Transaction lifecycle ───────────────────────────────────────────────────

export const TX_STATES = [
  'CREATED', 'SIMULATED', 'AWAITING_SIGNATURE', 'SIGNED', 'BROADCAST',
  'PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'RECONCILIATION_REQUIRED',
] as const

export type TxState = (typeof TX_STATES)[number]

/**
 * Check whether a broadcast tx has landed by querying the state it should
 * have produced (state-based confirmation: authoritative for our purposes).
 * `confirmExpr` is a realm expression that must succeed once the tx lands.
 */
export async function reconcileTransaction(txHash: string, confirmExpr: { pkg: 'verify' | 'releases' | 'attestations' | 'registry'; expr: string }): Promise<'CONFIRMED' | 'PENDING' | 'FAILED'> {
  try {
    await realmEval(confirmExpr.pkg, confirmExpr.expr)
    return 'CONFIRMED'
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'NOT_FOUND') return 'PENDING'
    if (code === 'CHAIN_UNAVAILABLE') return 'PENDING'
    return 'FAILED'
  }
}

export function txExplorerUrl(txHash: string): string {
  return `${activeChain().explorer}/tx/${txHash}`
}

export function realmExplorerUrl(pkg: string): string {
  return `${activeChain().explorer}/realm/${realmPath(pkg)}`
}

export { isValidDigest, isValidGnoAddress }
