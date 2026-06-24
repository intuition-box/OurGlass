import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
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
