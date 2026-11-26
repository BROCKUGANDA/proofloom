# PROOFLOOM Deployment Guide

Derived from `chain/scripts/deploy.sh`, `chain/deployments/deployment-dev.json`,
`src/lib/chain.ts` and `src/lib/operator.ts`.

**Current status (factual):** the seven realms have been deployed and
initialized against a **local `gnodev` chain** — `deployment-dev.json` records
that run. The **Onyx testnet deployment is pending**: the deployer address
`g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq` is not yet funded (the external
faucet is captcha- and IP-throttle-gated). All tx hashes in the dev manifest
are base64 digests from the local dev chain — **they are not Onyx records and
must never be cited as production transactions**.

---

## 1. Prerequisites

- `gnokey` v1.8.0+ (repo-local binaries: `/home/z/my-project/bin/gnokey`,
  `gno`, `gnodev`; verify with `./bin/gno version` → `gno version: v1.8.0`).
- `GNOROOT` pointing at `/home/z/my-project/bin` so the VM finds
  `bin/gnovm/stdlibs` (the stdlibs tree installed from the gno v1.8.0 source;
  without it realm compilation fails with `package strings is not in std`).
- A funded deployment key in a keybase (`GNOKY_HOME`), key name
  `PROOFLOOM_KEY`.
- Network args (see §3).

## 2. Key creation

```bash
export GNOKY_HOME="$HOME/.config/gno"          # script default
gnokey --home "$GNOKY_HOME" add proofloom-deployer
# the script looks the address up with:
#   gnokey --home "$GNOKY_HOME" list | grep -A2 "$KEY" | grep -oE 'g1[a-z0-9]{38}'
```

If the key is missing the script exits with:
`ERROR: key '<KEY>' not found in keybase at <KEYHOME>` and prints the exact
`gnokey add` command to run.

## 3. Environment variables consumed by deploy.sh

| Variable | Default | Purpose |
|---|---|---|
| `PROOFLOOM_REMOTE` | `https://rpc.onyx.testnets.gno.land:443` | RPC endpoint broadcast target |
| `PROOFLOOM_CHAINID` | `onyx-1` | chain id; also names the manifest file |
| `PROOFLOOM_KEY` | `proofloom-deployer` | key name in the keybase |
| `GNOKY_HOME` | `$HOME/.config/gno` | keybase directory |
| `PROOFLOOM_KEY_PASSWORD` | *(unset)* | when set, the passphrase is piped via `--insecure-password-stdin` (recommended for CI); otherwise gnokey prompts interactively |
| `GNOKEY_BIN` | `gnokey` | path override for the binary |

## 4. Funding (faucet)

For Onyx: fund the deployer at `https://faucet.gno.land/` (default
`PROOFLOOM_FAUCET` in `src/lib/chain.ts`). This step is currently
**externally blocked** — the faucet applies captcha and IP throttling. The
local `gnodev` chain funds its genesis keys automatically, which is how the
dev deployment was performed.

## 5. Deployment order

`deploy.sh` deploys the packages in dependency order, then initializes:

1. `addpkg` for each of: **core → registry → releases → attestations →
   agents → policies → verify**, each with
   `--gas-fee 100000000ugnot --gas-wanted 50000000`. The exact broadcast
   invocation used by the script (verbatim flags):
   ```
   gnokey --home "$KEYHOME" maketx addpkg [pass args] \
     --pkgpath "$BASE/$pkg" --pkgdir "$REALMS_DIR/proofloom/$pkg" \
     --remote "$REMOTE" --chainid "$CHAINID" \
     --gas-fee 100000000ugnot --gas-wanted 50000000 \
     --broadcast -simulate test "$KEY"
   ```
   (the script passes `--broadcast -simulate test` and greps `TX HASH:` from
   the output; deploy failures are detected by grepping `error|fail`).
