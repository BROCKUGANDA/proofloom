# Environment Configuration Reference

Every environment variable read by application code in `src/` (verified by
searching for `process.env` across the tree), plus the variables consumed by
the chain tooling (`chain/scripts/deploy.sh`, realm tests). Defaults are the
in-code defaults; nothing is invented.

---

## Application (`src/`)

### Chain profile — `src/lib/chain.ts` (all optional, all defaulted)

| Variable | Default | Purpose |
|---|---|---|
| `PROOFLOOM_RPC_URL` | `https://rpc.onyx.testnets.gno.land:443` | JSON-RPC endpoint for `abci_query` / `status` calls |
| `PROOFLOOM_CHAIN_ID` | `onyx-1` | expected chain id; mismatch ⇒ `CHAIN_ID_MISMATCH` |
| `PROOFLOOM_WS_URL` | `wss://rpc.onyx.testnets.gno.land:443/websocket` | websocket endpoint (exposed in profiles; no ws consumer code yet) |
| `PROOFLOOM_EXPLORER` | `https://gnoscan.io` | base URL for `txExplorerUrl` / `realmExplorerUrl` |
| `PROOFLOOM_FAUCET` | `https://faucet.gno.land/` | faucet URL surfaced in chain profile / docs |
| `PROOFLOOM_REALM_PREFIX` | `gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom` | realm namespace used to build query paths (`realmPath(pkg)`) |

### Operator signing — `src/lib/operator.ts`

| Variable | Default | Required? | Purpose |
|---|---|---|---|
| `PROOFLOOM_OPERATOR_MNEMONIC` | *(none)* | Optional — **secret** | Platform-operated (testnet) signing. When absent, `operatorAvailable()` is false and `POST /api/chain` ops `publish-on-chain` / `attest-on-chain` fail **explicitly** with error code `FAUCET_DEPLETED` plus recovery guidance ("Set PROOFLOOM_OPERATOR_MNEMONIC … or connect Adena"). No simulated success. |
| `PROOFLOOM_GNOKEY_BIN` | `/home/z/my-project/bin/gnokey` | No | gnokey binary used for temp-keybase recovery + `maketx` broadcast |

### Verification — `src/lib/verification.ts`

| Variable | Default | Required? | Purpose |
|---|---|---|---|
| `PROOFLOOM_OPERATOR_ADDRESS` | *(none)* | No | g1 address treated as an authorized issuer for platform-issued attestations in the `issuer_authorized` verification check |

### Webhooks — `src/app/api/webhooks/github/route.ts`

| Variable | Default | Required? | Purpose |
|---|---|---|---|
| `PROOFLOOM_GITHUB_WEBHOOK_SECRET` | *(none)* | **Required for webhook use** — **secret** | HMAC-SHA256 key for `x-hub-signature-256` and PROOFLOOM relay signatures. Unset ⇒ `GITHUB_UNAUTHORIZED` (no silent success). |

### Platform

| Variable | Default | Required? | Purpose |
|---|---|---|---|
| `DATABASE_URL` | *(none — must be set)* | **Required** — **secret if credentials embedded** | Prisma SQLite connection, e.g. `file:db/custom.db` (`prisma/schema.prisma` reads `env("DATABASE_URL")`). The runtime test `tests/database-runtime-build.sh` asserts an absolute `file:` path. |
| `NODE_ENV` | `development` | No | `src/lib/db.ts` caches the Prisma client in `globalThis` only when **not** production |

## Chain tooling (not read by `src/`, but by scripts)

| Variable | Default | Where | Purpose |
|---|---|---|---|
| `PROOFLOOM_REMOTE` | `https://rpc.onyx.testnets.gno.land:443` | `chain/scripts/deploy.sh` | RPC broadcast target |
| `PROOFLOOM_CHAINID` | `onyx-1` | `chain/scripts/deploy.sh` | chain id; names the deployment manifest |
| `PROOFLOOM_KEY` | `proofloom-deployer` | `chain/scripts/deploy.sh` | deployer key name in keybase |
| `GNOKY_HOME` | `$HOME/.config/gno` | `chain/scripts/deploy.sh` | keybase directory |
| `PROOFLOOM_KEY_PASSWORD` | *(none)* — **secret** | `chain/scripts/deploy.sh` | when set, piped via `--insecure-password-stdin` for CI; else interactive prompt |
| `GNOKEY_BIN` | `gnokey` | `chain/scripts/deploy.sh` | binary override |
| `GNOROOT` | *(none)* | realm test/build invocations | must point at `/home/z/my-project/bin` so `gnovm/stdlibs` resolves (see `LOCAL_SETUP.md` §1) |

## Secrets — never commit

`PROOFLOOM_OPERATOR_MNEMONIC`, `PROOFLOOM_KEY_PASSWORD`,
`PROOFLOOM_GITHUB_WEBHOOK_SECRET`, `DATABASE_URL` (when it embeds
credentials), and any gnokey keystore contents (`.keys/`). `.env*` is
git-ignored for new files.

> **Repository reality (verified):** `.env`, `.keys/keystore.pw` and the
> `.keys/gnokey/` keybase are currently **tracked by git** (`git ls-files`
> lists them) — a leak-class gap requiring `git rm --cached`, ignore rules,
> and key rotation. See `docs/security/SECURITY_CONTROLS.md` §8. Until
> remediated, treat all of those values as exposed; this is one reason the
> operator path is documented as testnet-only.

## Reading order for operators

1. Set `DATABASE_URL`, run `npm run db:push` (`LOCAL_SETUP.md` §4).
2. Leave chain vars at defaults (Onyx) or point them at local `gnodev`.
3. Decide the signing model: user-owned (Adena, no server secrets) or
   platform-operated (set `PROOFLOOM_OPERATOR_MNEMONIC`, testnet only).
4. If webhooks are used, set `PROOFLOOM_GITHUB_WEBHOOK_SECRET` before
   configuring the GitHub webhook.
5. Verify with `GET /api/health` and `GET /api/chain`
   (`identity.ok`, realm paths, recent transactions).
