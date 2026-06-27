/** Resolve an ipfs:// URI to an HTTP gateway URL (passes through http(s) URLs). */
export function ipfsToHttp(uri: string, gateway = 'https://gateway.pinata.cloud/ipfs/'): string {
  return uri.startsWith('ipfs://') ? gateway + uri.slice('ipfs://'.length) : uri
}
