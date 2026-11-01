import { useState } from 'react'
import { DEFAULT_AI_MODEL, DEFAULT_AI_MODEL_LABEL } from '../config'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

/**
 * AI assistant panel. Defaults to the Claude Sonnet 5.5 agent.
 *
 * Sends chat turns to the `/api/chat` serverless function (see api/chat.ts),
 * which proxies to Anthropic when ANTHROPIC_API_KEY is configured on Vercel.
 */
export function AssistantPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: DEFAULT_AI_MODEL, messages: next }),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(detail || `Request failed (${res.status})`)
      }
      const data = (await res.json()) as { reply?: string }
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: data.reply ?? '(no response)' },
      ])
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to reach the assistant.',
      )
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <aside className="assistant" aria-label="AI assistant">
      <header className="assistant-header">
        <span className="assistant-dot" aria-hidden="true" />
        <span className="assistant-title">AI Assistant</span>
        <span className="assistant-model" title="Default agent">
          {DEFAULT_AI_MODEL_LABEL}
        </span>
      </header>

      <div className="assistant-log">
        {messages.length === 0 && (
          <p className="assistant-empty">
            Ask about Logix programming, Rockwell docs, or your program files.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="bubble bubble-assistant">…</div>}
        {error && <div className="assistant-error">{error}</div>}
      </div>

      <div className="assistant-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Message the assistant…"
          aria-label="Message the assistant"
        />
        <button type="button" onClick={() => void send()} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </aside>
  )
}
