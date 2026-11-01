/**
 * Vercel serverless function: AI assistant proxy.
 *
 * Defaults to the Claude Sonnet 5.5 agent. Proxies chat turns to the Anthropic
 * Messages API when ANTHROPIC_API_KEY is set as a Vercel environment variable.
 * Keeping the key server-side means it is never exposed to the browser.
 *
 * Request body:  { model?: string, messages: { role, content }[] }
 * Response body: { reply: string }
 */

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Maps the app's friendly default to a concrete Anthropic model id.
const MODEL_MAP: Record<string, string> = {
  'claude-sonnet-5.5': 'claude-sonnet-4-5',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      'AI assistant is not configured. Set ANTHROPIC_API_KEY in your Vercel project environment variables to enable the Claude Sonnet 5.5 agent.',
      { status: 503 },
    )
  }

  let body: { model?: string; messages?: ChatMessage[] }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const messages = body.messages ?? []
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('No messages provided', { status: 400 })
  }

  const requested = body.model ?? 'claude-sonnet-5.5'
  const model = MODEL_MAP[requested] ?? 'claude-sonnet-4-5'

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
        system:
          'You are Logix Assistant, a helpful assistant for Rockwell Automation / Studio 5000 Logix programming, created by Charles R. Freeman.',
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      return new Response(`Assistant error: ${detail}`, { status: 502 })
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
    return new Response(`Assistant request failed: ${message}`, { status: 502 })
  }
}
