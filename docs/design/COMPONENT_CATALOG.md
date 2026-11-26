# PROOFLOOM — Component Catalog

Sources: `src/components/proofloom-app.tsx` (shell + router), `src/components/views/*.tsx`
(14 views, each read), `src/components/atelier/kit.tsx` + `emblem.tsx`, and import analysis of
`src/components/ui/*`. Everything listed here exists in the repo.

---

## 1. Application shell — `src/components/proofloom-app.tsx`

Single-surface SPA: one Next.js route (`/`, `src/app/page.tsx`) renders `ProofloomApp`, which
implements hash-based routing (`#/workspace`, `#/project/{id}/{tab}`, `#/verify/{query}`, … via
`parseHash` / `navigate`). Provides the app context: `session`, `refreshSession`,
`orgId`/`setOrgId`, `theme` ('dark' default) / `toggleTheme`, `toast(kind, title, detail)`,
`reduceMotion`/`setReduceMotion`. Renders `Header` (nav + org switcher + theme + notifications
bell), `ShellLayout` (sidebar for authenticated org views), `Footer`, and a custom `ToastStack`
(`loom-panel-raised` toasts, auto-dismiss 3.8 s / 7 s for errors, `aria-live="polite"`).

Route union: `landing | auth | workspace | project{projectId, tab?} | release{releaseId} |
agents | verify{query?} | explore{query?} | atlas | analytics | audit | settings{tab?} | status |
docs{section?}`.

Authenticated org views (`workspace`, `analytics`, `audit`, `settings`) render inside
`ShellLayout`; unauthenticated visitors to those routes are redirected to `AuthView`. Public
routes (`landing`, `verify`, `explore`, `atlas`, `status`, `docs`) need no session.

## 2. Views (`src/components/views/`)

All views are client components receiving `{ route, go, session, orgId }` and using the shared
`api` client. "States" below = loading / empty / error handling actually implemented per view
(verified by counting `PanelSkeleton` / `EmptyState` / `Spinner` / `ClientError` usage).

### landing.tsx — Editorial landing (public, ATELIER)
Fetches `/api/public/explore` for a live public summary (projects, releases, chain profile,
on-chain stats) and renders the editorial composition: problem → protocol → surfaces →
composability. Uses `Emblem`/`Wordmark`, `ProofSeal`, `HashChip`. Degrades silently when the
API is unreachable (optional data).

### auth.tsx — Authentication
Login/register toggle with MFA code field; honest `ClientError` surfacing via toasts; session
refresh + navigate to workspace on success. Uses shadcn `Button`/`Input`/`Label`.

### workspace.tsx — Executive workspace (auth)
Organization overview: project registry table with status seals, search filter, project-creation
dialog (name/description/repo/category/visibility/tech stack), wallet status display
(`walletStatus()` from the client lib). States: `PanelSkeleton` while loading, `EmptyState`
with create action, `ClientError` toasts.

### project.tsx — Project workspace (auth) — the largest view (623 lines)
Operational surface with shadcn `Tabs`: **Releases** (list with `ProvenanceRail` per release,
create-release dialog with version/commit validation), **Components** (create/deprecate),
**Dependencies** (graph summary: direct vs transitive, by ecosystem, by risk), **Tasks**
(create; agent assignment), **Policy** (editor with required categories, min approvals, issuer
allow-list, flags; simulation via `PolicyVerdict`), **Agents** (scoped to project). Archive +
delete actions with `destructive-zone` framing. States: skeleton, per-tab `EmptyState`, 13
`ClientError` handlers.

### release.tsx — Release detail (auth)
Provenance surface for one release: lifecycle `ProvenanceRail`, evidence library
(`EvidenceThread` + upload dialog with kind/mime/content and client-side digest display),
attestation issuance dialog (category, evidence-or-digest, issuer address, expiry) with
`AttestationStamp` list + revoke, on-chain publication (`ChainReceipt`, publish/confirm buttons
driven by `/api/chain` ops), policy verdict + `TrustMeter`, public-verification hand-off link.
States: skeleton, `EmptyState`, 8 `ClientError` handlers.

### agents.tsx — Agent Command (auth)
Registry of agents (`AgentSigil`), registration dialog (name/description/runtime/model/capabilities),
grant management dialog (scopes + expiry) with revoke, execution console: run button, live
execution list with `ProofSeal` states, approve/reject actions for `AWAITING_APPROVAL`
executions, attest action for completed ones. Provider health display (`llm.health()` via
`/api/agents GET`). States: skeleton, empty, spinner, 9 error handlers.

### audit.tsx — Audit Explorer (auth)
Filterable append-only trail: org-scoped event list with action filter input, per-event target
chips (`HashChip`), metadata, ip, trace id. States: skeleton, empty, error toast.

### analytics.tsx — Analytics (auth)
Renders `/api/analytics`: totals, releases-by-status and attestation-by-category breakdowns,
14-day activity series, verification verdict distribution, transaction stats — with the
data-source labels from the API ("platform records" vs "on-chain realm state"). States: skeleton,
seal-capsuled sections, error toast.

