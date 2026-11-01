import { useRef, useState } from 'react'
import type { Library } from '../lib/useLibrary'
import { validateName, type TreeNode } from '../lib/fs'

interface ExplorerPanelProps {
  library: Library
  selectedFile: string | null
  onOpenFile: (node: TreeNode) => void
  onRemoved: (path: string) => void
}

function Icon({ kind, name }: { kind: 'file' | 'directory'; name: string }) {
  if (kind === 'directory') {
    return (
      <svg className="ex-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M1.5 3.5h4l1.5 1.5h7.5v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
          fill="#f58025"
        />
      </svg>
    )
  }
  const isPdf = /\.pdf$/i.test(name)
  return (
    <svg className="ex-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 1.5h6.5L13 5v9a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14z"
        fill={isPdf ? '#cd163f' : '#6b7884'}
      />
      <path d="M9.5 1.5V5H13" fill="rgba(255,255,255,0.35)" />
    </svg>
  )
}

export function ExplorerPanel({
  library,
  selectedFile,
  onOpenFile,
  onRemoved,
}: ExplorerPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [targetDir, setTargetDir] = useState('')
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const { status, tree, busy, error } = library

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function openFolder(node: TreeNode) {
    setTargetDir(node.path)
    toggle(node.path)
  }

  async function submitFolder() {
    const problem = validateName(folderName)
    if (problem) return setNameError(problem)
    await library.makeFolder(targetDir, folderName)
    setExpanded((prev) => new Set(prev).add(targetDir))
    setFolderName('')
    setNameError(null)
    setCreating(false)
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) {
      void library.uploadFiles(targetDir, files)
      if (targetDir) setExpanded((prev) => new Set(prev).add(targetDir))
    }
  }

  function onDrop(e: React.DragEvent, dir: string) {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    void library.dropItems(dir, e.dataTransfer)
    if (dir) setExpanded((prev) => new Set(prev).add(dir))
  }

  function allowDrop(e: React.DragEvent, dir: string) {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(dir)
  }

  async function confirmDelete(path: string) {
    setConfirming(null)
    await library.remove(path)
    if (targetDir === path || targetDir.startsWith(path + '/')) setTargetDir('')
    onRemoved(path)
  }

  function renderNodes(nodes: TreeNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const isDir = node.kind === 'directory'
      const isOpen = expanded.has(node.path)
      const isActive = isDir ? targetDir === node.path : selectedFile === node.path
      return (
        <div key={node.path}>
          <div
            className={
              'ex-row' +
              (isActive ? ' ex-active' : '') +
              (dropTarget === node.path && isDir ? ' ex-drop' : '')
            }
            style={{ paddingLeft: 10 + depth * 14 }}
            onDragOver={isDir ? (e) => allowDrop(e, node.path) : undefined}
            onDrop={isDir ? (e) => onDrop(e, node.path) : undefined}
          >
            <button
              type="button"
              className="ex-main"
              onClick={() => (isDir ? openFolder(node) : onOpenFile(node))}
              title={node.path}
            >
              <span className="ex-caret">{isDir ? (isOpen ? '▾' : '▸') : ''}</span>
              <Icon kind={node.kind} name={node.name} />
              <span className="ex-name">{node.name}</span>
            </button>
            {confirming === node.path ? (
              <span className="ex-confirm">
                Delete?
                <button type="button" onClick={() => void confirmDelete(node.path)}>
                  Yes
                </button>
                <button type="button" onClick={() => setConfirming(null)}>
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="ex-delete"
                aria-label={`Delete ${node.name}`}
                title="Delete"
                onClick={() => setConfirming(node.path)}
              >
                ✕
              </button>
            )}
          </div>
          {isDir && isOpen && node.children && renderNodes(node.children, depth + 1)}
        </div>
      )
    })
  }

  if (status === 'loading') {
    return (
      <nav className="explorer" aria-label="Library">
        <header className="ex-header">
          <span className="ex-title">Library</span>
        </header>
        <p className="ex-note">Loading…</p>
      </nav>
    )
  }

  if (status !== 'ready') {
    return (
      <nav className="explorer" aria-label="Library">
        <header className="ex-header">
          <span className="ex-title">Library</span>
        </header>
        <div className="ex-connect">
          {status === 'needs-permission' ? (
            <>
              <p>
                Reconnect to <strong>{library.pendingName}</strong> to keep working
                with your PDFs.
              </p>
              <button type="button" className="ex-primary" onClick={() => void library.reconnect()}>
                Reconnect folder
              </button>
              <button type="button" className="ex-secondary" onClick={() => void library.disconnect()}>
                Choose a different folder
              </button>
            </>
          ) : (
            <>
              <p>
                Choose the folder that holds your Rockwell PDFs and program files.
                You can create folders and add files right here.
              </p>
              {library.canPickFolder ? (
                <button type="button" className="ex-primary" onClick={() => void library.connectFolder()}>
                  Choose library folder
                </button>
              ) : (
                <p className="ex-warn">
                  This browser can't open folders on disk. Use Chrome or Edge, or
                  browser storage below.
                </p>
              )}
              {library.canUsePrivateStorage && (
                <button type="button" className="ex-secondary" onClick={() => void library.connectPrivate()}>
                  Use browser storage instead
                </button>
              )}
            </>
          )}
          {error && <p className="ex-error">{error}</p>}
        </div>
      </nav>
    )
  }

  const where = targetDir ? `/${targetDir}` : '/ (library root)'

  return (
    <nav
      className={'explorer' + (dropTarget === '' ? ' ex-drop-root' : '')}
      aria-label="Library"
      onDragOver={(e) => allowDrop(e, '')}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropTarget(null)
      }}
      onDrop={(e) => onDrop(e, '')}
    >
      <header className="ex-header">
        <span className="ex-title" title={library.rootName}>
          Library · {library.rootName}
        </span>
        <div className="ex-actions">
          <button
            type="button"
            title="New folder"
            aria-label="New folder"
            onClick={() => {
              setCreating((c) => !c)
              setNameError(null)
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.5 3.5h4l1.5 1.5h7.5v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" />
              <path d="M8 7v4M6 9h4" stroke="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            title="Add files"
            aria-label="Add files"
            onClick={() => fileInput.current?.click()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" fill="none" stroke="currentColor" />
            </svg>
          </button>
          <button type="button" title="Refresh" aria-label="Refresh" onClick={() => void library.refresh()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" fill="none" stroke="currentColor" />
            </svg>
          </button>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={onPickFiles}
        aria-label="Choose files to add"
      />

      <div className="ex-target">
        Adding to <strong>{where}</strong>
        {targetDir && (
          <button type="button" className="ex-link" onClick={() => setTargetDir('')}>
            root
          </button>
        )}
      </div>

      {creating && (
        <form
          className="ex-new"
          onSubmit={(e) => {
            e.preventDefault()
            void submitFolder()
          }}
        >
          <input
            autoFocus
            value={folderName}
            onChange={(e) => {
              setFolderName(e.target.value)
              setNameError(null)
            }}
            placeholder="New folder name"
            aria-label="New folder name"
            spellCheck={false}
          />
          <button type="submit" className="ex-primary" disabled={busy}>
            Create
          </button>
          <button type="button" className="ex-secondary" onClick={() => setCreating(false)}>
            Cancel
          </button>
          {nameError && <p className="ex-error">{nameError}</p>}
        </form>
      )}

      {error && (
        <p className="ex-error" role="alert">
          {error}
        </p>
      )}

      <div className="ex-tree" role="tree">
        {tree.length === 0 ? (
          <p className="ex-note">
            This folder is empty. Create a folder, or add or drop your PDFs here.
          </p>
        ) : (
          renderNodes(tree, 0)
        )}
      </div>

      <footer className="ex-footer">
        <span>{busy ? 'Working…' : 'Drop files or folders to add them'}</span>
        <button type="button" className="ex-link" onClick={() => void library.disconnect()}>
          Change folder
        </button>
      </footer>
    </nav>
  )
}
