// LLM provider abstraction.
//
// PROOFLOOM's agent runtime must never be welded to one model provider.
// Providers implement LLMProvider; the registry selects by configuration
// with health checks and graceful fallback. API keys never reach the
// browser or any realm: providers are server-side only.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionRequest {
  messages: ChatMessage[]
  thinking?: boolean
  maxTokens?: number
}

export interface CompletionResult {
  content: string
  provider: string
  model: string
  tokensUsed: number
  durationMs: number
}

export interface LLMProvider {
  readonly name: string
  readonly model: string
  isAvailable(): Promise<boolean>
  complete(req: CompletionRequest): Promise<CompletionResult>
}

// ─── Z.ai provider (server-side only; uses z-ai-web-dev-sdk) ────────────────

interface ZaiClient {
  chat: { completions: { create(req: unknown): Promise<{ choices?: { message?: { content?: string } }[] }> } }
}

class ZaiProvider implements LLMProvider {
  readonly name = 'zai'
  readonly model = 'glm-4.6'
  private zai: ZaiClient | null = null

  private async client(): Promise<ZaiClient | null> {
    if (this.zai) return this.zai
    try {
      const mod = await import('z-ai-web-dev-sdk')
      const ZAI = (mod as unknown as { default: { create(): Promise<unknown> } }).default
      this.zai = (await ZAI.create()) as ZaiClient
      return this.zai
    } catch {
      return null
    }
  }

  async isAvailable(): Promise<boolean> {
    return (await this.client()) !== null
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now()
    const client = await this.client()
    if (!client) throw new Error('zai provider unavailable')
    const completion = await client.chat.completions.create({
      messages: req.messages,
      thinking: { type: req.thinking ? 'enabled' : 'disabled' },
    })
    const content = completion.choices?.[0]?.message?.content ?? ''
    return {
      content,
      provider: this.name,
      model: this.model,
      tokensUsed: Math.ceil(content.length / 4),
      durationMs: Date.now() - started,
    }
  }
}

// ─── Null provider: explicitly reports unavailability ───────────────────────

export class ProviderUnavailableError extends Error {
  constructor(public readonly provider: string) {
    super(`LLM provider ${provider} is unavailable`)
  }
}

// ─── Registry with fallback ──────────────────────────────────────────────────

class ProviderRegistry {
  private providers: LLMProvider[] = [new ZaiProvider()]

  get activeProvider(): string {
    return this.providers[0]?.name ?? 'none'
  }

  async health(): Promise<{ provider: string; available: boolean; model: string }[]> {
    const out = []
    for (const p of this.providers) {
      out.push({ provider: p.name, model: p.model, available: await p.isAvailable() })
    }
    return out
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    for (const p of this.providers) {
      if (await p.isAvailable()) {
        return p.complete(req)
      }
    }
    throw new ProviderUnavailableError(this.providers.map(p => p.name).join(', ') || 'none')
  }
}

// Module-level singleton (server only)
const globalForLLM = globalThis as unknown as { __proofloomLLM?: ProviderRegistry }
export const llm = globalForLLM.__proofloomLLM ?? new ProviderRegistry()
globalForLLM.__proofloomLLM = llm

// ─── Output validation ───────────────────────────────────────────────────────

export interface AgentReportSchema {
  summary: string
  findings: { severity: 'info' | 'warning' | 'critical'; title: string; detail: string }[]
  evidenceRefs: string[]
  conclusion: 'PASS' | 'FAIL' | 'NEEDS_REVIEW'
}

/** Parse and validate model output into the execution report schema. */
export function validateAgentReport(raw: string): AgentReportSchema | null {
  // Extract first JSON object from the response.
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<AgentReportSchema>
    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.findings)) return null
    const conclusions: AgentReportSchema['conclusion'][] = ['PASS', 'FAIL', 'NEEDS_REVIEW']
    if (!conclusions.includes(parsed.conclusion as AgentReportSchema['conclusion'])) return null
    return {
      summary: parsed.summary.slice(0, 4000),
      findings: parsed.findings.slice(0, 20).map(f => ({
        severity: (['info', 'warning', 'critical'].includes(f.severity) ? f.severity : 'info') as AgentReportSchema['findings'][number]['severity'],
        title: String(f.title ?? '').slice(0, 200),
        detail: String(f.detail ?? '').slice(0, 2000),
      })),
      evidenceRefs: Array.isArray(parsed.evidenceRefs) ? parsed.evidenceRefs.slice(0, 10).map(String) : [],
      conclusion: parsed.conclusion as AgentReportSchema['conclusion'],
    }
  } catch {
    return null
  }
}
