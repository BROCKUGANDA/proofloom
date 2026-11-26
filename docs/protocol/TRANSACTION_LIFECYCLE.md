# PROOFLOOM Transaction Lifecycle

Derived from `src/lib/chain.ts`, `src/lib/operator.ts`, `src/lib/client.ts`,
`src/app/api/chain/route.ts` and `src/lib/errors.ts`. Everything below
describes code that exists in the repository.

---

## 1. Two signing paths, one gateway

`src/lib/chain.ts` states the split explicitly:

1. **User-owned operations** — signed client-side via Adena/GnoConnect
   (`src/lib/client.ts`: `detectAdena`, `walletConnect`, `walletSignMessage`,
   `walletSendTransaction`). The platform never touches user keys.
2. **Platform-operated operations** — the `gnokey` CLI operator flow in
   `src/lib/operator.ts` (deployment/testnet integration). The operator
   mnemonic arrives only via `PROOFLOOM_OPERATOR_MNEMONIC` at runtime and a
   throwaway keybase is created per call.

The gateway itself is **read-only**: `abciQuery` (JSON-RPC `abci_query`) for
state, plus lifecycle bookkeeping in the `ChainTransaction` table. It never
holds user keys and never broadcasts on its own.

## 2. Transport and query construction

- RPC endpoint: `activeChain().rpc` — `PROOFLOOM_RPC_URL`, default
  `https://rpc.onyx.testnets.gno.land:443`.
- Timeout: every RPC call is wrapped in an `AbortController` with
  `TIMEOUT_MS = 12_000`; `cache: 'no-store'`.
- **State queries** use JSON-RPC method `abci_query` with
  `params: { path, data: base64(utf8(expression)), height: "0", prove: false }`.
  - Realm *evaluation* queries use path **`vm/qeval`** with data
    `<realmPrefix>/<pkg>.<Expression>` (built by `realmEval(pkg, expression)`
    via `realmPath(pkg)`), e.g.:
    - `verify.VerifyRelease("<releaseId>")` (`fetchOnChainVerdict`)
    - `releases.ReleaseStatus("<releaseId>")` (`fetchReleaseStatus`)
    - `verify.RegistryStats()` (`fetchRegistryStats`)
    - `registry.GetPublicProject("<projectId>")` (`fetchOnChainProject`)
  - **Chain identity** uses the tm2 `status` method (`params: [null]`) reading
    `node_info.network` and `sync_info.latest_block_height`
    (`verifyChainIdentity`, 60s cache). A remote network id that differs from
    the configured `chainId` hard-fails with `CHAIN_ID_MISMATCH`.
- Responses are decoded from `result.response.ResponseBase.Data` (base64 →
  utf8). Flat Go-struct renderings are parsed by `parseGoStruct` (regex over
  `Field:"value"` pairs) into typed shapes like `RealmVerdict`.

> Note: evaluation queries use the `vm/qeval` path. The repo contains no
> `vm/qrealm` usage.

## 3. Transaction lifecycle states

`TX_STATES` in `src/lib/chain.ts`:

```
CREATED → SIMULATED → AWAITING_SIGNATURE → SIGNED → BROADCAST
        → PENDING → CONFIRMED | FAILED | EXPIRED | RECONCILIATION_REQUIRED
```

The same vocabulary is enforced by `POST /api/chain` (`op: 'record'` /
`op: 'transition'` validate `status` against `TX_STATES`) and persisted in
`ChainTransaction.status` (`prisma/schema.prisma`). `txHash` and
`idempotencyKey` are `@unique` columns. `RECONCILIATION_REQUIRED` is defined
but no code path currently transitions a record into it (honest gap —
records land in `FAILED`/`PENDING` instead).

### Operator flow (gnokey, `src/lib/operator.ts`)

- `operatorAvailable()` = `PROOFLOOM_OPERATOR_MNEMONIC` is set.
- **When absent**, `operatorBroadcastCall` / `operatorDeployPackage` throw an
  error with `code = 'FAUCET_DEPLETED'` and an explicit recovery string
  telling the caller to set the mnemonic or sign with Adena. No simulated
  success is ever returned.
- When present, `withKeybase` creates a temp keybase
  (`mkdtempSync(join(tmpdir(), 'pl-key-'))`), recovers the key with
  `gnokey --home <tmp> add operator --recover --insecure-password-stdin`
  (mnemonic piped via stdin, 20s timeout), runs the operation, and always
  `rmSync`s the temp keybase.
- `operatorBroadcastCall` builds:
  `gnokey maketx call --pkgpath <pkgpath> --func <func> --args <comma-joined>
  --remote <rpc> --chainid <chainId> --gas-fee <default 5000000ugnot>
  --gas-wanted <default 2500000> [--memo ≤100 chars] --broadcast sync operator`
  (60s timeout). The tx hash is extracted from gnokey output with
  `/hash[=: ]+([0-9A-Fa-f]{40,})/` or a 64-hex fallback; failure to find a
  hash raises `TX_FAILED`.
- `operatorDeployPackage` builds the analogous `maketx addpkg` command
  (`--gas-fee 100000000ugnot --gas-wanted 50000000`, optional `--deposit`,
  120s timeout) — used by the deployment pipeline.
