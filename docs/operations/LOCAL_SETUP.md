# Local Setup

Verified against this repository on the local machine. Commands are run from
the repo root `/home/z/my-project` unless noted.

---

## 1. Prerequisites

- **Node + package manager:** the repo uses `bun.lock` and `npm`-compatible
  scripts; `npm install` works (`start` script invokes `bun` at runtime).
- **Gno v1.8.0 toolchain, repo-local:** `bin/gno`, `bin/gnokey`,
  `bin/gnodev` plus **`bin/gnovm/stdlibs`** — the Gno standard-library tree,
  installed from the gno v1.8.0 source (`.gnosrc/gno`). This is the known
  **GNOROOT fix**: without `bin/gnovm/stdlibs`, realm compilation fails with
  errors like `package strings is not in std (…/stdlibs/strings)`. Verify:

  ```bash
  ./bin/gno version        # → gno version: v1.8.0
  ls bin/gnovm/stdlibs     # must exist (sort, strings, time, testing, …)
  ```

  When invoking gno, set `GNOROOT=/home/z/my-project/bin` so the VM resolves
  stdlibs at `$GNOROOT/gnovm/stdlibs`. (Setting `GNOROOT=bin/gnovm` makes it
  look for `bin/gnovm/gnovm/stdlibs` and fail — use the repo root, not the
  gnovm subdirectory.)

- **gnokey keyring:** `gnokey` stores keys under `GNOKY_HOME`
  (default `~/.config/gno`). The repo also contains a local dev keybase at
  `.keys/gnokey/` used by `gnodev` — see the security note in
  `docs/security/SECURITY_CONTROLS.md` §8 (these files are currently
  git-tracked; do not copy that pattern).

## 2. Install

```bash
npm install
```

## 3. Environment

`.env` is git-ignored by rule (`.env*`) — create it if missing. Minimum for
local development:

```dotenv
DATABASE_URL=file:db/custom.db
```

Chain-facing variables all have working defaults (from `src/lib/chain.ts`),
so a local setup runs without them:

```dotenv
# optional; defaults shown
PROOFLOOM_RPC_URL=https://rpc.onyx.testnets.gno.land:443
PROOFLOOM_CHAIN_ID=onyx-1
PROOFLOOM_WS_URL=wss://rpc.onyx.testnets.gno.land:443/websocket
PROOFLOOM_EXPLORER=https://gnoscan.io
PROOFLOOM_FAUCET=https://faucet.gno.land/
PROOFLOOM_REALM_PREFIX=gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom
# platform signing (optional; absent ⇒ FAUCET_DEPLETED on operator endpoints)
# PROOFLOOM_OPERATOR_MNEMONIC=<testnet-only deployer mnemonic — never commit>
# webhooks
# PROOFLOOM_GITHUB_WEBHOOK_SECRET=...
# operator identity used by verification issuer checks
# PROOFLOOM_OPERATOR_ADDRESS=g1...
```

Full reference: `docs/operations/ENVIRONMENT_CONFIGURATION.md`.

> To point the app at a **local gnodev** chain instead of Onyx, set
> `PROOFLOOM_RPC_URL=http://127.0.0.1:26657`, `PROOFLOOM_CHAIN_ID=dev`, and
> matching `PROOFLOOM_REALM_PREFIX` (see `chain/deployments/deployment-dev.json`).

## 4. Database

```bash
npm run db:generate      # prisma generate
npm run db:push          # prisma db push --accept-data-loss → creates db/custom.db
```

The Prisma datasource is SQLite (`prisma/schema.prisma`), so no database
server is needed. `db/custom.db` is a local artifact; demo/demo-seeded data
in it is **not** production data.

## 5. Dev server

```bash
npm run dev              # next dev -p 3000 (logs tee'd to dev.log)
```

- App: `http://localhost:3000`
- Health probe: `GET /api/health` → database/chain/LLM checks
  (`degraded` when the RPC is unreachable — expected without a funded chain).

## 6. Realm tests

```bash
cd chain/realms
GNOROOT=/home/z/my-project/bin /home/z/my-project/bin/gno test \
    ./proofloom/... ./consumer-example/example/...
```

Expected output: `ok` for all 8 packages (agents, attestations, core,
policies, registry, releases, verify, consumer-example/example) — 29 test
functions total. The `./consumer-example/...` glob reports a harmless
"package has no files" failure for the module root (it contains only
`gnomod.toml`); test the leaf package as shown above.

## 7. Realm deployment (local gnodev)

```bash
./bin/gnodev &                               # local chain on :26657
PROOFLOOM_REMOTE=http://127.0.0.1:26657 \
PROOFLOOM_CHAINID=dev \
GNOKY_HOME=/home/z/my-project/.keys/gnokey \
./chain/scripts/deploy.sh
```

Writes `chain/deployments/deployment-dev.json`. The current manifest records
the local dev deployment (its tx hashes are base64 dev-chain digests, **not**
Onyx transactions). Details and caveats: `docs/protocol/DEPLOYMENT_GUIDE.md`.

## 8. Production build

```bash
npm run build     # next build + copies .next/static and public into .next/standalone
npm start         # NODE_ENV=production bun .next/standalone/server.js (logs → server.log)
```

## 9. Shell-based runtime tests (repo infrastructure)

`tests/python-runtime-build.sh`, `tests/python-runtime-container.sh` and
`tests/database-runtime-build.sh` are sandbox *infrastructure* checks (they
exercise the `.zscripts/` runtime packaging helpers, e.g. "DATABASE_URL must
be an absolute SQLite file URL"). They are not PROOFLOOM feature tests —
see `docs/testing/TEST_STRATEGY.md`.

## 10. Quick troubleshooting

| Symptom | Cause / fix |
|---|---|
| `package strings is not in std` | `GNOROOT` wrong or `bin/gnovm/stdlibs` missing → reinstall stdlibs from gno v1.8.0 source; use `GNOROOT=/home/z/my-project/bin` |
| `CHAIN_UNAVAILABLE` in health | no RPC reachable; fine offline — chain checks degrade, DB works |
| `FAUCET_DEPLETED` on operator endpoints | `PROOFLOOM_OPERATOR_MNEMONIC` unset — expected; connect Adena or set the testnet mnemonic |
| `WEBHOOK_SIGNATURE_INVALID` | webhook secret unset/mismatched — set `PROOFLOOM_GITHUB_WEBHOOK_SECRET` |
| Prisma opens wrong DB file | `DATABASE_URL` must be a `file:` URL; the runtime test asserts an absolute path |
