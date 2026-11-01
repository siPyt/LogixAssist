import { setAiBackend, setBridgeToken } from '../config'

/**
 * Picks up a pairing token passed in the URL fragment (#pair=<64 hex chars>) by
 * the VS Code bridge's "Open App (auto-pair)" command, stores it, and removes it
 * from the address bar. Fragments are never sent to servers.
 */
export function consumePairingToken(): void {
  const match = /(?:^|[#&])pair=([0-9a-f]{64})(?:&|$)/i.exec(window.location.hash)
  if (!match) return
  setBridgeToken(match[1])
  setAiBackend('vscode')
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}
