import { useState } from 'react'
import { ftColors } from '../theme'
import { AUTHOR, buildVsCodeFolderUri, getResourcesPath } from '../config'

interface LogixIconProps {
  size?: number
  /**
   * When true the badge is a clickable button that opens the configured
   * Rockwell/program-file folder in VS Code. When false (the default) it is a
   * plain, non-interactive marketing graphic.
   */
  interactive?: boolean
}

function LogixBadge({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 112 112"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Logix Assistant badge"
    >
      <defs>
        <linearGradient id="la-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={ftColors.brandRed} />
          <stop offset="100%" stopColor={ftColors.brandRedDark} />
        </linearGradient>
      </defs>
      <rect
        x="4"
        y="4"
        width="104"
        height="104"
        rx="22"
        fill="url(#la-bg)"
        stroke={ftColors.brandOrange}
        strokeWidth="4"
      />
      {/* Orange accent bar */}
      <rect x="20" y="86" width="72" height="6" rx="3" fill={ftColors.brandOrange} />
      {/* LA letters */}
      <text
        x="56"
        y="64"
        textAnchor="middle"
        fontFamily="'Segoe UI', Arial, sans-serif"
        fontWeight="800"
        fontSize="48"
        letterSpacing="1"
        fill={ftColors.textPrimary}
      >
        LA
      </text>
    </svg>
  )
}

/**
 * The "LA" badge icon in FactoryTalk View colors.
 *
 * By default it is a static graphic (used as the center marketing piece).
 * Pass `interactive` to make it a button that opens the configured
 * Rockwell/program-file folder in VS Code via the `vscode://file/...` scheme.
 */
export function LogixIcon({ size = 112, interactive = false }: LogixIconProps) {
  const [hovered, setHovered] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  if (!interactive) {
    return (
      <div style={{ display: 'inline-block', lineHeight: 0 }}>
        <LogixBadge size={size} />
      </div>
    )
  }

  function openInVsCode() {
    const path = getResourcesPath()
    const uri = buildVsCodeFolderUri(path)
    setStatus('Opening in VS Code…')
    window.location.href = uri
    window.setTimeout(() => setStatus(null), 3500)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openInVsCode()
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={openInVsCode}
        onKeyDown={onKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-label={`Logix Assistant by ${AUTHOR} — open resource folder in VS Code`}
        title={`by ${AUTHOR}`}
        className="logix-icon-button"
        style={{
          width: size,
          height: size,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          borderRadius: 18,
        }}
      >
        <LogixBadge size={size} />
      </button>

      {hovered && (
        <div className="logix-tooltip" role="tooltip">
          by {AUTHOR}
        </div>
      )}

      {status && <div className="logix-icon-status">{status}</div>}
    </div>
  )
}
