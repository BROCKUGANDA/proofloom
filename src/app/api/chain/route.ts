import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess, requireMembership } from '@/lib/auth'
import { err } from '@/lib/errors'
import { activeChain, verifyChainIdentity, realmPath, fetchOnChainVerdict, fetchReleaseStatus, txExplorerUrl, TX_STATES } from '@/lib/chain'
import { operatorAvailable, operatorBroadcastCall } from '@/lib/operator'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// GET /api/chain — chain profile, identity check, deployment manifest
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const chain = activeChain()
    let identity: { ok: boolean; chainId?: string; error?: string }
    try {
      const id = await verifyChainIdentity()
      identity = { ok: true, chainId: id.chainId }
    } catch (e) {
      identity = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }
    }
    const manifest = await db.chainTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, kind: true, status: true, txHash: true, chainId: true, createdAt: true, confirmedAt: true, error: true },
    })
    return {
      profile: {
        network: chain.label,
        chainId: chain.chainId,
        rpc: chain.rpc,
        websocket: chain.websocket,
        faucet: chain.faucet,
        explorer: chain.explorer,
        realms: {
          core: realmPath('verify'),
          registry: realmPath('registry'),
          releases: realmPath('releases'),
          attestations: realmPath('attestations'),
          agents: realmPath('agents'),
          policies: realmPath('policies'),
          verify: realmPath('verify'),
        },
      },
      identity,
      transactionStates: TX_STATES,
      recentTransactions: manifest,
    }
  })
}

