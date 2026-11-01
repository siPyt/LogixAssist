import { useEffect, useState } from 'react'
import type { TreeNode } from '../lib/fs'
import { buildVsCodeFolderUri, getResourcesPath } from '../config'

interface FileViewerProps {
  node: TreeNode
  onClose: () => void
}

type Loaded =
  | { type: 'pdf' | 'image'; url: string }
  | { type: 'text'; text: string }
  | { type: 'none'; size: number }
  | { type: 'error'; message: string }

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const TEXT_EXT =
  /\.(txt|md|json|csv|log|xml|l5x|l5k|csv|ini|yml|yaml|st|ld|sc)$/i
const MAX_TEXT_BYTES = 1024 * 1024

function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function FileViewer({ node, onClose }: FileViewerProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    setLoaded(null)
    void (async () => {
      try {
        const file = await (node.handle as FileSystemFileHandle).getFile()
        if (cancelled) return
        if (/\.pdf$/i.test(node.name)) {
          url = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }))
          setLoaded({ type: 'pdf', url })
        } else if (IMAGE_EXT.test(node.name)) {
          url = URL.createObjectURL(file)
          setLoaded({ type: 'image', url })
        } else if (TEXT_EXT.test(node.name) && file.size <= MAX_TEXT_BYTES) {
          setLoaded({ type: 'text', text: await file.text() })
        } else {
          setLoaded({ type: 'none', size: file.size })
        }
      } catch (err) {
        if (!cancelled) {
          setLoaded({
            type: 'error',
            message: err instanceof Error ? err.message : 'Could not open file.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [node])

  function openInVsCode() {
    const parent = parentOf(node.path)
    const base = getResourcesPath().replace(/[\\/]+$/, '')
    window.location.href = buildVsCodeFolderUri(parent ? `${base}/${parent}` : base)
  }

  return (
    <section className="viewer" aria-label={`Viewing ${node.name}`}>
      <header className="viewer-header">
        <span className="viewer-name" title={node.path}>
          {node.path}
        </span>
        <button type="button" onClick={openInVsCode}>
          Open folder in VS Code
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="viewer-body">
        {!loaded && <p className="viewer-note">Loading…</p>}
        {loaded?.type === 'pdf' && (
          <iframe className="viewer-frame" src={loaded.url} title={node.name} />
        )}
        {loaded?.type === 'image' && (
          <img className="viewer-image" src={loaded.url} alt={node.name} />
        )}
        {loaded?.type === 'text' && <pre className="viewer-text">{loaded.text}</pre>}
        {loaded?.type === 'none' && (
          <p className="viewer-note">
            No in-app preview for this file type ({Math.max(1, Math.round(loaded.size / 1024))} KB).
            Use “Open folder in VS Code” to work with it.
          </p>
        )}
        {loaded?.type === 'error' && (
          <p className="viewer-note viewer-error">{loaded.message}</p>
        )}
      </div>
    </section>
  )
}
