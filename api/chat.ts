/**
 * Vercel serverless function: AI assistant proxy.
 *
 * Proxies chat turns to the Anthropic Messages API using ANTHROPIC_API_KEY
 * (set it in Vercel project env vars, or in a local .env for `npm run dev`).
 * The key stays server-side and is never sent to the browser.
 *
 * Request body:  { messages: { role, content }[] }
 * Response body: { reply: string }
 */

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const DEFAULT_MODEL = 'claude-sonnet-5.5'
const MAX_MESSAGES = 40
const MAX_CHARS = 20000

const SYSTEM_PROMPT =
  'You are Logix Assistant, a helpful assistant for Rockwell Automation / Studio 5000 Logix programming, created by Charles R. Freeman.'

function text(body: string, status: number): Response {
  return new Response(body, { status })
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

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return text(
      'AI assistant is not configured. Set ANTHROPIC_API_KEY (Vercel env vars, or a local .env file) to enable it.',
      503,
    )
  }

  let body: { messages?: unknown }
  try {
    body = (await request.json()) as { messages?: unknown }
  } catch {
    return text('Invalid JSON body', 400)
  }

  const messages = body.messages
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_MESSAGES ||
    !messages.every(isMessage)
  ) {
    return text('Invalid messages', 400)
  }

  // The model is chosen server-side so clients cannot select arbitrary models.
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: messages.map((m: ChatMessage) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      return text(`Assistant error (${res.status}): ${detail}`, 502)
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[]
    }
    const reply =
      data.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
        .trim() || '(no response)'

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return text(`Assistant request failed: ${message}`, 502)
  }
}
