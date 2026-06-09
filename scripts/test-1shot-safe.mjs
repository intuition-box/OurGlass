/**
 * DECISIVE TEST: can the 1Shot relayer redeem a Safe-module delegation?
 * Builds an erc20PeriodTransfer delegation (delegator = module, delegate =
 * 1Shot targetAddress), signs it with the Safe owner via protocol-kit (ERC-1271),
 * and runs the 1Shot estimate. "transfer amount exceeds balance" = ACCEPTED.
 *
 *   PK=0x... node scripts/test-1shot-safe.mjs
 */
import {
  createPublicClient, http, hashTypedData, encodePacked, encodeAbiParameters,
  keccak256, concatHex, parseAbi,
} from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = 'https://base-sepolia-rpc.publicnode.com'
const RELAYER = 'https://relayer.1shotapi.dev/relayers'
const CHAIN = 84532
const DELEGATION_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3'
const ERC20_PERIOD_ENFORCER = '0x474e3Ae7E169e940607cC624Da8A15Eb120139aB'
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const SAFE = '0x4fb26bdf32ee534c518bd069f9bdcf508b944564'
const MODULE = '0xAcA740d8DeBcC736316CC9B0fBB8CC4c145aCB3f' // delegator
const TARGET = '0xf1ef956eff4181Ce913b664713515996858B9Ca9' // 1Shot targetAddress (Base Sepolia)
const FEE_COLLECTOR = '0xE936e8FAf4A5655469182A49a505055B71C17604'
const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

const account = privateKeyToAccount(process.env.PK)
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })

// 1. Build the erc20PeriodTransfer delegation (delegator = module).
const now = Math.floor(Date.now() / 1000)
const salt = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('')
const periodTerms = encodePacked(
  ['address', 'uint256', 'uint256', 'uint256'],
  [USDC, 5_000_000n, 2_592_000n, BigInt(now)],
)
const delegation = {
  delegate: TARGET,
  delegator: MODULE,
  authority: ROOT_AUTHORITY,
  caveats: [{ enforcer: ERC20_PERIOD_ENFORCER, terms: periodTerms, args: '0x' }],
  salt,
  signature: '0x',
}

// 2. EIP-712 delegation hash (what the DelegationManager validates).
const typedData = {
  domain: { name: 'DelegationManager', version: '1', chainId: CHAIN, verifyingContract: DELEGATION_MANAGER },
  types: {
    Delegation: [
      { name: 'delegate', type: 'address' },
      { name: 'delegator', type: 'address' },
      { name: 'authority', type: 'bytes32' },
      { name: 'caveats', type: 'Caveat[]' },
      { name: 'salt', type: 'uint256' },
    ],
    Caveat: [
      { name: 'enforcer', type: 'address' },
      { name: 'terms', type: 'bytes' },
    ],
  },
  primaryType: 'Delegation',
  message: {
    delegate: delegation.delegate,
    delegator: delegation.delegator,
    authority: delegation.authority,
    caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
    salt: BigInt(delegation.salt),
  },
}
const delegationHash = hashTypedData(typedData)
console.log('delegation hash:', delegationHash)

// 3. Sign as a Safe ERC-1271 message, replicating CompatibilityFallbackHandler v1.4.1:
//    messageHash = keccak256(0x1901 || domainSeparator || keccak256(abi.encode(SAFE_MSG_TYPEHASH, keccak256(abi.encode(delegationHash)))))
const SAFE_MSG_TYPEHASH = keccak256(new TextEncoder().encode('SafeMessage(bytes message)'))
const domainSeparator = await pub.readContract({
  address: SAFE,
  abi: parseAbi(['function domainSeparator() view returns (bytes32)']),
  functionName: 'domainSeparator',
})
const keccakMsg = keccak256(encodeAbiParameters([{ type: 'bytes32' }], [delegationHash]))
const safeMessageHash = keccak256(
  encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [SAFE_MSG_TYPEHASH, keccakMsg]),
)
const messageHash = keccak256(concatHex(['0x1901', domainSeparator, safeMessageHash]))
// Owner signs the messageHash directly (EIP-712 path, v=27/28). Safe sig = r||s||v.
const signature = await account.sign({ hash: messageHash })
console.log('safe signature:', signature.slice(0, 30), '…')

// 4. 1Shot estimate.
const toRelayerJson = (v) => {
  if (v === null || v === undefined) return v
  if (typeof v === 'bigint') return '0x' + v.toString(16)
  if (Array.isArray(v)) return v.map(toRelayerJson)
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toRelayerJson(x)]))
  return v
}
const signedDelegation = { ...delegation, signature }
const erc20transfer = (to, amt) =>
  '0xa9059cbb' + to.slice(2).toLowerCase().padStart(64, '0') + amt.toString(16).padStart(64, '0')

const params = {
  chainId: String(CHAIN),
  transactions: [
    {
      permissionContext: [toRelayerJson(signedDelegation)],
      executions: [
        { target: USDC, value: '0', data: erc20transfer(FEE_COLLECTOR, 10000n) },
        { target: USDC, value: '0', data: erc20transfer(account.address, 100000n) },
      ],
    },
  ],
}
const res = await fetch(RELAYER, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'relayer_estimate7710Transaction', params }),
})
const json = await res.json()
console.log('\n=== 1Shot estimate result ===')
console.log(JSON.stringify(json.result ?? json.error, null, 2).slice(0, 500))
const err = json.result?.error ?? ''
if (json.result?.success) console.log('\n✅ 1Shot ACCEPTS the Safe-module delegation (estimate succeeded)')
else if (/exceeds balance|transfer-amount/i.test(err)) console.log('\n✅ 1Shot ACCEPTS the Safe-module delegation (failed only on USDC balance)')
else console.log('\n⚠️ Inconclusive / rejected — inspect the error above')
