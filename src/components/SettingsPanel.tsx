import { useState } from 'react'
import {
  DEFAULT_BRIDGE_URL,
  getAiBackend,
  getBridgeToken,
  getBridgeUrl,
  getResourcesPath,
  setAiBackend,
  setBridgeToken,
  setBridgeUrl,
  setResourcesPath,
  type AiBackend,
} from '../config'
import { probeBridge, type BridgeState } from '../lib/bridge'

const TEST_RESULT: Record<BridgeState['kind'], string> = {
  checking: 'Checking…',
  offline: 'Bridge not detected. Is VS Code open with the Logix Assistant Bridge extension?',
  'needs-token': 'Bridge found, but no pairing token is saved yet.',
  'bad-token': 'Bridge found, but it rejected this pairing token.',
  ready: 'Connected.',
}

/**
 * Settings: the folder opened in VS Code, and how the AI assistant connects
 * (VS Code bridge by default, or the Anthropic API).
 */
export function SettingsPanel() {
  const [path, setPath] = useState(getResourcesPath())
  const [backend, setBackend] = useState<AiBackend>(getAiBackend())
  const [bridgeUrl, setBridgeUrlState] = useState(getBridgeUrl())
  const [token, setToken] = useState(getBridgeToken())
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  function save() {
    setResourcesPath(path.trim())
    setAiBackend(backend)
    setBridgeUrl(bridgeUrl)
    setBridgeToken(token)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  async function test() {
    setTestResult('Checking…')
    const state = await probeBridge(bridgeUrl.trim().replace(/\/+$/, ''), token.trim())
    const model = state.kind === 'ready' && state.model ? ` Model: ${state.model}.` : ''
    setTestResult(TEST_RESULT[state.kind] + model)
  }

  return (
    <section className="settings" aria-label="Settings">
      <h2 className="settings-title">Settings</h2>

      <label className="settings-field">
        <span>Resource folder (opened in VS Code)</span>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          spellCheck={false}
          placeholder="C:\\path\\to\\your\\pdf\\folder"
        />
      </label>

      <h3 className="settings-subtitle">AI assistant</h3>

      <label className="settings-field">
        <span>Connect through</span>
        <select value={backend} onChange={(e) => setBackend(e.target.value as AiBackend)}>
          <option value="vscode">VS Code — Claude Sonnet from my Copilot subscription</option>
          <option value="cloud">Anthropic API (needs an API key on the server)</option>
        </select>
      </label>

      {backend === 'vscode' && (
        <>
          <label className="settings-field">
            <span>Bridge address</span>
            <input
              type="text"
              value={bridgeUrl}
              onChange={(e) => setBridgeUrlState(e.target.value)}
              spellCheck={false}
              placeholder={DEFAULT_BRIDGE_URL}
            />
          </label>
          <label className="settings-field">
            <span>Pairing token (filled in by “Open App (auto-pair)” in VS Code)</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="Run “Logix Assistant: Copy Pairing Token” in VS Code"
            />
          </label>
        </>
      )}

      <div className="settings-actions">
        <button type="button" onClick={save}>
          Save
        </button>
        {backend === 'vscode' && (
          <button type="button" className="settings-secondary" onClick={() => void test()}>
            Test connection
          </button>
        )}
        {saved && <span className="settings-saved">Saved ✓</span>}
      </div>
      {testResult && <p className="settings-result">{testResult}</p>}
    </section>
  )
}
