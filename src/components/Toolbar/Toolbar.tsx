import { useEffect, useState } from 'react'
import {
  Pencil,
  Spline,
  Type,
  Eraser,
  BoxSelect,
  Lasso,
  MousePointer2,
  Lock,
  MapPin,
  Hand,
  Magnet,
  LayoutGrid,
  PanelTop,
  PanelRight,
  PanelBottom,
  PanelLeft,
} from 'lucide-react'
import { useDrawingStore, type ToolMode, type ToolbarPosition } from '../../store/drawingStore'
import './Toolbar.css'

/**
 * Dockable tool dock. Tools select the active interaction mode; the color
 * swatches set the stroke color. The dock can live on any edge (top/right/
 * bottom/left) — orientation follows the side, and a dock control on the bar
 * lets the user pick the side.
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

const DOCK_OPTIONS: { key: ToolbarPosition; label: string; Icon: typeof PanelTop }[] = [
  { key: 'top', label: 'Dock top', Icon: PanelTop },
  { key: 'right', label: 'Dock right', Icon: PanelRight },
  { key: 'bottom', label: 'Dock bottom', Icon: PanelBottom },
  { key: 'left', label: 'Dock left', Icon: PanelLeft },
]

/** Settings button + popover to choose which edge the toolbar docks to. */
function DockControl() {
  const position = useDrawingStore((s) => s.toolbarPosition)
  const setPosition = useDrawingStore((s) => s.setToolbarPosition)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="dock-control" data-dock={position} onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="tool-button"
        title="Dock position"
        aria-label="Dock position"
        onClick={() => setOpen((o) => !o)}
      >
        <LayoutGrid size={18} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="dock-menu" role="menu">
          {DOCK_OPTIONS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`dock-menu-item${position === key ? ' is-active' : ''}`}
              title={label}
              aria-label={label}
              onClick={() => {
                setPosition(key)
                setOpen(false)
              }}
            >
              <Icon size={16} strokeWidth={1.75} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Toolbar() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const setTool = useDrawingStore((s) => s.setTool)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const setColor = useDrawingStore((s) => s.setColor)
  const setShowIntentLabels = useDrawingStore((s) => s.setShowIntentLabels)
  const toolbarPosition = useDrawingStore((s) => s.toolbarPosition)
  const snappingEnabled = useDrawingStore((s) => s.snappingEnabled)
  const toggleSnapping = useDrawingStore((s) => s.toggleSnapping)

  const vertical = toolbarPosition === 'left' || toolbarPosition === 'right'

  return (
    <div
      className={`toolbar-dock ${vertical ? 'toolbar-dock--vertical' : 'toolbar-dock--horizontal'}`}
      role="toolbar"
      aria-label="Tools"
    >
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

      <div className="toolbar-divider" />

      <button
        type="button"
        className={`tool-button snap-toggle${snappingEnabled ? ' is-active' : ' snap-toggle--off'}`}
        title={snappingEnabled ? 'Snapping: On (F3)' : 'Snapping: Off (F3)'}
        aria-label="Toggle object snapping"
        aria-pressed={snappingEnabled}
        onClick={toggleSnapping}
      >
        <Magnet size={20} strokeWidth={1.75} />
      </button>

      <div className="toolbar-divider" />

      <DockControl />
    </div>
  )
}
