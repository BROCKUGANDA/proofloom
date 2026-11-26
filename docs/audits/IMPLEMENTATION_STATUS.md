# Implementation Status Ledger

Factual status of PROOFLOOM as of this documentation pass. Each entry states
**how it was verified**. Nothing in this document claims verification that
did not happen. Demo data and dev-chain records are explicitly labeled as
such.

---

## 1. Implemented & verified

| Item | How verified |
|---|---|
| All 7 proofloom realm packages + consumer example compile against gno v1.8.0 | `gno test` run in this environment: `GNOROOT=/home/z/my-project/bin ./bin/gno test ./proofloom/... ./consumer-example/example/...` → `ok` for **8 packages** (agents, attestations, core, policies, registry, releases, verify, consumer-example/example) |
| 29 realm test functions exist (core 6, registry 7, releases 3, attestations 3, agents 3, policies 1, verify 5, consumer 1) | `rg "func Test"` over `chain/realms/**/*_test.gno` |
| On-chain state machines, authorization denials, duplicate protection | Exercised by the realm tests above (e.g. `TestReleaseStateMachine`, `TestUnauthorizedRegistration`, `TestAdminCannotBeUsurped`, `TestIssueAndDuplicatePrevention`, `TestConsumerGate`) — all passing |
| gno toolchain binaries present and versioned | `./bin/gno version` → `gno version: v1.8.0`; `bin/gnokey`, `bin/gnodev` exist; `bin/gnovm/stdlibs` populated from gno v1.8.0 source (`.gnosrc/gno`) |
| Deployment pipeline script + manifest format | Read `chain/scripts/deploy.sh` end-to-end; `chain/deployments/deployment-dev.json` conforms to the script's output schema |
| **Local gnodev deployment (dev chain only)** | `deployment-dev.json` records 7 addpkg entries + 5 Init tx hashes with `remote: http://127.0.0.1:26657` and a `network` field explicitly labeling it *"dev (gnodev local chain — pipeline verification; Onyx deployment pending faucet funding)"*. **These are local dev records with base64 dev-chain hashes — not Onyx transactions, not production records.** |
| Prisma schema + SQLite DB | `prisma/schema.prisma` (30 models); `db/custom.db` exists; `DATABASE_URL=file:db/custom.db` set in `.env` (value not reproduced here) |
| Next.js app builds (structure, not CI-proven in a pipeline) | `npm run build` script present; TS project compiles as part of this environment's dev workflow — a fresh `npm run build` was **not** executed during this documentation pass, see §2 |
| Auth primitives | Code-read + direct source verification: scrypt hashing (`crypto.ts`), sha256-hashed session tokens, cookie flags (`auth.ts`), TOTP (`crypto.ts`), RBAC capability tables (`auth.ts`) |
| Webhook verification implementation | `src/app/api/webhooks/github/route.ts` read line-by-line: HMAC-SHA256 over raw body, constant-time compare, delivery dedupe, 40 KB cap, audit write |
| Rate limiting implementation | `src/lib/rate-limit.ts` read: exact buckets (auth 50/5min, verify 120/min/IP, api 600/min/org, agent-exec 30/min/org, registration 10/h/IP) |
| API surface | All routes under `src/app/api/**` read during documentation (auth, session, orgs, projects, releases, evidence, attest, agents, executions, tasks, policies, analytics, audit, keys, notifications, chain, verify, public/explore, health, webhooks/github) |

## 2. Implemented but not fully verified

| Item | What is missing from verification |
|---|---|
| `npm run build` / `npm start` production flow | Script exists and the app was developed in this workspace, but a clean production build was not executed as part of this documentation pass — treat as unverified until run |
| Operator broadcast flow (`operator.ts`) | Implemented (temp keybase, `maketx call/addpkg --broadcast sync`, hash parsing, `FAUCET_DEPLETED` fail-closed) but **never exercised end-to-end in a recorded run** — no funded Onyx key, and the publish path has a realm-function mismatch (see §3) |
| `reconcileTransaction` confirmation loop | Code verified (`chain.ts`, `chain/route.ts op=confirm-on-chain`) but no broadcast has been confirmed in a recorded run; state-based logic is unit-reasoned, not integration-tested |
| Adena client flows (`client.ts`) | Wallet abstraction code exists (`detectAdena`, `walletConnect`, `signEcdsa`, `sendTransaction`); no browser E2E with a real Adena extension was performed |
| Webhook ingestion against real GitHub | Signature logic verified by code reading only; no live GitHub delivery was captured/processed in a recorded run |
| Shell runtime tests (`tests/*.sh`) | Present and runnable in principle; they test sandbox infrastructure (`.zscripts`), not PROOFLOOM — not executed in this pass |
| `GET /api/health` | Implemented (DB/chain/LLM checks); the **200 OK** response is expected but was not captured in a recorded run during this pass — the server was not started for this audit |

