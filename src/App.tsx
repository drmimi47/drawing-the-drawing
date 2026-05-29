import { CanvasScene } from './components/Canvas'
import { Toolbar } from './components/Toolbar'

export default function App() {
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
