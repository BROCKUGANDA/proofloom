// Machine-readable error codes with recovery guidance.
// Every error surfaced to clients carries a stable code, an HTTP status,
// a human message and a recovery instruction. Internal details never leak.

export interface ProofloomError {
  code: string
  status: number
  message: string
  recovery: string
  retryable: boolean
  details?: Record<string, unknown>
}

const defs: Record<string, Omit<ProofloomError, 'details'>> = {
  // auth
  AUTH_REQUIRED: { status: 401, message: 'Authentication required.', recovery: 'Sign in and retry.', retryable: false },
  AUTH_INVALID_CREDENTIALS: { status: 401, message: 'Email or password is incorrect.', recovery: 'Check your credentials or reset your password.', retryable: true },
  AUTH_SESSION_EXPIRED: { status: 401, message: 'Your session has expired.', recovery: 'Sign in again.', retryable: false },
  AUTH_MFA_REQUIRED: { status: 401, message: 'Multi-factor code required.', recovery: 'Enter your authenticator code.', retryable: true },
  AUTH_MFA_INVALID: { status: 401, message: 'Invalid multi-factor code.', recovery: 'Check your authenticator app and retry.', retryable: true },
  AUTH_WEAK_PASSWORD: { status: 400, message: 'Password does not meet the minimum strength.', recovery: 'Use at least 10 characters mixing letters, digits and symbols.', retryable: true },
  // authorization
  FORBIDDEN: { status: 403, message: 'You do not have permission for this action.', recovery: 'Ask an organization administrator for access.', retryable: false },
  NOT_A_MEMBER: { status: 403, message: 'You are not a member of this organization.', recovery: 'Accept an invitation or create your own organization.', retryable: false },
  TENANT_ISOLATION: { status: 403, message: 'Resource belongs to another organization.', recovery: 'Switch organizations and retry.', retryable: false },
  // validation
  VALIDATION_FAILED: { status: 400, message: 'Request validation failed.', recovery: 'Fix the highlighted fields and retry.', retryable: true },
  INVALID_DIGEST: { status: 400, message: 'Digest must be 64 lowercase hex characters (sha256).', recovery: 'Recompute the digest with sha256.', retryable: true },
  INVALID_ADDRESS: { status: 400, message: 'Not a valid g1-prefixed Gno address.', recovery: 'Check the address format.', retryable: true },
  // state
  INVALID_TRANSITION: { status: 409, message: 'This state transition is not allowed.', recovery: 'Refresh the record and follow the permitted transitions.', retryable: false },
  DUPLICATE: { status: 409, message: 'An identical record already exists.', recovery: 'Review the existing record.', retryable: false },
  NOT_FOUND: { status: 404, message: 'Resource not found.', recovery: 'Verify the identifier.', retryable: false },
  ARCHIVED: { status: 409, message: 'The parent project is archived.', recovery: 'Restore the project first.', retryable: false },
  // chain
  CHAIN_UNAVAILABLE: { status: 503, message: 'The Gno.land RPC endpoint is unreachable.', recovery: 'Try again shortly; verification continues with cached state.', retryable: true },
  CHAIN_ID_MISMATCH: { status: 409, message: 'Connected wallet is on a different chain.', recovery: 'Switch your wallet to the configured testnet.', retryable: false },
  TX_FAILED: { status: 502, message: 'The on-chain transaction failed.', recovery: 'Check the transaction in the explorer, then retry with corrected arguments.', retryable: true },
  TX_TIMEOUT: { status: 504, message: 'The transaction did not confirm in time.', recovery: 'The gateway will reconcile automatically; check the transaction panel.', retryable: true },
  FAUCET_DEPLETED: { status: 503, message: 'Testnet faucet quota exhausted for this origin.', recovery: 'Fund the deployment account manually or retry later.', retryable: true },
  // integrations
  GITHUB_UNAUTHORIZED: { status: 502, message: 'GitHub rejected the configured credentials.', recovery: 'Reconnect the GitHub integration with fresh scopes.', retryable: true },
  WEBHOOK_SIGNATURE_INVALID: { status: 401, message: 'Webhook signature verification failed.', recovery: 'Confirm the signing secret configured for this endpoint.', retryable: false },
  // agents
  AGENT_NOT_AUTHORIZED: { status: 403, message: 'Agent lacks the required scope for this operation.', recovery: 'Grant the missing scope from the project permissions panel.', retryable: false },
  AGENT_SUSPENDED: { status: 409, message: 'Agent is suspended or revoked.', recovery: 'Resume or re-register the agent.', retryable: false },
  LLM_PROVIDER_UNAVAILABLE: { status: 503, message: 'The configured model provider is unavailable.', recovery: 'Retry, or switch providers in settings. Manual workflows remain available.', retryable: true },
  LLM_OUTPUT_INVALID: { status: 502, message: 'The model output failed schema validation.', recovery: 'Retry the execution; persistent failures indicate a provider regression.', retryable: true },
  // rate limits
  RATE_LIMITED: { status: 429, message: 'Too many requests.', recovery: 'Wait for the retry window indicated in the response headers.', retryable: true },
  // platform
  INTERNAL: { status: 500, message: 'An unexpected error occurred.', recovery: 'Retry; if it persists, include the trace id in a bug report.', retryable: true },

  // billing & entitlements (HTTP 402 Payment Required)
  ENTITLEMENT_REQUIRED: { status: 402, message: 'This feature requires a paid plan.', recovery: 'Upgrade the organization plan from Plan & Billing, then retry.', retryable: false },
  ENTITLEMENT_LIMIT: { status: 402, message: 'Plan allowance reached for this billing period.', recovery: 'Upgrade the organization plan for a higher allowance, or wait for the next period.', retryable: false },
  BILLING_INVALID_TRANSITION: { status: 409, message: 'That plan change is not valid for the current subscription state.', recovery: 'Refresh the billing page and choose an allowed action.', retryable: false },
}

export function err(code: keyof typeof defs | string, details?: Record<string, unknown>): ProofloomError {
  const def = defs[code] ?? defs.INTERNAL
  return { code, ...def, details }
}

export function isErr(x: unknown): x is ProofloomError {
  return typeof x === 'object' && x !== null && 'code' in x && 'status' in x
}
