import { useState } from 'react'
import { MarketingScreen } from './components/MarketingScreen'
import { AssistantPanel } from './components/AssistantPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ExplorerPanel } from './components/ExplorerPanel'
import { FileViewer } from './components/FileViewer'
import { LogixIcon } from './components/LogixIcon'
import { useLibrary } from './lib/useLibrary'
import { useInstallPrompt } from './lib/useInstallPrompt'
import type { TreeNode } from './lib/fs'
import { APP_NAME, AUTHOR } from './config'

export default function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [openFile, setOpenFile] = useState<TreeNode | null>(null)
  const library = useLibrary()
  const install = useInstallPrompt()

  function handleOpenFile(node: TreeNode) {
    setShowSettings(false)
    setOpenFile(node)
  }

  function handleRemoved(path: string) {
    if (openFile && (openFile.path === path || openFile.path.startsWith(path + '/'))) {
      setOpenFile(null)
    }
  }

  let center = <MarketingScreen />
  if (showSettings) center = <SettingsPanel />
  else if (openFile) {
    center = <FileViewer node={openFile} onClose={() => setOpenFile(null)} />
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <span className="app-brand-group">
          <LogixIcon size={34} />
          <span className="app-brand">{APP_NAME}</span>
        </span>
        <span className="app-topbar-actions">
          {install && (
            <button
              type="button"
              className="app-install"
              onClick={() => void install()}
              title="Install Logix Assistant as an app"
            >
              Install app
            </button>
          )}
          <button
            type="button"
            className="app-settings-toggle"
            onClick={() => setShowSettings((s) => !s)}
            aria-pressed={showSettings}
          >
            {showSettings ? 'Close Settings' : 'Settings'}
          </button>
        </span>
      </header>

      <main className="app-body">
        <ExplorerPanel
          library={library}
          selectedFile={openFile?.path ?? null}
          onOpenFile={handleOpenFile}
          onRemoved={handleRemoved}
        />
        <div className={'app-center' + (openFile && !showSettings ? ' app-center-viewer' : '')}>
          {center}
        </div>
        <AssistantPanel onOpenSettings={() => setShowSettings(true)} />
      </main>

      <footer className="app-footer">© {new Date().getFullYear()} {AUTHOR}</footer>
    </div>
  )
}
