import { useEffect, useMemo, useRef, useState } from 'react'
import type { Library } from '../lib/useLibrary'
import { parentOf, validateName, type TreeNode } from '../lib/fs'
import { buildVsCodeFolderUri, getResourcesPath } from '../config'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ConfirmDialog } from './ConfirmDialog'

interface ExplorerPanelProps {
  library: Library
  selectedFile: string | null
  onOpenFile: (node: TreeNode) => void
  /** Called when a path was deleted, renamed or moved, so open views can close. */
  onRemoved: (path: string) => void
}

type Editing =
  | { mode: 'new-file' | 'new-folder'; parentPath: string }
  | { mode: 'rename'; path: string }

type Row =
  | { type: 'node'; node: TreeNode; depth: number }
  | { type: 'new'; mode: 'new-file' | 'new-folder'; parentPath: string; depth: number }

const INTERNAL_DRAG = 'application/x-logix-path'
const TEXT_FILE = /\.(txt|md|json|csv|log|xml|l5x|l5k|ini|ya?ml|st|ld|sc)$/i

const FILE_COLORS: Record<string, string> = {
  pdf: '#e5484d',
  l5x: '#f58025',
  l5k: '#f58025',
  acd: '#f58025',
  xml: '#f58025',
  md: '#6cb6ff',
  txt: '#9aa7b2',
  json: '#f2b01e',
  csv: '#2fbf4b',
  png: '#a371f7',
  jpg: '#a371f7',
  jpeg: '#a371f7',
  gif: '#a371f7',
  svg: '#a371f7',
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.kind === 'directory' && node.children && path.startsWith(node.path + '/')) {
      const hit = findNode(node.children, path)
      if (hit) return hit
    }
  }
  return null
}

function buildRows(
  nodes: TreeNode[],
  expanded: Set<string>,
  editing: Editing | null,
  depth: number,
  parentPath: string,
  out: Row[],
): Row[] {
  if (editing && editing.mode !== 'rename' && editing.parentPath === parentPath) {
    out.push({ type: 'new', mode: editing.mode, parentPath, depth })
  }
  for (const node of nodes) {
    out.push({ type: 'node', node, depth })
    if (node.kind === 'directory' && expanded.has(node.path)) {
      buildRows(node.children ?? [], expanded, editing, depth + 1, node.path, out)
    }
  }
  return out
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={'vx-chev' + (open ? ' is-open' : '')}>
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function NodeIcon({ kind, name, open }: { kind: 'file' | 'directory'; name: string; open?: boolean }) {
  if (kind === 'directory') {
    return (
      <svg className="vx-icon" viewBox="0 0 16 16" aria-hidden="true">
        {open ? (
          <path d="M1.5 4.5a1 1 0 0 1 1-1h3.3l1.2 1.3h6.5a1 1 0 0 1 1 1V6H4.2L1.5 12z M4.2 6.8h10.3l-2.4 6a1 1 0 0 1-.9.7H2.6z" fill="#dcb67a" />
        ) : (
          <path d="M1.5 4a1 1 0 0 1 1-1h3.4l1.2 1.4h6.4a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#c09553" />
        )}
      </svg>
    )
  }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  const color = FILE_COLORS[ext] ?? '#8b98a5'
  return (
    <svg className="vx-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 1.5h5.7L12.5 4.8v9a.7.7 0 0 1-.7.7H3.5a.7.7 0 0 1-.7-.7V2.2a.7.7 0 0 1 .7-.7z" fill={color} />
      <path d="M9.2 1.5v3.3h3.3" fill="rgba(255,255,255,0.4)" />
    </svg>
  )
}

interface InlineNameProps {
  initial: string
  selectBase: boolean
  siblings: string[]
  onCommit: (name: string) => void
  onCancel: () => void
}

/** The inline text box used for New File, New Folder and Rename. */
function InlineName({ initial, selectBase, siblings, onCommit, onCancel }: InlineNameProps) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = selectBase ? initial.lastIndexOf('.') : -1
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial, selectBase])

  function problem(v: string): string | null {
    const invalid = validateName(v)
    if (invalid) return invalid
    const name = v.trim()
    if (name !== initial && siblings.some((s) => s.toLowerCase() === name.toLowerCase())) {
      return `A file or folder "${name}" already exists at this location. Choose a different name.`
    }
    return null
  }

  function finish(commit: boolean) {
    if (finished.current) return
    const name = value.trim()
    if (!commit || !name || name === initial) {
      finished.current = true
      return onCancel()
    }
    const issue = problem(name)
    if (issue) return setError(issue)
    finished.current = true
    onCommit(name)
  }

  return (
    <>
      <input
        ref={ref}
        className={'vx-input' + (error ? ' is-invalid' : '')}
        value={value}
        spellCheck={false}
        aria-label="Name"
        onChange={(e) => {
          setValue(e.target.value)
          setError(value.trim() ? problem(e.target.value) : null)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') finish(true)
          if (e.key === 'Escape') {
            finished.current = true
            onCancel()
          }
        }}
        onBlur={() => {
          const name = value.trim()
          if (finished.current) return
          if (!name || name === initial || problem(name)) {
            finished.current = true
            onCancel()
          } else finish(true)
        }}
        onClick={(e) => e.stopPropagation()}
      />
      {error && <div className="vx-input-error">{error}</div>}
    </>
  )
}

