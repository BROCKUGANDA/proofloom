# PROOFLOOM Security Model (On-Chain)

Derived from `chain/realms/proofloom/*/*.gno` and the off-chain gateway
(`src/lib/*`). Each control cites the code that implements it. Items that are
**not** implemented are marked as gaps — nothing here is aspirational prose.

---

## 1. Caller identity validation — `cur.Previous().Address()`

Identity is never taken from arguments; every state change attributes the
caller from the VM-provided previous realm:

| Realm | Instances |
|---|---|
| `registry` | `mustAdmin` (compare to stored `admin`), `Init` (stamps admin), `RegisterProject` (stamps Owner), `TransferProject`, `SetProjectVisibility`, `ArchiveProject`, `RestoreProject`, `RegisterComponent`, `DeprecateComponent` |
| `releases` | `caller(cur)` helper used by every mutator; `CreateRelease` stamps `Publisher` |
| `attestations` | `Issue` stamps `Issuer`; `Revoke` compares caller to `a.Issuer` |
| `agents` | `RegisterAgent` stamps `Owner`; `canSuspend`, `ResumeAgent`, `RevokeAgent`, `GrantPermission`, `RevokePermission`, `RecordExecution` (`RecordedBy`) |
| `policies` | `SetPolicy`, `ClearPolicy` compare against `registry.IsProjectOwner`; `UpdatedBy` stamped |
| `verify` | none — pure reads, no realm context |
| `consumer-example` | `Init` stamps `curator`; `assertCurator` gates `Watch`/`Unwatch` |

Cross-realm confusion is blocked with `cur.IsCurrent()` checks:
`registry.mustAdmin` panics on cross-realm admin calls; `releases.requireCurrent`
and `attestations`/`agents` `cur.IsCurrent()` guards force mutators to run in
the current realm.

## 2. Admin authorization — single root of trust

- `registry.Init` records the deployment caller as protocol **admin**; a
  second `Init` panics (`registry: already initialized`) — the admin can
  never be re-stamped.
- Only `registry.SetAdmin` (admin-only, address-validated) can transfer it.
- All other realms have **no local admin**: `releases`, `attestations`,
  `agents`, `policies` delegate to `registry.IsProtocolAdmin(addr)`. This
  means one rotation rotates admin authority everywhere.
- Admin power is deliberately narrow even in `registry`: the admin may manage
  the registrar allow-list and archive projects, but cannot transfer or
  mutate user-owned projects. The test `TestAdminCannotBeUsurped`
  (`registry_test.gno`) locks this in.
- Off-chain mirror: `src/lib/verification.ts` accepts
  `PROOFLOOM_OPERATOR_ADDRESS` as an authorized issuer only for the platform
  operator; regular authorization requires org membership.

## 3. No mutable pointer exposure

All getters return value copies so callers can never hold a reference into
realm state:

- Structs are dereferenced on return: `registry.GetProject/GetProjectFor/
  GetPublicProject/GetComponent` (`*p`, `*c`), `releases.GetRelease/
  GetPublishedRelease` (`*r`), `attestations.GetAttestation` (`*a`),
  `agents.GetExecution` (`*e`).
- Slice fields are deep-copied: `agents.GetAgent` copies `Capabilities`,
  `agents.GetGrant` copies `Scopes`, `policies.copyPolicy` copies
  `RequireCategories` and `AllowedIssuers`, `consumer-example.Watchlist`
  copies its list.
- List getters build fresh slices (`ListProjectIDs` copies then reverses;
  `ListPublicProjectIDs`, `ListActiveBySubjectAndCategory`, `FindByDigest`
  build sorted output slices). Internal maps are never exposed through any
  exported function.

## 4. Replay / duplicate protections — deterministic protocol ids

- `core.ComposeReleaseID(projectID, version)` →
  `<projectID>-<lowercased version>`; `releases.CreateRelease` panics
  `releases: release already exists <id>` on re-use.
- `core.ComposeAttestationID(subjectID, category, issuer)` →
  `<subject>-<lowercased category>-<issuer>`; `attestations.Issue` panics
  when an **active** attestation with the same id exists (revoked ones may be
  re-issued, and the re-issue is a new public event, not a silent overwrite).
- `agents` grants are keyed `agentID + "/" + projectID`; a live grant blocks
  re-granting (`agents: active grant already exists for this agent and
  project`). Executions are keyed `agentID + "-" + taskID`; duplicates panic.
- Expiry is enforced at read time: `attestations.EffectiveStatus` derives
  `EXPIRED` from `ExpiresAt`; `agents.HasPermission` returns false for expired
  grants; both use absolute unix timestamps supplied at grant/issue time.
- Terminal-state protection in `releases`: `Reject` refuses
  published/verified records; `Revoke` only from PUBLISHED/VERIFIED;
  `Dispute` refuses terminal REVOKED/SUPERSEDED. A PUBLISHED record can never
  silently change — corrections are explicit `Supersede`/`Revoke` events.

## 5. Input validation on-chain

`core` validators gate every persisted field: `IsValidID` (slugs),
`IsValidDigest` (64-hex sha256), `IsValidAddress` (g1-prefix),
`IsValidVersion`, `IsValidShortHash`, `IsValidSlugList`; `BoundedText` +
`MaxTextLen=512` + `MaxListLen=32` cap free-form text and list sizes
(`registry.RegisterProject`, `agents.RegisterAgent`,
`attestations.Revoke`, `policies.SetPolicy` all enforce them). Enum fields
(visibility, artifactType, scopes, categories, subject types, execution
status) are whitelist-checked in the owning realm.

## 6. Tenant visibility on-chain

- Private projects are hidden from foreign readers via
  `registry.GetProjectFor` / excluded from `GetPublicProject`.
- Pre-publication releases are hidden by `releases.GetRelease` unless the
  reader is authorized; `ReleaseStatus` remains public intentionally (needed
  for external revocation checks).
- Agent grants are addressed by `agentID/projectID` pairs, not enumerated.

## 7. Off-chain complements (pointers)

- Session auth: opaque 256-bit tokens, sha256-hashed at rest, httpOnly +
  `sameSite: lax` + `secure` cookies, 30-day expiry, 7-day rotation —
  `src/lib/auth.ts` (details in `docs/security/SECURITY_CONTROLS.md`).
- RBAC capability checks enforced server-side per request
  (`requireMembership`, `requireProjectAccess`).
- scrypt password hashing, HMAC webhook verification, rate limiting — see
  `docs/security/SECURITY_CONTROLS.md` and `docs/security/THREAT_MODEL.md`.

## 8. Known gaps (on-chain)

1. **No events**: realms emit nothing, so off-chain components must poll
   state (`reconcileTransaction`) — acceptable but worth an events upgrade.
2. **`registry.GetProject` visibility**: returns private projects to any
   caller (documented as an existence probe). Anyone who can call the realm
   can learn that a private project id exists and read its metadata. Marked
   here as a conscious trade-off, not a secret.
3. **`agents.canSuspend` iteration** over all grants is O(n) per call — a
   performance, not security, consideration.
4. **Operator publish mismatch**: `POST /api/chain op=publish-on-chain`
   targets `releases.PublishRelease`, which the deployed realm does not
   export (see `TRANSACTION_LIFECYCLE.md` §3). Fail-closed (the call fails),
   but it is an unimplemented operator path, not a protection.
5. **`--insecure-password-stdin`**: both `deploy.sh` and `operator.ts` feed
   key passwords/mnemonics via stdin; acceptable for testnet automation, must
   be revisited for mainnet-style operations.
