# PROOFLOOM Gno Architecture

Scope: the on-chain layer of PROOFLOOM — the Gno realm packages under
`chain/realms/proofloom/` and their third-party consumer contract. Everything
in this document is derived from the actual `.gno` sources and `gnomod.toml`
files in this repository (gno v1.8.0 toolchain, `bin/`).

Status legend: **[implemented]** = code exists and realm tests pass;
**[planned]** = described in docs/comments but not in code;
**[blocked]** = implemented but external dependency (faucet funding) prevents
live deployment.

---

## 1. Module layout

All realms share one deployer namespace. The deployer address is
`g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq` (see
`chain/deployments/deployment-dev.json`), so the deployed module paths are:

```
gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/
  core/          pure validation library (no state)
  registry/      projects, components, protocol admin, registrars
  releases/      release records + authoritative release state machine
  attestations/  evidence commitment registry
  agents/        agent identities, scoped grants, execution receipts
  policies/      versioned publication policies
  verify/        read-only public verification facade (no state)
gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom-consumer/
  example/       third-party consumer realm (composability proof)
```

Each directory carries a `gnomod.toml` declaring `gno = "0.9"` and its module
path, e.g. `chain/realms/proofloom/registry/gnomod.toml`:

```toml
module = "gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/registry"
gno = "0.9"
```

Notes on the source tree:

- `chain/realms/gnowork.toml` exists but is **empty** (0 bytes); workspace
  resolution therefore relies on the `gnomod.toml` paths alone.
- The consumer module root (`chain/realms/consumer-example/`) has no `.gno`
  files; the realm package lives in `consumer-example/example/`. Running
  `gno test ./consumer-example/...` reports a harmless "package has no files"
  setup failure for the root; test the leaf package instead.

## 2. Realm responsibilities

| Realm | Responsibility | State? |
|---|---|---|
| `core` | Shared validators (`IsValidAddress`, `IsValidDigest`, `IsValidID`, `IsValidVersion`, `IsValidShortHash`, `BoundedText`), deterministic ID composition, protocol status/category/scope vocabularies | **None** — explicitly stateless library so any realm can import it without authority concerns |
| `registry` | Ownership backbone: projects, components, the protocol admin (set once at `Init`) and the registrar allow-list. Every other realm consults it for authorization | projects, components, `admin`, `registrars`, ordered ID lists |
| `releases` | Release provenance engine: records release commitments and enforces the release state machine `DRAFT → EVIDENCE_PENDING → VALIDATING → REVIEW_REQUIRED → APPROVED → PUBLISHED → VERIFIED` with terminal `REJECTED / REVOKED / SUPERSEDED / DISPUTED` | `releases` map + `releaseIDs` order list |
| `attestations` | Evidence commitment registry: binds (subject, category, issuer) to a content digest; deterministic IDs structurally prevent duplicate active attestations; permanent public revocation | `attestations` map + `attestationIDs` |
| `agents` | First-class AI-agent accountability: agent identities, scoped/expiring/revocable grants, immutable execution receipts | `agents`, `grants` (key `agentID/projectID`), `executions` |
| `policies` | Versioned publication policy per project (required attestation categories, min approvals, issuer allow-list, flags). Evaluation happens in `verify` and off-chain | `current` map + per-project `history` slice |
| `verify` | Read-only public verification facade combining release state, attestation status and deterministic policy evaluation into explainable verdicts | **None** |
| `proofloom-consumer/example` | Demonstrates third-party consumption of `verify` without registering anywhere: private watchlist + release gate | `watchlist`, `curator` |

## 3. Interrealm call graph

Edges below are actual `import` statements in the `.gno` sources:

