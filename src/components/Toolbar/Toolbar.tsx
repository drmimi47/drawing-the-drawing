import { Pencil, Hand, MapPin } from 'lucide-react'
import { useDrawingStore, type ToolMode } from '../../store/drawingStore'
import './Toolbar.css'

/**
 * Floating bottom-center tool dock (Cluster B).
 *
 * Tools select the active interaction mode; the color swatches set the stroke
 * color. Pan (Cluster C) and Lock (Cluster H) are selectable now but only Draw
 * is wired to behavior so far.
 */

const TOOLS: { key: ToolMode; label: string; Icon: typeof Pencil }[] = [
  { key: 'DRAW', label: 'Draw (D)', Icon: Pencil },
  { key: 'PAN', label: 'Pan (V)', Icon: Hand },
  { key: 'LOCK', label: 'Lock (L)', Icon: MapPin },
]

const PRESET_COLORS = ['#1a1a1a', '#e23b3b', '#2f6fed', '#1f9d55', '#e8852b']

export function Toolbar() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const setTool = useDrawingStore((s) => s.setTool)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const setColor = useDrawingStore((s) => s.setColor)

  return (
    <div className="toolbar-dock" role="toolbar" aria-label="Tools">
      {TOOLS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`tool-button${toolMode === key ? ' is-active' : ''}`}
          title={label}
          aria-label={label}
          aria-pressed={toolMode === key}
          onClick={() => setTool(key)}
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
