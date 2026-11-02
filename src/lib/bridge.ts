export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type BridgeState =
  | { kind: 'checking' }
  | { kind: 'offline' }
  | { kind: 'outdated' }
  | { kind: 'no-model' }
  | { kind: 'needs-token' }
  | { kind: 'bad-token' }
  | { kind: 'ready'; model: string | null }

const BRIDGE_NAME = 'logix-assistant-bridge'

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

/** Checks whether the VS Code bridge is running and whether our token is accepted. */
export async function probeBridge(baseUrl: string, token: string): Promise<BridgeState> {
  try {
    const health = await fetchWithTimeout(`${baseUrl}/health`, {}, 2500)
    const info = health.ok ? ((await health.json()) as { name?: string; features?: string[] }) : null
    if (info?.name !== BRIDGE_NAME) return { kind: 'offline' }
    // Older bridges ignore file context, so Advisor could not see the Explorer files.
    if (!info.features?.includes('context') || !info.features.includes('sonnet-5.5-only')) {
      return { kind: 'outdated' }
    }
    if (!token) return { kind: 'needs-token' }

    const models = await fetchWithTimeout(
      `${baseUrl}/models`,
      { headers: { authorization: `Bearer ${token}` } },
      5000,
    )
    if (models.status === 401) return { kind: 'bad-token' }
    if (!models.ok) return { kind: 'offline' }
    const data = (await models.json()) as { selected?: { name?: string } | null }
    if (!data.selected) return { kind: 'no-model' }
    return { kind: 'ready', model: data.selected.name ?? null }
  } catch {
    return { kind: 'offline' }
  }
}

/** Asks the bridge for the pairing token. Resolves to the token, or throws a readable error. */
export async function pairWithBridge(baseUrl: string): Promise<string> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${baseUrl}/pair`, { method: 'POST' }, 4000)
  } catch {
    throw new Error(
      "Can't reach the bridge. Reload the VS Code window (Ctrl+Shift+P → Developer: Reload Window) so the Logix Assistant Bridge starts.",
    )
  }
  if (res.status === 403) {
    throw new Error(
      `VS Code doesn't allow ${window.location.origin} yet. Add it to the setting "Logix Assistant: Allowed Origins".`,
    )
  }
  if (res.status === 404) {
    throw new Error(
      'VS Code is running an old copy of the bridge. Reload the VS Code window (Ctrl+Shift+P → Developer: Reload Window).',
    )
  }
  if (!res.ok) throw new Error(`Pairing failed (${res.status}).`)
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('Pairing failed: no token returned.')
  return data.token
}

export const OFFLINE_HELP =
  "Can't reach the VS Code bridge. Open VS Code with the Logix Assistant Bridge extension installed, then try again."

/** Streams a reply from the VS Code bridge, calling onDelta for each chunk of text. */
export async function streamChat(
  baseUrl: string,
  token: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
  context?: string,
): Promise<{ model?: string }> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages, context }),
      signal,
    })
  } catch (err) {
    if (signal.aborted) throw err
    throw new Error(OFFLINE_HELP)
  }

  if (res.status === 401) {
    throw new Error('The pairing token was rejected. Pair again from VS Code: "Logix Assistant: Open App (auto-pair)".')
  }
  if (!res.ok || !res.body) {
    const detail = await res.json().then((d: { error?: string }) => d.error).catch(() => undefined)
    throw new Error(detail ?? `Bridge request failed (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let model: string | undefined
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, end).trim()
      buffer = buffer.slice(end + 2)
      if (!line.startsWith('data:')) continue
      const event = JSON.parse(line.slice(5)) as {
        delta?: string
        error?: string
        done?: boolean
        model?: string
      }
      if (event.error) throw new Error(event.error)
      if (event.delta) onDelta(event.delta)
      if (event.done) model = event.model
    }
  }
  return { model }
}
