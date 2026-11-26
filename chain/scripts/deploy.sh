#!/usr/bin/env bash
# PROOFLOOM realm deployment pipeline.
#
# Deploys all seven realm packages in dependency order, then initializes
# them. Records every package path and transaction hash to
# chain/deployments/deployment-<network>.json
#
# Prerequisites:
#   - gnokey binary (v1.8.0+)
#   - Funded deployment key in a keybase (GNOKY_HOME), name PROOFLOOM_KEY
#   - Network args: PROOFLOOM_REMOTE (RPC), PROOFLOOM_CHAINID
#
# Usage: PROOFLOOM_KEY=proofloom-deployer ./chain/scripts/deploy.sh
set -euo pipefail

REMOTE="${PROOFLOOM_REMOTE:-https://rpc.onyx.testnets.gno.land:443}"
CHAINID="${PROOFLOOM_CHAINID:-onyx-1}"
KEY="${PROOFLOOM_KEY:-proofloom-deployer}"
KEYHOME="${GNOKY_HOME:-$HOME/.config/gno}"
GNOKEY="${GNOKEY_BIN:-gnokey}"
# Password feed: with PROOFLOOM_KEY_PASSWORD set (recommended for CI), the
# passphrase is piped via --insecure-password-stdin; otherwise gnokey prompts.
# Password feed: when PROOFLOOM_KEY_PASSWORD is SET (even empty), it is piped
# via --insecure-password-stdin — CI-friendly. Otherwise gnokey prompts.
PASS_ARGS=()
if [ "${PROOFLOOM_KEY_PASSWORD+set}" = "set" ]; then
  PASS_ARGS=(--insecure-password-stdin)
fi
sign() {
  if [ "${PROOFLOOM_KEY_PASSWORD+set}" = "set" ]; then
    printf '%s\n' "$PROOFLOOM_KEY_PASSWORD" | "$GNOKEY" "$@"
  else
    "$GNOKEY" "$@"
  fi
}
REALMS_SRC="$(cd "$(dirname "$0")/../realms" && pwd)"
OUT_DIR="$(cd "$(dirname "$0")/../deployments" && pwd)"
mkdir -p "$OUT_DIR"


ADDR=$("$GNOKEY" --home "$KEYHOME" list 2>/dev/null | grep -A2 "$KEY" | grep -oE 'g1[a-z0-9]{38}' | head -1 || true)
if [ -z "$ADDR" ]; then
  echo "ERROR: key '$KEY' not found in keybase at $KEYHOME" >&2
  echo "Create one: gnokey --home $KEYHOME add $KEY" >&2
  exit 1
fi
BASE="gno.land/r/$ADDR/proofloom"

# Namespace staging: realm sources reference each other by absolute module
# path (e.g. gno.land/r/<deployer>/proofloom/releases). Deployment is address-
# specific, so stage a copy of the workspace and rewrite every module path and
# cross-realm import to the deployer's actual address. The source tree on disk
# is never mutated.
STAGE="$(mktemp -d /tmp/proofloom-stage.XXXXXX)"
cp -r "$REALMS_SRC" "$STAGE/realms"
REALMS_DIR="$STAGE/realms"
rewrote=0
if grep -rlq "gno.land/r/g1" "$STAGE/realms/proofloom" 2>/dev/null; then
  find "$STAGE/realms/proofloom" -type f \( -name '*.gno' -o -name 'gnomod.toml' \) | while read -r f; do
    sed -i "s#gno\.land/r/g1[a-z0-9]\{36,42\}#gno.land/r/$ADDR#g" "$f"
  done
  rewrote=1
  echo "── staged workspace: cross-realm imports rewritten to $BASE"
fi

echo "Network: $CHAINID @ $REMOTE"
echo "Deployer: $ADDR"
echo "Namespace: $BASE"

PACKAGES=(core registry releases attestations agents policies verify)
declare -A TXHASH

for pkg in "${PACKAGES[@]}"; do
  echo "── deploying $pkg ..."
  if OUT=$(sign --home "$KEYHOME" maketx addpkg "${PASS_ARGS[@]}" \
    --pkgpath "$BASE/$pkg" \
    --pkgdir "$REALMS_DIR/proofloom/$pkg" \
    --remote "$REMOTE" --chainid "$CHAINID" \
    --gas-fee 100000000ugnot --gas-wanted 50000000 \
    --broadcast "$KEY" 2>&1); then
    HASH=$(echo "$OUT" | grep -E '^TX HASH:' | sed 's/^TX HASH:[[:space:]]*//' | grep -vE '^$' | head -1 || true)
    TXHASH[$pkg]="${HASH:-unknown}"
    echo "   tx: ${HASH:-<no hash>}"
  else
    echo "   DEPLOY FAILED for $pkg:"
    echo "$OUT" | grep -iE "error|fail" | head -3 || echo "$OUT" | head -5
    exit 1
  fi
  sleep 1
done

# Initialization: registry.Init must run first (others rely on its admin).
echo "── initializing realms ..."
for pkg in registry releases attestations agents policies; do
  OUT=$(sign --home "$KEYHOME" maketx call "${PASS_ARGS[@]}" \
    --pkgpath "$BASE/$pkg" --func "Init" \
    --remote "$REMOTE" --chainid "$CHAINID" \
    --gas-fee 10000000ugnot --gas-wanted 3000000 \
    --broadcast "$KEY" 2>&1) || { echo "   $pkg.Init FAILED:"; echo "$OUT" | grep -E "Error|error" | head -2; }
  HASH=$(echo "$OUT" | grep -E '^TX HASH:' | sed 's/^TX HASH:[[:space:]]*//' | grep -vE '^$' | head -1 || true)
  echo "   $pkg.Init: ${HASH:-<no hash>}"
  TXHASH["init-$pkg"]="${HASH:-unknown}"
done

cat > "$OUT_DIR/deployment-$CHAINID.json" <<JSON
{
  "network": "$CHAINID",
  "remote": "$REMOTE",
  "deployer": "$ADDR",
  "namespace": "$BASE",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "packages": {
$(for pkg in "${PACKAGES[@]}"; do
  printf '    "%s": { "path": "%s/%s", "txHash": "%s" },\n' "$pkg" "$BASE" "$pkg" "${TXHASH[$pkg]}"
done | sed '$ s/,$//')
  },
  "init": {
$(for pkg in registry releases attestations agents policies; do
  printf '    "%s": "%s",\n' "$pkg" "${TXHASH[init-$pkg]}"
done | sed '$ s/,$//')
  }
}
JSON
echo "✓ deployment manifest written to $OUT_DIR/deployment-$CHAINID.json"
echo "  Set these in the app environment to point the product at the deployment:"
echo "    PROOFLOOM_REALM_PREFIX=$BASE"
