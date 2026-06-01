import { Pencil, Spline, Type, Eraser, BoxSelect, Lasso, MousePointer2, Lock, MapPin, Hand } from 'lucide-react'
import { useDrawingStore, type ToolMode } from '../../store/drawingStore'
import './Toolbar.css'

/**
 * Floating bottom-center tool dock.
 *
 * Tools select the active interaction mode; the color swatches set the stroke
 * color. Select (marquee) and Lasso (freehand) feed the right-click "Normalize"
 * command. Vector edits anchor points directly. Lock/Intent tools arrive in Cluster H.
 */

const TOOLS: { key: ToolMode; label: string; Icon: typeof Pencil }[] = [
  { key: 'DRAW', label: 'Draw', Icon: Pencil },
  { key: 'POLYLINE', label: 'Polyline', Icon: Spline },
  { key: 'TEXT', label: 'Text', Icon: Type },
  { key: 'ERASE', label: 'Erase', Icon: Eraser },
  { key: 'SELECT', label: 'Marquee select', Icon: BoxSelect },
  { key: 'LASSO', label: 'Lasso select', Icon: Lasso },
  { key: 'VECTOR', label: 'Edit', Icon: MousePointer2 },
  { key: 'LASSO_LOCK', label: 'Lock region', Icon: Lock },
  { key: 'INTENT_PIN', label: 'Intent pin', Icon: MapPin },
  { key: 'PAN', label: 'Pan', Icon: Hand },
]

const PRESET_COLORS = ['#1a1a1a', '#e23b3b', '#2f6fed', '#1f9d55', '#e8852b']

export function Toolbar() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const setTool = useDrawingStore((s) => s.setTool)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const setColor = useDrawingStore((s) => s.setColor)
  const setShowIntentLabels = useDrawingStore((s) => s.setShowIntentLabels)

  return (
    <div className="toolbar-dock" role="toolbar" aria-label="Tools">
      {TOOLS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`tool-button${key === 'VECTOR' ? ' tool-button--edit' : ''}${toolMode === key ? ' is-active' : ''}`}
          title={label}
          aria-label={label}
          aria-pressed={toolMode === key}
          onClick={() => setTool(key)}
          // Hovering the Intent-pin button reveals every pin's type label.
          onMouseEnter={key === 'INTENT_PIN' ? () => setShowIntentLabels(true) : undefined}
          onMouseLeave={key === 'INTENT_PIN' ? () => setShowIntentLabels(false) : undefined}
        >
          <Icon size={20} strokeWidth={1.75} />
        </button>
      ))}

      <div className="toolbar-divider" />

      <div className="swatches">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`swatch${strokeColor === color ? ' is-active' : ''}`}
            style={{ background: color }}
            title={color}
            aria-label={`Color ${color}`}
            aria-pressed={strokeColor === color}
            onClick={() => setColor(color)}
          />
        ))}

        <label className="swatch swatch-custom" title="Custom color">
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Custom stroke color"
          />
        </label>
      </div>
    </div>
  )
}
