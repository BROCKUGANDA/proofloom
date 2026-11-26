# PROOFLOOM Test Strategy

Honest inventory of what exists today and the layered plan for what does
not. Counts below were taken by grepping `func Test` across the realm test
files.

---

## 1. What exists

### 1.1 Gno realm tests — implemented, passing

Location: `chain/realms/proofloom/*/*_test.gno` and
`chain/realms/consumer-example/example/example_test.gno`.
Run: `GNOROOT=/home/z/my-project/bin ./bin/gno test ./proofloom/...
./consumer-example/example/...` (from `chain/realms/`).

**28 test functions in the proofloom realms + 1 consumer test = 29 total**:

| Realm | Count | Test functions |
|---|---|---|
| `core` | 6 | TestIsValidAddress, TestIsValidDigest, TestIsValidID, TestIsValidVersionAndHash, TestComposeIDs, TestBoundedText |
| `registry` | 7 | TestRegisterProjectFlow, TestUnauthorizedRegistration, TestOwnershipTransfer, TestComponentsAndVisibility, TestArchiveAndRestore, TestAdminCannotBeUsurped, TestListingDeterministic |
| `releases` | 3 | TestReleaseStateMachine, TestReleaseAuthorization, TestRevokeAndSupersede |
| `attestations` | 3 | TestIssueAndDuplicatePrevention, TestRevocation, TestValidationGuards |
| `agents` | 3 | TestAgentLifecycle, TestGrantAuthorization, TestExpiringGrants |
| `policies` | 1 | TestPolicyVersioning |
| `verify` | 5 | TestFullVerificationWorkflow, TestPolicyEnforcedVerification, TestRevocationVisibleInVerdict, TestUnknownAndPrePublication, TestComposabilitySurface |
| consumer example | 1 | TestConsumerGate |

These cover: state-machine transitions (happy path), authorization denials
(non-owner/non-admin panics), admin-usurpation prevention, deterministic id
composition + duplicate prevention, revocation/expiry semantics, policy
versioning, composable verification, and the third-party release gate.
Coverage emphasis is security-critical invariants, not exhaustiveness (e.g.
`policies` has one versioning test; input-validation fuzzing is absent).

Known quirk: `./consumer-example/...` also matches the module *root* (only a
`gnomod.toml`, no files) and reports `package has no files … [setup failed]`.
Test the leaf package `./consumer-example/example/...` — this is a glob
artifact, not a failure.

### 1.2 Shell-based container/runtime tests — implemented (infrastructure)

`tests/python-runtime-build.sh`, `tests/python-runtime-container.sh`,
`tests/database-runtime-build.sh`. These exercise the sandbox's *runtime
packaging* helpers in `.zscripts/` (e.g. python report build, container
layout, and a fake-`bun` harness asserting `DATABASE_URL` must be an absolute
`file:` SQLite URL for `bun run db:push`). They validate the execution
environment, **not** PROOFLOOM product behavior.

### 1.3 Frontend / backend (TypeScript) tests — absent → **Planned**

Verified: `package.json` contains **no** `jest`, `vitest`, `playwright`,
`mocha`, `node:test` or any test script; there are no `*.test.ts` /
`*.spec.ts` files under `src/`; no test config files. The only "tests" for
the app layer are the runtime-container scripts above. Status: **Planned**
(see §2). Consequence: every API-route behavior in the docs was established
by code reading, not by automated TS tests — this is stated plainly in
`docs/audits/IMPLEMENTATION_STATUS.md`.

## 2. Layered target strategy

### Unit (Planned — TS)

- Pure libs first: `src/lib/crypto.ts` (scrypt round-trip, TOTP ±1 window,
  webhook signature, constant-time compare), `src/lib/policy-engine.ts`
  (deterministic verdicts incl. allow-listed approvals),
  `src/lib/rate-limit.ts` (window math), `src/lib/errors.ts` (code table),
  `parseGoStruct`/verdict parsing in `src/lib/chain.ts`.
- Runner suggestion: vitest (fast, TS-native). No runner is installed today.

### Integration (Planned — TS)

- API routes against a throwaway SQLite DB (Prisma): auth flows
  (register/login/MFA/wallet-link UNVERIFIED path), RBAC matrix per
  capability, release state-machine transitions incl. policy gate,
  evidence ingest (512 KiB cap, digest mismatch), attestation duplicate
  protocol ids, webhook signature verification + dedupe, chain route ops
  with the RPC mocked (`FAUCET_DEPLETED` path included).
- Gno side stays covered by realm tests; optionally drive `gnodev` via
  `gnokey` in CI as a smoke layer.

### E2E (Planned)

- Playwright: sign-in → create project → release → evidence → attest →
  publish; verify portal queries; explorer feed. Requires the app + either
  mocked chain responses or local `gnodev`.

### Security testing (Partially covered, more planned)

- Covered now: on-chain authorization negatives, admin usurpation, duplicate
  protection, expiry (realm tests); webhook HMAC + dedupe implemented in
  code (untested).
- Planned: RBAC negative-matrix tests, rate-limit enforcement tests,
  tenant-isolation suite (cross-org probes on every route incl. the
  `attestations/[attestationId]` no-org path — see `EDGE_CASE_REGISTER.md`
  EC-ID-3), payload-size and prototype-pollution-style body tests, and
  dependency auditing in CI.

### Visual (Planned)

- The UI is a custom shadcn/tailwind front end
  (`src/components/views/*`); no snapshot/regression tooling exists.
  Planned: Playwright screenshot suites for the verify portal and explorer.

## 3. Coverage map (honest)

| Area | Realm tests | TS tests | Notes |
|---|---|---|---|
| Realm state machines & authz | ✅ 29 tests | — | passing locally (gno v1.8.0) |
| Input validation (on-chain) | ✅ core tests | — | |
| API route behavior | ❌ | ❌ Planned | code-reviewed only |
| Rate limiting | ❌ | ❌ Planned | implemented in `rate-limit.ts` |
| Webhook security | ❌ | ❌ Planned | implemented in webhook route |
| Verification engine | ❌ | ❌ Planned | `verification.ts` logic |
| Operator/tx lifecycle | ❌ | ❌ Planned | `operator.ts`, `chain.ts` |
| UI/E2E | ❌ | ❌ Planned | |
| Runtime containers | ✅ shell tests | — | infra, not product |

## 4. CI integration (Planned)

No CI pipeline config exists in the repo. Target: on every PR run
`npm run lint` (eslint config present), `npm run build`, realm tests
(GNOROOT-pinned), and — once added — vitest suites; nightly: gnodev
deployment smoke via `chain/scripts/deploy.sh` against the local chain.
