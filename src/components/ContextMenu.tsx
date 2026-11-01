import { useEffect, useRef, useState } from 'react'

export type MenuItem =
  | { separator: true }
  | { label: string; shortcut?: string; disabled?: boolean; onClick: () => void }

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** Right-click menu that closes on outside click, Escape, scroll, or resize. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({
        left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
        top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
      })
    }
    const close = (e: Event) => {
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', key)
    }
  }, [x, y, onClose])

  return (
    <div className="vx-menu" ref={ref} style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="vx-menu-sep" role="separator" />
        ) : (
          <div
            key={i}
            role="menuitem"
            className={'vx-menu-item' + (item.disabled ? ' is-disabled' : '')}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="vx-menu-key">{item.shortcut}</span>}
          </div>
        ),
      )}
    </div>
  )
}
