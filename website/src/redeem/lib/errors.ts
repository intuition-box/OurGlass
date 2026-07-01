import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

/**
 * Turn any thrown error (viem revert, RPC failure, wallet rejection, validation)
 * into a human, end-user message. Never surfaces raw reverts or hex — the raw text
 * goes in `technical`, shown only behind a collapsible in the UI.
 */
export interface UserError {
  severity: 'warning' | 'error'
  title: string
  detail: string
  fix: string
  technical?: string
}

const has =
  (...needles: string[]) =>
  (signal: string) =>
    needles.some((n) => signal.includes(n))

interface Rule {
  match: (signal: string) => boolean
  error: Omit<UserError, 'technical'>
}

// Ordered: first match wins. Signals are lowercased (error name + revert reason +
// messages). Keep needles specific so the generic fallback handles the rest.
const RULES: Rule[] = [
  {
    match: has('invalideoasignature', 'invalid signature', 'invalidsignature'),
    error: {
      severity: 'error',
      title: "Signature couldn't be verified",
      detail: "The delegation's signature didn't validate on this network.",
      fix: "Usually a wrong-chain redeem — switch your wallet to the delegation's network, then retry.",
    },
  },
  {
    match: has('cannotuseadisableddelegation', 'disabled delegation', 'disableddelegation'),
    error: {
      severity: 'warning',
      title: 'This delegation was revoked',
      detail: 'The payer cancelled it on-chain.',
      fix: 'Nothing left to claim. Ask the payer to sign a new one if needed.',
    },
  },
  {
    match: has('transfer-amount-exceeded', 'amount-exceeded'),
    error: {
      severity: 'warning',
      title: "Above this period's limit",
      detail: 'You tried to claim more than the cap allows right now.',
      fix: 'Lower the claim amount and retry.',
    },
  },
  {
    match: has('allowance-exceeded', 'allowance exceeded'),
    error: {
      severity: 'warning',
      title: 'More than has accrued',
      detail: "You're claiming more than the stream has unlocked so far.",
      fix: 'Wait a moment for more to accrue, or claim a little less.',
    },
  },
  {
    match: has('transfer amount exceeds balance', 'exceeds balance', 'insufficient balance'),
    error: {
      severity: 'error',
      title: "Payer's balance is too low",
      detail: "The payer's account doesn't hold enough of the token for this claim.",
      fix: 'Ask the payer to top up their account, then retry.',
    },
  },
  {
    match: has('insufficient funds'),
    error: {
      severity: 'error',
      title: 'Not enough ETH for gas',
      detail: 'Your wallet needs ETH on this network to pay the transaction fee.',
      fix: 'Add some ETH to your wallet and retry.',
    },
  },
  {
    match: has('gs013'),
    error: {
      severity: 'error',
      title: 'The transaction reverted',
      detail: 'The on-chain call failed for a reason the wallet wrapped.',
      fix: 'Open Technical details for the exact reason, then retry or report it.',
    },
  },
  {
    match: has('http request failed', 'failed to fetch', 'fetch failed', 'timed out', 'request timeout'),
    error: {
      severity: 'warning',
      title: 'Network hiccup',
      detail: "Couldn't reach the network just now.",
      fix: 'Retry in a moment.',
    },
  },
]

const technicalOf = (err: unknown): string =>
  err instanceof BaseError ? err.shortMessage || err.message : err instanceof Error ? err.message : String(err)

function signalOf(err: unknown): string {
  const parts: string[] = []
  if (err instanceof BaseError) {
    parts.push(err.shortMessage, err.message)
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      if (revert.data?.errorName) parts.push(revert.data.errorName)
      if (revert.reason) parts.push(revert.reason)
    }
  } else if (err instanceof Error) {
    parts.push(err.message)
  } else {
    parts.push(String(err))
  }
  return parts.filter(Boolean).join(' ').toLowerCase()
}

function isUserRejected(err: unknown): boolean {
  if (err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError)) return true
  const s = signalOf(err)
  return s.includes('user rejected') || s.includes('user denied') || s.includes('4001')
}

/**
 * Map a caught error to a UserError. `action` fills the generic fallback title
 * (e.g. 'redeem' → "Couldn't redeem").
 */
export function toUserError(err: unknown, action = 'complete this action'): UserError {
  const technical = technicalOf(err)
  if (isUserRejected(err)) {
    return { severity: 'warning', title: 'You cancelled the request', detail: 'The wallet prompt was dismissed.', fix: 'Retry when ready.', technical }
  }
  const signal = signalOf(err)
  for (const rule of RULES) {
    if (rule.match(signal)) return { ...rule.error, technical }
  }
  return {
    severity: 'error',
    title: `Couldn't ${action}`,
    detail: 'Something went wrong on-chain or with the network.',
    fix: 'Retry; if it keeps happening, open Technical details and report it.',
    technical,
  }
}

/** Build a UserError for a local validation message (already user-facing). */
export function validationError(title: string, fix = ''): UserError {
  return { severity: 'error', title, detail: '', fix }
}
