import { useCallback, useEffect, useState } from 'react'

export type Side = 'left' | 'right'

interface LayoutState {
  left: number
  right: number
  leftOpen: boolean
  rightOpen: boolean
}

const KEY = 'logix.layout'
const DEFAULTS: LayoutState = { left: 290, right: 380, leftOpen: true, rightOpen: true }
const LIMITS = { left: { min: 200, max: 560 }, right: { min: 300, max: 720 } }
/** Dragging a panel narrower than this collapses it, like VS Code. */
const SNAP_CLOSED = 120

function load(): LayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LayoutState> | null
    if (raw) {
      return {
        left: Number.isFinite(raw.left) ? Number(raw.left) : DEFAULTS.left,
        right: Number.isFinite(raw.right) ? Number(raw.right) : DEFAULTS.right,
        leftOpen: raw.leftOpen ?? DEFAULTS.leftOpen,
        rightOpen: raw.rightOpen ?? DEFAULTS.rightOpen,
      }
    }
  } catch {
    // ignore corrupt saved layout
  }
  return DEFAULTS
}

/** Side panel widths and open/closed state, remembered between visits. */
export function useLayout() {
  const [layout, setLayout] = useState<LayoutState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout))
    } catch {
      // storage unavailable
    }
  }, [layout])

  const toggle = useCallback((side: Side) => {
    setLayout((l) => (side === 'left' ? { ...l, leftOpen: !l.leftOpen } : { ...l, rightOpen: !l.rightOpen }))
  }, [])

  const resizeTo = useCallback((side: Side, raw: number) => {
    setLayout((l) => {
      if (raw < SNAP_CLOSED) return side === 'left' ? { ...l, leftOpen: false } : { ...l, rightOpen: false }
      const { min, max } = LIMITS[side]
      const width = Math.min(max, Math.max(min, Math.round(raw)))
      return side === 'left' ? { ...l, left: width, leftOpen: true } : { ...l, right: width, rightOpen: true }
    })
  }, [])

  const reset = useCallback((side: Side) => {
    setLayout((l) => (side === 'left' ? { ...l, left: DEFAULTS.left } : { ...l, right: DEFAULTS.right }))
  }, [])

  return { layout, toggle, resizeTo, reset }
}
