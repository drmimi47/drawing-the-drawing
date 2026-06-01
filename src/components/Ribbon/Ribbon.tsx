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
  Upload,
  Trash2,
  FileCode,
  Image as ImageIcon,
  FileText,
  Map as MapIcon,
  Sparkles,
} from 'lucide-react'
import { useDrawingStore, type ToolMode } from '../../store/drawingStore'
import { importUnderlay } from '../../io/importUnderlay'
import { exportSVG, exportPNG, exportPDF } from '../../io/exportDrawing'
import './Ribbon.css'

/**
 * Compact single-row tool rail.
 *
 * Replaces the two-row Word/Revit ribbon with a ~46px horizontal strip.
 * Tools are grouped by workflow stage with thin separators. Import and Color
 * open floating panels; every other button is a direct tool toggle.
 *
 * Layout: [Import▼] | Draw Poly Pan Erase Text | Marquee Lasso Edit Lock | IntentPin | [Color▼] | ─── | Generate
 */

interface ToolDef {
  key: ToolMode
  label: string
  Icon: typeof Pencil
}

const SKETCH_TOOLS: ToolDef[] = [
  { key: 'DRAW', label: 'Draw', Icon: Pencil },
  { key: 'POLYLINE', label: 'Polyline', Icon: Spline },
  { key: 'PAN', label: 'Pan', Icon: Hand },
  { key: 'ERASE', label: 'Erase', Icon: Eraser },
  { key: 'TEXT', label: 'Text', Icon: Type },
]

const NORMALIZE_TOOLS: ToolDef[] = [
  { key: 'SELECT', label: 'Marquee', Icon: BoxSelect },
  { key: 'LASSO', label: 'Lasso', Icon: Lasso },
  { key: 'VECTOR', label: 'Edit', Icon: MousePointer2 },
  { key: 'LASSO_LOCK', label: 'Lock', Icon: Lock },
]

const PRESET_COLORS = ['#1a1a1a', '#e23b3b', '#2f6fed', '#1f9d55', '#e8852b']

function ToolBtn({ tool }: { tool: ToolDef }) {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const setTool = useDrawingStore((s) => s.setTool)
  const setShowIntentLabels = useDrawingStore((s) => s.setShowIntentLabels)
  const { key, label, Icon } = tool
  const active = toolMode === key
  return (
    <button
      type="button"
      className={`rail-btn${active ? ' is-active' : ''}`}
      aria-pressed={active}
      title={label}
      onClick={() => setTool(key)}
      onMouseEnter={key === 'INTENT_PIN' ? () => setShowIntentLabels(true) : undefined}
      onMouseLeave={key === 'INTENT_PIN' ? () => setShowIntentLabels(false) : undefined}
    >
      <Icon size={16} strokeWidth={1.75} />
      <span className="rail-btn-label">{label}</span>
    </button>
  )
}

function ImportDropdown() {
  const setUnderlay = useDrawingStore((s) => s.setUnderlay)
  const clearUnderlay = useDrawingStore((s) => s.clearUnderlay)
  const hasUnderlay = useDrawingStore((s) => s.underlay !== null)
  const mapActive = useDrawingStore((s) => s.mapActive)
  const toggleMap = useDrawingStore((s) => s.toggleMap)
  const fileRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { src, width, height } = await importUnderlay(file)
      setUnderlay(src, width, height)
      setOpen(false)
    } catch (err) {
      console.error('Underlay import failed:', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={wrapRef} className="rail-dropdown-wrap">
      <button
        type="button"
        className={`rail-btn${open ? ' is-active' : ''}`}
        title="Import / Export / Map"
        onClick={() => setOpen((o) => !o)}
      >
        <Upload size={16} strokeWidth={1.75} />
        <span className="rail-btn-label">Import</span>
      </button>

      {open && (
        <div className="rail-float-panel">
          <div className="rail-float-label">Underlay</div>
          <button
            type="button"
            className="rail-float-item"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload size={13} strokeWidth={1.75} />
            {busy ? 'Loading…' : 'Import file'}
          </button>
          <button
            type="button"
            className="rail-float-item"
            onClick={clearUnderlay}
            disabled={!hasUnderlay}
          >
            <Trash2 size={13} strokeWidth={1.75} />
            Remove underlay
          </button>

          <div className="rail-float-divider" />
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

          <div className="rail-float-divider" />
          <div className="rail-float-label">Geospatial</div>
          <button
            type="button"
            className={`rail-float-item${mapActive ? ' is-active' : ''}`}
            aria-pressed={mapActive}
            onClick={() => { toggleMap(); setOpen(false) }}
          >
            <MapIcon size={13} strokeWidth={1.75} />
            {mapActive ? 'Close map' : 'Open map'}
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            onChange={onFile}
            style={{ display: 'none' }}
          />
        </div>
      )}
    </div>
  )
}

function ColorDropdown() {
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const setColor = useDrawingStore((s) => s.setColor)
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
        title="Stroke color"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="rail-color-dot" style={{ background: strokeColor }} />
        <span className="rail-btn-label">Color</span>
      </button>

      {open && (
        <div className="rail-float-panel">
          <div className="rail-float-swatches">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`rail-swatch${strokeColor === color ? ' is-active' : ''}`}
                style={{ background: color }}
                title={color}
                aria-label={`Color ${color}`}
                aria-pressed={strokeColor === color}
                onClick={() => { setColor(color); setOpen(false) }}
              />
            ))}
            <label className="rail-swatch rail-swatch-custom" title="Custom color">
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Custom stroke color"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

export function Ribbon() {
  return (
    <div className="toolbar-rail">
      <ImportDropdown />

      <div className="rail-sep" />
      {SKETCH_TOOLS.map((t) => <ToolBtn key={t.key} tool={t} />)}

      <div className="rail-sep" />
      {NORMALIZE_TOOLS.map((t) => <ToolBtn key={t.key} tool={t} />)}

      <div className="rail-sep" />
      <ToolBtn tool={{ key: 'INTENT_PIN', label: 'Intent Pin', Icon: MapPin }} />

      <div className="rail-sep" />
      <ColorDropdown />

      <div className="rail-spacer" />

      <button type="button" className="rail-btn rail-generate" disabled title="Phase 2 — coming soon">
        <Sparkles size={16} strokeWidth={1.75} />
        <span className="rail-btn-label">Generate</span>
      </button>
    </div>
  )
}
