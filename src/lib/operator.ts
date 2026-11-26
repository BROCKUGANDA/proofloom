import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { activeChain } from '@/lib/chain'

const execFileAsync = promisify(execFile)

// Operator transaction service.
//
// PROOFLOOM distinguishes two signing paths:
//   1. USER-OWNED operations: signed client-side via Adena/GnoConnect. The
//      platform never touches user keys.
//   2. PLATFORM-OPERATED operations (demo/testnet integration): the
//      deployment account, whose mnemonic arrives ONLY via the
//      PROOFLOOM_OPERATOR_MNEMONIC environment variable at runtime. It is
//      never committed to the repository and never leaves the server.
//
// When the operator credential is absent, every endpoint here fails with an
// explicit activation requirement — no simulated success is ever returned.

const GNOKY_BIN = process.env.PROOFLOOM_GNOKEY_BIN || '/home/z/my-project/bin/gnokey'

export function operatorAvailable(): boolean {
  return !!process.env.PROOFLOOM_OPERATOR_MNEMONIC
}

interface OperatorContext {
  keyHome: string
  keyName: string
}

async function withKeybase<T>(fn: (ctx: OperatorContext) => Promise<T>): Promise<T> {
  const keyHome = mkdtempSync(join(tmpdir(), 'pl-key-'))
  const ctx: OperatorContext = { keyHome, keyName: 'operator' }
  try {
    await execFileAsync(GNOKY_BIN, [
      '--home', keyHome, 'add', ctx.keyName, '--recover', '--insecure-password-stdin',
    ], {
      input: process.env.PROOFLOOM_OPERATOR_MNEMONIC + '\n',
      timeout: 20_000,
    })
    return await fn(ctx)
  } finally {
    try { rmSync(keyHome, { recursive: true, force: true }) } catch { /* temp cleanup */ }
  }
}

export interface OperatorBroadcastResult {
  txHash: string
  height?: number
  gasUsed?: number
  chainId: string
}

/** Broadcast a realm call signed by the deployment account. */
export async function operatorBroadcastCall(params: {
  pkgpath: string
  func: string
  args: string[]
  gasWanted?: number
  gasFee?: string
  memo?: string
}): Promise<OperatorBroadcastResult> {
  if (!operatorAvailable()) {
    const e = new Error('PROOFLOOM_OPERATOR_MNEMONIC not configured') as Error & { code: string; recovery: string }
    e.code = 'FAUCET_DEPLETED'
    e.recovery = 'Set PROOFLOOM_OPERATOR_MNEMONIC (testnet-only deployment account) to activate platform-signed transactions; or connect Adena to sign with your own wallet.'
    throw e
  }
  const chain = activeChain()
  return withKeybase(async (ctx) => {
    const args = [
      '--home', ctx.keyHome,
      'maketx', 'call',
      '--pkgpath', params.pkgpath,
      '--func', params.func,
      '--args', params.args.join(','),
      '--remote', chain.rpc,
      '--chainid', chain.chainId,
      '--gas-fee', params.gasFee ?? '5000000ugnot',
      '--gas-wanted', String(params.gasWanted ?? 2_500_000),
      ...(params.memo ? ['--memo', params.memo.slice(0, 100)] : []),
      '--broadcast', 'sync',
      ctx.keyName,
    ]
    const { stdout, stderr } = await execFileAsync(GNOKY_BIN, args, { timeout: 60_000 })
    const out = stdout + stderr
    // gnokey prints the tx hash in the broadcast result.
    const hashMatch = out.match(/hash[=: ]+([0-9A-Fa-f]{40,})/) || out.match(/([0-9A-F]{64})/)
    if (!hashMatch) {
      const e = new Error(`broadcast did not return a hash: ${out.slice(0, 300)}`) as Error & { code: string }
      e.code = 'TX_FAILED'
      throw e
    }
    const heightMatch = out.match(/height[=: ]+(\d+)/) || out.match(/(\d+)G\W/)?.let?.(m => m)
    void heightMatch
    return {
      txHash: hashMatch[1],
      chainId: chain.chainId,
    }
  })
}

/** Broadcast a realm deployment (addpkg). Used by the deployment pipeline. */
export async function operatorDeployPackage(params: {
  pkgpath: string
  pkgdir: string
  deposit?: string
}): Promise<OperatorBroadcastResult> {
  if (!operatorAvailable()) {
    const e = new Error('PROOFLOOM_OPERATOR_MNEMONIC not configured') as Error & { code: string }
    e.code = 'FAUCET_DEPLETED'
    throw e
  }
  const chain = activeChain()
  return withKeybase(async (ctx) => {
    const args = [
      '--home', ctx.keyHome,
      'maketx', 'addpkg',
      '--pkgpath', params.pkgpath,
      '--pkgdir', params.pkgdir,
      '--remote', chain.rpc,
      '--chainid', chain.chainId,
      '--gas-fee', '100000000ugnot',
      '--gas-wanted', '50000000',
      ...(params.deposit ? ['--deposit', params.deposit] : []),
      '--broadcast', 'sync',
      ctx.keyName,
    ]
    const { stdout, stderr } = await execFileAsync(GNOKY_BIN, args, { timeout: 120_000 })
    const out = stdout + stderr
    const hashMatch = out.match(/hash[=: ]+([0-9A-Fa-f]{40,})/) || out.match(/([0-9A-F]{64})/)
    if (!hashMatch) {
      const e = new Error(`deploy did not return a hash: ${out.slice(0, 300)}`) as Error & { code: string }
      e.code = 'TX_FAILED'
      throw e
    }
    return { txHash: hashMatch[1], chainId: chain.chainId }
  })
}
