import { useEffect, useRef, useState } from 'react'
import {
  AI_SETTINGS_EVENT,
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
import { indexLibrary, indexMentioned, type IndexProgress } from '../lib/libraryIndex'
import { researchFiles } from '../lib/advisor'
import type { TreeNode } from '../lib/fs'
import { loadChat, loadDraft, saveChat, saveDraft } from '../lib/chatStore'

interface AssistantPanelProps {
  onOpenSettings: () => void
  tree: TreeNode[]
  openPath: string | null
}

const POLL_MS = 10000

const STATUS_TEXT: Record<BridgeState['kind'], string> = {
  checking: 'Checking VS Code connection…',
  offline: 'VS Code bridge not detected',
  'needs-token': 'Pairing needed',
  'bad-token': 'Pairing token rejected',
  outdated: 'VS Code bridge needs a reload',
  'no-model': 'Claude Sonnet 5.5 not available in VS Code',
  ready: 'Connected',
}

/**
 * AI assistant panel. By default it uses the Claude Sonnet model from your
 * VS Code (GitHub Copilot) subscription through the Logix Assistant Bridge
 * extension. Settings can switch it to the Anthropic API (/api/chat) instead,
 * which is what phones and other machines without VS Code need.
 */
export function AssistantPanel({ onOpenSettings, tree, openPath }: AssistantPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadChat)
  const [input, setInput] = useState(loadDraft)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState<IndexProgress | null>(null)
  const [searching, setSearching] = useState<string | null>(null)
  const readingRef = useRef<IndexProgress | null>(null)
  const indexDone = useRef<Promise<void>>(Promise.resolve())
  const [pairing, setPairing] = useState(false)
  const [pairError, setPairError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [backend, setBackend] = useState(getAiBackend())
  const [bridge, setBridge] = useState<BridgeState>({ kind: 'checking' })
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let running = false
    async function check() {
      const next = getAiBackend()
      setBackend(next)
      if (next !== 'vscode' || running) return
      running = true
      try {
        let state = await probeBridge(getBridgeUrl(), getBridgeToken())
        // Pair automatically: the bridge hands its token to allowed origins only.
        if (state.kind === 'needs-token' || state.kind === 'bad-token') {
          try {
            setBridgeToken(await pairWithBridge(getBridgeUrl()))
            setPairError(null)
            state = await probeBridge(getBridgeUrl(), getBridgeToken())
          } catch (err) {
            setPairError(err instanceof Error ? err.message : 'Pairing failed.')
          }
        }
        if (cancelled) return
        setBridge(state)
      } finally {
        running = false
      }
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

  // Saved once a reply finishes streaming, not on every token.
  useEffect(() => {
    if (!busy) saveChat(messages)
  }, [messages, busy])

  useEffect(() => saveDraft(input), [input])

  // Read the Explorer's files so questions can be answered from them.
  useEffect(() => {
    indexDone.current = indexLibrary(tree, openPath, (p) => {
      readingRef.current = p
      setReading(p)
    })
  }, [tree, openPath])

  // Waits briefly for file reading, then lets the model plan and run searches over the files.
  async function libraryContext(history: ChatMessage[], signal: AbortSignal): Promise<string> {
    const question = history
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)
      .join(' ')
    // Read the files the question names first; they may be far down the background queue.
    const named = await Promise.race([
      indexMentioned(tree, question),
      new Promise<boolean>((r) => setTimeout(() => r(true), 90000)),
    ])
    if (!named) await Promise.race([indexDone.current, new Promise((r) => setTimeout(r, 20000))])
    const ask = async (prompt: string): Promise<string> => {
      const one: ChatMessage[] = [{ role: 'user', content: prompt }]
      if (backend === 'vscode') {
        let reply = ''
        await streamChat(getBridgeUrl(), getBridgeToken(), one, (d) => (reply += d), signal)
        return reply
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: one }),
        signal,
      })
      if (!res.ok) throw new Error(await res.text())
      return ((await res.json()) as { reply?: string }).reply ?? ''
    }
    try {
      return await researchFiles({
        history,
        tree,
        openPath,
        indexing: readingRef.current,
        ask,
        onStatus: setSearching,
        signal,
      })
    } finally {
      setSearching(null)
    }
  }

  async function sendViaBridge(history: ChatMessage[], context: string, signal: AbortSignal) {
    setMessages([...history, { role: 'assistant', content: '' }])
    await streamChat(
      getBridgeUrl(),
      getBridgeToken(),
      history,
      (delta) =>
        setMessages((m) => {
          const last = m[m.length - 1]
          return [...m.slice(0, -1), { ...last, content: last.content + delta }]
        }),
      signal,
      context,
    )
  }

  async function sendViaCloud(history: ChatMessage[], context: string, signal: AbortSignal) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, context }),
      signal,
    })
    if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`)
    const data = (await res.json()) as { reply?: string }
    setMessages([...history, { role: 'assistant', content: data.reply ?? '(no response)' }])
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    if (backend === 'vscode' && bridge.kind === 'outdated') {
      setError('VS Code is running an old bridge. Reload the VS Code window (Ctrl+Shift+P → Developer: Reload Window), then ask again.')
      return
    }
    if (backend === 'vscode' && bridge.kind === 'no-model') {
      setError('Claude Sonnet 5.5 is not available in VS Code, so Logix Advisor is not available. Enable it in the GitHub Copilot model picker, then ask again.')
      return
    }
    setError(null)
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setInput('')
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const context = await libraryContext(history, controller.signal)
      if (backend === 'vscode') await sendViaBridge(history, context, controller.signal)
      else await sendViaCloud(history, context, controller.signal)
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

  return (
    <aside className="assistant" aria-label="Logix Advisor">
      <header className="assistant-header">
        <span className={`assistant-dot ${statusClass}`} aria-hidden="true" />
        <span className="assistant-title">Logix Advisor</span>
        {messages.length > 0 && (
          <button
            type="button"
            className="assistant-new"
            onClick={() => {
              abortRef.current?.abort()
              setMessages([])
              setError(null)
            }}
            title="Clear this conversation and start a new one"
          >
            New chat
          </button>
        )}
      </header>

      <div className={`assistant-status ${statusClass}`} role="status">
        {viaVsCode ? STATUS_TEXT[bridge.kind] : 'Connected'}
        {reading && ` · Reading files ${reading.done}/${reading.total}`}
        {searching && ` · ${searching}`}
      </div>

      {viaVsCode && !ready && bridge.kind !== 'checking' && (
        <div className="assistant-help">
          {bridge.kind === 'offline' && (
            <p>
              Install the <strong>Logix Assistant Bridge</strong> extension in VS Code and keep VS
              Code open. It connects Logix Advisor through your Copilot
              subscription — no API key needed.
            </p>
          )}
          {bridge.kind === 'outdated' && (
            <p>
              VS Code is still running an old copy of the bridge, which can't pass your files to
              Logix Advisor. In VS Code press <strong>Ctrl+Shift+P</strong> and run{' '}
              <strong>Developer: Reload Window</strong>. This turns green on its own.
            </p>
          )}
          {bridge.kind === 'no-model' && (
            <p>
              Logix Advisor only uses <strong>Claude Sonnet 5.5</strong>, and VS Code doesn't offer
              it right now, so the Advisor is not available. Sign in to GitHub Copilot and enable
              Claude Sonnet 5.5 in the Copilot model picker. This turns green on its own.
            </p>
          )}
          {(bridge.kind === 'needs-token' || bridge.kind === 'bad-token') && (
            <p>{pairError ?? 'Connecting to VS Code…'}</p>
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
          placeholder="Ask Logix Advisor…"
          aria-label="Message Logix Advisor"
        />
        <button type="button" onClick={() => void send()} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </aside>
  )
}
