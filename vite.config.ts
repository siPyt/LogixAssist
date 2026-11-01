import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
    plugins: [react(), apiDevPlugin(mode)],
    server: {
      port: 5173,
      open: true,
    },
  }
})
