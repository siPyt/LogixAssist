import type { Side } from '../lib/useLayout'

interface SplitterProps {
  side: Side
  width: number
  onResize: (width: number) => void
  onReset: () => void
}

/** Draggable divider between a side panel and the center, like VS Code's sash. */
export function Splitter({ side, width, onResize, onReset }: SplitterProps) {
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    document.body.classList.add('is-resizing')
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      onResize(side === 'left' ? startWidth + dx : startWidth - dx)
    }
    const up = () => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const grow = (e.key === 'ArrowRight') === (side === 'left')
    onResize(width + (grow ? step : -step))
  }

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize explorer' : 'Resize Logix Advisor'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
