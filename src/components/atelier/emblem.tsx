// PROOFLOOM emblem and glyph vocabulary.
//
// The emblem: three interwoven paths — Source, Execution, Evidence —
// resolving into a central verification node. Open endpoints express
// extensibility. Vector-first; never emoji.

export function Emblem({ size = 28, className = '', tone = 'accent' }: { size?: number; className?: string; tone?: 'accent' | 'mono' | 'ink' }) {
  const stroke = tone === 'accent' ? 'var(--accent)' : tone === 'ink' ? 'currentColor' : 'var(--text-secondary)'
  const node = tone === 'accent' ? 'var(--accent)' : 'currentColor'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      {/* Source path */}
      <path d="M5 6 C10 6, 13 10, 16 16" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="5" cy="6" r="1.6" stroke={stroke} strokeWidth="1.3" />
      {/* Execution path */}
      <path d="M27 6 C22 6, 19 10, 16 16" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="27" cy="6" r="1.6" stroke={stroke} strokeWidth="1.3" />
      {/* Evidence path */}
      <path d="M16 28 C16 24, 16 20, 16 16" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="28" r="1.6" stroke={stroke} strokeWidth="1.3" />
      {/* Central verification node */}
      <circle cx="16" cy="16" r="3.4" stroke={node} strokeWidth="1.8" fill="none" />
      <circle cx="16" cy="16" r="1.2" fill={node} />
    </svg>
  )
}

export function Wordmark({ className = '', size = 16 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Emblem size={size + 12} />
      <span className="font-mono font-semibold tracking-[0.18em] uppercase" style={{ fontSize: size }}>
        Proofloom
      </span>
    </span>
  )
}

// Trust-state glyph vocabulary — consistent 1.5 stroke, 16px grid.
const glyphProps = {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

export function GlyphVerified(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><circle cx="8" cy="8" r="6" /><path d="M5.5 8l1.8 1.8L10.7 6.4" /></svg>
}
export function GlyphPending(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 1.5" /></svg>
}
export function GlyphRevoked(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><circle cx="8" cy="8" r="6" /><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" /></svg>
}
export function GlyphAgent(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><rect x="3.5" y="5" width="9" height="7" rx="1.5" /><circle cx="6.2" cy="8.5" r="0.9" fill="currentColor" stroke="none" /><circle cx="9.8" cy="8.5" r="0.9" fill="currentColor" stroke="none" /><path d="M8 5V3.2" /></svg>
}
export function GlyphRelease(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3" /></svg>
}
export function GlyphSource(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><path d="M4 2.5h6l2.5 2.5v8.5H4z" /><path d="M6 7h4M6 9.5h4M6 12h2.5" /></svg>
}
export function GlyphCommitment(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><path d="M8 2l5 2.5v4c0 3-2.2 4.8-5 5.5-2.8-.7-5-2.5-5-5.5v-4z" /><path d="M6.2 8l1.4 1.4L10.2 6.8" /></svg>
}
export function GlyphExternalIssuer(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><circle cx="6.5" cy="6.5" r="3.5" /><path d="M2.8 13.5c.8-2 2.2-3 3.7-3s2.9 1 3.7 3" /><path d="M11.5 4.5l3 3m0-3l-3 3" /></svg>
}
export function GlyphCrossRealm(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><rect x="2" y="5" width="5" height="6" rx="1" /><rect x="9" y="5" width="5" height="6" rx="1" /><path d="M7 8h2" /></svg>
}
export function GlyphHumanApproval(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><circle cx="8" cy="5" r="2.5" /><path d="M3 14c.8-3 2.6-4.5 5-4.5s4.2 1.5 5 4.5" /></svg>
}
export function GlyphPolicyFail(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><path d="M8 2l5.5 2.5v4.5c0 2.8-2.3 4.3-5.5 5-3.2-.7-5.5-2.2-5.5-5V4.5z" /><path d="M6.2 6.2L9.8 9.8M9.8 6.2L6.2 9.8" /></svg>
}
export function GlyphAuditTrail(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><path d="M3 3h10M3 6.5h10M3 10h6M3 13.5h8" /></svg>
}
export function GlyphMismatch(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...glyphProps} {...props}><rect x="2.5" y="2.5" width="5" height="5" rx="1" /><rect x="8.5" y="8.5" width="5" height="5" rx="1" /><path d="M2.5 11l5-5M13.5 5l-5 5" /></svg>
}

export const GLYPHS: Record<string, (p: React.SVGProps<SVGSVGElement>) => React.ReactElement> = {
  verified: GlyphVerified, pending: GlyphPending, revoked: GlyphRevoked,
  agent: GlyphAgent, release: GlyphRelease, source: GlyphSource,
  commitment: GlyphCommitment, external: GlyphExternalIssuer,
  crossrealm: GlyphCrossRealm, approval: GlyphHumanApproval,
  policyfail: GlyphPolicyFail, audit: GlyphAuditTrail, mismatch: GlyphMismatch,
}

export function Glyph({ name, className }: { name: string; className?: string }) {
  const G = GLYPHS[name] ?? GlyphPending
  return <G className={className} />
}

// Empty-state illustration: an unfinished loom
export function EmptyLoom({ className = '' }: { className?: string }) {
  return (
    <svg width="120" height="72" viewBox="0 0 120 72" fill="none" className={className} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <line key={i} x1={20 + i * 14} y1="10" x2={20 + i * 14} y2="62" stroke="var(--border-strong)" strokeWidth="1" />
      ))}
      {[0, 1, 2].map(i => (
        <path key={`w${i}`} d={`M20 ${20 + i * 16} C45 ${14 + i * 16}, 75 ${26 + i * 16}, 100 ${20 + i * 16}`} stroke="var(--accent)" strokeOpacity={0.55} strokeWidth="1.2" />
      ))}
      <circle cx="60" cy="36" r="4" stroke="var(--accent)" strokeWidth="1.4" />
    </svg>
  )
}
