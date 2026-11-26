# PROOFLOOM Realm Specification

Exact public function signatures copied from the `.gno` sources in
`chain/realms/proofloom/` and `chain/realms/consumer-example/`. All realms
report errors by **panicking** with a `<package>: …` message — there is no
error-return convention and no events (verified: no emit calls exist in any
realm). Getter functions return value copies; internal maps/slices are never
exposed.

Deployed module prefix:
`gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom/<pkg>`.

---

## 1. core — `chain/realms/proofloom/core/core.gno`

Stateless library (no `Init`, no vars). Constants:

- `ProtocolVersion = "1.0.0"`
- Release statuses: `ReleaseDraft`…`ReleaseDisputed` (`DRAFT`,
  `EVIDENCE_PENDING`, `VALIDATING`, `REVIEW_REQUIRED`, `APPROVED`,
  `PUBLISHED`, `VERIFIED`, `REJECTED`, `REVOKED`, `SUPERSEDED`, `DISPUTED`)
- Attestation statuses: `AttestationActive | Revoked | Expired`
  (`ACTIVE`, `REVOKED`, `EXPIRED`)
- Agent statuses: `AgentActive | Suspended | Revoked`
- Agent scopes: `READ, EVIDENCE, VERIFY_REQUEST, TASK_UPDATE, REVIEW_PROPOSE,
  PUBLISH_REQUEST` (least-privilege; no wildcard scope by design)
- Subject types: `RELEASE, PROJECT, COMPONENT, TASK, AGENT_EXECUTION`
- 13 attestation categories: `BUILD_PROVENANCE, SOURCE_PROVENANCE,
  TEST_EXECUTION, SECURITY_ASSESSMENT, CODE_REVIEW, RELEASE_APPROVAL,
  AGENT_TASK_COMPLETION, BENCHMARK_RESULT, DEPENDENCY_VERIFICATION,
  OWNERSHIP_VERIFICATION, DEPLOYMENT_VERIFICATION, COMPLIANCE_EVIDENCE,
  INCIDENT_REMEDIATION`
- `MaxTextLen = 512`, `MaxListLen = 32`

```go
func IsValidAddress(a string) bool          // g1-prefixed bech32-shape gate (no checksum verify)
func IsValidDigest(d string) bool           // 64 lowercase hex chars
func IsValidID(id string) bool              // slug: [a-z0-9-], 1..64, no leading/trailing dash
func IsValidSlugList(ids []string) bool
func IsValidVersion(v string) bool          // alnum . - + , 1..32 chars
func IsValidShortHash(h string) bool        // hex, 7..64 chars (git commit-ish)
func BoundedText(s string, maxLen int) bool
func ComposeReleaseID(projectID, version string) string      // "<projectID>-<lowercased version>"
func ComposeAttestationID(subjectID, category, issuer string) string // "<subject>-<lowercased category>-<issuer>"
```

## 2. registry — `chain/realms/proofloom/registry/registry.gno`

State: `projects`, `components` (maps of pointers), `admin address`,
`registrars map[string]bool`, ordered `projectIDs`/`componentIDs`.

Types: `Project{ID, Name, Description, Repo, Category, Visibility ("public"|"private"), Owner address, CreatedAt int64, Archived bool}`,
`Component{ID, ProjectID, Name, License, ArtifactType, Owner address, CreatedAt int64, Deprecated bool}`.

```go
func Init(cur realm)                          // caller becomes protocol admin; 2nd call panics
func IsInitialized() bool
func SetAdmin(cur realm, next address)        // admin only; validates address
func GrantRegistrar(cur realm, addr address)  // admin only
func RevokeRegistrar(cur realm, addr address) // admin only
func IsRegistrar(addr address) bool           // admin implicitly a registrar
func RegisterProject(cur realm, id, name, description, repo, category, visibility string)
func TransferProject(cur realm, id string, next address)     // owner only
func SetProjectVisibility(cur realm, id, visibility string)  // owner only
func ArchiveProject(cur realm, id string)                    // owner or admin
func RestoreProject(cur realm, id string)                    // owner only
func RegisterComponent(cur realm, id, projectID, name, license, artifactType string) // owner only; archived project rejected
func DeprecateComponent(cur realm, id string)                // owner only
func HasProject(id string) bool
func GetProject(id string) (Project, bool)                   // visibility NOT enforced (existence probe)
func GetProjectFor(id string, reader address) (Project, bool) // hides private from non-owner
func GetPublicProject(id string) (Project, bool)             // public + non-archived only
func IsProjectOwner(id string, addr address) bool
func GetComponent(id string) (Component, bool)
func IsComponentOwner(id string, addr address) bool          // owner of the component record
func ListProjectIDs() []string                               // newest first (registration order reversed)
func ListPublicProjectIDs() []string                         // public+active, sorted
func ListComponentIDsByProject(projectID string) []string
func ProjectCount() int
func ComponentCount() int
func IsProtocolAdmin(addr address) bool
func ProtocolAdminAddress() address
func NormalizeRepo(repo string) string
```

