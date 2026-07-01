/// <reference types="vite/client" />

interface Window {
  /**
   * Runtime config injected by the container entrypoint into /safe-app/env.js.
   * Absent in dev and before the entrypoint runs, so every field is optional.
   */
  __OG__?: {
    network?: string
  }
}
