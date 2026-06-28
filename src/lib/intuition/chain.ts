import type { Account, Chain, Hex, PublicClient, Transport, WalletClient } from 'viem'
import { multiVaultAbi } from './network'

/**
 * The on-chain MultiVault operations the write service needs, behind a port so
 * the orchestrator stays testable (a fake implements this in unit tests) and
 * decoupled from how signing is wired (Node key now, signer endpoint later).
 */

export interface CreatePreview {
  shares: bigint
  assetsAfterFixedFees: bigint
}

export interface IntuitionChain {
  getAtomCost(): Promise<bigint>
  getTripleCost(): Promise<bigint>
  calculateAtomId(data: Hex): Promise<Hex>
  calculateTripleId(subject: Hex, predicate: Hex, object: Hex): Promise<Hex>
  isTermCreated(termId: Hex): Promise<boolean>
  previewAtomCreate(atomId: Hex, assets: bigint): Promise<CreatePreview>
  previewTripleCreate(tripleId: Hex, assets: bigint): Promise<CreatePreview>
  /** Creates the atom (cost-only) and returns its verified term_id. */
  createAtom(data: Hex, assets: bigint): Promise<Hex>
  /** Creates the triple (cost-only) and returns its verified term_id. */
  createTriple(subject: Hex, predicate: Hex, object: Hex, assets: bigint): Promise<Hex>
}

type FundedWallet = WalletClient<Transport, Chain, Account>

/** viem-backed adapter: simulate → write → wait → verify for every create. */
export function createViemChain(
  publicClient: PublicClient,
  walletClient: FundedWallet,
  multiVault: Hex,
): IntuitionChain {
  const account = walletClient.account
  const base = { address: multiVault, abi: multiVaultAbi } as const

  const calculateAtomId = (data: Hex): Promise<Hex> =>
    publicClient.readContract({ ...base, functionName: 'calculateAtomId', args: [data] })

  const calculateTripleId = (subject: Hex, predicate: Hex, object: Hex): Promise<Hex> =>
    publicClient.readContract({
      ...base,
      functionName: 'calculateTripleId',
      args: [subject, predicate, object],
    })

  const isTermCreated = (termId: Hex): Promise<boolean> =>
    publicClient.readContract({ ...base, functionName: 'isTermCreated', args: [termId] })

  async function confirm(label: string, hash: Hex): Promise<void> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') {
      throw new Error(`${label} reverted (tx ${hash})`)
    }
  }

  async function createAtomsTx(datas: readonly Hex[], assets: readonly bigint[]): Promise<void> {
    const value = assets.reduce((sum, a) => sum + a, 0n)
    const { request } = await publicClient.simulateContract({
      ...base,
      account,
      functionName: 'createAtoms',
      args: [datas, assets],
      value,
    })
    await confirm('createAtoms', await walletClient.writeContract(request))
  }

  async function createTriplesTx(
    subjects: readonly Hex[],
    predicates: readonly Hex[],
    objects: readonly Hex[],
    assets: readonly bigint[],
  ): Promise<void> {
    const value = assets.reduce((sum, a) => sum + a, 0n)
    const { request } = await publicClient.simulateContract({
      ...base,
      account,
      functionName: 'createTriples',
      args: [subjects, predicates, objects, assets],
      value,
    })
    await confirm('createTriples', await walletClient.writeContract(request))
  }

  return {
    getAtomCost: () => publicClient.readContract({ ...base, functionName: 'getAtomCost' }),
    getTripleCost: () => publicClient.readContract({ ...base, functionName: 'getTripleCost' }),
    calculateAtomId,
    calculateTripleId,
    isTermCreated,
    async previewAtomCreate(atomId, assets) {
      const [shares, assetsAfterFixedFees] = await publicClient.readContract({
        ...base,
        functionName: 'previewAtomCreate',
        args: [atomId, assets],
      })
      return { shares, assetsAfterFixedFees }
    },
    async previewTripleCreate(tripleId, assets) {
      const [shares, assetsAfterFixedFees] = await publicClient.readContract({
        ...base,
        functionName: 'previewTripleCreate',
        args: [tripleId, assets],
      })
      return { shares, assetsAfterFixedFees }
    },
    async createAtom(data, assets) {
      const atomId = await calculateAtomId(data)
      await createAtomsTx([data], [assets])
      if (!(await isTermCreated(atomId))) {
        throw new Error(`createAtom post-write verify failed for ${atomId}`)
      }
      return atomId
    },
    async createTriple(subject, predicate, object, assets) {
      const tripleId = await calculateTripleId(subject, predicate, object)
      await createTriplesTx([subject], [predicate], [object], [assets])
      if (!(await isTermCreated(tripleId))) {
        throw new Error(`createTriple post-write verify failed for ${tripleId}`)
      }
      return tripleId
    },
  }
}
