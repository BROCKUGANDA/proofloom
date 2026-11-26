# Edge Case Register

A register of concrete edge cases grounded in real code paths (file/endpoint
cited for each). "gap" = no handling found in the code. Legend for Current
handling: `file → behavior (error code / effect)`.

---

## Identity & authentication

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-AUTH-01 | Auth | Login with non-existent email | Same generic error as wrong password (no user enumeration) | `src/app/api/auth/[action]/route.ts` → `AUTH_INVALID_CREDENTIALS` |
| EC-AUTH-02 | Auth | Login with missing email/password | 400, no DB hit | same route → `AUTH_INVALID_CREDENTIALS` (deliberately not `VALIDATION_FAILED`) |
| EC-AUTH-03 | Auth | Register with weak password (≤10 chars / no upper / no digit) | 400 with specific problems | `src/lib/crypto.ts passwordStrength` → `AUTH_WEAK_PASSWORD {problems}` |
| EC-AUTH-04 | Auth | Register with already-used email | 409 | auth route → `DUPLICATE {field: email}` |
| EC-AUTH-05 | Auth | Register with malformed email | 400 | regex `^[^@\s]+@[^@\s]+\.[^@\s]+$` → `VALIDATION_FAILED {field: email}` |
| EC-AUTH-06 | Auth | >10 registrations/hour from one IP | 429 | `limits.registration` (`rate-limit.ts`) → `RATE_LIMITED` |
| EC-AUTH-07 | Auth | >10 failed logins/15min for one email | 429 on further attempts | `guardRate('login-fail', email, 10, 15min)` — note: counter only increments on failures of *known* emails path (both branches call guardRate) |
| EC-AUTH-08 | Auth | MFA enabled, code missing / wrong | 401 with distinct codes | `checkMfa` (`src/lib/auth.ts`) → `AUTH_MFA_REQUIRED` / `AUTH_MFA_INVALID` |
| EC-AUTH-09 | Auth | MFA disable without current password | 401 | mfa-disable branch → `AUTH_INVALID_CREDENTIALS` |
| EC-AUTH-10 | Auth | Expired or revoked session cookie | 401 on every protected route | `getAuth` (`src/lib/auth.ts`) returns null → `requireAuth` throws `AUTH_REQUIRED` |
| EC-AUTH-11 | Auth | Suspended user with valid session | Session unusable; login blocked | `getAuth` checks `status !== 'ACTIVE'`; login → `FORBIDDEN {reason: account suspended}` |
| EC-AUTH-12 | Auth | Wallet link with malformed g1 address | 400 | auth route wallet-link → regex `/^g1[a-z0-9]{36,40}$/` → `INVALID_ADDRESS` |
| EC-AUTH-13 | Auth | Wallet link without signature | Association stored but marked unverified, honestly | `verified = signature?.length > 40` → stored `verified: false` (route comment admits preview limitation) |
| EC-AUTH-14 | Auth | Unknown `/api/auth/<action>` | 404 | fall-through → `NOT_FOUND {route}` |
| EC-AUTH-15 | Auth | Session older than 7 days | Transparent rotation | `requireAuth` → `rotateSession` (new token, `lastRotatedAt`) |

## Organization membership

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-ORG-01 | Membership | Invite with role ≥ OWNER | 400 | `orgs/[orgId]/members/route.ts` → `VALIDATION_FAILED {reason: cannot invite at or above OWNER}` |
| EC-ORG-02 | Membership | Invite an existing member | 409 | same route → `DUPLICATE {reason: already a member}` |
| EC-ORG-03 | Membership | Remove yourself | 400 | DELETE members → `VALIDATION_FAILED {reason: cannot remove yourself}` |
| EC-ORG-04 | Membership | Remove an OWNER | 403 | → `FORBIDDEN {reason: owners cannot be removed; transfer ownership first}` |
| EC-ORG-05 | Membership | Revoke an invitation ID from another org | Tenant check fires | `inv.organizationId !== orgId` → `TENANT_ISOLATION` (checked **after** the update — row already flipped to REVOKED; ordering gap) |
| EC-ORG-06 | Membership | Non-member reads roster | 403 | `requireMembership(..., 'project.read')` → `NOT_A_MEMBER` |

