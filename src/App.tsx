import { useEffect, useState } from 'react'
import { MarketingScreen } from './components/MarketingScreen'
import { AssistantPanel } from './components/AssistantPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ExplorerPanel } from './components/ExplorerPanel'
import { FileViewer } from './components/FileViewer'
import { LogixIcon } from './components/LogixIcon'
import { Splitter } from './components/Splitter'
import { useLibrary } from './lib/useLibrary'
import { useInstallPrompt } from './lib/useInstallPrompt'
import { useLayout } from './lib/useLayout'
import type { TreeNode } from './lib/fs'
import { APP_NAME, AUTHOR, AUTHOR_TITLE } from './config'

function PanelIcon({ side, filled }: { side: 'left' | 'right'; filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.2" fill="none" stroke="currentColor" />
      {side === 'left' ? (
        <rect x="2" y="3" width="4" height="10" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" />
      ) : (
        <rect x="10" y="3" width="4" height="10" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" />
      )}
    </svg>
  )
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [openFile, setOpenFile] = useState<TreeNode | null>(null)
  const library = useLibrary()
  const install = useInstallPrompt()
  const { layout, toggle, resizeTo, reset } = useLayout()

  // Ctrl+B toggles the explorer, Ctrl+Alt+B the assistant (as in VS Code).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b') return
      e.preventDefault()
      toggle(e.altKey ? 'right' : 'left')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

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
          <LogixIcon size={34} interactive />
          <span className="app-brand">{APP_NAME}</span>
          <span className="app-byline">
            {AUTHOR}, {AUTHOR_TITLE}
          </span>
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
            className={'icon-btn' + (layout.leftOpen ? ' is-on' : '')}
            onClick={() => toggle('left')}
            aria-pressed={layout.leftOpen}
            title="Toggle Explorer (Ctrl+B)"
            aria-label="Toggle Explorer"
          >
            <PanelIcon side="left" filled={layout.leftOpen} />
          </button>
          <button
            type="button"
            className={'icon-btn' + (layout.rightOpen ? ' is-on' : '')}
            onClick={() => toggle('right')}
            aria-pressed={layout.rightOpen}
            title="Toggle Logix Advisor (Ctrl+Alt+B)"
            aria-label="Toggle Logix Advisor"
          >
            <PanelIcon side="right" filled={layout.rightOpen} />
          </button>
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

      <main
        className="app-body"
        style={{ '--left-w': `${layout.left}px`, '--right-w': `${layout.right}px` } as React.CSSProperties}
      >
        <div className={'panel-slot panel-left' + (layout.leftOpen ? '' : ' is-collapsed')}>
          <ExplorerPanel
            library={library}
            selectedFile={openFile?.path ?? null}
            onOpenFile={handleOpenFile}
            onRemoved={handleRemoved}
          />
        </div>
        {layout.leftOpen && (
          <Splitter
            side="left"
            width={layout.left}
            onResize={(w) => resizeTo('left', w)}
            onReset={() => reset('left')}
          />
        )}

        <div className={'app-center' + (openFile && !showSettings ? ' app-center-viewer' : '')}>
          {center}
        </div>

        {layout.rightOpen && (
          <Splitter
            side="right"
            width={layout.right}
            onResize={(w) => resizeTo('right', w)}
            onReset={() => reset('right')}
          />
        )}
        <div className={'panel-slot panel-right' + (layout.rightOpen ? '' : ' is-collapsed')}>
          <AssistantPanel
            onOpenSettings={() => setShowSettings(true)}
            tree={library.tree}
            openPath={openFile?.path ?? null}
          />
        </div>
      </main>

      <footer className="app-footer">© {new Date().getFullYear()} {AUTHOR}</footer>
    </div>
  )
}
