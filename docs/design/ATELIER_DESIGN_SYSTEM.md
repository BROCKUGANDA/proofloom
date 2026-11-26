# THE ATELIER — PROOFLOOM Design System

Sources read for this document: `src/app/globals.css`, `src/app/layout.tsx`,
`tailwind.config.ts`, `src/components/atelier/kit.tsx`, `src/components/atelier/emblem.tsx`,
`src/components/proofloom-app.tsx` (theme switching), and the views that consume the kit.

The stylesheet header declares the system's own framing:

> THE ATELIER — PROOFLOOM design system. "The architecture of trust, made visible."
> Three coordinated environments share one language:
> ATELIER (editorial parchment) · OBSERVATORY (dark analysis) · CONTROL ROOM (operational density)

---

## 1. Three visual environments

The environments are **not** separate route trees — they are token sets and primitive treatments
applied across one hash-routed application (`src/components/proofloom-app.tsx`). Dark
(Observatory) is the product default; light (Atelier editorial) is toggled by the header control
(`theme` state toggles the `light`/`dark` classes on `<html>`, `proofloom-app.tsx` lines ~192–196).

### 1.1 ATELIER — Editorial (marketing / public pages)
- **Where it lives**: the `.light` theme block plus the `.parchment-section` /
  `.atelier-display` primitives; applied by `LandingView` ("ATELIER editorial environment",
  per its file header) and `DocsView` (documentation, API reference, security & trust centre,
  pricing — "one editorial surface").
- **Character**: parchment surfaces (`--surface-editorial: #E9E4D8` in light; `--parchment`
  `#F2EFE7`), serif display headings (`.atelier-display`: Instrument Serif, weight 400,
  line-height 1.04, letter-spacing −0.01em), small-caps eyebrow lead-ins, generous composition
  (problem → protocol → surfaces → composability, per `landing.tsx`).
- **Signature treatment**: `.parchment-section` overrides eyebrow/hash-chip colors for
  on-parchment contrast; `.hash-chip` inside parchment sections uses ink-tinted backgrounds.

### 1.2 OBSERVATORY — Analytical dark surfaces
- **Where it lives**: the `:root` dark defaults (html ships with `class="dark"`,
  `layout.tsx`); consumed by `VerifyPortalView`, `ExplorerView`, `AtlasView`, `AnalyticsView`,
  `AuditView` and every analytical panel.
- **Character**: obsidian background, carbon surfaces, precision grid backdrop (`.obs-grid`,
  28px lines), hash/id chips, ProofSeal state capsules, TrustMeter segment meters.
- **Signature treatment**: `.loom-panel` / `.loom-panel-raised` information surfaces with
  border-hover transitions; `.trace-line`/`.trace-node` provenance rails; monospace
  `.font-mono-sm` for digests with `--hash-tracking: 0.02em`.

### 1.3 CONTROL ROOM — Operational dense views
- **Where it lives**: the authenticated shell (`ShellLayout` in `proofloom-app.tsx` wraps
  Workspace / Analytics / Audit / Settings) and the operational surfaces
  `ProjectView`, `ReleaseView`, `AgentsView`.
- **Character**: dense panels, fixed `--sidebar-w: 232px` and `--header-h: 56px` chrome,
  status dots, lifecycle rails, seal-capsuled machine states everywhere, destructive-zone
  framing (`.destructive-zone`), keyboard hints (`.kbd`).
- **Signature treatment**: the same tokens at higher density — `--text-xs 0.72rem`,
  `--text-sm 0.82rem` keep data legible in compact rows; buttons get press feedback
  (`.btn-press`).

## 2. Color tokens

Confirmed from `src/app/globals.css` (`:root` block). Foundation palette:

| Token | Value | Role |
| --- | --- | --- |
| `--obsidian` | `#090D11` | Dark background base (`--background`) |
| `--carbon` | `#151D24` | Surface (`--surface`) |
| `--iron` | `#25333B` | Raised surface (`--surface-raised`) |
| `--parchment` | `#F2EFE7` | Editorial base; light-theme background |
| `--parchment-deep` | `#E9E4D8` | Editorial raised surface |
| `--mist` | `#B7C1C2` | Secondary text (`--text-secondary`) |
| `--verdigris` | `#55D8C2` | Accent (`--accent`), verified state |
| `--copper` | `#D6A36C` | Warm accent (`--accent-warm`) |
| `--cobalt` | `#7599D9` | Info accent (`--accent-info`) |
| `--ash` | `#6E7A80` | Muted text |

