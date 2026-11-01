import { useState } from 'react'
import { MarketingScreen } from './components/MarketingScreen'
import { AssistantPanel } from './components/AssistantPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { APP_NAME, AUTHOR } from './config'

export default function App() {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <span className="app-brand">{APP_NAME}</span>
        <button
          type="button"
          className="app-settings-toggle"
          onClick={() => setShowSettings((s) => !s)}
          aria-pressed={showSettings}
        >
          {showSettings ? 'Close Settings' : 'Settings'}
        </button>
      </header>

      <main className="app-body">
        <div className="app-center">
          {showSettings ? <SettingsPanel /> : <MarketingScreen />}
        </div>
        <AssistantPanel />
      </main>

      <footer className="app-footer">© {new Date().getFullYear()} {AUTHOR}</footer>
    </div>
  )
}
