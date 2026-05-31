import { useCallback, useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { computeNormalizeTargets } from '../../geometry/mutations/normalizeSelection'
import { computeLockInfluences } from '../../geometry/locks'

/**
 * Selection-scoped Normalize (Cluster G, G3).
 *
 * Normalization is NEVER global. With strokes selected (Select tool marquee),
 * right-click opens a "Normalize" menu. Choosing it starts a non-destructive
 * preview: a strength slider morphs the selected strokes toward their fitted
 * primitives live; Apply commits, Cancel reverts. One undo step per session.
 */

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function NormalizeMenu() {
  const selectedStrokeIds = useDrawingStore((s) => s.selectedStrokeIds)

  const DEFAULT_STRENGTH = 0.5

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [session, setSession] = useState<{ x: number; y: number } | null>(null)
  const [strength, setStrength] = useState(DEFAULT_STRENGTH)

  const originals = useRef<Map<string, { x: number; y: number }>>(new Map())
  const targets = useRef<Map<string, { x: number; y: number }>>(new Map())
  const influences = useRef<Map<string, number>>(new Map())

  const applyPreview = useCallback((m: number) => {
    const eased = easeInOutCubic(m)
    const updates: Record<string, { x: number; y: number }> = {}
    originals.current.forEach((o, vid) => {
      const t = targets.current.get(vid) ?? o
      // Locked vertices resist: scale the morph by (1 - lock influence).
      const factor = eased * (1 - (influences.current.get(vid) ?? 0))
      updates[vid] = { x: o.x + (t.x - o.x) * factor, y: o.y + (t.y - o.y) * factor }
    })
    useDrawingStore.getState().setVertexPositions(updates)
  }, [])

  const startSession = useCallback(
    (at: { x: number; y: number }) => {
      const store = useDrawingStore.getState()
      const ids = store.selectedStrokeIds
      if (ids.length === 0) return
      const { originals: o, targets: t } = computeNormalizeTargets(store.graph, ids)
      originals.current = o
      targets.current = t
      influences.current = computeLockInfluences(store.graph, store.lockPolygons)
      store.beginHistory() // snapshot original graph for one-step undo
      setMenu(null)
      setSession(at)
      setStrength(DEFAULT_STRENGTH)
      applyPreview(DEFAULT_STRENGTH)
    },
    [applyPreview],
  )

  const cancelSession = useCallback(() => {
    useDrawingStore.getState().undo() // restore original graph + pop the snapshot
    setSession(null)
  }, [])

  const applySession = useCallback(() => {
    setSession(null) // preview positions stay; history already holds the pre-state
  }, [])

  // Right-click opens the menu only when there is a selection.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (useDrawingStore.getState().selectedStrokeIds.length === 0) return
      if (session) return
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('contextmenu', onContextMenu)
    return () => window.removeEventListener('contextmenu', onContextMenu)
  }, [session])

  // Escape cancels; a left-click elsewhere closes the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (session) cancelSession()
      else setMenu(null)
    }
    const onDown = () => setMenu(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [session, cancelSession])

  // Selection cleared out from under us → abandon menu/session.
  useEffect(() => {
    if (selectedStrokeIds.length === 0) {
      setMenu(null)
      if (session) cancelSession()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStrokeIds])

  return (
    <>
      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="context-menu-item" onClick={() => startSession(menu)}>
            Normalize selection
          </button>
        </div>
      )}

      {session && (
        <div
          className="normalize-panel"
          style={{ left: session.x, top: session.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="normalize-panel-title">Normalize · {Math.round(strength * 100)}%</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={strength}
            onChange={(e) => {
              const m = Number(e.target.value)
              setStrength(m)
              applyPreview(m)
            }}
          />
          <div className="normalize-panel-actions">
            <button type="button" className="btn btn-ghost" onClick={cancelSession}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={applySession}>
              Apply
            </button>
          </div>
        </div>
      )}
    </>
  )
}