```
core  (imported by: registry, releases, attestations, agents, policies, verify)
registry ← releases      (HasProject, IsProjectOwner, IsProtocolAdmin)
registry ← attestations  (HasProject, IsProtocolAdmin)
registry ← agents        (HasProject, IsProjectOwner, IsProtocolAdmin)
registry ← policies      (HasProject, IsProjectOwner)
registry ← verify        (GetPublicProject, ListPublicProjectIDs, ProjectCount, ComponentCount)
releases ← attestations  (HasRelease)
releases ← verify        (GetPublishedRelease, ReleaseStatus, HasRelease,
                          FindByDigest, ListReleaseIDsByProject, ReleaseCount)
attestations ← verify    (ListBySubject, GetAttestation, EffectiveStatus,
                          ListActiveBySubjectAndCategory, HasActiveAttestation, AttestationCount)
policies ← verify        (GetPolicy)
verify ← proofloom-consumer/example (VerifyRelease, ListReleaseIDsByProject)
```

Direction of authority: **downward only**. Write-side realms (`releases`,
`attestations`, `agents`, `policies`) call `registry` for authorization; the
read-only facade (`verify`) calls every write-side realm's getters; external
consumers call only `verify`. No realm ever calls upward into a consumer, and
no consumer realm imports a write-side realm.

### Caller identity: `cur.Previous().Address()`

Every state-changing function attributes the caller from
`cur.Previous().Address()` — never from a user-supplied argument:

- `registry.mustAdmin` compares it to the stored `admin` and additionally
  rejects cross-realm calls with `cur.IsCurrent()` (cross-realm admin calls
  panic with `registry: cross-realm admin call rejected`).
- `registry.RegisterProject` records `Owner = cur.Previous().Address()`.
- `releases.caller(cur)` is a helper used by every transition; `requireCurrent`
  panics unless `cur.IsCurrent()`.
- `attestations.Issue` records `Issuer = cur.Previous().Address()`.
- `agents.RegisterAgent` records `Owner`; `agents.canSuspend` /
  `RevokeAgent` / `GrantPermission` / `RevokePermission` / `RecordExecution`
  compare or record it.
- `policies.SetPolicy` / `ClearPolicy` compare it against
  `registry.IsProjectOwner` and record it in `UpdatedBy`.
- `verify` uses no realm context at all — it is a pure read surface.
- `proofloom-consumer/example.Init` records `curator` from it; `assertCurator`
  gates `Watch` / `Unwatch`.

## 4. State ownership rules

1. **One realm, one dataset.** Projects/components live only in `registry`;
   releases only in `releases`; attestations only in `attestations`; grants
   only in `agents`; policies only in `policies`. No realm writes another
   realm's state — cross-realm effects are requested through the owning
   realm's exported mutators only.
2. **Admin root of trust is singular.** `registry.Init` stamps the deployment
   caller as protocol admin. `releases`, `attestations`, `agents` and
   `policies` have **no local admin**; they delegate admin decisions to
   `registry.IsProtocolAdmin(addr)`. This is stated in each realm's `Init`
   doc-comment and enforced by using `registry` in every admin check.
3. **`core` is frozen.** It holds constants and pure functions; no var state,
   so importing it can never mutate protocol state.
4. **`verify` is frozen.** It holds no state and grants no authority; its
   function signatures are the protocol's composability contract.
5. **Ownership is recorded at creation, from the caller.** `Project.Owner`,
   `Component.Owner`, `Release.Publisher`, `Agent.Owner`,
   `Attestation.Issuer`, `Grant.GrantedBy`, `Policy.UpdatedBy` are all taken
   from `cur.Previous().Address()`.
6. **Init is idempotent-by-panic.** Every realm's `Init` panics on a second
   call (`"<pkg>: already initialized"`). `registry` also has
   `IsInitialized()`; `releases/attestations/agents/policies` expose
   `Initialized()`.

## 5. Deterministic identifiers (replay/duplicate protection)

Record IDs are composed deterministically so off-chain parties can address
records without a lookup and duplicates are structurally impossible:

- `core.ComposeReleaseID(projectID, version)` → `projectID + "-" +
  strings.ToLower(version)`. `releases.CreateRelease` panics on re-use of the
  derived id.
