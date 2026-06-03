import { lazy, Suspense, useEffect } from 'react'
import { CanvasScene } from './components/Canvas'
import { BoundaryContextOverlay } from './components/Canvas/BoundaryContextOverlay'
import { TextOverlay } from './components/Canvas/TextOverlay'
import { ScribbleOverlay } from './components/Canvas/ScribbleOverlay'
import { SheetTitle } from './components/Canvas/SheetTitle'
import { SheetScale } from './components/Canvas/SheetScale'
import { CanvasBranchControls } from './components/Canvas/CanvasBranchControls'
import { ContextualBar } from './components/Toolbar/ContextualBar'
import { MenuBar } from './components/Menu/MenuBar'
import { Ribbon } from './components/Ribbon/Ribbon'
import { Crosshair } from './components/Crosshair/Crosshair'
// Lazy-loaded so Mapbox GL JS + Turf.js only download when the map is opened.
const MapView = lazy(() => import('./components/Map/MapView').then((m) => ({ default: m.MapView })))
import { NormalizeMenu } from './components/Toolbar/NormalizeMenu'
import { IntentPinMenu } from './components/Toolbar/IntentPinMenu'
import { TextEditor } from './components/Toolbar/TextEditor'
import { TextHoverPreview } from './components/Toolbar/TextHoverPreview'
import { SnapToast } from './components/Toolbar/SnapToast'
import { RightPanel } from './components/Panel/RightPanel'
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
      // F3 (universal CAD OSNAP key) or Ctrl/Cmd+G: master snapping toggle.
      if (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g')) {
        e.preventDefault()
        useDrawingStore.getState().toggleSnapping()
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
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  // The map is the interactive surface only while framing it in the Context layer.
  const mapInteractive = mapActive && activeLayer === 'CONTEXT'

  return (
    // Column shell: a full-width menu bar, the ribbon toolbar, then the canvas
    // workspace fills the rest. The R3F canvas fills the whole canvas area, so
    // coordinate tracking is intact.
    <div className="app-shell">
      <MenuBar />
      <Ribbon />

      {/* Workspace row: the canvas flexes to fill space left of the layer panel,
          so the Mapbox underlay (inset:0 within .canvas-area) stays confined to
          the canvas rather than the whole screen. */}
      <div className="workspace">
        <main className="canvas-area">
          <CanvasScene />
          {/* Geospatial overlay, confined to the canvas bounds (loads on demand). */}
          {mapActive && (
            <Suspense fallback={null}>
              <MapView />
            </Suspense>
          )}
          {/* Magenta lot-boundary reference (Context layer), drawn above the map. */}
          <BoundaryContextOverlay />
          {/* Freehand scribbles (raster), pinned in world space ABOVE the map in all layers. */}
          <ScribbleOverlay />
          {/* Committed text labels, pinned in world space ABOVE the map in all layers. */}
          <TextOverlay />
          {/* Editable sheet title at the artboard's bottom-right corner. */}
          <SheetTitle />
          {/* Real-world scale readout at the artboard's bottom-left corner. */}
          <SheetScale />
          {/* "+" controls just outside each edge of the active canvas → spawn a
              neighboring design-option canvas in that cardinal direction. */}
          <CanvasBranchControls />
          {/* CAD crosshair — inside canvas-area so overflow:hidden clips it to the
              canvas and it never bleeds over the right panel. */}
          {!mapInteractive && <Crosshair />}
          {/* Ghost "add text" preview that trails the cursor with the Text tool. */}
          <TextHoverPreview />
          {/* Photoshop-style contextual options bar (Scribble / Text tools). */}
          <ContextualBar />
        </main>
        <RightPanel />
      </div>

      {/* Transient confirmation when the snapping toggle flips (F3 / Ctrl+G). */}
      <SnapToast />

      {/* Fixed-position menus (anchored to click coordinates). */}
      <NormalizeMenu />
      <IntentPinMenu />
      <TextEditor />
    </div>
  )
}