Semantic state tokens (dark theme): `--verified #55D8C2`, `--pending #E7B95C`, `--info #7599D9`,
`--rejected #E86D72`, `--revoked #C77B80`, `--unknown #8A969D`, `--critical #E86D72`,
`--warning #E7A65C`. Border tokens `--border #26323B`, `--border-strong #33424C`; text tokens
`--text-primary #E9EDEE`, `--text-muted #7E8C93`; focus/selection:
`--focus-ring rgba(85,216,194,0.45)`, `--selection rgba(85,216,194,0.16)`.

**Light (ATELIER) overrides** (`.light` block): background `#F2EFE7`, surface `#FBF9F3`,
raised `#FFFFFF`, borders `#DDD6C6`/`#C9C0AC`, text `#1A232B`/`#46545C`, accent `#0E7C6B`
(verifying teal-dark), warm `#A8683A`, info `#3D63A8`, and adjusted state colors
(`verified #0E7C6B`, `pending #A8683A`, `rejected #B23A40`, `revoked #9E4A50`,
`critical #B23A40`, `warning #A8683A`).

**shadcn bridge**: an `@theme inline` block maps the tokens onto shadcn variables
(`--color-background`, `--color-primary: var(--accent)`, `--color-destructive:
var(--critical)`, fonts, radii). Note an integration wrinkle: `tailwind.config.ts` still maps
colors through `hsl(var(--…))` (the older HSL convention) while `globals.css` defines raw hex /
oklab tokens — the components in practice consume the CSS variables directly (e.g.
`text-[var(--verified)]`, `border-[color:var(--critical)]`), so the system works, but the
`hsl(var(--…))` config entries are vestigial scaffold.

Radii: `--radius-sm 4px`, `--radius-md 8px`, `--radius-lg 12px`; shadcn `--radius: 8px`.
Motion tokens: `--micro-duration 140ms`, `--transition-duration 240ms`, `--macro-duration 420ms`,
`--ease-out cubic-bezier(0.22,1,0.36,1)`, `--ease-in-out cubic-bezier(0.65,0,0.35,1)`.
Reduced motion is honored globally (`@media (prefers-reduced-motion: reduce)` zeroing animation
and transition durations) **and** via an in-app `.reduce-motion` toggle that
`proofloom-app.tsx` applies from `matchMedia('(prefers-reduced-motion: reduce)')` plus a user
setting.

## 3. Typography

Confirmed from `src/app/layout.tsx` (Next/font Google loaders) and the `--font-*` tokens in
`globals.css`:

| Token | Font | Loaded as | Fallbacks | Use |
| --- | --- | --- | --- | --- |
| `--font-display` | **Instrument Serif** (400) | `--font-instrument-serif` | Georgia, 'Times New Roman', serif | Editorial display headings (`.atelier-display`, `.font-display`) |
| `--font-ui` | **Manrope** | `--font-manrope` | ui-sans-serif, system-ui | Body + UI text (body default, `--font-sans`) |
| `--font-mono` | **IBM Plex Mono** (400/500/600) | `--font-plex-mono` | ui-monospace, SFMono-Regular, Menlo | Digests, ids, states, eyebrows (`.font-mono`, `.font-mono-sm`, `.eyebrow`, `.hash-chip`, `.kbd`) |

Type scale: `--text-xs 0.72rem` … `--text-5xl 4.8rem` (11 steps). The `.eyebrow` class combines
mono + uppercase + `0.14em` tracking; hash/id text uses `--hash-tracking: 0.02em`.

## 4. Signature components (`src/components/atelier/kit.tsx`)

Real exports, with their actual props:

