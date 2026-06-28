/**
 * Pure helpers for Intuition delegation discovery on the redeem page. The decode
 * is correctness-critical (it reconstructs token/amount/period from the caveat),
 * so it's pinned against the real erc20PeriodTransfer terms we published.
 *
 * Run: bun test test/unit
 */
import { describe, test, expect } from 'bun:test'
import { encodePacked, getAddress } from 'viem'
import {
  caip10Uri,
  chainIdFromCaip10,
  decodePeriodTransferTerms,
  periodFromSeconds,
} from '../../website/src/redeem/lib/intuition/discover'

// erc20PeriodTransfer caveat terms: token(20) + periodAmount + periodDuration +
// startDate, abi.encodePacked. 300 USDC (6dp) / monthly, matching the demo.
const TOKEN = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
const REAL_TERMS = encodePacked(
  ['address', 'uint256', 'uint256', 'uint256'],
  [TOKEN, 300_000_000n, 2_592_000n, 1_782_341_632n],
)

describe('caip10', () => {
  test('caip10Uri checksums and formats', () => {
    expect(caip10Uri(84532, '0x036cbd53842c5426634e7929541ec2318f3dcf7e')).toBe(
      `caip10:eip155:84532:${getAddress('0x036cbd53842c5426634e7929541ec2318f3dcf7e')}`,
    )
  })

  test('chainIdFromCaip10 parses or returns null', () => {
    expect(chainIdFromCaip10('caip10:eip155:84532:0xabc')).toBe(84532)
    expect(chainIdFromCaip10('caip10:eip155:1:0xabc')).toBe(1)
    expect(chainIdFromCaip10('not-a-caip10')).toBeNull()
  })
})

describe('decodePeriodTransferTerms', () => {
  test('decodes the real published caveat', () => {
    const t = decodePeriodTransferTerms(REAL_TERMS)
    expect(t.token).toBe(TOKEN)
    expect(t.periodAmount).toBe(300_000_000n) // 300 USDC @ 6dp
    expect(t.periodDuration).toBe(2_592_000n) // monthly
    expect(t.startDate).toBe(1_782_341_632n)
  })
})

describe('periodFromSeconds', () => {
  test('maps known durations, falls back to seconds', () => {
    expect(periodFromSeconds(2_592_000n)).toBe('month')
    expect(periodFromSeconds(604_800n)).toBe('week')
    expect(periodFromSeconds(60n)).toBe('minute')
    expect(periodFromSeconds(999n)).toBe('999s')
  })
})