## Permissions (RBAC)

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-PERM-01 | Permissions | DEVELOPER attempts `release.publish` | 403 | `PATCH /api/releases/[releaseId]` capFor map → `requireProjectAccess(..., 'release.publish')` → `FORBIDDEN` |
| EC-PERM-02 | Permissions | VIEWER uploads evidence | 403 | evidence POST requires `evidence.write` (VIEWER lacks it) → `FORBIDDEN` |
| EC-PERM-03 | Permissions | AUDITOR issues attestation | Allowed by design | `attestation.issue` ∈ AUDITOR caps (`src/lib/auth.ts CAPS`) |
| EC-PERM-04 | Permissions | Member (any role) lists agents | Read succeeds even for VIEWER | **gap (weaker RBAC):** `GET /api/agents` uses `requireMembershipShim` (membership only, no capability) — `src/app/api/agents/route.ts` |
| EC-PERM-05 | Permissions | Invited role above inviter's rank | Currently permitted if inviter holds `org.invite` | **gap:** no rank comparison between inviter and invited role |

## Tenant isolation

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-TEN-01 | Isolation | Cross-org user fetches release by id | 404-style denial without data leak | `requireProjectAccess` → membership lookup fails → `NOT_A_MEMBER` (release existence implied by 404/403 distinction) |
| EC-TEN-02 | Isolation | Agent executed with org mismatch | 403 | `src/lib/agent-runtime.ts startExecution` → `TENANT_ISOLATION` |
| EC-TEN-03 | Isolation | Cross-org execution detail fetch | 403 | `executions/[executionId]/route.ts` membership check → `TENANT_ISOLATION` |
| EC-TEN-04 | Isolation | Attestation row with `organizationId = null` read by stranger | Should deny | **gap:** `attestations/[attestationId]/route.ts` GET checks access only `if (att.organizationId)` — org-less rows are readable by any authenticated user |
| EC-TEN-05 | Isolation | Private project in public explorer | Excluded | `public/explore/route.ts` filters `visibility: 'public'` and re-filters attestations by release→project visibility |
| EC-TEN-06 | Isolation | Private project queried on-chain | Hidden from foreign readers | `registry.GetProjectFor` / `GetPublicProject` (`registry.gno`); note `GetProject` alone is an existence probe |
| EC-TEN-07 | Isolation | Pre-publication release queried on-chain by stranger | Hidden | `releases.GetRelease(id, reader)` visibility family check |

## Releases

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-REL-01 | Releases | Duplicate version within a project | 409 | `projects/[projectId]/releases/route.ts` → unique `projectId_version` → `DUPLICATE` |
| EC-REL-02 | Releases | Malformed version string | 400 | regex `^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,31}$` → `VALIDATION_FAILED` |
| EC-REL-03 | Releases | Malformed commit hash | 400 | regex `^[0-9a-f]{7,64}$` → `VALIDATION_FAILED` |
| EC-REL-04 | Releases | Illegal transition (e.g. DRAFT → PUBLISHED) | 409 with allowed list | `TRANSITIONS` map → `INVALID_TRANSITION {from, to, allowed}` |
| EC-REL-05 | Releases | Publish without valid artifact digest | 400 | digest gate on EVIDENCE_PENDING/APPROVED/PUBLISHED → `INVALID_DIGEST` |
| EC-REL-06 | Releases | Publish while policy unmet | 409 with check details | `evaluateReleasePolicy` → `INVALID_TRANSITION {policyChecks}` |
| EC-REL-07 | Releases | Mark VERIFIED with zero on-chain attestations | 409 | count of ACTIVE+onChain attestations → `INVALID_TRANSITION` |
| EC-REL-08 | Releases | Supersede with another project's release | 400 | `supersededBy` project check → `VALIDATION_FAILED` |
| EC-REL-09 | Releases | Supersede with unpublished release | 400 | status check → `VALIDATION_FAILED` |
| EC-REL-10 | Releases | Create release on archived project | 409 | → `ARCHIVED` |
| EC-REL-11 | Releases | Unknown PATCH action | 400 listing allowed actions | → `VALIDATION_FAILED {allowed}` |
| EC-REL-12 | Releases | On-chain duplicate release id (same project+version) | Panic, no state change | `releases.gno CreateRelease` → `releases: release already exists <id>` |
| EC-REL-13 | Releases | On-chain create by non-owner | Panic | `releases.gno` → `releases: only the project owner may create releases` (regression-tested: `TestReleaseAuthorization`) |

