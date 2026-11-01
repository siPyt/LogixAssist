import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

/**
 * Opens the dev app in its own app-mode window (no tabs or address bar) so
 * Windows shows the LA icon on the taskbar instead of the browser's logo.
 * Set LOGIX_NO_OPEN=1 to skip. Only opens once per `npm run dev`.
 */
function appWindowPlugin(): Plugin {
  return {
    name: 'logix-app-window',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        if (process.env.LOGIX_NO_OPEN || process.env.LOGIX_APP_OPENED) return
        process.env.LOGIX_APP_OPENED = '1'
        const address = server.httpServer?.address()
        const port = typeof address === 'object' && address ? address.port : 5173
        const browser = process.platform === 'win32' ? BROWSERS.find((p) => existsSync(p)) : undefined
        if (!browser) {
          server.openBrowser()
          return
        }
        spawn(browser, [`--app=http://localhost:${port}/`, '--window-size=1280,760', '--window-position=40,10'], {
          detached: true,
          stdio: 'ignore',
        }).unref()
      })
    },
  }
}

/**
 * Serves api/chat.ts at /api/chat during `npm run dev`, mirroring the Vercel
 * serverless function. Env vars (e.g. ANTHROPIC_API_KEY) come from .env.
 */
function apiDevPlugin(mode: string): Plugin {
  return {
    name: 'logix-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        try {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
          }
          // Re-read .env on every request so a newly pasted key works without restarting.
          for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
            if (value) process.env[key] = value
            else delete process.env[key]
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const mod = await server.ssrLoadModule('/api/chat.ts')
          const response: Response = await mod.POST(
            new Request('http://localhost/api/chat', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: Buffer.concat(chunks),
            }),
          )
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          res.statusCode = 500
          res.end(err instanceof Error ? err.message : 'Internal error')
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  return {
    plugins: [react(), apiDevPlugin(mode), appWindowPlugin()],
    server: {
      port: 5173,
    },
  }
})