- `core.ComposeAttestationID(subjectID, category, issuer)` →
  `subjectID + "-" + strings.ToLower(category) + "-" + issuer`.
  `attestations.Issue` panics when an **active** attestation with the same id
  already exists (a revoked one may be re-issued).
- `agents` grants are keyed `agentID + "/" + projectID` (one live grant per
  pair), and executions are keyed `agentID + "-" + taskID` (duplicate
  execution receipts rejected).

## 6. Why evidence stays off-chain

The chain stores **commitments, not content**:

- Releases store `ArtifactDigest` (sha256 hex, enforced by
  `core.IsValidDigest`). `releases.SetEvidence`'s doc-comment states digest
  correctness against artifacts is verified off-chain by the evidence worker.
- Attestations store a `Digest` of the claim/evidence plus subject/category.
  The package comment is explicit: *"the evidence bytes themselves live
  off-chain; the chain stores who claimed what about which subject, when, and
  whether it still stands."*
- `core.BoundedText` / `MaxTextLen` (512) / `MaxListLen` (32) cap every
  persisted free-form field and list to prevent state bloat; e.g.
  `registry.RegisterProject` panics when metadata exceeds size limits.

Rationale: build logs, SBOMs, test reports and agent transcripts are large,
sometimes confidential, and occasionally legally sensitive (personal data).
Immutable on-chain state cannot honour deletion requests, so only
fixed-size, non-invertible digests and small metadata go on-chain. The
off-chain application (`src/lib/verification.ts`) later re-computes sha256
over evidence bytes and compares with the on-chain commitment
(`digest_integrity` check).

## 7. Public vs. non-public reads

- `registry.GetProject(id)` returns any record (existence probe);
  `GetProjectFor(id, reader)` hides **private** projects from readers that are
  not the owner; `GetPublicProject` additionally excludes archived records —
  this is what `verify` exposes.
- `releases.GetRelease(id, reader)` returns a record only when its status is
  in the public family (`PUBLISHED`, `VERIFIED`, `REVOKED`, `SUPERSEDED`,
  `DISPUTED`) or the reader is authorized. `ReleaseStatus(id)` is public for
  every release so external verifiers can check revocation without full
  record access.
- Getters return **value copies**: structs are dereferenced (`*p`, `*r`, `*a`)
  and slice fields are deep-copied (`agents.GetAgent` copies `Capabilities`,
  `agents.GetGrant` copies `Scopes`, `policies.copyPolicy` copies
  `RequireCategories`/`AllowedIssuers`). Internal maps are never exposed.

## 8. Events and errors

- **No events are emitted.** None of the realm sources import an events
  facility or call an emit function; state changes are observed by re-reading
  state (this is why the application's `reconcileTransaction` uses
  state-based confirmation).
- **Errors are panics with stable string prefixes** (`registry: …`,
  `releases: …`, `attestations: …`, `agents: …`, `policies: …`,
  `consumer: …`). The off-chain gateway (`src/lib/chain.ts`) classifies
  realm panics from the abci_query log, mapping `unknown release|project|…`
  to `NOT_FOUND` and other realm errors to `TX_FAILED`.

## 9. Deployment & verification status

- **[implemented]** All seven proofloom packages + consumer example compile
  and pass `gno test` (29 test functions across 8 packages) with
  `GNOROOT=/home/z/my-project/bin ./bin/gno test ./proofloom/...
  ./consumer-example/example/...`.
- **[implemented, local only]** Deployment to a local `gnodev` chain,
  recorded in `chain/deployments/deployment-dev.json` (tx hashes are base64
  digests from the local dev chain — they are **not** Onyx records).
- **[blocked]** Onyx testnet deployment: the deployer address
  `g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq` awaits faucet funding (external,
  captcha/IP-throttled faucet). See `DEPLOYMENT_GUIDE.md`.