// POST /api/chain — record a transaction lifecycle transition (wallet flows)
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const body = await readJson<{
      op?: string; txId?: string; kind?: string; releaseId?: string; attestationId?: string
      txHash?: string; status?: string; idempotencyKey?: string; gasUsed?: number; height?: number; error?: string
    }>(req)
    const ip = clientIp(req)

    if (body.op === 'record') {
      const VALID: string[] = [...TX_STATES]
      const status = body.status ?? 'CREATED'
      if (!VALID.includes(status)) throw err('VALIDATION_FAILED', { field: 'status', allowed: VALID })
      const tx = await db.chainTransaction.create({
        data: {
          kind: body.kind ?? 'UNKNOWN',
          releaseId: body.releaseId,
          attestationId: body.attestationId,
          status,
          chainId: activeChain().chainId,
          txHash: body.txHash,
          gasUsed: body.gasUsed,
          height: body.height,
          error: body.error?.slice(0, 500),
          idempotencyKey: body.idempotencyKey,
          createdBy: user.id,
          confirmedAt: status === 'CONFIRMED' ? new Date() : null,
        },
      })
      return { id: tx.id, status: tx.status }
    }

    if (body.op === 'transition') {
      if (!body.txId) throw err('VALIDATION_FAILED', { missing: ['txId'] })
      const tx = await db.chainTransaction.findUnique({ where: { id: body.txId } })
      if (!tx) throw err('NOT_FOUND')
      const status = body.status ?? ''
      if (![...TX_STATES].includes(status)) throw err('VALIDATION_FAILED', { field: 'status', allowed: TX_STATES })
      const updated = await db.chainTransaction.update({
        where: { id: body.txId },
        data: {
          status,
          txHash: body.txHash ?? tx.txHash,
          gasUsed: body.gasUsed ?? tx.gasUsed,
          height: body.height ?? tx.height,
          error: body.error?.slice(0, 500),
          confirmedAt: status === 'CONFIRMED' ? new Date() : tx.confirmedAt,
        },
      })
      return { id: updated.id, status: updated.status, explorerUrl: updated.txHash ? txExplorerUrl(updated.txHash) : null }
    }

    if (body.op === 'query-release') {
      // authoritative on-chain status query for a protocol release id
      const protocolId = body.kind as string
      if (!protocolId || !/^[-a-z0-9]{1,100}$/.test(protocolId)) throw err('VALIDATION_FAILED', { field: 'kind (protocolId)' })
      const status = await fetchReleaseStatus(protocolId)
      return { protocolId, onChainStatus: status, recorded: status !== null }
    }

    if (body.op === 'operator-status') {
      return {
        available: operatorAvailable(),
        note: operatorAvailable()
          ? 'Platform-operated testnet transactions are enabled (deployment account, testnet only).'
          : 'Platform-operated transactions are inactive. Set PROOFLOOM_OPERATOR_MNEMONIC (testnet-only deployment account) or connect Adena to sign with your own keys.',
      }
    }

    if (body.op === 'publish-on-chain') {
      // Platform-operated REAL broadcast of a release commitment to the
      // deployed releases realm. Requires: operator credential configured,
      // release APPROVED with a valid digest. The tx hash + height are
      // recorded; the UI labels operator-signed records as such.
      if (!body.releaseId) throw err('VALIDATION_FAILED', { missing: ['releaseId'] })
      const release = await db.release.findUnique({ where: { id: body.releaseId }, include: { project: true } })
      if (!release) throw err('NOT_FOUND')
      await requireMembership(user.id, release.project.organizationId, 'release.write')
      if (release.status !== 'APPROVED' && release.status !== 'PUBLISHED') {
        throw err('INVALID_TRANSITION', { reason: 'on-chain publication requires an APPROVED release' })
      }
      const protocolId = `${release.project.slug}-${release.version.toLowerCase()}`
      const func = 'PublishRelease'
      const args = [protocolId, release.project.slug, release.version, release.commitHash.slice(0, 12), release.artifactDigest ?? '']
      const tx = await operatorBroadcastCall({
        pkgpath: realmPath('releases'), func, args,
        memo: `proofloom:publish:${protocolId}`,
      })
      const record = await db.chainTransaction.create({
        data: {
          kind: 'PUBLISH_RELEASE', releaseId, status: 'BROADCAST',
          chainId: activeChain().chainId, txHash: tx.txHash,
          idempotencyKey: `publish:${protocolId}:${Date.now()}`,
          createdBy: user.id,
        },
      })
      await audit({
        organizationId: release.project.organizationId, projectId: release.projectId,
        actorUserId: user.id, action: 'chain.publish_release', targetType: 'CHAIN_TRANSACTION',
        targetId: record.id, metadata: { protocolId, txHash: tx.txHash, signing: 'operator' }, ip: clientIp(req), traceId,
      })
      return { txId: record.id, txHash: tx.txHash, explorerUrl: txExplorerUrl(tx.txHash), protocolId, signing: 'operator' }
    }

    if (body.op === 'attest-on-chain') {
      // Platform-operated REAL broadcast of an attestation commitment.
      if (!body.attestationId) throw err('VALIDATION_FAILED', { missing: ['attestationId'] })
      const att = await db.attestation.findUnique({ where: { id: body.attestationId }, include: { release: { include: { project: true } } } })
      if (!att) throw err('NOT_FOUND')
      if (att.organizationId) await requireMembership(user.id, att.organizationId, 'attestation.issue')
      const subjectLabel = att.subjectType === 'RELEASE' && att.release
        ? `${att.release.project.slug}-${att.release.version.toLowerCase()}`
        : att.subjectId
      const func = 'Issue'
      const args = ['RELEASE', subjectLabel, att.category, att.digest, '0']
      const tx = await operatorBroadcastCall({
        pkgpath: realmPath('attestations'), func, args,
        memo: `proofloom:attest:${subjectLabel}:${att.category}`,
      })
      await db.attestation.update({
        where: { id: att.id },
        data: { onChain: true, chainTxHash: tx.txHash },
      })
      const record = await db.chainTransaction.create({
        data: {
          kind: 'ATTEST', attestationId: att.id, status: 'BROADCAST',
          chainId: activeChain().chainId, txHash: tx.txHash,
          idempotencyKey: `attest:${att.protocolId}:${Date.now()}`,
          createdBy: user.id,
        },
      })
      await audit({
        organizationId: att.organizationId, projectId: att.projectId,
        actorUserId: user.id, action: 'chain.attest', targetType: 'CHAIN_TRANSACTION',
        targetId: record.id, metadata: { protocolId: att.protocolId, txHash: tx.txHash, signing: 'operator' }, ip: clientIp(req), traceId,
      })
      return { txId: record.id, txHash: tx.txHash, explorerUrl: txExplorerUrl(tx.txHash), attestationProtocolId: att.protocolId, signing: 'operator' }
    }

    if (body.op === 'confirm-on-chain') {
      // State-based reconciliation: query the realm; if the expected record
      // exists, the tx is confirmed. Never trusts a hash alone.
      const txId = body.txId as string
      const tx = await db.chainTransaction.findUnique({ where: { id: txId } })
      if (!tx) throw err('NOT_FOUND')
      const { reconcileTransaction } = await import('@/lib/chain')
      let confirmExpr: { pkg: 'verify' | 'releases' | 'attestations' | 'registry'; expr: string } | null = null
      if (tx.kind === 'PUBLISH_RELEASE' && tx.releaseId) {
        const rel = await db.release.findUnique({ where: { id: tx.releaseId }, include: { project: true } })
        if (rel) confirmExpr = { pkg: 'releases', expr: `ReleaseStatus("${rel.project.slug}-${rel.version.toLowerCase()}")` }
      } else if (tx.kind === 'ATTEST' && tx.attestationId) {
        const a = await db.attestation.findUnique({ where: { id: tx.attestationId } })
        if (a) confirmExpr = { pkg: 'attestations', expr: `GetAttestation("${a.protocolId}")` }
      }
      if (!confirmExpr) throw err('VALIDATION_FAILED', { reason: 'no confirmation query for this transaction kind' })
      const outcome = await reconcileTransaction(tx.txHash ?? '', confirmExpr)
      await db.chainTransaction.update({
        where: { id: txId },
        data: { status: outcome, confirmedAt: outcome === 'CONFIRMED' ? new Date() : null, attempts: tx.attempts + 1 },
      })
      if (outcome === 'CONFIRMED' && tx.releaseId) {
        await db.release.update({ where: { id: tx.releaseId }, data: { gnoRegistered: true, onChainRef: tx.txHash } }).catch(() => {})
      }
      return { txId, outcome }
    }

    throw err('VALIDATION_FAILED', { field: 'op', allowed: ['record', 'transition', 'query-release', 'operator-status', 'publish-on-chain', 'attest-on-chain', 'confirm-on-chain'] })
  })
}
