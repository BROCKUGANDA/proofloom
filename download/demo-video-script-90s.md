# PROOFLOOM — 90-Second Demo Script
**Sign-in → Publish flow → Agent approval → Public verify**

> Target: hackathon judges. Tone: calm, concrete, no hype. The full 3-minute
> walkthrough is in `proofloom-demo.webm`; this script cuts it to 90 seconds
> (or records 1:1 as a fresh take).

---

## Cast & assets

| Asset | Where |
| --- | --- |
| Demo account | `demo@proofloom.io` / `ProofLoom#2026` (pre-seeded "Verdigris Labs" org, Pro plan) |
| One-click trial | `#/auth` → "One-click demo — try the full product" |
| Project used | **Helios Ledger** (double-entry settlement engine) |
| Release created live | `v2.6.0`, commit `9be1c7d2e4a5…`, artifact digest pre-filled |
| Evidence attached | *Test report — v2.6.0 full regression* (342/342 passed) |
| Attestations issued live | BUILD_PROVENANCE, TEST_EXECUTION, SECURITY_ASSESSMENT, SBOM_COMPLETE, RELEASE_APPROVAL |
| Agent execution | Sentinel Auditor → `AWAITING_APPROVAL` → Approve |
| Public verify | `#/verify` → `helios-ledger-v2.6.0` |

---

## Shot list (seconds are cumulative)

### 0:00–0:08 — Cold open on the claim (8s)
**Screen:** Landing hero — *"Software claims are cheap. Evidence isn't."*
**VO:** "Every release says it passed tests. Every AI agent says it did the work. PROOFLOOM turns those claims into cryptographic evidence, committed on-chain, that anyone can check."

### 0:08–0:18 — One-click trial sign-in (10s)
**Screen:** `#/auth` → click **One-click demo** → workspace appears with trial banner.
**VO:** "No signup friction: one click provisions a trial workspace on a 14-day Pro plan. When the trial lapses, the workspace downgrades to Free automatically — advanced features lock, nothing is deleted."

### 0:18–0:34 — Create the release (16s)
**Screen:** Helios Ledger → Releases → **New release** → type `v2.6.0`, commit hash, artifact digest → Create.
**VO:** "A release starts as a draft bound to a commit. The artifact digest is the anchor: everything downstream points at these exact bytes."

### 0:34–0:50 — Attach evidence (16s)
**Screen:** Release page → **Add evidence** → paste test report → *Hash & attach* (sha256 chip appears).
**VO:** "Evidence is hashed with sha256 on upload — content-addressed, so the record can't silently change. Build logs, test reports, SBOMs, security scans."

### 0:50–1:06 — Attestations satisfy policy (16s)
**Screen:** Attest dialog ×2 (fast montage) → policy verdict panel turns green: *policy "helios-release-gate" v2 satisfied*.
**VO:** "Independent issuers attest the release with their own digests. The publication policy — attestations required, approvals required — is enforced server-side. You cannot publish on a red policy."

### 1:06–1:20 — Agent approval gate (14s)
**Screen:** Agent Command → Sentinel Auditor execution `AWAITING_APPROVAL` → **Approve** → COMPLETED with report digest.
**VO:** "AI agents run real work — but nothing they do reaches the chain without a human approval. Every execution keeps its input and output digests, and the approval is an audit event."

### 1:20–1:32 — Walk to PUBLISHED, verify publicly (12s)
**Screen:** Lifecycle rail → Publish → seal flips to PUBLISHED → cut to `#/verify`, type `helios-ledger-v2.6.0` → verdict panel.
**VO:** "The release walks its lifecycle to PUBLISHED. And the verdict is public: no account, one API call — or this iframe badge on any site."

### 1:32–1:40 — Close on honesty (8s)
**Screen:** The verify panel's *"What this verdict does not claim"* section.
**VO:** "Verification states exactly what was checked — and what wasn't. That honesty is the product. PROOFLOOM: build the record. Prove the work."

---

## One-take shooting notes

- Viewport **1440×900**, dark theme, browser zoom 100%.
- Pre-warm: sign in once, open Helios, close — kills first-load skeleton flashes.
- The verify verdict ends **PENDING** with `chain_publication` unmet until the
  realms are deployed with a funded key — say it out loud ("the on-chain check
  lights up the moment the realm deployment lands; the platform never fakes it").
- Toasts auto-dismiss in ~4s; wait for them between beats.
- Keep the cursor visible; the seal color flips (amber → green) carry the story.
