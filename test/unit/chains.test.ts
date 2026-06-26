/**
 * Chain wiring tests: prove every supported chain is consistently configured
 * end-to-end — registry ⇄ USDC ⇄ contract addresses ⇄ display helpers. Catches
 * the classic "added a chain in one place, forgot another" bug.
 *
 * Run: bun test test/unit
 */
import { describe, test, expect } from 'bun:test'
import { isAddress } from 'viem'
import { mainnet } from 'viem/chains'
import {
  SUPPORTED_CHAINS,
  SELECTABLE_CHAINS,
  findChain,
  USDC_ADDRESS,
  chainName,
  explorerTx,
  anvilLocal,
} from '../../src/config/supported-chains'
import { getAddresses } from '../../src/config/addresses'

const ANVIL = anvilLocal.id
const realChains = SUPPORTED_CHAINS.filter((c) => c.id !== ANVIL)

describe('supported-chains registry', () => {
  test('chain ids are unique', () => {
    const ids = SUPPORTED_CHAINS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('findChain resolves every supported id and rejects unknown ones', () => {
    for (const c of SUPPORTED_CHAINS) expect(findChain(c.id)?.id).toBe(c.id)
    expect(findChain(999_999)).toBeUndefined()
  })

  test('every real (non-anvil) chain has a valid USDC address', () => {
    for (const c of realChains) {
      const usdc = USDC_ADDRESS[c.id]
      expect(usdc, `USDC missing for chain ${c.id}`).toBeDefined()
      expect(isAddress(usdc!), `USDC invalid for chain ${c.id}`).toBe(true)
    }
  })

  test('chainName gives a real name for every selectable chain (never "Chain X")', () => {
    for (const c of SELECTABLE_CHAINS) {
      expect(chainName(c.id)).toBe(c.label)
      expect(chainName(c.id)).not.toMatch(/^Chain /)
    }
    expect(chainName(999_999)).toBe('Chain 999999') // graceful fallback for unknown
  })

  test('explorerTx builds the chain-specific explorer URL', () => {
    expect(explorerTx(mainnet.id, '0xabc')).toBe('https://etherscan.io/tx/0xabc')
    for (const c of SELECTABLE_CHAINS) {
      expect(explorerTx(c.id, '0xhash')).toBe(`${c.explorer}/tx/0xhash`)
    }
  })

  test('selectable chains exclude anvil and cover all real networks', () => {
    const ids = SELECTABLE_CHAINS.map((c) => c.id)
    expect(ids).not.toContain(ANVIL)
    expect(ids.sort()).toEqual(realChains.map((c) => c.id).sort())
  })
})

describe('registry ⇄ contract addresses are in sync', () => {
  test('every supported chain has a contract-addresses entry (no missing wiring)', () => {
    for (const c of SUPPORTED_CHAINS) {
      expect(() => getAddresses(c.id), `addresses missing for chain ${c.id}`).not.toThrow()
    }
  })

  test('every configured contract address is a valid address', () => {
    for (const c of SUPPORTED_CHAINS) {
      const a = getAddresses(c.id)
      for (const [field, value] of Object.entries(a)) {
        // `ourglass` is a nested group of addresses (the OurGlass-owned enforcer
        // instances), not a flat address — validate its members instead.
        if (typeof value === 'object' && value !== null) {
          for (const [sub, addr] of Object.entries(value)) {
            expect(isAddress(addr), `${c.id}.${field}.${sub} is not a valid address`).toBe(true)
          }
          continue
        }
        expect(isAddress(value), `${c.id}.${field} is not a valid address`).toBe(true)
      }
    }
  })
})

describe('Ethereum mainnet is fully wired', () => {
  test('chain, USDC, contract addresses and name all resolve', () => {
    expect(findChain(mainnet.id)?.id).toBe(mainnet.id)
    expect(isAddress(USDC_ADDRESS[mainnet.id]!)).toBe(true)
    expect(() => getAddresses(mainnet.id)).not.toThrow()
    expect(chainName(mainnet.id)).toBe('Ethereum')
    expect(SELECTABLE_CHAINS.some((c) => c.id === mainnet.id)).toBe(true)
  })
})