## 3. Known code/data discrepancies (found while documenting)

1. **`publish-on-chain` realm mismatch:** `src/app/api/chain/route.ts` calls
   realm function `PublishRelease(protocolId, slug, version, commit, digest)`
   — the deployed `releases` realm exports no such function (`Publish(id)`
   etc.). Operator publishing will fail at the chain (fail-closed).
2. **Secrets tracked in git:** `.env`, `.keys/keystore.pw`,
   `.keys/gnokey/data/keys.db/*` are listed by `git ls-files`; `.gitignore`
   has no `.keys/` rule and `.env` predates the `.env*` rule. Rotation +
   untracking required (`SECURITY_CONTROLS.md` §8).
3. **zod unused:** `zod` is a declared dependency but no `src/` file imports
   it; validation is hand-rolled (`requireFields`, regexes, validators).
4. **Agent grant semantics differ:** app upsert overwrites a live grant
   (`agents/route.ts op=grant`), on-chain `GrantPermission` panics instead
   (`agents.gno`).
5. **`RECONCILIATION_REQUIRED`** is in `TX_STATES` but no code transitions a
   record into it.
6. **`vm/qeval` used** for abci_query realm reads (no `vm/qrealm` anywhere).
7. **GNOROOT nuance:** tests must run with `GNOROOT=/home/z/my-project/bin`
   (not `bin/gnovm`), because stdlibs resolve at `$GNOROOT/gnovm/stdlibs`;
   and `./consumer-example/...` reports a harmless no-files setup error for
   the module root — test `./consumer-example/example/...`.

## 4. Externally blocked

| Item | Blocker |
|---|---|
| **Onyx testnet deployment of the realms** | The deployer address `g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq` has no testnet balance. The external faucet (`https://faucet.gno.land/`, the `PROOFLOOM_FAUCET` default) is captcha- and IP-throttle-gated; funding could not be completed from this environment. Until funded, `deploy.sh` cannot broadcast addpkg/Init to `onyx-1`, and **no Onyx transaction hash exists** for PROOFLOOM. Everything on-chain claimed in these docs is local-gnodev-verified only. |
| Platform-operated transactions on Onyx | Dependent on the same funding (mnemonic holder must hold ugnot for gas). |
| Live GitHub webhook validation | Requires a publicly reachable HTTPS endpoint + GitHub app/webhook registration — not available in this sandbox. |

## 5. Planned (not implemented)

- TypeScript test suites (jest/vitest/playwright absent from
  `package.json`; no `*.test.ts` anywhere) — see `TEST_STRATEGY.md`.
- CI pipeline configuration (no `.github/workflows`, no CI config file).
- Outbound webhook dispatcher (`WEBHOOKS.md` §2).
- Object-storage evidence adapter (>512 KiB) — named in the evidence route's
  error message, not implemented.
- API-credential authentication on ingestion routes (`ApiCredential` model +
  management API exist; no auth middleware consumes `keyHash` yet).
- Repository sync from GitHub (`GITHUB.md` §Repository sync — planned).
- Retention/pruning jobs for sessions, webhook deliveries, usage records.
- Email delivery for invitations (invite URL is returned in the API
  response instead — honestly labeled in the members route).

## 6. Verification commands used for this ledger

```bash
cd chain/realms && GNOROOT=/home/z/my-project/bin /home/z/my-project/bin/gno test \
  ./proofloom/... ./consumer-example/example/...   # → ok ×8 packages
rg "func Test" proofloom/*/*_test.gno consumer-example/example/*_test.gno
./bin/gno version                                  # → gno version: v1.8.0
git ls-files | rg "keys|env|keystore"              # → confirms §3.2
rg "process\.env\." src/                           # → env var inventory
```

No transaction hash, endpoint, or function name in the docs was invented;
dev-manifest hashes are quoted only as local dev records.