## Evidence

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-EV-01 | Evidence | Inline content > 512 KiB | 400 pointing to object storage | `MAX_INLINE_BYTES` check → `VALIDATION_FAILED` (no object adapter implemented yet) |
| EC-EV-02 | Evidence | Client-supplied digest ≠ computed sha256 | 400 | → `INVALID_DIGEST {computed}` (server digest is authoritative) |
| EC-EV-03 | Evidence | Unknown `kind` | 400 with allowed list | `KINDS` whitelist → `VALIDATION_FAILED` |
| EC-EV-04 | Evidence | Evidence on REVOKED/SUPERSEDED release | 409 | → `INVALID_TRANSITION {from}` |
| EC-EV-05 | Evidence | Evidence on DRAFT release without artifactDigest | Stays DRAFT (no bogus state) | auto-advance guarded by `release.artifactDigest` presence |
| EC-EV-06 | Evidence | PUT fetch of evidenceId from another release | 404 | `ev.releaseId !== releaseId` → `NOT_FOUND` |
| EC-EV-07 | Evidence | Stored evidence bytes modified out-of-band | Integrity flagged, not hidden | PUT handler recomputes → `integrityOk: false` surfaced; verification engine would set verdict `FAILED` (`verification.ts digest_integrity`) |

## Attestations

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-ATT-01 | Attestations | Same issuer+subject+category while active | 409 | protocol id uniqueness → `DUPLICATE` (mirrors on-chain panic in `attestations.gno`) |
| EC-ATT-02 | Attestations | Re-issue after revocation | Allowed; becomes new ACTIVE record | upsert revives with new `issuedAt`, clears revocation fields |
| EC-ATT-03 | Attestations | `expiresAt` in the past | 400 | → `VALIDATION_FAILED {reason: expiry must be in the future}` (on-chain: panic) |
| EC-ATT-04 | Attestations | Issuer address not g1-valid | 400 | → `INVALID_ADDRESS` |
| EC-ATT-05 | Attestations | Double revocation | 409 | → `INVALID_TRANSITION {from: REVOKED}` |
| EC-ATT-06 | Attestations | Revocation by non-issuer | 403 unless `attestation.revoke` in owning org | issuer check + capability fallback; org-less row → `FORBIDDEN` |
| EC-ATT-07 | Attestations | On-chain Issue against unknown subject | Panic | `attestations.gno subjectExists` → `attestations: subject does not exist` (COMPONENT/TASK/AGENT_EXECUTION accepted without lookup — documented) |

