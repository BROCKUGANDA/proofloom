import { NextRequest } from 'next/server'
import { withApi, clientIp, guardRate } from '@/lib/api'
import { verifyRelease, verifyAttestation, verifyDigest } from '@/lib/verification'
import { activeChain } from '@/lib/chain'

export const dynamic = 'force-dynamic'

// GET /api/verify/{release|attestation|digest}/[id] — PUBLIC verification API.
// No account required; rate-limited per IP; returns machine-readable results
// including limitations. Third parties can verify without registering.
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return withApi(async () => {
    const ip = clientIp(req)
    await guardRate('public-verify', ip, 120, 60_000)
    const { path } = await ctx.params
    const [kind, id] = path ?? []
    if (!kind || !id) {
      return {
        protocol: 'PROOFLOOM Verification API v1',
        usage: {
          release: 'GET /api/verify/release/{releaseId or projectId-version}',
          attestation: 'GET /api/verify/attestation/{protocolId}',
          digest: 'GET /api/verify/digest/{sha256hex}',
        },
        network: { chainId: activeChain().chainId, label: activeChain().label, realmPrefix: activeChain().realmPrefix },
        note: 'Verification results include explicit limitations. A valid signature proves origin and integrity, not artifact safety.',
      }
    }

    if (kind === 'release') {
      return verifyRelease(decodeURIComponent(id), { ip })
    }
    if (kind === 'attestation') {
      return verifyAttestation(decodeURIComponent(id))
    }
    if (kind === 'digest') {
      if (!/^[0-9a-f]{64}$/.test(id)) {
        return { error: 'digest must be 64 lowercase hex characters' }
      }
      const matches = await verifyDigest(id)
      return {
        targetType: 'DIGEST', targetId: id,
        verdict: matches.length === 0 ? 'UNKNOWN' : (matches.some(m => m.status === 'REVOKED') ? 'PARTIAL' : 'VERIFIED'),
        matches, limitations: ['Digest matches only reflect commitments recorded by PROOFLOOM publishers.'],
      }
    }
    return { error: `unknown verification kind: ${kind}`, usage: ['release', 'attestation', 'digest'] }
  })
}
