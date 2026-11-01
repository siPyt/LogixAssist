import { useState } from 'react'
import {
  DEFAULT_AI_MODEL_LABEL,
  getResourcesPath,
  setResourcesPath,
} from '../config'

/**
 * Lightweight settings: the absolute folder path opened in VS Code, and a
 * read-only view of the default AI agent.
 */
export function SettingsPanel() {
  const [path, setPath] = useState(getResourcesPath())
  const [saved, setSaved] = useState(false)

  function save() {
    setResourcesPath(path.trim())
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
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

      <label className="settings-field">
        <span>Default AI agent</span>
        <input type="text" value={DEFAULT_AI_MODEL_LABEL} readOnly />
      </label>

      <div className="settings-actions">
        <button type="button" onClick={save}>
          Save
        </button>
        {saved && <span className="settings-saved">Saved ✓</span>}
      </div>
    </section>
  )
}
