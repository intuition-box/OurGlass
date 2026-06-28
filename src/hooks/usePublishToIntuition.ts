import { useCallback, useState } from 'react'
import {
  intuitionPublisherUrl,
  publishDelegationToIntuition,
  type PublishRequest,
} from '../lib/intuitionPublisher'

export type PublishState = 'idle' | 'publishing' | 'done' | 'error'

export interface PublishStatus {
  state: PublishState
  uri?: string
  message?: string
}

/**
 * Fire-and-forget publish of a signed delegation to the Intuition graph via the
 * publisher backend. Never throws into the caller — failures surface as status
 * only, so they cannot break the delegation create flow.
 */
export function usePublishToIntuition(): {
  publish: (req: PublishRequest) => void
  status: PublishStatus
  enabled: boolean
} {
  const [status, setStatus] = useState<PublishStatus>({ state: 'idle' })
  const enabled = intuitionPublisherUrl() !== null

  const publish = useCallback((req: PublishRequest) => {
    if (!intuitionPublisherUrl()) return
    setStatus({ state: 'publishing' })
    publishDelegationToIntuition(req)
      .then((res) => setStatus({ state: 'done', uri: res.uri }))
      .catch((err: unknown) =>
        setStatus({ state: 'error', message: err instanceof Error ? err.message : 'publish failed' }),
      )
  }, [])

  return { publish, status, enabled }
}