2. `Init` calls for **registry, releases, attestations, agents, policies**
   (in that order) via `maketx call --func Init` with
   `--gas-fee 10000000ugnot --gas-wanted 3000000`. `registry.Init` must land
   first — the other realms stamp their admin from the registry's protocol
   admin via `registry.IsProtocolAdmin`.
3. `core` and `verify` are **not initialized**: `core` is a stateless library
   and `verify` holds no state (verified in the sources).

The namespace is derived from the deployer address:
`BASE="gno.land/r/$ADDR/proofloom"` — so the deployed realm prefix matches
`src/lib/chain.ts`'s default `PROOFLOOM_REALM_PREFIX`.

## 6. Deployment manifest format

The script writes `chain/deployments/deployment-<CHAINID>.json`:

```json
{
  "network": "<CHAINID>",
  "remote": "<PROOFLOOM_REMOTE>",
  "deployer": "g1…",
  "namespace": "gno.land/r/g1…/proofloom",
  "deployedAt": "<RFC3339 UTC>",
  "packages": {
    "core":       { "path": "<namespace>/core",       "txHash": "…" },
    "registry":   { "path": "<namespace>/registry",   "txHash": "…" },
    "releases":   { "path": "<namespace>/releases",   "txHash": "…" },
    "attestations": { "path": "<namespace>/attestations", "txHash": "…" },
    "agents":     { "path": "<namespace>/agents",     "txHash": "…" },
    "policies":   { "path": "<namespace>/policies",   "txHash": "…" },
    "verify":     { "path": "<namespace>/verify",     "txHash": "…" }
  },
  "init": {
    "registry": "<txHash>", "releases": "<txHash>", "attestations": "<txHash>",
    "agents": "<txHash>", "policies": "<txHash>"
  }
}
```

The existing `chain/deployments/deployment-dev.json` follows this shape with
`"remote": "http://127.0.0.1:26657"` and a `network` field that explicitly
says *"dev (gnodev local chain — pipeline verification; Onyx deployment
pending faucet funding)"*. The `consumer-example` realm is **not** deployed
by the script; if deployed separately it requires its own
`proofloom-consumer/example.Init` call.

## 7. App env wiring

Point the application at the deployment (echoed by the script on success):

```
PROOFLOOM_REALM_PREFIX=gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom
```

Other chain-facing app variables (defaults in `src/lib/chain.ts`):
`PROOFLOOM_RPC_URL`, `PROOFLOOM_CHAIN_ID` (`onyx-1`), `PROOFLOOM_WS_URL`,
`PROOFLOOM_EXPLORER`, `PROOFLOOM_FAUCET`. For platform-operated transactions
only: `PROOFLOOM_OPERATOR_MNEMONIC` (secret; absence makes
`POST /api/chain op=publish-on-chain|attest-on-chain` fail with
`FAUCET_DEPLETED` rather than simulating success). Full list:
`docs/operations/ENVIRONMENT_CONFIGURATION.md`.

## 8. Post-deployment verification (operational runbook)

Read-only, no funds required:

```bash
# realm read via abci_query (what src/lib/chain.ts does):
curl -s "$PROOFLOOM_REMOTE" -X POST -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"abci_query",
  "params":{"path":"vm/qeval","data":"'$(printf 'gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/verify.RegistryStats()' | base64 -w0)'","height":"0","prove":false}}'
```

Or through the app: `GET /api/health` reports chain identity +
`RegistryStats`, `GET /api/chain` reports identity + realm paths, and
`POST /api/chain` with `op":"query-release"` resolves a protocol release id
on-chain.

## 9. Known gaps

- The `addpkg` invocation in `deploy.sh` passes `--broadcast -simulate test`
  before the key name; confirm intended flags when running a real Onyx deploy
  (documented verbatim from the script in §5).
- `src/app/api/chain/route.ts` (`publish-on-chain`) targets a
  `releases.PublishRelease` function that does not exist in the deployed
  realm (see `TRANSACTION_LIFECYCLE.md` §3) — reconcile before relying on
  operator-driven publishing.
- Onyx deployment, and therefore any Onyx tx hash, does not exist yet.