Authorization details:
- `mustAdmin(cur)` panics `"registry: caller is not protocol admin"` unless
  `cur.Previous().Address() == admin`, and panics
  `"registry: cross-realm admin call rejected"` unless `cur.IsCurrent()`.
- `RegisterProject` requires the caller to be a registrar (`IsRegistrar`),
  panics on duplicate id, enforces `BoundedText` caps (name 128, description
  `MaxTextLen`, repo 256, category 64), requires non-empty name and
  `visibility ∈ {public, private}`.
- `RegisterComponent` restricts `artifactType` to
  `{source, container, binary, sbom, docs, library}`.

Errors (panic messages): `registry: realm not initialized`,
`registry: already initialized`, `registry: caller is not protocol admin`,
`registry: cross-realm admin call rejected`, `registry: invalid project id`,
`registry: project id already registered`, `registry: metadata exceeds size
limits`, `registry: project name required`, `registry: visibility must be
public or private`, `registry: caller is not a registrar`,
`registry: unknown project`, `registry: only the project owner may …`,
`registry: invalid admin address`, `registry: invalid registrar address`,
`registry: project is archived`, `registry: invalid component id`,
`registry: component id already registered`, `registry: component metadata
exceeds size limits`, `registry: unsupported artifact type`,
`registry: unknown component`, `registry: target owner already owns project`,
`registry: not authorized to archive project`.

## 3. releases — `chain/realms/proofloom/releases/releases.gno`

State: `releases map[string]*Release`, ordered `releaseIDs`. No local admin;
admin decisions delegate to `registry.IsProtocolAdmin`.

Type: `Release{ID, ProjectID, ComponentID, Version, Commit, Branch, Repo,
ArtifactDigest, Status, Publisher address, CreatedAt int64, PublishedAt int64,
SupersededBy string}`.

```go
func Init(cur realm)
func CreateRelease(cur realm, projectID, version, commit, branch, repo, componentID string) string // returns deterministic id
func SetEvidence(cur realm, id, artifactDigest string)     // DRAFT→EVIDENCE_PENDING; EVIDENCE_PENDING→VALIDATING
func MarkValidating(cur realm, id string)                  // EVIDENCE_PENDING→VALIDATING
func RequireReview(cur realm, id string)                   // VALIDATING→REVIEW_REQUIRED
func Approve(cur realm, id string)                         // VALIDATING|REVIEW_REQUIRED→APPROVED
func Reject(cur realm, id string)                          // terminal; published/verified must be revoked instead
func Publish(cur realm, id string)                         // APPROVED→PUBLISHED; requires ArtifactDigest
func MarkVerified(cur realm, id string)                    // PUBLISHED→VERIFIED
func Revoke(cur realm, id string)                          // PUBLISHED|VERIFIED→REVOKED (visible forever)
func Supersede(cur realm, id, byID string)                 // byID must be same project and published
func Dispute(cur realm, id string)                         // not from REVOKED/SUPERSEDED
func GetRelease(id string, reader address) (Release, bool) // public states or authorized reader
func HasRelease(id string) bool
func ReleaseStatus(id string) string                       // "" when unknown; public metadata
func GetPublishedRelease(id string) (Release, bool)
func ListReleaseIDsByProject(projectID string) []string    // newest first
func FindByDigest(digest string) []string                  // published-family releases with matching digest, sorted
func ReleaseCount() int
func Initialized() bool
```

Authorization: `CreateRelease` requires `registry.IsProjectOwner(projectID,
caller)`. Every other mutator requires `authorized(r, caller)` = release
**publisher** OR **project owner** OR **protocol admin**
(`registry.IsProjectOwner` / `registry.IsProtocolAdmin`). All mutators run
`requireCurrent(cur)`.

