import { useEffect } from 'react'

interface ConfirmDialogProps {
  title: string
  detail?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** Modal confirmation, used for destructive actions like Delete. */
export function ConfirmDialog({ title, detail, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onConfirm, onCancel])

  return (
    <div className="vx-overlay" onMouseDown={onCancel}>
      <div
        className="vx-dialog"
        role="alertdialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="vx-dialog-title">{title}</p>
        {detail && <p className="vx-dialog-detail">{detail}</p>}
        <div className="vx-dialog-actions">
          <button type="button" className="vx-dialog-danger" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
