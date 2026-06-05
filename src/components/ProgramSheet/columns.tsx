import { useCallback, useState } from 'react'

/**
 * Resizable table columns (file-explorer style): drag a header's right edge to widen/narrow a
 * column. Used by the Program Sheet tabs so the user can reveal clipped column content.
 *
 * Widths are kept in a module cache keyed per table, so a resize survives tab switches (the tab
 * components unmount when you switch) without needing store state.
 */

const MIN_COL = 48
const cache: Record<string, number[]> = {}

export function useColumnWidths(key: string, initial: number[]) {
  const [widths, setWidths] = useState<number[]>(() => cache[key] ?? initial)

  const onResizeDown = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      // Read the live start width from the cache/initial at drag start.
      const startW = (cache[key] ?? initial)[index]
      const onMove = (ev: PointerEvent) => {
        const next = Math.max(MIN_COL, startW + (ev.clientX - startX))
        setWidths((ws) => {
          const out = ws.map((w, i) => (i === index ? next : w))
          cache[key] = out
          return out
        })
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'col-resize'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [key, initial],
  )

  const total = widths.reduce((a, b) => a + b, 0)
  return { widths, total, onResizeDown }
}

/** <colgroup> that drives the (table-layout: fixed) column widths. */
export function ColGroup({ widths }: { widths: number[] }) {
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  )
}

/** Drag handle sitting on a header cell's right edge. */
export function ColHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <span
      className="ps-col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={onPointerDown}
    />
  )
}
