# CI/CD Integration — Release Evidence Ingestion

How an external build system submits build evidence to PROOFLOOM. Derived
from `src/app/api/releases/[releaseId]/evidence/route.ts`,
`src/lib/crypto.ts`, `src/lib/verification.ts`, `src/lib/errors.ts` and the
release state machine in `src/app/api/releases/[releaseId]/route.ts`.

---

## 1. The ingestion path

```
CI job  ──POST /api/releases/{releaseId}/evidence──▶  PROOFLOOM API
             (session cookie or API credential)          │
                                                  sha256(content) computed server-side
                                                         │
                                       Evidence row (contentHash) + AuditEvent
                                                         │
                              DRAFT release + artifactDigest ─▶ EVIDENCE_PENDING
```

Requirements enforced by `POST /api/releases/[releaseId]/evidence`:

1. **Authentication:** `requireAuth()` (session cookie). API credentials
   (`plk_…`, `src/app/api/keys/route.ts`) exist as a model + management API;
   authenticating ingestion routes *by* those credentials is **planned**
   (no middleware consumes `keyHash` yet — honest status).
2. **Authorization:** `requireProjectAccess(user.id, release.projectId,
   'evidence.write')` — the CI identity must hold `evidence.write` in the
   owning organization (role `DEVELOPER` and up per `src/lib/auth.ts`).
3. **Release state:** rejected with `INVALID_TRANSITION` when the release is
   `REVOKED` or `SUPERSEDED`.
4. **Body schema** (JSON):

| Field | Type | Rules |
|---|---|---|
| `kind` | string enum | one of `build_log`, `test_report`, `security_scan`, `sbom`, `approval`, `agent_report`, `deployment`, `other` |
| `title` | string | required; truncated to 200 chars |
| `content` | string (utf8 body) | required; ≤ **512 KiB** inline (`MAX_INLINE_BYTES`); larger artifacts must use the object-storage adapter (error message says so) |
| `digest` | string | optional; if supplied must equal the server-computed sha256, else `INVALID_DIGEST` |
| `mimeType` | string | optional; default `text/plain`; truncated to 80 chars |

5. **Server-side digesting:** the server computes
   `sha256Hex(body.content)` itself (`src/lib/crypto.ts`) — a client can
   never dictate the commitment. The response returns
   `{ id, contentHash, sizeBytes, releaseStatus }`.

## 2. Artifact digest verification

- Evidence-level: `contentHash` stored per row; the evidence PUT handler
  re-computes sha256 over stored bytes and returns `integrityOk` (evidence
  route).
- Release-level: `artifactDigest` (sha256) must be present before the
  `EVIDENCE_PENDING`, `APPROVED` and `PUBLISHED` transitions
  (`isValidDigest` gate in the releases PATCH route).
- Publication gate: `evaluateReleasePolicy` (`src/lib/policy-engine.ts`)
  deterministically checks required attestation categories, minimum
  `RELEASE_APPROVAL` count (optionally restricted to allow-listed issuer
  addresses), `NO_CRITICAL_FINDINGS` (active `SECURITY_ASSESSMENT`
  attestation), `VALID_SBOM`, and `SIGNED_EVIDENCE` (on-chain commitment
  present). A failed policy blocks `PUBLISHED` with `INVALID_TRANSITION` and
  the failing checks.
- Verification level: `verifyRelease` / `verifyAttestation`
  (`src/lib/verification.ts`) re-compute digests from evidence bytes
  (`digest_integrity` — mismatch ⇒ verdict `FAILED`) and compare the
  platform record against the on-chain realm verdict (`chain_publication`,
  digest equality ⇒ otherwise "CHAIN MISMATCH").

## 3. Recommended CI flow

1. CI creates the release in `DRAFT` via
   `POST /api/projects/{projectId}/releases` (version + commit hash; digest
   optional at creation).
2. CI uploads each artifact of evidence to
   `POST /api/releases/{releaseId}/evidence` (`build_log`, `test_report`,
   `security_scan`, `sbom`…).
3. CI sets the artifact digest (`PATCH` `submit-evidence` with
   `artifactDigest`) → release `EVIDENCE_PENDING` → `VALIDATING`.
4. Humans/auditors issue attestations
   (`POST /api/releases/{releaseId}/attest`, capability
   `attestation.issue`), including `RELEASE_APPROVAL` attestations to
   satisfy `minApprovals`.
5. `approve` → `publish` (policy-gated) — optionally pushed on-chain
   (`POST /api/chain` op `attest-on-chain` / publish flow, see
   `TRANSACTION_LIFECYCLE.md` §3 for the current operator-path caveat).

## 4. GitHub Actions adapter example

> **This YAML is an adapter example, not a file in this repository.** It
> shows the shape of a CI job posting evidence to the documented API. It
> assumes a session/credential story as noted above; adjust auth to your
> deployment (API-credential auth for machine callers is planned).

```yaml
name: proofloom-evidence
on:
  push:
    tags: ["v*.*.*"]

jobs:
  publish-evidence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make build test   # produce build.log, test-report.xml, sbom.json
      - name: Upload build evidence to PROOFLOOM
        env:
          PROOFLOOM_URL: "https://proofloom.example.com"
          PROOFLOOM_RELEASE_ID: ${{ vars.PROOFLOOM_RELEASE_ID }} # release created in DRAFT beforehand
          PROOFLOOM_TOKEN: ${{ secrets.PROOFLOOM_TOKEN }}        # session/credential per your deployment
        run: |
          post() { # name, file, kind
            python3 - "$@" <<'PY'
import hashlib, json, os, sys, urllib.request
title, path, kind = sys.argv[1:4]
content = open(path, "rb").read()
body = {"kind": kind, "title": title, "content": content.decode("utf-8", "replace"),
        "digest": hashlib.sha256(content).hexdigest(), "mimeType": "text/plain"}
req = urllib.request.Request(
    f"{os.environ['PROOFLOOM_URL']}/api/releases/{os.environ['PROOFLOOM_RELEASE_ID']}/evidence",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ['PROOFLOOM_TOKEN']}"},
    method="POST")
print(urllib.request.urlopen(req).read().decode())
PY
          }
          post "build log" build.log build_log
          post "test report" test-report.xml test_report
          post "SBOM" sbom.json sbom
```

Notes: the digest is computed **client-side only as a self-check** — the
server recomputes and rejects mismatches (`INVALID_DIGEST`); inline evidence
is limited to 512 KiB per artifact; evidence to a `REVOKED`/`SUPERSEDED`
release is refused.

## 5. Status summary

- Implemented: evidence ingestion endpoint, server-side digesting, digest
  verification, policy gate, audit trail, release state machine.
- Planned: machine authentication via API credentials on ingestion routes;
  automatic release creation from CI events; object-storage adapter for
  >512 KiB artifacts (the API names it in the size-limit error but no
  adapter is implemented).
