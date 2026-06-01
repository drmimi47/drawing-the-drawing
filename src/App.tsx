import { useEffect } from 'react'
import { CanvasScene } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { StageIndicator } from './components/Toolbar/StageIndicator'
import { NormalizeMenu } from './components/Toolbar/NormalizeMenu'
import { IntentPinMenu } from './components/Toolbar/IntentPinMenu'
import { TextEditor } from './components/Toolbar/TextEditor'
import { useDrawingStore } from './store/drawingStore'

export default function App() {
  // Undo (Ctrl/Cmd+Z) and redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y) across the whole
  // pipeline — draw, erase, normalize, and lock add/remove.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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

  const toolbarPosition = useDrawingStore((s) => s.toolbarPosition)

  return (
    // Flex layout: the docked toolbar takes one edge, the canvas area fills the
    // rest. Toolbar is the first child; flex-direction (set per dock side in CSS)
    // places it on the chosen edge.
    <div className="app" data-dock={toolbarPosition}>
      <Toolbar />

      <main className="canvas-area">
        <CanvasScene />

        {/* Overlays live inside the canvas area, so they never sit under the dock. */}
        <div className="status-bar">
          <span className="status-dot" />
          DYNAMIC TRACE PAPER
        </div>
        <StageIndicator />
      </main>

      {/* Fixed-position menus (anchored to click coordinates). */}
      <NormalizeMenu />
      <IntentPinMenu />
      <TextEditor />
    </div>
  )
}
