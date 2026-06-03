import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Spline,
  Hand,
  Eraser,
  Type,
  BoxSelect,
  Lasso,
  MousePointer2,
  Lock,
  MapPin,
  Download,
  FileCode,
  Image as ImageIcon,
  FileText,
} from 'lucide-react'
import { useDrawingStore, type ToolMode, type PipelineLayer } from '../../store/drawingStore'
import { exportSVG, exportPNG, exportPDF } from '../../io/exportDrawing'
import './Ribbon.css'

/**
 * Compact single-row tool rail.
 *
 * Replaces the two-row Word/Revit ribbon with a ~46px horizontal strip.
 * Tools are grouped by workflow stage with thin separators. Color/Pen/Export
 * open floating panels; every other button is a direct tool toggle.
 *
 * Layout: Pan Scribble Text | Polyline Erase Edit | Marquee Lasso Lock IntentPin [Export▼]
 * Color & Pen options moved to the per-tool contextual bar (ContextualBar).
 * Generate lives in the right-panel layer hierarchy, not the rail.
 */

interface ToolDef {
  key: ToolMode
  label: string
  Icon: typeof Pencil
}

const PAN_TOOL: ToolDef = { key: 'PAN', label: 'Pan', Icon: Hand }
const SCRIBBLE_TOOL: ToolDef = { key: 'DRAW', label: 'Scribble', Icon: Pencil }
const TEXT_TOOL: ToolDef = { key: 'TEXT', label: 'Text', Icon: Type }
const POLYLINE_TOOL: ToolDef = { key: 'POLYLINE', label: 'Polyline', Icon: Spline }
const ERASE_TOOL: ToolDef = { key: 'ERASE', label: 'Erase', Icon: Eraser }
const EDIT_TOOL: ToolDef = { key: 'VECTOR', label: 'Edit', Icon: MousePointer2 }

/** Group 1: navigation + freehand + text. */
const GROUP_NAV: ToolDef[] = [PAN_TOOL, SCRIBBLE_TOOL, TEXT_TOOL]
/** Group 2: structured draw / edit tools. */
const GROUP_DRAW: ToolDef[] = [POLYLINE_TOOL, ERASE_TOOL, EDIT_TOOL]
/** The rest, flowing together with no further separators. */
const REST_TOOLS: ToolDef[] = [
  { key: 'SELECT', label: 'Marquee', Icon: BoxSelect },
  { key: 'LASSO', label: 'Lasso', Icon: Lasso },
  { key: 'LASSO_LOCK', label: 'Lock', Icon: Lock },
]

/**
 * Per-layer tool allowlist — which tool buttons are ENABLED in each pipeline
 * layer (the rule follows the active layer, so it applies even when stepping
 * backwards). A layer absent from this map enables every tool. Until the later
 * stages are specified they fall through to "all enabled".
 *   • Context     → Pan only (map setup).
 *   • Lot Boundary / Circulation → Pan, Scribble, Text, Polyline, Erase, Edit.
 */
const DRAW_TOOLS: ToolMode[] = ['PAN', 'DRAW', 'TEXT', 'POLYLINE', 'ERASE', 'VECTOR']
const LAYER_ENABLED_TOOLS: Partial<Record<PipelineLayer, Set<ToolMode>>> = {
  CONTEXT: new Set<ToolMode>(['PAN']),
  BOUNDARY: new Set<ToolMode>(DRAW_TOOLS),
  CIRCULATION: new Set<ToolMode>(DRAW_TOOLS),
}

function ToolBtn({ tool }: { tool: ToolDef }) {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const setTool = useDrawingStore((s) => s.setTool)
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const setShowIntentLabels = useDrawingStore((s) => s.setShowIntentLabels)
  const setShowIntentGrid = useDrawingStore((s) => s.setShowIntentGrid)
  const { key, label, Icon } = tool
  const active = toolMode === key
  const allowed = LAYER_ENABLED_TOOLS[activeLayer]
  const disabled = allowed != null && !allowed.has(key)
  // Hovering Intent Pin previews the pin labels AND the region concentration grid.
  const hoverIntent = (show: boolean) => {
    setShowIntentLabels(show)
    setShowIntentGrid(show)
  }
  return (
    <button
      type="button"
      className={`rail-btn${active ? ' is-active' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      title={disabled ? `${label} — not available in this layer` : label}
      onClick={() => setTool(key)}
      onMouseEnter={key === 'INTENT_PIN' && !disabled ? () => hoverIntent(true) : undefined}
      onMouseLeave={key === 'INTENT_PIN' && !disabled ? () => hoverIntent(false) : undefined}
    >
      <Icon size={16} strokeWidth={1.75} />
      <span className="rail-btn-label">{label}</span>
    </button>
  )
}

/** Export menu (SVG / PNG / PDF). Underlay import + map moved to the right panel. */
function ExportDropdown() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={wrapRef} className="rail-dropdown-wrap">
      <button
        type="button"
        className={`rail-btn${open ? ' is-active' : ''}`}
        title="Export"
        onClick={() => setOpen((o) => !o)}
      >
        <Download size={16} strokeWidth={1.75} />
        <span className="rail-btn-label">Export</span>
      </button>

      {open && (
        <div className="rail-float-panel">
          <div className="rail-float-label">Export</div>
          <button type="button" className="rail-float-item" onClick={() => { exportSVG(); setOpen(false) }}>
            <FileCode size={13} strokeWidth={1.75} />
            Export SVG
          </button>
          <button type="button" className="rail-float-item" onClick={() => { void exportPNG(); setOpen(false) }}>
            <ImageIcon size={13} strokeWidth={1.75} />
            Export PNG
          </button>
          <button type="button" className="rail-float-item" onClick={() => { void exportPDF(); setOpen(false) }}>
            <FileText size={13} strokeWidth={1.75} />
            Export PDF
          </button>
        </div>
      )}
    </div>
  )
}

export function Ribbon() {
  return (
    <div className="toolbar-rail">
      {GROUP_NAV.map((t) => <ToolBtn key={t.key} tool={t} />)}

      <div className="rail-sep" />
      {GROUP_DRAW.map((t) => <ToolBtn key={t.key} tool={t} />)}

      <div className="rail-sep" />
      {REST_TOOLS.map((t) => <ToolBtn key={t.key} tool={t} />)}
      <ToolBtn tool={{ key: 'INTENT_PIN', label: 'Intent Pin', Icon: MapPin }} />
      {/* Color & Pen options now live in the per-tool contextual bar (see
          ContextualBar). Export sits directly after the Intent Pin button. */}
      <ExportDropdown />
    </div>
  )
}