Errors: `releases: realm not initialized`, `releases: already initialized`,
`releases: call must run in current realm`, `releases: unknown project`,
`releases: invalid version`, `releases: invalid commit hash`,
`releases: field exceeds size limits`, `releases: release already exists <id>`,
`releases: only the project owner may create releases`,
`releases: unknown release <id>`, `releases: caller not authorized …`,
`releases: invalid artifact digest`, `releases: cannot set evidence in state
<status>`, `releases: expected EVIDENCE_PENDING, got <status>`,
`releases: expected VALIDATING, got <status>`, `releases: cannot approve from
state <status>`, `releases: published releases cannot be rejected; revoke
instead`, `releases: only APPROVED releases can be published`,
`releases: missing artifact digest`, `releases: only PUBLISHED releases can
be verified`, `releases: only published releases can be revoked`,
`releases: superseding release belongs to another project`,
`releases: superseding release is not published`, `releases: terminal release
cannot be disputed`.

## 4. attestations — `chain/realms/proofloom/attestations/attestations.gno`

State: `attestations map[string]*Attestation`, ordered `attestationIDs`.

Type: `Attestation{ID, SubjectType, SubjectID, Category, Issuer address,
Digest, Status, IssuedAt int64, ExpiresAt int64 (0 = never), RevokedAt int64,
RevocationReason string}`.

```go
func Init(cur realm)
func Issue(cur realm, subjectType, subjectID, category, digest string, expiresAt int64) string
func Revoke(cur realm, id, reason string)     // issuer or protocol admin only; permanent
func GetAttestation(id string) (Attestation, bool)
func EffectiveStatus(id string) string        // ACTIVE | REVOKED | EXPIRED | "" (expiry derived)
func ListBySubject(subjectID string) []string // newest first
func ListActiveBySubjectAndCategory(subjectID, category string) []string // sorted
func HasActiveAttestation(subjectID, category, issuer string) bool // empty issuer = any
func AttestationCount() int
func Initialized() bool
```

Authorization & guards:
- `Issue` is open to any caller (the caller **becomes** the issuer —
  `cur.Previous().Address()`); validates subject type, category, digest,
  subject existence (`subjectExists` cross-checks `releases.HasRelease` /
  `registry.HasProject`; COMPONENT/TASK/AGENT_EXECUTION subjects are accepted
  without on-chain lookup) and future expiry. Duplicate **active**
  attestation for the same deterministic id panics.
- `Revoke` requires the original issuer or `registry.IsProtocolAdmin`;
  revocation reason capped at `MaxTextLen`; double-revoke panics.

Errors: `attestations: realm not initialized`, `attestations: already
initialized`, `attestations: issue must run in current realm`,
`attestations: invalid subject type`, `attestations: invalid category`,
`attestations: invalid evidence digest`, `attestations: subject does not
exist`, `attestations: expiry must be in the future`, `attestations: active
attestation already exists for this subject, category and issuer`,
`attestations: unknown attestation`, `attestations: only the issuer or
protocol admin may revoke`, `attestations: already revoked`,
`attestations: revocation reason too long`.

## 5. agents — `chain/realms/proofloom/agents/agents.gno`

State: `agents`, `grants` (key `agentID + "/" + projectID`), `executions`
(key `agentID + "-" + taskID`), ordered `agentIDs`/`executionIDs`.

Types: `Agent{ID, Name, Description, Owner address, Version, Runtime,
Capabilities []string, Status, CreatedAt int64}`;
`Grant{AgentID, ProjectID, Scopes []string, ExpiresAt int64, GrantedBy
address, GrantedAt int64, Revoked bool}`;
`Execution{ID, AgentID, TaskID, ProjectID, Digest, Status ("COMPLETED"|"FAILED"),
RecordedBy address, At int64}`.

```go
func Init(cur realm)
func RegisterAgent(cur realm, id, name, description, version, runtime string, capabilities []string)
func SuspendAgent(cur realm, id string)   // owner, admin, or owner of any granted project
func ResumeAgent(cur realm, id string)    // owner only; from SUSPENDED
func RevokeAgent(cur realm, id string)    // owner or admin; revokes all grants
func GrantPermission(cur realm, agentID, projectID string, scopes []string, expiresAt int64) // project owner only
func RevokePermission(cur realm, agentID, projectID string) // project owner or admin
func HasPermission(agentID, projectID, scope string) bool   // the authorization gate
func RecordExecution(cur realm, agentID, taskID, projectID, digest, status string) string
func GetAgent(id string) (Agent, bool)          // Capabilities deep-copied
func GetGrant(agentID, projectID string) (Grant, bool) // Scopes deep-copied
func GetExecution(id string) (Execution, bool)
func ListAgentIDs() []string                    // newest first
func ListExecutionsByAgent(agentID string) []string
func AgentCount() int
func Initialized() bool
```

