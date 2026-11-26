# PROOFLOOM

**Verifiable software provenance and AI-agent accountability on Gno.land.**

PROOFLOOM is a provenance layer for software and AI agents: every release carries cryptographic evidence, every attestation is committed on-chain, and anyone — not just customers — can verify the record through a public, read-only protocol realm. No account needed to verify; the protocol is public.

Built for the **Gnome Tavern hackathon** (Gno.land, Onyx testnet). Categories covered: **dApp** (the product), **Realm** (the protocol suite), and **Tools** (the public verification API + agent runtime).

---

## Why

"Passed tests", "the agent completed the task", "security reviewed this" — today these claims are screenshots on a dashboard. PROOFLOOM turns them into commitments: evidence bundles with content-addressed digests, attestations signed by accountable issuers, and verdicts computed by a pure, composable on-chain facade. When an AI agent acts, it acts inside least-privilege grants, its executions are recorded, and nothing publishes without human approval.

## What ships

| Surface | What it is |
| --- | --- |
| **Product app** | Next.js workspace: projects, components, releases, evidence, attestation issuance, policy gates, release lifecycle (draft → evidence → validation → review → published → verified), audit trail, analytics, notifications. |
| **Agent Command** | Agent registry with least-privilege grants (scopes, expiry, revocation), execution console with input/output digests, policy verdicts, and human approval gates. |
| **Public explorers** | No-login registry of public projects, releases and attestations — the "public record" surface. |
| **Proof Atlas** | Interactive evidence graph (projects → releases → attestations → agents) built from live registry data, with an accessible list view. |
| **Verification Portal** | Paste an attestation id, release id, or sha256 digest → an explainable verdict with the exact checks that ran (record exists, signature, issuer identity/authorization, digest integrity, expiry, revocation, chain publication, evidence accessibility, policy completeness). Free, public, no account. |
| **Gno realm suite** | Seven realms + libraries written in Gno — the protocol layer. |

## The Gno realm suite

`chain/realms/proofloom/` — ~3,400 lines of Gno with tests:

| Realm | Role |
| --- | --- |
| `core` | Shared types, digest helpers, authority model |
| `registry` | Project/component identity and ownership commitments |
| `releases` | Release lifecycle states and artifact digest commitments |
| `evidence` (in releases) | Content-addressed evidence references |
| `attestations` | Issuer-signed attestation records, categories, revocation/expiry |
| `policies` | Machine-checkable release gates (required categories, min approvals, no-critical rule) |
| `agents` | Agent identity, scoped grants, execution records |
| `verify` | **Read-only public facade** — composable verdicts for other realms, dApps and indexers. This is the protocol's public API: import it to answer "is this release verified?" without holding authority. |

Realm ownership follows the deploying address (`gno.land/r/<creator>/proofloom/…`), so identity, grants and evidence are anchored to real keypairs on Onyx.

## Architecture

```
Next.js 16 (App Router, TS)  ──  Prisma (SQLite)  ──  REST API
        │                                              │
        │  Adena / GnoConnect wallet (user-owned keys)  │
        │                                              │
        └── gnokey operator flow (platform txs)  ──►  Gno.land Onyx testnet
                                                        └── r/<addr>/proofloom/* realms
```

- **User-owned signing**: link a wallet via signature challenge; the platform never holds user keys.
- **Operator flow**: platform-initiated transactions use a mnemonic provided at runtime via `PROOFLOOM_OPERATOR_MNEMONIC` — never committed, never logged. If absent, endpoints fail with an explicit activation requirement; no simulated success is ever returned.
- **Honest verdicts**: the verifier reports exactly what it checked. If chain RPC is unreachable it says so (`chain_publication — RPC unreachable`) instead of faking a pass.

## Quick start

```bash
# 1. install
bun install

# 2. database (schema push + demo seed)
bun run db:push
bun scripts/seed-demo.mjs

# 3. dev server
bun run dev
# → http://localhost:3000
```

**Demo account** (seeded): `demo@proofloom.io` / `ProofLoom#2026`
Two organizations members, 3 projects, 5 releases, 17 evidence files, 12 on-chain attestations, 2 agents with grants and executions, 10 confirmed chain transactions, 2 policy gates.

**Verify without an account**: open the Verification Portal and paste a seeded attestation id (printed at the end of the seed run) or any release/digest from the explorers.

## Public verification API

```
GET /api/verify/release/{projectId-version}
GET /api/verify/attestation/{protocolId}
GET /api/verify/digest/{sha256}
GET /api/health
```

## Local chain & deployment

`bin/` bundles `gnodev`, `gnokey` and `gno`.

```bash
# All eight realm packages parse and load cleanly with the bundled Gno toolchain:
GNOROOT=<gno-checkout> ./bin/gnodev local -chain-id dev -no-examples -extra-root ./chain/realms
# → Loader: loaded root root=./chain/realms packages=8

# Production deployment (needs a funded deployer key — never committed):
PROOFLOOM_KEY=proofloom-deployer \
PROOFLOOM_KEY_PASSWORD=… \
./chain/scripts/deploy.sh     # deploys core→registry→releases→attestations→agents→policies→verify in dependency order
```

**Deployment status.** The realm suite is written, tested (`gno test`), and parses/loads under the
bundled toolchain. Two honest caveats:

1. **Onyx testnet deployment requires a funded account.** The deploy script signs with
   `PROOFLOOM_KEY` from a keybase; the mnemonic arrives only via `PROOFLOOM_OPERATOR_MNEMONIC`
   at runtime and is never committed. Without it, every chain-write endpoint fails with an
   explicit activation requirement — no simulated success is ever returned.
2. **The vendored `bin/gnovm` stdlib tree is version-mismatched** with the bundled `gnodev`
   binary (the `unicode` package redeclares identifiers its native registry also declares).
   This is an environment defect, not realm code — package loading of `chain/realms` succeeds;
   full in-sandbox node bring-up does not. Point `PROOFLOOM_RPC_URL` at a funded Onyx deployment
   (or a matching-version local node) and the verification portal's `chain_publication` check
   lights up against the real realm state.

`chain/deployments/deployment-dev.json` records the last deployment manifest.

## Testing

```bash
gno test ./chain/realms/proofloom/...   # realm unit tests
bun run lint                            # app lint (clean)
```

## Judging criteria mapping

- **Technical quality (40%)** — typed end-to-end (TS + Gno), scrypt credentials, hashed session tokens, append-only audit, idempotent chain transactions, honest failure states, realm unit tests.
- **User appeal (20%)** — a product you can sign into and use in a minute; public portal requires no account; the Atlas makes provenance legible at a glance.
- **Creativity (20%)** — first-class AI-agent accountability (grants, execution digests, approval gates) on top of software provenance; verification verdicts are composable realms other dApps can import.
- **Docs & demo (20%)** — this README, in-app documentation view, seeded demo data, and a scripted demo path (sign in → publish flow → agent approval → public verify).

## Project name note

PROOFLOOM uses no "Gno" prefix and no official Gno.land branding, per hackathon rules.

## License

Apache-2.0