export function ExplorerPanel({ library, selectedFile, onOpenFile, onRemoved }: ExplorerPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [confirm, setConfirm] = useState<TreeNode | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [sectionOpen, setSectionOpen] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadDir = useRef('')
  const treeRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<number | undefined>(undefined)

  const { status, tree, error } = library
  const rows = useMemo(() => buildRows(tree, expanded, editing, 0, '', []), [tree, expanded, editing])
  const nodeRows = useMemo(
    () => rows.filter((r): r is Extract<Row, { type: 'node' }> => r.type === 'node'),
    [rows],
  )

  useEffect(() => {
    if (!selected) return
    const el = treeRef.current?.querySelector(`[data-path="${CSS.escape(selected)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const siblingNames = (parentPath: string) =>
    (parentPath ? (findNode(tree, parentPath)?.children ?? []) : tree).map((n) => n.name)

  const targetDirOf = (path: string | null): string => {
    if (!path) return ''
    const node = findNode(tree, path)
    return node?.kind === 'directory' ? node.path : parentOf(path)
  }

  function expand(path: string) {
    if (path) setExpanded((prev) => new Set(prev).add(path))
  }

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function startNew(mode: 'new-file' | 'new-folder', parentPath = targetDirOf(selected)) {
    setSectionOpen(true)
    expand(parentPath)
    setEditing({ mode, parentPath })
  }

  function startRename(node: TreeNode) {
    setSelected(node.path)
    setEditing({ mode: 'rename', path: node.path })
  }

  async function commitEdit(name: string) {
    const current = editing
    setEditing(null)
    treeRef.current?.focus()
    if (!current) return
    if (current.mode === 'rename') {
      const newPath = [parentOf(current.path), name].filter(Boolean).join('/')
      await library.rename(current.path, name)
      onRemoved(current.path)
      setSelected(newPath)
    } else {
      const created = [current.parentPath, name].filter(Boolean).join('/')
      if (current.mode === 'new-file') await library.makeFile(current.parentPath, name)
      else await library.makeFolder(current.parentPath, name)
      expand(current.parentPath)
      setSelected(created)
    }
  }

  async function deleteNode(node: TreeNode) {
    setConfirm(null)
    await library.remove(node.path)
    onRemoved(node.path)
    setSelected((s) => (s && (s === node.path || s.startsWith(node.path + '/')) ? null : s))
    treeRef.current?.focus()
  }

  function openInVsCode(node: TreeNode | null) {
    const base = getResourcesPath().replace(/[\\/]+$/, '')
    let target = ''
    if (node) target = node.kind === 'directory' || TEXT_FILE.test(node.name) ? node.path : parentOf(node.path)
    window.location.href = buildVsCodeFolderUri(target ? `${base}/${target}` : base)
  }

  function buildMenu(node: TreeNode | null): MenuItem[] {
    const dir = node ? (node.kind === 'directory' ? node.path : parentOf(node.path)) : ''
    const items: MenuItem[] = [
      { label: 'New File…', onClick: () => startNew('new-file', dir) },
      { label: 'New Folder…', onClick: () => startNew('new-folder', dir) },
      {
        label: 'Upload Files…',
        onClick: () => {
          uploadDir.current = dir
          fileInput.current?.click()
        },
      },
      { separator: true },
    ]
    if (node) {
      items.push(
        { label: 'Rename', shortcut: 'F2', onClick: () => startRename(node) },
        { label: 'Delete', shortcut: 'Del', onClick: () => setConfirm(node) },
        { separator: true },
      )
    }
    items.push(
      { label: 'Open in VS Code', onClick: () => openInVsCode(node) },
      {
        label: 'Copy Path',
        onClick: () => void navigator.clipboard?.writeText(node ? node.path : library.rootName),
      },
      { label: 'Refresh', onClick: () => void library.refresh() },
    )
    return items
  }

  function openMenu(e: React.MouseEvent, node: TreeNode | null) {
    e.preventDefault()
    e.stopPropagation()
    if (node) setSelected(node.path)
    setMenu({ x: e.clientX, y: e.clientY, items: buildMenu(node) })
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const dir = uploadDir.current
    expand(dir)
    void library.uploadFiles(dir, files)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || nodeRows.length === 0) return
    const index = nodeRows.findIndex((r) => r.node.path === selected)
    const current = index >= 0 ? nodeRows[index].node : null
    const select = (i: number) => setSelected(nodeRows[Math.max(0, Math.min(nodeRows.length - 1, i))].node.path)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        select(index + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        select(index < 0 ? 0 : index - 1)
        break
      case 'Home':
        e.preventDefault()
        select(0)
        break
      case 'End':
        e.preventDefault()
        select(nodeRows.length - 1)
        break
      case 'ArrowRight':
        if (current?.kind === 'directory') {
          e.preventDefault()
          if (!expanded.has(current.path)) expand(current.path)
          else if (current.children?.length) setSelected(current.children[0].path)
        }
        break
      case 'ArrowLeft':
        if (current) {
          e.preventDefault()
          if (current.kind === 'directory' && expanded.has(current.path)) toggle(current.path)
          else if (parentOf(current.path)) setSelected(parentOf(current.path))
        }
        break
      case 'Enter':
        if (current) {
          e.preventDefault()
          if (current.kind === 'directory') toggle(current.path)
          else onOpenFile(current)
        }
        break
      case 'F2':
        if (current) {
          e.preventDefault()
          startRename(current)
        }
        break
      case 'Delete':
        if (current) {
          e.preventDefault()
          setConfirm(current)
        }
        break
    }
  }

  function dragKinds(e: React.DragEvent): { internal: boolean; files: boolean } {
    const types = Array.from(e.dataTransfer.types)
    return { internal: types.includes(INTERNAL_DRAG), files: types.includes('Files') }
  }

  function onDragOverDir(e: React.DragEvent, dir: string) {
    const { internal, files } = dragKinds(e)
    if (!internal && !files) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy'
    if (dropTarget !== dir) {
      setDropTarget(dir)
      window.clearTimeout(hoverTimer.current)
      if (dir) hoverTimer.current = window.setTimeout(() => expand(dir), 700)
    }
  }

  function onDropDir(e: React.DragEvent, dir: string) {
    const { internal, files } = dragKinds(e)
    if (!internal && !files) return
    e.preventDefault()
    e.stopPropagation()
    window.clearTimeout(hoverTimer.current)
    setDropTarget(null)
    expand(dir)
    if (internal) {
      const src = e.dataTransfer.getData(INTERNAL_DRAG)
      if (src) {
        void library.move(src, dir).then(() => onRemoved(src))
      }
    } else {
      void library.dropItems(dir, e.dataTransfer)
    }
  }

  const header = (
    <header className="vx-title">
      <span className="vx-title-label">Explorer</span>
      <button
        type="button"
        className="vx-btn"
        title="More actions"
        aria-label="More actions"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({
            x: r.left,
            y: r.bottom + 2,
            items: [
              { label: 'Change Library Folder…', onClick: () => void library.disconnect() },
              { label: 'Open Library in VS Code', onClick: () => openInVsCode(null) },
              { label: 'Refresh', onClick: () => void library.refresh() },
            ],
          })
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.2" fill="currentColor" />
          <circle cx="8" cy="8" r="1.2" fill="currentColor" />
          <circle cx="13" cy="8" r="1.2" fill="currentColor" />
        </svg>
      </button>
    </header>
  )

  if (status === 'loading') {
    return (
      <nav className="vx" aria-label="Explorer">
        {header}
        <p className="vx-note">Loading…</p>
      </nav>
    )
  }

  if (status !== 'ready') {
    return (
      <nav className="vx" aria-label="Explorer">
        {header}
        <div className="vx-welcome">
          {status === 'needs-permission' ? (
            <>
              <p>
                Reconnect to <strong>{library.pendingName}</strong> to keep working with your PDFs.
              </p>
              <button type="button" className="vx-primary" onClick={() => void library.reconnect()}>
                Reconnect Folder
              </button>
              <button type="button" className="vx-secondary" onClick={() => void library.disconnect()}>
                Choose a Different Folder
              </button>
            </>
          ) : (
            <>
              <p>You have not yet opened a library folder. Choose the folder that holds your Rockwell PDFs and program files.</p>
              {library.canPickFolder ? (
                <button type="button" className="vx-primary" onClick={() => void library.connectFolder()}>
                  Open Folder
                </button>
              ) : (
                <p className="vx-warn">This browser can't open folders on disk. Use Chrome or Edge, or browser storage below.</p>
              )}
              {library.canUsePrivateStorage && (
                <button type="button" className="vx-secondary" onClick={() => void library.connectPrivate()}>
                  Use Browser Storage
                </button>
              )}
            </>
          )}
          {error && <p className="vx-error">{error}</p>}
        </div>
      </nav>
    )
  }

  const actionButtons = (
    <span className="vx-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="vx-btn" title="New File…" aria-label="New File" onClick={() => startNew('new-file')}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M3.5 1.5h5l3 3v3M3.5 1.5v13h5M11 10v4M9 12h4" fill="none" stroke="currentColor" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="vx-btn" title="New Folder…" aria-label="New Folder" onClick={() => startNew('new-folder')}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M1.5 3.5h4l1.3 1.5h6.7v3.5M1.5 3.5v9h6M12 10.5v4M10 12.5h4" fill="none" stroke="currentColor" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="vx-btn"
        title="Upload Files…"
        aria-label="Upload Files"
        onClick={() => {
          uploadDir.current = targetDirOf(selected)
          fileInput.current?.click()
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="vx-btn" title="Refresh Explorer" aria-label="Refresh" onClick={() => void library.refresh()}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" fill="none" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="vx-btn" title="Collapse Folders in Explorer" aria-label="Collapse All" onClick={() => setExpanded(new Set())}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M3 5.5h8v8H3zM5.5 5.5V3h8v8H11M5 9.5h4" fill="none" stroke="currentColor" strokeLinejoin="round" />
        </svg>
      </button>
    </span>
  )

  return (
    <nav className="vx" aria-label="Explorer">
      {header}
      <input ref={fileInput} type="file" multiple hidden onChange={onPickFiles} aria-label="Choose files to add" />

      <div
        className={'vx-section' + (dropTarget === '' ? ' is-drop' : '')}
        onContextMenu={(e) => openMenu(e, null)}
        onDragOver={(e) => onDragOverDir(e, '')}
        onDragLeave={() => setDropTarget((t) => (t === '' ? null : t))}
        onDrop={(e) => onDropDir(e, '')}
        title={library.rootName}
      >
        <button
          type="button"
          className="vx-section-toggle"
          aria-expanded={sectionOpen}
          onClick={() => {
            setSectionOpen((o) => !o)
            setSelected(null)
          }}
        >
          <span className="vx-chevron">
            <Chevron open={sectionOpen} />
          </span>
          <span className="vx-section-label">{library.rootName}</span>
        </button>
        {actionButtons}
      </div>

      {error && (
        <p className="vx-error" role="alert">
          {error}
        </p>
      )}

      {sectionOpen && (
        <div
          ref={treeRef}
          className={'vx-tree' + (dropTarget === '' ? ' is-drop-root' : '')}
          role="tree"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => openMenu(e, null)}
          onClick={() => setSelected(null)}
          onDragOver={(e) => onDragOverDir(e, '')}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDropTarget(null)
          }}
          onDrop={(e) => onDropDir(e, '')}
        >
          {rows.length === 0 && (
            <p className="vx-note">The folder is empty. Right-click to add a file or folder, or drop your PDFs here.</p>
          )}
          {rows.map((row) => {
            if (row.type === 'new') {
              return (
                <div
                  key={`new:${row.parentPath}`}
                  className="vx-row is-editing"
                  style={{ '--depth': row.depth } as React.CSSProperties}
                >
                  <span className="vx-guides" />
                  <span className="vx-chevron" />
                  <NodeIcon kind={row.mode === 'new-folder' ? 'directory' : 'file'} name="" />
                  <InlineName
                    initial=""
                    selectBase={false}
                    siblings={siblingNames(row.parentPath)}
                    onCommit={(n) => void commitEdit(n)}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )
            }
            const { node, depth } = row
            const isDir = node.kind === 'directory'
            const isOpen = expanded.has(node.path)
            const renaming = editing?.mode === 'rename' && editing.path === node.path
            const classes = [
              'vx-row',
              selected === node.path ? 'is-selected' : '',
              !isDir && selectedFile === node.path ? 'is-open-file' : '',
              dropTarget === node.path ? 'is-drop' : '',
            ]
            return (
              <div
                key={node.path}
                data-path={node.path}
                className={classes.join(' ')}
                style={{ '--depth': depth } as React.CSSProperties}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selected === node.path}
                aria-expanded={isDir ? isOpen : undefined}
                draggable={!renaming}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(node.path)
                  treeRef.current?.focus()
                  if (isDir) toggle(node.path)
                  else onOpenFile(node)
                }}
                onContextMenu={(e) => openMenu(e, node)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(INTERNAL_DRAG, node.path)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => onDragOverDir(e, isDir ? node.path : parentOf(node.path))}
                onDrop={(e) => onDropDir(e, isDir ? node.path : parentOf(node.path))}
                onDragLeave={() => setDropTarget((t) => (t === node.path ? null : t))}
              >
                <span className="vx-guides" />
                <span className="vx-chevron">{isDir && <Chevron open={isOpen} />}</span>
                <NodeIcon kind={node.kind} name={node.name} open={isOpen} />
                {renaming ? (
                  <InlineName
                    initial={node.name}
                    selectBase={!isDir}
                    siblings={siblingNames(parentOf(node.path))}
                    onCommit={(n) => void commitEdit(n)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <span className="vx-label">{node.name}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {confirm && (
        <ConfirmDialog
          title={`Are you sure you want to delete '${confirm.name}'?`}
          detail={confirm.kind === 'directory' ? 'This folder and everything inside it will be permanently deleted.' : 'This file will be permanently deleted.'}
          confirmLabel="Delete"
          onConfirm={() => void deleteNode(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </nav>
  )
}
