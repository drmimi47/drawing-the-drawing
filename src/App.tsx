import { useEffect } from 'react'
import { CanvasScene } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { StageIndicator } from './components/Toolbar/StageIndicator'
import { NormalizeMenu } from './components/Toolbar/NormalizeMenu'
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

  return (
    <div className="app">
      <CanvasScene />

      <div className="status-bar">
        <span className="status-dot" />
        DYNAMIC TRACE PAPER
      </div>

      <StageIndicator />
      <Toolbar />
      <NormalizeMenu />
    </div>
  )
}
