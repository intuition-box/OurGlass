import {
  bytesToHex,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'

/**
 * 1Shot public relayer client (gas-abstracted ERC-7710 redemption). Chain- and
 * kit-agnostic: it takes a signed delegation as JSON (permissionContext) plus
 * executions, so it works with both DeleGator and Safe-module delegations.
 * Ported from @safe-subscriptions/core.
 */

export function relayerUrlForChain(chainId: number): string {
  return chainId === 11155111 || chainId === 84532
    ? 'https://relayer.1shotapi.dev/relayers'
    : 'https://relayer.1shotapi.com/relayers'
}

type JsonRpc<T> =
  | { jsonrpc: '2.0'; id: number | string; result: T }
  | { jsonrpc: '2.0'; id: number | string; error: { code: number; message: string; data?: unknown } }

function isTransient(err: { code: number; message: string; data?: unknown }): boolean {
  const code = (err.data as { errorCode?: string } | undefined)?.errorCode
  return code === 'ERR_ONESHOT' || /Not Found/i.test(err.message)
}

async function rpc<T>(url: string, method: string, params: unknown, id = 1): Promise<T> {
  let last: { code: number; message: string; data?: unknown } | undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt))
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    const json = (await res.json()) as JsonRpc<T>
    if (!('error' in json)) return json.result
    last = json.error
    if (!isTransient(json.error)) break
  }
  throw new Error(`relayer [${last?.code}] ${last?.message}`)
}

/** Convert delegation bigints / Uint8Arrays into JSON-safe shapes. */
export function toRelayerJson(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return `0x${value.toString(16)}`
  if (value instanceof Uint8Array) return bytesToHex(value)
  if (Array.isArray(value)) return value.map(toRelayerJson)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = toRelayerJson(v)
    return out
  }
  return value
}

export interface RelayerToken {
  address: Address
  symbol?: string
  decimals: number | string
}
export interface ChainCapabilities {
  feeCollector: Address
  targetAddress: Address
  tokens: RelayerToken[]
}

export async function getCapabilities(url: string, chainId: number): Promise<ChainCapabilities> {
  const caps = await rpc<Record<string, ChainCapabilities>>(url, 'relayer_getCapabilities', [
    String(chainId),
  ])
  const c = caps[String(chainId)]
  if (!c) throw new Error(`1Shot relayer does not support chain ${chainId}`)
  return c
}

interface Estimate7710Result {
  success: boolean
  requiredPaymentAmount?: string
  context?: string
  error?: string
}

/** Guard against the relayer's gas oracle misreporting (clear error instead of a cryptic revert). */
export async function assertRelayerGasSane(params: {
  client: PublicClient
  relayerUrl: string
  chainId: number
  token: Address
  maxRatio?: number
}): Promise<void> {
  let relayerGas: bigint
  try {
    const fd = await rpc<{ gasPrice: string }>(params.relayerUrl, 'relayer_getFeeData', {
      chainId: String(params.chainId),
      token: params.token,
    })
    relayerGas = BigInt(fd.gasPrice)
  } catch {
    return
  }
  const chainGas = await params.client.getGasPrice()
  if (chainGas === 0n) return
  const ratio = Number(relayerGas) / Number(chainGas)
  if (ratio > (params.maxRatio ?? 10)) {
    throw new Error(
      `1Shot relayer gas oracle looks wrong: ${Math.round(Number(relayerGas) / 1e9)} gwei vs chain ` +
        `${Math.round(Number(chainGas) / 1e9)} gwei (${Math.round(ratio)}x). Try again later.`,
    )
  }
}

export interface ChargeBundleParams {
  relayerUrl: string
  chainId: number
  capabilities: ChainCapabilities
  /** Already JSON-safe signed delegation(s). */
  permissionContext: unknown[]
  token: { address: Address; decimals: number }
  /** Amount to transfer to the recipient (token atoms). */
  workAmount: bigint
  recipient: Address
  /** Optional EIP-7702 authorization list. */
  authorization?: unknown
  /** When set, guard against a misreporting gas oracle before charging. */
  client?: PublicClient
}

/**
 * Redeem one period via 1Shot: estimate the fee, then submit a bundle of
 * [fee → feeCollector, amount → recipient]. No ETH spent — the relayer is paid
 * in the fee token. Returns the relayer task id.
 */
export async function chargeBundleViaRelayer(params: ChargeBundleParams): Promise<string> {
  const { capabilities: caps, token } = params

  if (params.client) {
    await assertRelayerGasSane({
      client: params.client,
      relayerUrl: params.relayerUrl,
      chainId: params.chainId,
      token: token.address,
    })
  }

  const buildBundle = (feeAmount: bigint) => ({
    chainId: String(params.chainId),
    ...(params.authorization ? { authorizationList: [params.authorization] } : {}),
    transactions: [
      {
        permissionContext: params.permissionContext,
        executions: [
          {
            target: token.address,
            value: '0',
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [caps.feeCollector, feeAmount],
            }),
          },
          {
            target: token.address,
            value: '0',
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [params.recipient, params.workAmount],
            }),
          },
        ],
      },
    ],
  })

  const mockFee = 10_000n
  const first = await rpc<Estimate7710Result>(
    params.relayerUrl,
    'relayer_estimate7710Transaction',
    buildBundle(mockFee),
  )
  if (!first.success) throw new Error(`1Shot estimate failed: ${first.error}`)

  const requiredFee = BigInt(first.requiredPaymentAmount ?? mockFee.toString())
  const feeToPay = requiredFee + (requiredFee * 3n) / 100n + 5_000n
  const second = await rpc<Estimate7710Result>(
    params.relayerUrl,
    'relayer_estimate7710Transaction',
    buildBundle(feeToPay),
  )
  if (!second.success) {
    if (/transfer-amount-exceeded|exceeds balance/i.test(second.error ?? '')) {
      throw new Error(
        `The relayer fee (~${(Number(feeToPay) / 10 ** token.decimals).toFixed(2)}) exceeds the ` +
          `period cap or the account balance — network gas is high. Try again later.`,
      )
    }
    throw new Error(`1Shot re-estimate failed: ${second.error}`)
  }

  return rpc<string>(params.relayerUrl, 'relayer_send7710Transaction', {
    ...buildBundle(feeToPay),
    context: second.context,
  })
}

export interface RelayerStatus {
  status: 100 | 110 | 200 | 400 | 500
  hash?: Hex
  receipt?: { transactionHash?: Hex }
  message?: string
  data?: unknown
}

export async function getRelayerStatus(url: string, taskId: string): Promise<RelayerStatus> {
  return rpc<RelayerStatus>(url, 'relayer_getStatus', { id: taskId, logs: false })
}

export async function pollRelayerUntilDone(
  url: string,
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<RelayerStatus> {
  const intervalMs = opts.intervalMs ?? 3000
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000)
  while (true) {
    const status = await getRelayerStatus(url, taskId)
    if (status.status === 200 || status.status === 400 || status.status === 500) return status
    if (Date.now() > deadline) throw new Error(`Timeout waiting for relayer task ${taskId}`)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
