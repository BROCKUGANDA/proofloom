# PROOFLOOM Privacy Model

How PROOFLOOM classifies data, what crosses the on-chain boundary, and what
happens on deletion. Derived from the realm sources, `prisma/schema.prisma`
and the lib/routes cited below.

---

## 1. Data classification

| Class | Examples | Storage | Notes |
|---|---|---|---|
| **Public protocol data** | release protocol ids (`<project>-<version>`), artifact digests (sha256), release status, attestation ids (`<subject>-<category>-<issuer>`), categories, issuer g1 addresses, policy requirement shapes, verify verdicts | On-chain (realms) + mirrored in DB + public API | Immutable once published; visible to anyone via `verify` realm and `/api/verify/*`, `/api/public/explore` |
| **Org-confidential** | project descriptions/repo URLs of private projects, release pipeline refs/build env, tasks, reviews, membership roster, invitations, policies, agent configs | DB only (`Project`, `Release`, `Task`, `Review`, `Policy`, `Agent`, `Invitation`) | Server-side tenant filter on every query (`src/lib/auth.ts`); private visibility enforced on-chain via `registry.GetProjectFor` |
| **Credentials** | passwords (scrypt), session token hashes, API key hashes, TOTP secrets, operator mnemonic, webhook secret, gnokey keystore | env / DB (hashed) / keybase | Hash-at-rest everywhere except env-provided runtime secrets; see the git-tracking gap in `SECURITY_CONTROLS.md` §8 |
| **Evidence artifacts** | build logs, test reports, SBOMs, security scans, agent reports, approvals | DB (`Evidence.content`, inline ≤512 KiB; `storageKey` for object storage) | Content-addressed (`contentHash` = sha256); on-chain stores the digest only |
| **Operational metadata** | sessions (ip, user-agent), audit events (ip, traceId), webhook deliveries, verification results, usage counters | DB | Retained for security analytics; IP from `x-forwarded-for` |

## 2. What goes on-chain vs stays off-chain

On-chain (by design, `chain/realms/proofloom/`):

- IDs, statuses, category enums, addresses, **64-hex sha256 digests**, small
  bounded metadata (name ≤128, description ≤512, repo ≤256 etc. —
  `core.BoundedText`, `MaxTextLen=512`, `MaxListLen=32`).
- Attestation commitments: *who* claimed *what category* about *which
  subject*, *when*, and whether it still stands (attestations.gno header).
- State transitions themselves (publish/revoke/supersede are public events by
  virtue of status changes — no event log exists, states are re-read).

Off-chain (never on-chain):

- Evidence bytes (build logs, SBOMs, reports) — `Evidence.content` /
  `storageKey`; the chain stores only the commitment
  (`releases.SetEvidence` doc-comment; `attestations.gno` header).
- Personal data: emails, display names, TOTP secrets, session IPs, audit IPs
  — DB only.
- LLM prompts/outputs and agent runtime internals (`src/lib/agent-runtime.ts`,
  `src/lib/llm.ts`) — DB receipts carry a digest, not the transcript.

Rationale: on-chain state is immutable and publicly readable, so anything
personal, bulky, or confidential must remain off-chain; digests are
non-invertible and fixed-size, giving integrity without disclosure.

## 3. Retention & deletion

- **Off-chain is deletable.** Evidence rows, sessions, notifications,
  webhook deliveries, verification results and usage records are ordinary DB
  rows and can be deleted/retention-swept. No retention job exists yet
  (**gap**: no automated retention/pruning code in `src/`).
- **Org/member deletion:** membership deletion cascades
  (`Membership onDelete: Cascade`); org data is soft-archived
  (`Organization.archived`, project `status ARCHIVED`). User suspension is a
  status flag (`User.status ACTIVE|SUSPENDED|DELETED`), not a hard delete —
  audit and attestation history keep referencing the actor id.
- **On-chain is not deletable.** Published releases can only be REVOKED /
  SUPERSEDED / DISPUTED; attestations can only be revoked (revocation is
  permanent and publicly visible — `attestations.Revoke`). Therefore: any
  identifier or digest committed on-chain remains queryable forever, and
  personal data must never be embedded in on-chain fields (ids are slugs and
  addresses; reason strings ≤512 chars — avoid free text with personal data).
- **Revocation ≠ deletion:** revocation is a visible compliance signal; the
  public record remains inspectable by design ("revocation is a visible
  state, never a deletion" — releases.gno).

## 4. Immutable public records — implications

1. Choose ids carefully: protocol ids are deterministic
   (`core.ComposeReleaseID/ComposeAttestationID`) and include issuer
   addresses — wallet addresses in attestation ids are permanently public.
2. Digests are content commitments: once published, the fact that *some*
   artifact with that sha256 existed is permanently attestable, even if the
   artifact bytes are later deleted off-chain (verification then reports
   `evidence_accessible: false` / digest-format-only limitation —
   `src/lib/verification.ts`).
3. Policy history is preserved on-chain (`policies.history`) — prior
   requirement configurations stay auditable.
4. Private data published by mistake cannot be un-published: recover by
   revoking the record and rotating whatever secret the evidence contained;
   prevention is enforced by the ≤512-char bounded metadata rule and the
   digest-only commitments.

## 5. Third-party exposure surfaces

- Public REST: `GET /api/verify/{release|attestation|digest}/…` and
  `GET /api/public/explore` (rate-limited; only `visibility: 'public'`
  projects and published-family releases are returned).
- On-chain reads: `verify.VerifyRelease / VerifyAttestation / VerifyDigest /
  GetProject / RegistryStats` — no authorization required by design.
- Consumers integrate exactly like `chain/realms/consumer-example` — reading
  the public facade without holding any org data.