Authorization & guards:
- `RegisterAgent`: any caller becomes `Owner`; caps name 128, description
  `MaxTextLen`, version 32, runtime 128; ≤ `MaxListLen` capabilities each ≤ 64
  chars and non-empty.
- `GrantPermission`: agent must be ACTIVE, project must exist, caller must be
  project owner (`registry.IsProjectOwner`), scopes non-empty (≤ 32) and each
  a valid scope constant, expiry in the future (0 = never); a live grant for
  the pair blocks a new one.
- `SuspendAgent` (`canSuspend`): agent owner, protocol admin, or the owner of
  **any project** holding a non-revoked grant for the agent.
- `RecordExecution`: caller must be the agent owner, agent ACTIVE, status ∈
  {COMPLETED, FAILED}, digest valid, taskID/projectID ≤ 64 chars; when
  `projectID != ""` the agent must hold `EVIDENCE` or `TASK_UPDATE` scope.
- `RevokeAgent` immediately sets `Revoked = true` on all of the agent's
  grants (least privilege on termination).
- `HasPermission` also returns false when the grant is revoked, expired, or
  the agent is not ACTIVE.

Errors: `agents: realm not initialized`, `agents: already initialized`,
`agents: register must run in current realm`, `agents: invalid agent id`,
`agents: agent id already registered`, `agents: metadata exceeds size
limits`, `agents: agent name required`, `agents: too many capabilities`,
`agents: invalid capability`, `agents: unknown agent <id>`,
`agents: not authorized to suspend`, `agents: agent is not active`,
`agents: only the owner may resume`, `agents: agent is not suspended`,
`agents: not authorized to revoke`, `agents: agent already revoked`,
`agents: unknown project`, `agents: only the project owner may grant
permissions`, `agents: invalid scope count`, `agents: invalid scope <s>`,
`agents: expiry must be in the future`, `agents: active grant already exists
for this agent and project`, `agents: no grant for this agent and project`,
`agents: only the project owner or admin may revoke`,
`agents: only the agent owner may record executions`,
`agents: invalid execution status`, `agents: invalid report digest`,
`agents: field exceeds size limits`,
`agents: agent lacks required permission for project`,
`agents: duplicate execution record <id>`.

## 6. policies — `chain/realms/proofloom/policies/policies.gno`

State: `current map[string]*Policy`, `history map[string][]*Policy` (every
prior version archived for audit).

Type: `Policy{ProjectID, Version int, RequireCategories []string,
MinApprovals int, AllowedIssuers []string, RequireNoCritical bool,
RequireValidSBOM bool, UpdatedAt int64, UpdatedBy address}`.

```go
func Init(cur realm)
func SetPolicy(cur realm, projectID string, requireCategories []string, minApprovals int,
               allowedIssuers []string, requireNoCritical, requireValidSBOM bool) int // returns new version
func ClearPolicy(cur realm, projectID string)               // archives then removes; owner only
func GetPolicy(projectID string) (Policy, bool)             // deep copy
func GetPolicyVersion(projectID string, version int) (Policy, bool)
func PolicyVersionCount(projectID string) int
func Initialized() bool
```

Authorization & guards: `SetPolicy` / `ClearPolicy` are **project owner
only** (`registry.IsProjectOwner`). Lists ≤ `MaxListLen`; categories must be
valid attestation categories; issuers must pass `core.IsValidAddress`;
`minApprovals` ∈ [0, 16]. Every `SetPolicy` on an existing policy bumps the
version and pushes the previous version into `history`.

Errors: `policies: realm not initialized`, `policies: already initialized`,
`policies: unknown project`, `policies: only the project owner may set/clear
policy`, `policies: list too long`, `policies: invalid required category
<c>`, `policies: invalid issuer address`, `policies: invalid approval
threshold`.

## 7. verify — `chain/realms/proofloom/verify/verify.gno`

Stateless read-only facade (no `Init`, no vars, no authorization). This is
the protocol's composability contract.

Verdict constants: `VerdictVerified/Valid/Pending/Failed/Revoked/Expired/
Unknown/Disputed/Superseded` (`VERIFIED, VALID, PENDING, FAILED, REVOKED,
EXPIRED, UNKNOWN, DISPUTED, SUPERSEDED`).