## Agents

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-AGT-01 | Agents | Execute with SUSPENDED/REVOKED agent | 409 | `startExecution` → `AGENT_SUSPENDED` |
| EC-AGT-02 | Agents | Execute without active grant / required scope | 403 | grant+scope check → `AGENT_NOT_AUTHORIZED {missing}` |
| EC-AGT-03 | Agents | >30 executions/min per org | 429 | `limits.agentExec` → `RATE_LIMITED` |
| EC-AGT-04 | Agents | Grant with unknown scope | 400 | `VALID_SCOPES` whitelist → `VALIDATION_FAILED` (on-chain: panic `agents: invalid scope <s>`) |
| EC-AGT-05 | Agents | Grant expiry in the past | 400 | → `VALIDATION_FAILED` |
| EC-AGT-06 | Agents | Re-grant while a live grant exists | Platform upsert **replaces**; on-chain **panics** | **discrepancy:** `agents/route.ts` upsert overwrites; `agents.gno GrantPermission` panics `active grant already exists` — DB is more permissive than chain |
| EC-AGT-07 | Agents | Duplicate execution receipt (same agent+task) on-chain | Panic | `agents.gno` → `agents: duplicate execution record <id>` |
| EC-AGT-08 | Agents | RecordExecution by non-owner on-chain | Panic | `agents.gno` → `agents: only the agent owner may record executions` |
| EC-AGT-09 | Agents | `set-status` with invalid status | 400 | whitelist `ACTIVE|SUSPENDED|REVOKED` → `VALIDATION_FAILED` |
| EC-AGT-10 | Agents | Expired DB grant used at execution time | Denied | `startExecution` checks `expiresAt > Date.now()` (no sweeper — rows persist) |

## Policies

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-POL-01 | Policies | `minApprovals` > 16 on-chain | Panic | `policies.gno` → `policies: invalid approval threshold` |
| EC-POL-02 | Policies | Unknown required category | Panic | `validCategoryRef` → `policies: invalid required category <c>` |
| EC-POL-03 | Policies | Non-g1 issuer in allow-list | Panic | `core.IsValidAddress` → `policies: invalid issuer address` |
| EC-POL-04 | Policies | Policy overwritten | Previous version archived | `SetPolicy` pushes to `history`; `GetPolicyVersion` reads it (`TestPolicyVersioning`) |
| EC-POL-05 | Policies | Multiple active DB policies for a project | First active wins (order not guaranteed) | `findFirst({ where: { projectId, active: true } })` — **gap:** no uniqueness constraint on active policy |

## Chain transactions

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-TX-01 | Chain | `PROOFLOOM_OPERATOR_MNEMONIC` unset | Explicit failure, no simulation | `operator.ts` → error code `FAUCET_DEPLETED` + recovery text (also used for "not configured" — naming quirk) |
| EC-TX-02 | Chain | Broadcast output lacks parsable hash | 502 | hash regexes fail → `TX_FAILED {output snippet ≤300 chars}` |
| EC-TX-03 | Chain | RPC network ≠ configured chain id | 409 | `verifyChainIdentity` → `CHAIN_ID_MISMATCH` |
| EC-TX-04 | Chain | RPC unreachable | 503; reconcile treats as retryable | `CHAIN_UNAVAILABLE`; `reconcileTransaction` → `PENDING` |
| EC-TX-05 | Chain | Realm says record unknown during reconcile | PENDING (not FAILED) | log regex `unknown release|project|…` → `NOT_FOUND` → reconcile `PENDING` |
| EC-TX-06 | Chain | Operator publish to releases realm | Should call a real realm function | **discrepancy:** `chain/route.ts publish-on-chain` calls `releases.PublishRelease`, which the deployed realm does not export — call fails at chain (fail-closed) |
| EC-TX-07 | Chain | `record`/`transition` with invalid status | 400 with allowed list | TX_STATES whitelist → `VALIDATION_FAILED` |
| EC-TX-08 | Chain | `confirm-on-chain` for kind without confirm expr | 400 | → `VALIDATION_FAILED {reason: no confirmation query…}` |
| EC-TX-09 | Chain | Malformed releaseId in `fetchOnChainVerdict` | 400 | regex `^[-a-z0-9]{1,80}$` → `VALIDATION_FAILED` |
| EC-TX-10 | Chain | Duplicate `idempotencyKey` insert | DB uniqueness error | `ChainTransaction.idempotencyKey @unique`; keys embed `Date.now()` → trace ids, **gap:** no true cross-retry dedupe |

