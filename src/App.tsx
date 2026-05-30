import { useEffect } from 'react'
import { CanvasScene } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { useDrawingStore } from './store/drawingStore'

export default function App() {
  // Ctrl/Cmd+Z removes the last committed stroke (Cluster B).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        useDrawingStore.getState().undo()
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
        BLINDSPOT
      </div>

      <Toolbar />
    </div>
  )
}