### explorer.tsx — Public Explorers (no auth)
Tabs/segments for projects, releases, attestations with search input; renders
`/api/public/explore` summary data with `ProofSeal` status, active-attestation counts,
`gnoRegistered` flags. States: skeleton, `EmptyState`, deep-link via `navigate`.

### verify-portal.tsx — Verification Portal (no auth)
Account-free verification: search form (accepts release id/protocolId, attestation protocolId, or
sha256 digest), renders the full check-by-check report (each check with
`GlyphVerified`/`GlyphPending`/`GlyphRevoked`), verdict seal, limitations list, embeddable-widget
+ JSON API hand-off section, deep-link support (`#/verify/{query}`). States: `Spinner`
("querying platform and chain state"), error toast on unreachable endpoint.

### atlas.tsx — Proof Atlas (no auth)
"Data-driven evidence graph": Canvas 2D rendering of projects/releases/attestations as selectable
nodes with filtering, refresh, and an accessible list alternative; explicitly respects
reduced-motion (no idle animation). States: `Spinner`, `EmptyState`, canvas fallback list.

### docs.tsx — Documentation (no auth, editorial)
One editorial surface with five sections: Getting started, Protocol architecture, API reference,
Security & trust, Pricing; sticky section nav with deep links (`#/docs/{section}`), smooth
scroll-to-section, copy buttons in code samples. No loading states needed (static content).

### settings.tsx — Settings (auth, ShellLayout)
shadcn `Tabs`: **Organization & members** (roster with capabilities, invite dialog returning the
invite URL, remove member), **API keys** (create with one-time raw key display, revoke),
**Notifications** (preferences UI), **Account security** (MFA setup with otpauth URI, wallet
linking via Adena `walletConnect`/`walletSignMessage`), **Integrations**. States: skeleton,
empty, 10 error handlers.

### status.tsx — Service Status (no auth)
Renders `/api/health`: overall status seal, database / chain identity / LLM provider checks
(availability + model), on-chain registry stats, version. States: skeleton, honest
`degraded`/error details.

## 3. Atelier kit components (`src/components/atelier/kit.tsx`)

Full props are documented in `ATELIER_DESIGN_SYSTEM.md` §4; summary here with their states:

| Component | Purpose | States handled |
| --- | --- | --- |
| `ProofSeal` | Universal state capsule (tone + glyph from `SEAL_TONES` map) | every platform status; unknown → `seal-unknown` |
| `HashChip` | Truncated digest/id chip | `display` override, `title` full value |
| `CopyButton` | Clipboard copy | copied ✓ transient state; silent failure |
| `TrustMeter` | Evidence completeness meter | 0-check edge (`0/0`), aria meter semantics |
| `PolicyVerdict` | Check-by-check policy result | empty-policy message |
| `ChainReceipt` | Tx lifecycle receipt | no-hash, error, explorer link variants |
| `AgentSigil` | Deterministic agent avatar | active/inactive opacity |
| `ProvenanceRail` | Release lifecycle rail | reached/current/terminal states |
| `EvidenceThread` | Evidence block | `integrityOk === false` → digest-mismatch seal |
| `AttestationStamp` | Attestation card | on-chain seal, revoke affordance for ACTIVE |
| `PanelSkeleton` | Loading skeleton | `rows` count |
| `Spinner` | Inline loading | label |
| `EmptyState` | Empty panel | title, hint, action slot |

Emblem exports (`src/components/atelier/emblem.tsx`): `Emblem`, `Wordmark`, 13 `Glyph*` trust
glyphs + `Glyph` registry dispatcher, `EmptyLoom` illustration.

## 4. shadcn/ui primitives

The repo carries the full shadcn/ui set under `src/components/ui/` (47 files). **Only 8 are
actually imported** by the views/shell (verified by import scan):

| Primitive | Used by |
| --- | --- |
| `button` | all views, shell |
| `input` | auth, workspace, project, release, agents, audit, explorer, verify-portal, atlas, settings |
| `label` | auth, workspace, project, release, agents, settings |
| `textarea` | project, release |
| `dialog` | workspace, project, release, agents |
| `select` | workspace, project, release, agents, settings |
| `tabs` | project, settings |
| `dropdown-menu` | proofloom-app.tsx (org switcher / user menu) |

Uninstalled-but-present scaffold: the remaining ~39 primitives (`accordion`, `alert`,
`alert-dialog`, `aspect-ratio`, `avatar`, `badge`, `breadcrumb`, `calendar`, `card`, `chart`,
`checkbox`, `collapsible`, `command`, `context-menu`, `drawer`, `form`, `hover-card`,
`input-otp`, `menubar`, `navigation-menu`, `pagination`, `popover`, `progress`, `radio-group`,
`resizable`, `scroll-area`, `separator`, `sheet`, `skeleton`, `slider`, `sonner`, `switch`,
`table`, `toast`/`toaster`, `toggle`, `toggle-group`, `tooltip`) are included by the scaffold
(`components.json`, `tailwindcss-animate`) but are **not referenced by product views**. Note:
`Toaster` from `ui/toaster` **is** mounted in `src/app/layout.tsx` even though the app's active
toast path is the custom `ToastStack` in the shell — the Radix toaster is mounted but unused by
views.