Types:
`AttestationSummary{ID, Category, Issuer string, Digest, Status, IssuedAt int64}`,
`PolicyCheck{Requirement string, Passed bool, Detail string}`,
`ReleaseVerdict{ReleaseID, ProjectID, Version, ArtifactDigest, ReleaseStatus,
Verdict string, Attestations []AttestationSummary, PolicyChecks []PolicyCheck,
PolicyVersion int, Notes string}`.

```go
func VerifyRelease(releaseID string) ReleaseVerdict   // explainable composite verdict
func VerifyAttestation(id string) (AttestationSummary, string) // summary + effective status
func VerifyDigest(digest string) []string             // published releases committed to this digest
func GetProject(id string) (reg.Project, bool)        // public projects only
func ListPublicProjectIDs() []string
func ListReleaseIDsByProject(projectID string) []string
func ListAttestationsBySubject(subjectID string) []string
func ProtocolVersion() string
func RegistryStats() (int, int, int, int)             // projects, components, releases, attestations
```

`VerifyRelease` semantics:
- Unknown release → verdict `UNKNOWN`, note "release does not exist".
- Pre-publication state → `PENDING` with a status note; `REVOKED` /
  `SUPERSEDED` / `DISPUTED` map to the matching verdicts with notes.
- Published-family release → collects attestation summaries (sorted by
  category then id) and evaluates the project policy
  (`evaluatePolicy`: per required category an active attestation must exist;
  `APPROVALS>=N` counting allow-listed issuers when configured;
  `NO_CRITICAL_FINDINGS` satisfied by an active `SECURITY_ASSESSMENT`
  attestation — scan content evaluation is off-chain; `VALID_SBOM` satisfied
  by an active `DEPENDENCY_VERIFICATION` attestation). With no policy, a
  baseline check requires an active `BUILD_PROVENANCE` attestation.
- Final verdict: revoked/superseded/disputed statuses win; otherwise
  `VERIFIED` only when every policy check passed, `VALID` when no checks
  configured, else `PENDING`.

## 8. consumer-example — `chain/realms/consumer-example/example/example.gno`

Module `gno.land/r/g1pd8esjj02k67reyzquv42lf8tlc4g9nnntashq/proofloom-consumer/example`.
A third-party integration contract proving that an external application can
consume PROOFLOOM without registering anywhere, holding authority, or
importing any write-side realm. It imports **only** `verify`.

State: `watchlist []string` (the consumer's own trust policy), `curator
address` (set at `Init` from the deployment caller).

```go
func Init(cur realm)                 // records curator; 2nd call panics
func Watch(cur realm, projectID string)   // curator only; idempotent (duplicate add is a no-op)
func Unwatch(cur realm, projectID string) // curator only
func ReleaseGate(releaseID string) (bool, string)
func GateReport(projectID string) string
func Watchlist() []string            // returns a copy
func CuratorAddress() address
```

`ReleaseGate` is the realistic integration pattern: it accepts a release only
when `verify.VerifyRelease(releaseID)` returns `VerdictVerified` **and** the
release's project is on the consumer's watchlist; otherwise it returns
`false` with a reason string (`"release verdict is <verdict>"` or `"project
not on watchlist"`). `GateReport` renders a per-release verdict report for a
watched project — a template for downstream UIs.

Errors: `consumer: already initialized`, `consumer: only the curator may
manage the watchlist`.

## 9. How the app talks to these realms

The TypeScript gateway (`src/lib/chain.ts`) queries read-only functions via
`abci_query` with path `vm/qeval` and data
`<realmPath>.<Expression>` (base64-encoded), e.g.
`verify.VerifyRelease("id")`, `releases.ReleaseStatus("id")`,
`registry.GetPublicProject("id")`, `verify.RegistryStats()`.
Broadcasts (`maketx call`) target realm mutators — see
`TRANSACTION_LIFECYCLE.md`.

## 10. Verification status

Every function listed above exists verbatim in the sources. The 29 test
functions across the 8 packages (see `docs/testing/TEST_STRATEGY.md`) exercise
the state machines, authorization denials, duplicate protection, expiry and
listing determinism described here; all packages pass under
`GNOROOT=/home/z/my-project/bin ./bin/gno test ./proofloom/...
./consumer-example/example/...`. No function has been renamed or invented for
this document.