| Component | Props | Behavior (as implemented) |
| --- | --- | --- |
| `ProofSeal` | `status: string; label?: string; pulse?: boolean` | Maps ~30 platform states to seal tones via `SEAL_TONES` (VERIFIED/PUBLISHED/ACTIVE/… → `seal-verified`; PENDING/VALIDATING/RUNNING/… → `seal-pending`; REJECTED/FAILED/DISPUTED → `seal-critical`; REVOKED/EXPIRED → `seal-revoked`; DRAFT/OPEN/UNKNOWN/SUPERSEDED → `seal-unknown`). Chooses verified/revoked/pending glyphs; `pulse` adds a soft pulsing dot; entry animation `.seal-land`. |
| `HashChip` | `value: string; display?: string; prefix?: string` | Monospace truncated id chip; full value in `title`. |
| `CopyButton` | `text: string; size?: number` | Clipboard write with 1.4 s copied-state check icon; silent on clipboard failure. |
| `TrustMeter` | `segments: { passed: boolean; requirement: string }[]; label?: string` | Segment meter (`role="meter"` with aria values) + `passed/total` mono counter + sr-only percentage. |
| `PolicyVerdict` | `checks: { requirement: string; passed: boolean; detail: string }[]` | Per-requirement verdict list with verified/pending glyphs; empty state text "No policy configured — protocol baseline applies." |
| `ChainReceipt` | `tx: { txHash?, status, kind, chainId?, createdAt?, confirmedAt?, error? }; explorer?: string` | Loom panel: kind label, `ProofSeal` status, truncated tx hash + copy + explorer link (`{explorer}/tx/{hash}`), error line. |
| `AgentSigil` | `name: string; size?: number; active?: boolean` | Deterministic sigil: hue derived from name hash, confined to a "restrained teal-amber band" (150–270°), `GlyphAgent` inside; 50% opacity when inactive. |
| `ProvenanceRail` | `status: string; history?: { from; to; at }[]` | Release lifecycle rail over the 7-step `LIFECYCLE` (DRAFT → VERIFIED); reached/current node styling from `--verified`; terminal states render a trailing `ProofSeal`. `role="img"` with state label. |
| `EvidenceThread` | `title; kind; digest; createdAt?; sizeBytes?; integrityOk?` | Evidence block on the `.evidence-thread` rail: kind eyebrow, truncated digest + copy, KiB size, timestamp, and a critical "digest mismatch" seal when `integrityOk === false`. |
| `AttestationStamp` | `attestation: { protocolId; category; status; issuerAddress; digest; onChain; issuedAt?; chainTxHash? }; onRevoke?: () => void` | Attestation panel: category, "on-chain" info seal, issuer + digest chips, status seal, revoke affordance for active attestations. |
| `PanelSkeleton` | `rows?: number` (default 3) | Loading skeleton inside a loom panel (`aria-busy`, shrinking bar widths). |
| `Spinner` | `label?: string` | Inline `role="status"` spinner + label (default "Loading"). |
| `EmptyState` | `title: string; hint?: string; action?: React.ReactNode` | Empty panel with the `EmptyLoom` glyph, hint line, optional action slot. |

CSS primitives backing these (globals.css): `.proof-seal` + tone classes, `.loom-panel(-raised)`,
`.hash-chip`, `.trace-line`/`.trace-node(-verified|-pending|-rejected)`, `.evidence-thread`,
`.eyebrow`, `.obs-grid`, `.parchment-section`, `.status-dot`, `.destructive-zone`, `.kbd`,
`.scroll-slim`, `.btn-press`, and the animations `seal-land`, `hash-scan`, `pulse-soft`.

## 5. Emblem & glyph vocabulary (`src/components/atelier/emblem.tsx`)

- **`Emblem`** — the mark: three interwoven paths (Source, Execution, Evidence) resolving into a
  central verification node. Props `{ size?, className?, tone?: 'accent' | 'mono' | 'ink' }`.
  Vector-first; "never emoji" (file header).
- **`Wordmark`** — Emblem + spaced mono uppercase "Proofloom". Props `{ className?, size? }`.
- **Trust-state glyphs** — 13 consistent 1.5-stroke, 16-grid SVG glyphs:
  `GlyphVerified`, `GlyphPending`, `GlyphRevoked`, `GlyphAgent`, `GlyphRelease`, `GlyphSource`,
  `GlyphCommitment`, `GlyphExternalIssuer`, `GlyphCrossRealm`, `GlyphHumanApproval`,
  `GlyphPolicyFail`, `GlyphAuditTrail`, `GlyphMismatch` — plus a name-based `Glyph` dispatcher
  over the `GLYPHS` registry (unknown names fall back to `GlyphPending`).
- **`EmptyLoom`** — empty-state illustration: an unfinished loom (warp threads + three weft
  curves + a center node). Props `{ className? }`.

## 6. Accessibility & motion rules implemented

- Skip-to-content link, `aria-live` toast stack, `role="status"` spinners, `aria-busy` skeletons,
  `role="img"`/`role="meter"` semantics in kit components, sr-only percentages.
- `prefers-reduced-motion` honored globally, plus an in-app reduce-motion class toggle.
- Focus-visible outline uses `--focus-ring` with 2px offset; selection color is tokenized.
- Honest-state UI: states that cannot be confirmed render `seal-unknown`/`seal-pending`, never a
  fabricated green.
