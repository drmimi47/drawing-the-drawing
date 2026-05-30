import { useEffect } from 'react'
import { ScanLine } from 'lucide-react'
import { CanvasScene } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { useDrawingStore } from './store/drawingStore'
import { useObserverStore } from './store/observerStore'

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

  const debug = useObserverStore((s) => s.debug)
  const toggleDebug = useObserverStore((s) => s.toggleDebug)

  return (
    <div className="app">
      <CanvasScene />

      <div className="status-bar">
        <span className="status-dot" />
        BLINDSPOT
      </div>

      <button
        type="button"
        className={`debug-toggle${debug ? ' is-active' : ''}`}
        onClick={toggleDebug}
        title="Toggle observation boundary"
        aria-pressed={debug}
      >
        <ScanLine size={16} strokeWidth={1.75} />
        Observation boundary
      </button>

      <Toolbar />
    </div>
  )
}
