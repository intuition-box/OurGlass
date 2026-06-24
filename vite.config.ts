import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // The Safe App is served under /safe-app on the shared domain; the website
  // (landing + docs + blog) owns the root. All app asset URLs are prefixed here.
  base: '/safe-app/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': '*',
    },
  },
  define: {
    global: 'globalThis',
  },
  build: {
    // No production sourcemaps: they add ~7.5MB of .map output and are the main
    // memory hog during `vite build` (OOM / exit 137 in the Coolify build
    // container). Safe iframe communication needs CORS/framing headers, not maps.
    sourcemap: false,
  },
})