## Wallet

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-WAL-01 | Wallet | Adena not installed | Guidance error, no crash | `client.ts walletConnect` throws instructive message; read flows need no wallet |
| EC-WAL-02 | Wallet | Wallet without `signEcdsa` | Returns null | `walletSignMessage` → `null` (caller decides) |
| EC-WAL-03 | Wallet | Wallet on different chain | Surfaced by `walletStatus.chainId`; server-side guard for RPC identity | `CHAIN_ID_MISMATCH` only checks RPC identity — **gap:** server does not verify the Adena-reported chainId matches before accepting signed payloads |

## Rate limiting

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-RL-01 | Rate limit | >120 verify requests/min per IP | 429 with resetAt | `guardRate('public-verify', ip, 120, 60s)` in `verify/[...path]/route.ts` |
| EC-RL-02 | Rate limit | >240 explore requests/min per IP | 429 | `public/explore/route.ts` |
| EC-RL-03 | Rate limit | Spoofed `x-forwarded-for` | Rate-limit identity should be trustworthy | **gap:** `clientIp` takes the first header value (`api.ts`) — spoofable behind misconfigured proxies |
| EC-RL-04 | Rate limit | Window boundary: burst across reset | Counters reset on new window | fixed-window math in `rateLimit` (bursts at boundaries are allowed by design — documented trade-off) |
| EC-RL-05 | Rate limit | DB unavailable | Rate limiting fails, request likely errors | upsert throws → `INTERNAL` (fail-closed, no bypass) |

## Webhooks

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-WH-01 | Webhooks | Secret not configured | Honest failure, not silent 200 | → `GITHUB_UNAUTHORIZED {reason: webhook secret not configured}` |
| EC-WH-02 | Webhooks | Invalid/tampered signature | 401 | → `WEBHOOK_SIGNATURE_INVALID` (constant-time compare) |
| EC-WH-03 | Webhooks | Redelivered delivery id | Dedupe, no duplicate records | `webhookDelivery` lookup → `{ok, deduped: true}` |
| EC-WH-04 | Webhooks | Relay signature with old timestamp | Should reject stale | **gap:** timestamp accepted, no freshness window |
| EC-WH-05 | Webhooks | Payload > 40 KB | Stored truncated, still processed | `raw.slice(0, 40_000)` |
| EC-WH-06 | Webhooks | Non-JSON body with valid signature | 500 envelope | `JSON.parse` throws → `withApi` → `INTERNAL` (arguably should be 400 — gap) |

## Verification

| ID | Area | Trigger | Expected behavior | Current handling |
|---|---|---|---|---|
| EC-VF-01 | Verification | Digest lookup with non-64-hex input | 400-style response | route returns `{error: 'digest must be 64 lowercase hex characters'}` (plain object, not the error envelope — inconsistency noted) |
| EC-VF-02 | Verification | Evidence stored in object storage (not inline) | Report limitation, no crash | `digest_integrity` note + `limitations[]` entry |
| EC-VF-03 | Verification | RPC down mid-verification | `chain_publication` fails softly with limitation | `CHAIN_UNAVAILABLE` branch → check failed + limitations note (no exception) |
| EC-VF-04 | Verification | Release id given as protocol id (`slug-version`) | Resolved via project slug + version | `verifyRelease` split/fallback query (`verification.ts`) |
| EC-VF-05 | Verification | Unknown release/attestation id | verdict `UNKNOWN` with `record_exists: false` | explicit branch in `verifyRelease`/`verifyAttestation` |

---
Total: 76 entries. Highest-priority gaps: EC-TEN-04 (org-less attestation
read), EC-AGT-06 (DB upsert vs on-chain panic), EC-TX-06 (PublishRelease
mismatch), EC-WH-04 (timestamp freshness), EC-RL-03 (XFF trust), EC-POL-05
(multiple active policies).
