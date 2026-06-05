import { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Spline,
  Hand,
  Eraser,
  Type,
  MousePointer2,
  Lock,
  MapPin,
  Building2,
  Download,
  FileCode,
  Image as ImageIcon,
  FileText,
  Table,
} from 'lucide-react'
import { useDrawingStore, type ToolMode, type PipelineLayer } from '../../store/drawingStore'
import { useProgramSheet } from '../../store/programSheetStore'
import { exportSVG, exportPNG, exportPDF } from '../../io/exportDrawing'
import './Ribbon.css'

/**
 * Compact single-row tool rail.
 *
 * Replaces the two-row Word/Revit ribbon with a ~46px horizontal strip.
 * Tools are grouped by workflow stage with thin separators. Color/Pen/Export
 * open floating panels; every other button is a direct tool toggle.
 *
 * Layout: Pan Scribble Text | Polyline Erase Edit | Dept | Lock IntentPin | [Export▼] Program Sheet
 * (Marquee + Lasso are hidden for now; Lock + Intent Pin are enabled only on the Rooms layer.)
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
/** Rooms-only tools shown after the Dept divider. Marquee + Lasso are hidden for now. */
const LOCK_TOOL: ToolDef = { key: 'LASSO_LOCK', label: 'Lock', Icon: Lock }
const INTENT_PIN_TOOL: ToolDef = { key: 'INTENT_PIN', label: 'Intent Pin', Icon: MapPin }

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
  // Departments layer: same draw tools, plus the Dept tool (gated separately in ToolBtn).
  DEPARTMENTS: new Set<ToolMode>(DRAW_TOOLS),
  // Rooms layer: parametric (panel-driven), plus Edit to nudge room corners, Erase to delete a
  // wall (merging the two same-department rooms it divides), and Scribble / Text to annotate.
  ROOMS: new Set<ToolMode>(['PAN', 'VECTOR', 'ERASE', 'DRAW', 'TEXT']),
  // Intent layer: same draw tools, plus the Intent Pin (gated separately in ToolBtn).
  INTENT: new Set<ToolMode>(DRAW_TOOLS),
}

function ToolBtn({ tool }: { tool: ToolDef }) {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const setTool = useDrawingStore((s) => s.setTool)
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const { key, label, Icon } = tool
  const active = toolMode === key
  const allowed = LAYER_ENABLED_TOOLS[activeLayer]
  // The Dept tool unlocks only on the Departments layer; the Intent Pin and the Lock tool only
  // on the Rooms layer — disabled (greyed) in every other stage. All remaining tools follow the
  // per-layer allowlist (absent layer ⇒ all enabled).
  const disabled =
    key === 'INTENT_PIN' || key === 'LASSO_LOCK'
      ? activeLayer !== 'ROOMS'
      : key === 'DEPT'
        ? activeLayer !== 'DEPARTMENTS'
        : allowed != null && !allowed.has(key)
  // (The intent concentration-grid preview now lives on hover of the contextual "Adjust" button.)
  return (
    <button
      type="button"
      className={`rail-btn${active ? ' is-active' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      title={disabled ? `${label} — not available in this layer` : label}
      onClick={() => setTool(key)}
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

/** Program Sheet — a SUBTLE pill button (not a drawing tool): it opens the space-programming
 *  grid panel, so it's styled distinctly from the tool buttons. Sits after Export. */
function ProgramSheetButton() {
  const view = useProgramSheet((s) => s.view)
  const toggle = useProgramSheet((s) => s.toggle)
  return (
    <button
      type="button"
      className={`rail-sheet-btn${view !== 'closed' ? ' is-open' : ''}`}
      aria-pressed={view !== 'closed'}
      title="Program Sheet — space programming grid"
      onClick={() => toggle()}
    >
      <Table size={14} strokeWidth={1.9} />
      <span>Program Sheet</span>
    </button>
  )
}

export function Ribbon() {
  return (
    <div className="toolbar-rail">
      {GROUP_NAV.map((t) => <ToolBtn key={t.key} tool={t} />)}

      <div className="rail-sep" />
      {GROUP_DRAW.map((t) => <ToolBtn key={t.key} tool={t} />)}

      {/* Dept is fenced by separators on BOTH sides (unlocks only on the Departments layer). */}
      <div className="rail-sep" />
      <ToolBtn tool={{ key: 'DEPT', label: 'Dept', Icon: Building2 }} />
      <div className="rail-sep" />

      {/* Lock then Intent Pin (both Rooms-only, gated in ToolBtn). */}
      <ToolBtn tool={LOCK_TOOL} />
      <ToolBtn tool={INTENT_PIN_TOOL} />

      {/* | then Export, then the subtle Program Sheet pill. */}
      <div className="rail-sep" />
      <ExportDropdown />
      <ProgramSheetButton />
    </div>
  )
}
