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

`bin/` bundles `gnodev`, `gnokey` and `gno`. The realm suite deploys end-to-end
with `chain/scripts/deploy.sh` — verified on a local gnodev chain (dev):

```
── deploying core ...            tx: taKEBnEvB5LhmP2rTubDk2gOqxJUOilkK1rHZ9HEqHQ=
── deploying registry ...        tx: wqCvu4ixKG0QRIzQk7NzM1Hzxg5l/z63ptRZ5vtMdBA=
── deploying releases ...        tx: kMe8RxJ0B8sLbpPW+Enb43loWDkYHME9kOKnWpbkeik=
── deploying attestations ...    tx: V1hU8A/d32brZYOCMkUpmz5VYE6pn4yBRStt5nNQkdA=
── deploying agents ...          tx: J5q3sA/xgm/kryKAaJ/7IIdZHH/7wCKHRdBsQOI20ls=
── deploying policies ...        tx: Q37e+D+pspRdbAbMbopDzGnhKjiBSCtR9ZbKEwQHvWk=
── deploying verify ...          tx: D5lTCe/0B7n4n7qT+mPDiguIHmAynU8QWqs5PjAdje4=
── initializing realms ...       5/5 Init transactions
✓ deployment manifest written to chain/deployments/deployment-dev.json
```

And the public verification facade answers on-chain queries immediately:

```
$ gnokey query vm/qeval -data '…/proofloom/verify.VerifyRelease("x")' --remote http://127.0.0.1:26657
data: (struct{…("UNKNOWN" string),…("release does not exist" string)} …verify.ReleaseVerdict)
```

**How the pipeline works.** Realm sources reference each other by absolute
module path, and module paths embed the deployer's address. `deploy.sh` stages
a copy of `chain/realms`, rewrites every cross-realm import to the deployer's
actual address, then deploys the seven packages in dependency order and calls
each realm's `Init`. The source tree on disk is never mutated.

**Reproduce locally** (three terminals or one script):

```bash
# 1. generate a deployer key (empty passphrase for dev only)
gnokey --home "$GNOKY_HOME" add proofloom-deployer --insecure-password-stdin

# 2. start the dev node with that account premined
gnodev local -chain-id dev -no-examples -extra-root ./chain/realms \
  -add-account "g1…=1000000000ugnot"

# 3. deploy + initialize everything
PROOFLOOM_REMOTE=http://127.0.0.1:26657 PROOFLOOM_CHAINID=dev \
PROOFLOOM_KEY=proofloom-deployer PROOFLOOM_KEY_PASSWORD="" ./chain/scripts/deploy.sh

# 4. point the product at the deployment
PROOFLOOM_RPC_URL=http://127.0.0.1:26657
PROOFLOOM_REALM_PREFIX=gno.land/r/<deployer>/proofloom
```

**Onyx testnet.** The same pipeline deploys to Onyx unchanged:
`PROOFLOOM_REMOTE=https://rpc.onyx.testnets.gno.land:443 PROOFLOOM_CHAINID=onyx-1`
with a **funded** deployer key. The mnemonic arrives only via
`PROOFLOOM_OPERATOR_MNEMONIC` at runtime and is never committed, logged, or
hardcoded — every chain-write endpoint fails with an explicit activation
requirement rather than simulating success.

Two environment caveats, stated plainly:

1. The vendored `bin/gnovm` stdlib tree had version-mismatch artifacts
   (`unicode`, `chain/runtime` redeclarations against the bundled `gnodev`
   binary). Those were reconciled in-tree so the dev node boots; the realm
   packages themselves needed no changes to compile or run.
2. The sandbox recycles processes, so the in-memory gnodev chain does not
   persist between sessions — the manifest records the transactions of the
   last completed run.

`chain/deployments/deployment-dev.json` records the last deployment manifest.
