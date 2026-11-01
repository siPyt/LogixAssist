import { useEffect, useRef, useState } from 'react'
import {
  AI_SETTINGS_EVENT,
  DEFAULT_AI_MODEL_LABEL,
  getAiBackend,
  getBridgeToken,
  getBridgeUrl,
  setAiBackend,
  setBridgeToken,
} from '../config'
import {
  pairWithBridge,
  probeBridge,
  streamChat,
  type BridgeState,
  type ChatMessage,
} from '../lib/bridge'

interface AssistantPanelProps {
  onOpenSettings: () => void
}

const POLL_MS = 10000

const STATUS_TEXT: Record<BridgeState['kind'], string> = {
  checking: 'Checking VS Code connection…',
  offline: 'VS Code bridge not detected',
  'needs-token': 'Pairing needed',
  'bad-token': 'Pairing token rejected',
  ready: 'Connected to VS Code',
}

/**
 * AI assistant panel. By default it uses the Claude Sonnet model from your
 * VS Code (GitHub Copilot) subscription through the Logix Assistant Bridge
 * extension. Settings can switch it to the Anthropic API (/api/chat) instead,
 * which is what phones and other machines without VS Code need.
 */
export function AssistantPanel({ onOpenSettings }: AssistantPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backend, setBackend] = useState(getAiBackend())
  const [bridge, setBridge] = useState<BridgeState>({ kind: 'checking' })
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      const next = getAiBackend()
      setBackend(next)
      if (next !== 'vscode') return
      const state = await probeBridge(getBridgeUrl(), getBridgeToken())
      if (cancelled) return
      setBridge(state)
      if (state.kind === 'ready') setActiveModel(state.model)
    }
    void check()
    const timer = window.setInterval(() => {
      if (!document.hidden) void check()
    }, POLL_MS)
    const onChange = () => {
      setBridge({ kind: 'checking' })
      void check()
    }
    window.addEventListener(AI_SETTINGS_EVENT, onChange)
    window.addEventListener('focus', onChange)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener(AI_SETTINGS_EVENT, onChange)
      window.removeEventListener('focus', onChange)
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, error])

  async function sendViaBridge(history: ChatMessage[]) {
    const controller = new AbortController()
    abortRef.current = controller
    setMessages([...history, { role: 'assistant', content: '' }])
    const result = await streamChat(
      getBridgeUrl(),
      getBridgeToken(),
      history,
      (delta) =>
        setMessages((m) => {
          const last = m[m.length - 1]
          return [...m.slice(0, -1), { ...last, content: last.content + delta }]
        }),
      controller.signal,
    )
    if (result.model) setActiveModel(result.model)
  }

  async function sendViaCloud(history: ChatMessage[]) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    })
    if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`)
    const data = (await res.json()) as { reply?: string }
    setMessages([...history, { role: 'assistant', content: data.reply ?? '(no response)' }])
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setInput('')
    setBusy(true)
    try {
      if (backend === 'vscode') await sendViaBridge(history)
      else await sendViaCloud(history)
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Unable to reach the assistant.')
      }
      // Drop an empty placeholder left by a failed stream.
      setMessages((m) =>
        m.length > 0 && m[m.length - 1].role === 'assistant' && !m[m.length - 1].content
          ? m.slice(0, -1)
          : m,
      )
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  // Asks the local bridge for its pairing token (allowed origins only) and saves it.
  async function pairWithVsCode() {
    setError(null)
    setPairing(true)
    try {
      setBridgeToken(await pairWithBridge(getBridgeUrl()))
      setAiBackend('vscode')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing failed.')
    } finally {
      setPairing(false)
    }
  }

  const viaVsCode = backend === 'vscode'
  const ready = bridge.kind === 'ready'
  const statusClass = !viaVsCode ? 'is-cloud' : ready ? 'is-ready' : bridge.kind === 'checking' ? 'is-checking' : 'is-warn'
  const modelLabel = viaVsCode ? (activeModel ?? DEFAULT_AI_MODEL_LABEL) : 'Anthropic API'

  return (
    <aside className="assistant" aria-label="AI assistant">
      <header className="assistant-header">
        <span className={`assistant-dot ${statusClass}`} aria-hidden="true" />
        <span className="assistant-title">AI Assistant</span>
        <span className="assistant-model" title="Model in use">
          {modelLabel}
        </span>
      </header>

      <div className={`assistant-status ${statusClass}`} role="status">
        {viaVsCode
          ? `${STATUS_TEXT[bridge.kind]}${ready && activeModel ? ` · ${activeModel}` : ''}`
          : 'Using the Anthropic API'}
      </div>

      {viaVsCode && !ready && bridge.kind !== 'checking' && (
        <div className="assistant-help">
          {bridge.kind === 'offline' && (
            <p>
              Install the <strong>Logix Assistant Bridge</strong> extension in VS Code and keep VS
              Code open. It lets this app use the Claude Sonnet model from your Copilot
              subscription — no API key needed.
            </p>
          )}
          {bridge.kind === 'needs-token' && (
            <p>
              The bridge is running. Click <strong>Pair with VS Code</strong> to connect this app.
            </p>
          )}
          {bridge.kind === 'bad-token' && (
            <p>
              The saved pairing token no longer matches. Click <strong>Pair with VS Code</strong>{' '}
              to connect again.
            </p>
          )}
          <div className="assistant-help-actions">
            <button
              type="button"
              className="assistant-help-primary"
              onClick={() => void pairWithVsCode()}
              disabled={pairing}
            >
              {pairing ? 'Pairing…' : 'Pair with VS Code'}
            </button>
            <button type="button" onClick={onOpenSettings}>
              Open Settings
            </button>
          </div>
        </div>
      )}

      <div className="assistant-log" ref={logRef}>
        {messages.length === 0 && (
          <p className="assistant-empty">
            Ask about Logix programming, Rockwell docs, or your program files.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
            {m.content || '…'}
          </div>
        ))}
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
