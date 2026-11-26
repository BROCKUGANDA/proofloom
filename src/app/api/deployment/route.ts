import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { withApi } from '@/lib/api'

export const dynamic = 'force-dynamic'

// GET /api/deployment — the last realm deployment manifest written by
// chain/scripts/deploy.sh. Read-only truth, served to the status page so the
// UI reflects what actually landed on-chain rather than a hardcoded claim.
export async function GET() {
  return withApi(async () => {
    const dir = join(process.cwd(), 'chain', 'deployments')
    const candidates = ['deployment-dev.json', 'deployment-onyx-1.json']
    for (const name of candidates) {
      const full = join(dir, name)
      if (existsSync(full)) {
        try {
          const manifest = JSON.parse(readFileSync(full, 'utf-8'))
          return { manifest, file: name }
        } catch {
          // corrupt manifest — fall through to the next candidate
        }
      }
    }
    return { manifest: null, file: null }
  })
}
