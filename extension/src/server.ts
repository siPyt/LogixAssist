import * as http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ModelInfo {
  id: string
  name: string
  family: string
  vendor: string
}

export interface ModelList {
  models: ModelInfo[]
  selected: ModelInfo | null
}

export interface LlmProvider {
  listModels(): Promise<ModelList>
  chat(
    messages: ChatMessage[],
    options: { modelId?: string; signal: AbortSignal },
    onDelta: (text: string) => void,
  ): Promise<{ model: string }>
}

export interface BridgeOptions {
  port: number
  getToken: () => string
  getAllowedOrigins: () => string[]
  provider: LlmProvider
}

export const BRIDGE_NAME = 'logix-assistant-bridge'

const MAX_BODY_BYTES = 256 * 1024
const MAX_MESSAGES = 40
const MAX_CHARS = 20000

/** Exact match, or a pattern where `*` stands for one host label chunk, e.g. https://*.vercel.app */
export function originMatches(origin: string, pattern: string): boolean {
  if (!pattern.includes('*')) return origin === pattern
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')
  return new RegExp(`^${escaped}$`, 'i').test(origin)
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function isMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string' &&
    m.content.length > 0 &&
    m.content.length <= MAX_CHARS
  )
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function createBridge(options: BridgeOptions): http.Server {
  const { port, provider } = options

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    // Reject DNS-rebinding style requests: only our own loopback host names.
    const host = (req.headers.host ?? '').toLowerCase()
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return sendJson(res, 403, { error: 'Forbidden host' })
    }

    // Browsers always send Origin on cross-origin requests; only allow listed apps.
    const origin = req.headers.origin
    if (origin !== undefined) {
      const allowed = options.getAllowedOrigins().some((p) => originMatches(origin, p))
      if (!allowed) return sendJson(res, 403, { error: 'Origin not allowed' })
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
      res.setHeader('Access-Control-Max-Age', '600')
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    const path = new URL(req.url ?? '/', 'http://localhost').pathname

    if (path === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, name: BRIDGE_NAME })
    }

    const auth = req.headers.authorization ?? ''
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!supplied || !tokensEqual(supplied, options.getToken())) {
      return sendJson(res, 401, { error: 'Invalid or missing pairing token' })
    }

    if (path === '/models' && req.method === 'GET') {
      return sendJson(res, 200, await provider.listModels())
    }

    if (path === '/chat' && req.method === 'POST') {
      return handleChat(req, res)
    }

    return sendJson(res, 404, { error: 'Not found' })
  }

  async function handleChat(req: http.IncomingMessage, res: http.ServerResponse) {
    let body: { messages?: unknown; model?: unknown }
    try {
      body = JSON.parse(await readBody(req)) as typeof body
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new HttpError(400, 'Invalid JSON body')
    }

    const messages = body.messages
    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > MAX_MESSAGES ||
      !messages.every(isMessage)
    ) {
      throw new HttpError(400, 'Invalid messages')
    }
    const modelId =
      typeof body.model === 'string' && body.model.length <= 200 ? body.model : undefined

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    })
    res.flushHeaders()
    const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`)

    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abort.abort()
    })

    try {
      const result = await provider.chat(
        messages as ChatMessage[],
        { modelId, signal: abort.signal },
        (delta) => send({ delta }),
      )
      send({ done: true, model: result.model })
    } catch (err) {
      if (!abort.signal.aborted) {
        send({ error: err instanceof Error ? err.message : 'Model request failed' })
      }
    } finally {
      res.end()
    }
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500
      const message = err instanceof HttpError ? err.message : 'Internal error'
      if (!res.headersSent) sendJson(res, status, { error: message })
      else res.end()
    })
  })
}