- Callers in `src/app/api/chain/route.ts`: `publish-on-chain` →
  `releases.PublishRelease` (see discrepancy note below) and
  `attest-on-chain` → `attestations.Issue` with args
  `[RELEASE, <subject>, <category>, <digest>, 0]`.

> **Discrepancy (documented honestly):** `publish-on-chain` calls realm
> function `PublishRelease` with `(protocolId, slug, version, commitPrefix,
> digest)`. The deployed `releases` realm has no `PublishRelease` function —
> its mutators are `CreateRelease`, `SetEvidence`, `Publish(id)`, etc.
> `attest-on-chain` matches `attestations.Issue` exactly. The publish
> operator path therefore does not match the deployed realm API surface and
> will fail at the chain if invoked.

### Client flow (Adena)

`src/lib/client.ts` exposes a wallet abstraction
(`walletStatus`, `walletConnect`, `walletSignMessage` via `signEcdsa`,
`walletSendTransaction` via `sendTransaction`). The server records lifecycle
transitions the client reports via `POST /api/chain`
(`op: 'record'`, `op: 'transition'`, `op: 'query-release'`,
`op: 'operator-status'`, `op: 'confirm-on-chain'`). `auth wallet-link` stores
a wallet association; without a presented signature it is recorded as
**UNVERIFIED** (`verified: false`) — stated plainly in
`src/app/api/auth/[action]/route.ts`.

## 4. Confirmation tracking (state-based, not hash-based)

`reconcileTransaction(txHash, confirmExpr)` never trusts a broadcast hash
alone. It evaluates a realm expression that must succeed once the tx landed:

| tx kind | confirmation expression (`POST /api/chain` op `confirm-on-chain`) |
|---|---|
| `PUBLISH_RELEASE` | `releases.ReleaseStatus("<slug>-<version>")` on `releases` |
| `ATTEST` | `attestations.GetAttestation("<protocolId>")` on `attestations` |

Outcome mapping: the expression succeeds → `CONFIRMED` (and `PUBLISH_RELEASE`
records additionally flip the platform release to `gnoRegistered: true` with
`onChainRef = txHash`); `NOT_FOUND` or `CHAIN_UNAVAILABLE` → `PENDING`
(retryable); anything else → `FAILED`. Every reconcile attempt increments
`ChainTransaction.attempts`; `confirmedAt` is stamped on `CONFIRMED`.

## 5. Failure classification

`src/lib/chain.ts` + `src/lib/errors.ts` produce a stable code taxonomy:

| Condition | Code | HTTP |
|---|---|---|
| non-OK HTTP from RPC, transport error, jsonrpc `error`, missing `ResponseBase` | `CHAIN_UNAVAILABLE` | 503 |
| remote `node_info.network` ≠ configured chainId | `CHAIN_ID_MISMATCH` | 409 |
| realm log matches `InvalidPackageError|InvalidFileError|not declared|not found` or `unknown (release|project|agent|attestation|component|execution|grant)` | `NOT_FOUND` | 404 |
| any other realm error in `ResponseBase.Error` | `TX_FAILED` | 502 |
| tx did not confirm in time | `TX_TIMEOUT` | 504 |
| operator mnemonic absent | `FAUCET_DEPLETED` | 503 |
| broadcast produced no parsable hash | `TX_FAILED` | 502 |

Log strings are truncated to 300 chars before being attached to errors, so
realm internals don't leak verbatim into clients. Unknown/missing realm
records are treated as legitimate "not found" answers rather than faults —
important for `PENDING` reconciliation semantics.

## 6. Idempotency & replay protections

- `ChainTransaction.txHash` and `ChainTransaction.idempotencyKey` are
  `@unique` (Prisma) — a duplicate insert with the same key fails at the DB.
- `publish-on-chain` sets `idempotencyKey = "publish:<protocolId>:<Date.now()>"`
  and `attest-on-chain` sets `"attest:<protocolId>:<Date.now()>"`. Because a
  millisecond timestamp is embedded, these keys act as **trace identifiers**
  rather than true dedupe across retries — replaying the same logical
  operation twice would produce two distinct keys (honest limitation).
  Deterministic dedupe ultimately comes from the realm layer: duplicate
  release ids panic (`releases: release already exists`) and duplicate active
  attestations panic (`attestations: active attestation already exists …`).
- Reads are side-effect free (`abci_query`), so query retries cannot mutate
  state; broadcasts are never blind-retried by the gateway (stated in the
  `chain.ts` header; retries surface as explicit reconciliation).
- Protocol ids are deterministic (`ComposeReleaseID`,
  `ComposeAttestationID`), so re-submitting identical on-chain facts is a
  no-op panic on-chain rather than a second record.
- GitHub webhook ingestion has its own delivery-id dedupe
  (`db.webhookDelivery` on `github:<deliveryId>`) — see
  `docs/integrations/GITHUB.md`.

## 7. Explorer URLs

`txExplorerUrl(txHash)` → `<explorer>/tx/<hash>` and
`realmExplorerUrl(pkg)` → `<explorer>/realm/<realmPath(pkg)>` where
`explorer` defaults to `https://gnoscan.io` (`PROOFLOOM_EXPLORER`).
