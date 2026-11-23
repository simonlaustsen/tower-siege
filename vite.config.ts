import { networkInterfaces } from 'node:os'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

// Phone cameras (for scanning QR codes) only work on https pages. `npm run dev:phone` serves the
// game over https with a self-signed certificate: accept the browser's warning once on each phone.
const https = process.env.HTTPS === '1'

/**
 * Development only. A page opened as "localhost" cannot give a phone a working link to itself, so
 * this lets the page ask the dev server for this computer's Wi-Fi addresses. (It does not exist in
 * the production build, where the page already knows its real address.)
 */
function lanAddresses(): Plugin {
  return {
    name: 'lan-addresses',
    configureServer(server) {
      server.middlewares.use('/__lan', (_req, res) => {
        const addresses = Object.values(networkInterfaces())
          .flatMap((list) => list ?? [])
          .filter((i) => i.family === 'IPv4' && !i.internal)
          .map((i) => i.address)
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify({ addresses }))
      })
    },
  }
}

// GitHub Pages serves the game from a sub-path (https://<user>.github.io/tower-siege/); the deploy
// workflow sets BASE_PATH to it. Everywhere else the game lives at the root.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react(), lanAddresses(), ...(https ? [basicSsl()] : [])],
  test: { environment: 'node' },
})
