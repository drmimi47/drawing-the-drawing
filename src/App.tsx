import { lazy, Suspense, useEffect } from 'react'
import { CanvasScene } from './components/Canvas'
import { MenuBar } from './components/Menu/MenuBar'
import { Ribbon } from './components/Ribbon/Ribbon'
import { Crosshair } from './components/Crosshair/Crosshair'
// Lazy-loaded so Mapbox GL JS + Turf.js only download when the map is opened.
const MapView = lazy(() => import('./components/Map/MapView').then((m) => ({ default: m.MapView })))
import { NormalizeMenu } from './components/Toolbar/NormalizeMenu'
import { IntentPinMenu } from './components/Toolbar/IntentPinMenu'
import { TextEditor } from './components/Toolbar/TextEditor'
import { useDrawingStore } from './store/drawingStore'

export default function App() {
  // Undo (Ctrl/Cmd+Z) and redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y) across the whole
  // pipeline — draw, erase, normalize, and lock add/remove.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ESC: deselect / clear the active marquee, lasso, and lock-region overlay.
      if (e.key === 'Escape') {
        useDrawingStore.getState().clearSelection()
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useDrawingStore.getState().undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        useDrawingStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const mapActive = useDrawingStore((s) => s.mapActive)

  return (
    // Column shell: a full-width menu bar, the ribbon toolbar, then the canvas
    // workspace fills the rest. The R3F canvas fills the whole canvas area, so
    // coordinate tracking is intact.
    <div className="app-shell">
      <MenuBar />
      <Ribbon />

      <main className="canvas-area">
        <CanvasScene />
        {/* Geospatial overlay, confined to the canvas bounds (loads on demand). */}
        {mapActive && (
          <Suspense fallback={null}>
            <MapView />
          </Suspense>
        )}
      </main>

      {/* Full-viewport pointer crosshair — hidden while the map is active. */}
      {!mapActive && <Crosshair />}

      {/* Fixed-position menus (anchored to click coordinates). */}
      <NormalizeMenu />
      <IntentPinMenu />
      <TextEditor />
    </div>
  )
}
