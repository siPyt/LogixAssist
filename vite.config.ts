import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serves api/chat.ts at /api/chat during `npm run dev`, mirroring the Vercel
 * serverless function. Env vars (e.g. ANTHROPIC_API_KEY) come from .env.
 */
function apiDevPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'logix-api-dev',
    configureServer(server) {
      Object.assign(process.env, env)
      server.middlewares.use('/api/chat', async (req, res) => {
        try {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method Not Allowed')
            return
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
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiDevPlugin(env)],
    server: {
      port: 5173,
    },
  }
})
