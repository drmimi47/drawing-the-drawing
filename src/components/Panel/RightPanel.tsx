import { useRef, useState } from 'react'
import { Map as MapIcon, Square, Upload, Lock, Unlock, Trash2 } from 'lucide-react'
import { useDrawingStore, type PipelineLayer, type ToolMode, type GridType } from '../../store/drawingStore'
import { polygonAreaWorld, worldAreaToSqft, formatArea } from '../../geometry/area'
import { importUnderlay } from '../../io/importUnderlay'
import './RightPanel.css'

/**
 * Right-panel "Layer Hierarchy & Constraints" (Bloom restructure — Foundation A).
 *
 *   (1) LAYER NAVIGATOR — the constraint-accumulating pipeline as a revisitable
 *       vertical stack. Clicking a layer activates it (and its default tool).
 *   (2) ACTIVE-LAYER CONTROLS — controls for the current layer (Context substrate;
 *       Stage-1 boundary area + advisory delta).
 *   (3) CONSTRAINTS / AREA-LOCK — per-feature lock toggles (boundary is the first).
 */

const LAYERS: { key: PipelineLayer; label: string; n: number }[] = [
  { key: 'CONTEXT', label: 'Context', n: 0 },
  { key: 'BOUNDARY', label: 'Lot Boundary', n: 1 },
  { key: 'CIRCULATION', label: 'Circulation', n: 2 },
  { key: 'DEPARTMENTS', label: 'Departments', n: 3 },
  { key: 'ROOMS', label: 'Rooms', n: 4 },
  { key: 'GENERATE', label: 'Generate', n: 5 },
]

/** The tool each layer activates on entry (so the wizard hands the right tool). */
const LAYER_TOOL: Partial<Record<PipelineLayer, ToolMode>> = {
  CONTEXT: 'PAN', // map-setup only; creation tools are disabled in this layer
  BOUNDARY: 'POLYLINE',
  CIRCULATION: 'POLYLINE',
}

/** Layers whose stage isn't implemented yet (scaffold only). */
const NOT_YET = new Set<PipelineLayer>(['DEPARTMENTS', 'ROOMS', 'GENERATE'])

export function RightPanel() {
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const setActiveLayer = useDrawingStore((s) => s.setActiveLayer)
  const setTool = useDrawingStore((s) => s.setTool)
  const context = useDrawingStore((s) => s.context)
  const setContext = useDrawingStore((s) => s.setContext)
  const boundary = useDrawingStore((s) => s.boundary)
  const circulationPaths = useDrawingStore((s) => s.circulationPaths)
  const maxLayerReached = useDrawingStore((s) => s.maxLayerReached)

  const layerStatus = (key: PipelineLayer): string => {
    if (key === 'CONTEXT') return context ? (context === 'MAP' ? 'Map underlay' : 'Blank sheet') : 'Choose a substrate'
    if (key === 'BOUNDARY') return boundary ? (boundary.isLocked ? 'Locked' : 'Defined') : 'Not defined'
    if (key === 'CIRCULATION')
      return circulationPaths.length ? `${circulationPaths.length} path${circulationPaths.length > 1 ? 's' : ''}` : 'None yet'
    return NOT_YET.has(key) ? 'Coming soon' : ''
  }

  const selectLayer = (key: PipelineLayer) => {
    setActiveLayer(key)
    const t = LAYER_TOOL[key]
    if (t) setTool(t)
  }

  return (
    <aside className="right-panel" aria-label="Layer hierarchy and constraints">
      <div className="right-panel-section">
        <h2 className="right-panel-heading">Layers</h2>
        <ul className="layer-list" role="tablist" aria-orientation="vertical">
          {LAYERS.map(({ key, label, n }) => {
            const active = activeLayer === key
            const future = NOT_YET.has(key)
            // Sequential unlock: reachable layers are those already reached plus the
            // immediate next one; everything beyond is locked (greyed) until reached.
            // Two stage gates beyond the sequential rule:
            //   • Lot Boundary stays locked until a substrate (Map / Blank / Import)
            //     is chosen in the Context layer — nothing to draw a boundary on yet.
            //   • Circulation stays locked until a *closed* boundary exists (an open
            //     polyline never commits to state.boundary, so it can't unlock it).
            const locked =
              n > maxLayerReached + 1 ||
              (key === 'BOUNDARY' && context == null) ||
              (key === 'CIRCULATION' && boundary == null)
            return (
              <li key={key}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={locked}
                  className={`layer-row${active ? ' is-active' : ''}${future ? ' is-future' : ''}${locked ? ' is-locked' : ''}`}
                  title={locked ? 'Complete the earlier steps first' : label}
                  onClick={() => !locked && selectLayer(key)}
                >
                  <span className="layer-index">{locked ? <Lock size={11} strokeWidth={2.5} /> : n}</span>
                  <span className="layer-text">
                    <span className="layer-label">{label}</span>
                    <span className="layer-status">{locked ? 'Locked' : layerStatus(key)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {activeLayer === 'CONTEXT' && <ContextControls context={context} setContext={setContext} />}
      {activeLayer === 'BOUNDARY' && <BoundaryControls />}
      {activeLayer === 'CIRCULATION' && <CirculationControls />}

      <ConstraintsSection />
    </aside>
  )
}

// ─── Context substrate choice (Stage 0) ──────────────────────────────────────

function ContextControls({
  context,
  setContext,
}: {
  context: 'MAP' | 'BLANK' | null
  setContext: (c: 'MAP' | 'BLANK') => void
}) {
  const setUnderlay = useDrawingStore((s) => s.setUnderlay)
  const clearUnderlay = useDrawingStore((s) => s.clearUnderlay)
  const setUnderlayOpacity = useDrawingStore((s) => s.setUnderlayOpacity)
  const underlay = useDrawingStore((s) => s.underlay)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { src, width, height } = await importUnderlay(file)
      setUnderlay(src, width, height)
      // An imported reference is traced on a blank artboard (no live map).
      setContext('BLANK')
    } catch (err) {
      console.error('Underlay import failed:', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="right-panel-section">
      <h2 className="right-panel-heading">Substrate</h2>
      <div className="context-choice">
        <button
          type="button"
          className={`context-option${context === 'MAP' ? ' is-active' : ''}`}
          onClick={() => { clearUnderlay(); setContext('MAP') }}
        >
          <MapIcon size={18} strokeWidth={1.75} />
          <span>Map</span>
          <small>Trace a real site over Mapbox</small>
        </button>
        <button
          type="button"
          className={`context-option${context === 'BLANK' && !underlay ? ' is-active' : ''}`}
          onClick={() => { clearUnderlay(); setContext('BLANK') }}
        >
          <Square size={18} strokeWidth={1.75} />
          <span>Blank sheet</span>
          <small>Untethered white artboard</small>
        </button>
        <button
          type="button"
          className={`context-option${underlay ? ' is-active' : ''}`}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload size={18} strokeWidth={1.75} />
          <span>{busy ? 'Loading…' : 'Import'}</span>
          <small>Trace over an image or PDF</small>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        onChange={onFile}
        style={{ display: 'none' }}
      />

      {context === 'MAP' && (
        <>
          <MapDimControl />
          <p className="right-panel-hint">
            Pan/zoom to frame the site here. Moving to the Lot Boundary layer freezes
            the map so you can trace over it.
          </p>
        </>
      )}

      {context === 'BLANK' && !underlay && <GridControl />}

      {underlay && (
        <>
          <label className="field">
            <span className="field-label">Underlay opacity — {Math.round(underlay.opacity * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={underlay.opacity}
              onChange={(e) => setUnderlayOpacity(Number(e.target.value))}
            />
          </label>
          <button type="button" className="panel-btn panel-btn--danger" onClick={clearUnderlay}>
            <Trash2 size={14} strokeWidth={2} /> Remove underlay
          </button>
        </>
      )}
    </div>
  )
}

/** Map underlay dimmer slider (shown whenever a map substrate is active). */
function MapDimControl() {
  const dim = useDrawingStore((s) => s.mapDim)
  const setDim = useDrawingStore((s) => s.setMapDim)
  return (
    <label className="field">
      <span className="field-label">Map dim — {Math.round(dim * 100)}%</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={dim}
        onChange={(e) => setDim(Number(e.target.value))}
      />
    </label>
  )
}

/** Blank-sheet grid lattice + spacing (appears where Map dim does for a map). */
function GridControl() {
  const gridType = useDrawingStore((s) => s.gridType)
  const setGridType = useDrawingStore((s) => s.setGridType)
  const gridSpacing = useDrawingStore((s) => s.gridSpacing)
  const setGridSpacing = useDrawingStore((s) => s.setGridSpacing)

  const types: { key: GridType; label: string }[] = [
    { key: 'none', label: 'None' },
    { key: 'square', label: 'Square' },
    { key: 'triangle', label: 'Triangle' },
    { key: 'dots', label: 'Dots' },
  ]
  // Common planning modules; 32 is the urban-planning default (32-unit blocks).
  const presets = [8, 16, 32, 64]

  return (
    <>
      <div className="field">
        <span className="field-label">Grid type</span>
        <div className="seg-group">
          {types.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`seg-btn${gridType === t.key ? ' is-active' : ''}`}
              aria-pressed={gridType === t.key}
              onClick={() => setGridType(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {gridType !== 'none' && (
        <>
          <label className="field">
            <span className="field-label">Grid spacing (world units)</span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={gridSpacing}
              onChange={(e) => setGridSpacing(Number(e.target.value) || 1)}
            />
          </label>
          <div className="seg-group">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                className={`seg-btn${gridSpacing === p ? ' is-active' : ''}`}
                onClick={() => setGridSpacing(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="right-panel-hint">32-unit modules suit urban-planning blocks.</p>
        </>
      )}
    </>
  )
}

// ─── Stage 1 — boundary area + advisory delta ────────────────────────────────

function BoundaryControls() {
  const boundary = useDrawingStore((s) => s.boundary)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)
  const setTargetSqf = useDrawingStore((s) => s.setBoundaryTargetSqf)
  const clearBoundary = useDrawingStore((s) => s.clearBoundary)

  if (!boundary) {
    return (
      <div className="right-panel-section">
        <h2 className="right-panel-heading">Lot Boundary</h2>
        <p className="right-panel-empty">
          Use the Polyline tool to trace a closed boundary over the map, then close
          the loop to commit it.
        </p>
      </div>
    )
  }

  const hasScale = mpu != null && mpu > 0
  const worldArea = polygonAreaWorld(boundary.ring)
  const current = hasScale ? worldAreaToSqft(worldArea, mpu) : worldArea
  const unit = hasScale ? 'ft²' : 'units²'
  const target = boundary.targetSqf
  const delta = target != null ? current - target : null
  const pct = target != null && target > 0 ? (delta! / target) * 100 : null

  return (
    <div className="right-panel-section">
      <h2 className="right-panel-heading">Lot Boundary</h2>

      <div className="metric-row">
        <span className="metric-label">Current</span>
        <span className="metric-value">{formatArea(current)} {unit}</span>
      </div>
      {!hasScale && <p className="right-panel-hint">No map scale — showing world units. Use a Map context for real ft².</p>}

      <label className="field">
        <span className="field-label">Target {unit}</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="e.g. 45000"
          value={target ?? ''}
          onChange={(e) => {
            const v = e.target.value
            setTargetSqf(v === '' ? undefined : Math.max(0, Number(v)))
          }}
        />
      </label>

      {delta != null && (
        <div className={`delta-readout${Math.abs(pct ?? 0) < 1 ? ' is-ok' : ''}`}>
          <span className="metric-label">Δ to target</span>
          <span className="metric-value">
            {delta >= 0 ? '+' : ''}{formatArea(delta)} {unit}
            {pct != null && <em> ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</em>}
          </span>
        </div>
      )}
      <p className="right-panel-hint">
        Advisory only — pull boundary vertices on the map until Δ → 0 (true map scale
        is preserved; the boundary is never auto-scaled).
      </p>

      <button
        type="button"
        className="panel-btn panel-btn--danger"
        disabled={boundary.isLocked}
        onClick={clearBoundary}
      >
        <Trash2 size={14} strokeWidth={2} /> Clear &amp; redraw
      </button>
    </div>
  )
}

// ─── Stage 2 — circulation width + paths ─────────────────────────────────────

function CirculationControls() {
  const paths = useDrawingStore((s) => s.circulationPaths)
  const width = useDrawingStore((s) => s.circulationWidth)
  const setWidth = useDrawingStore((s) => s.setCirculationWidth)
  const clearCirculation = useDrawingStore((s) => s.clearCirculation)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)

  const hasScale = mpu != null && mpu > 0
  const widthFt = hasScale ? width * mpu * 3.28084 : null

  return (
    <div className="right-panel-section">
      <h2 className="right-panel-heading">Circulation</h2>

      {paths.length === 0 && (
        <p className="right-panel-empty">
          Use the Polyline tool to draw hallway centerlines; each is auto-offset to
          the corridor width below. Finish a path with Enter or a double-click.
        </p>
      )}

      <label className="field">
        <span className="field-label">Corridor width (world units)</span>
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={width}
          onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
      {widthFt != null && <p className="right-panel-hint">≈ {widthFt.toFixed(1)} ft at the current map scale.</p>}

      {paths.length > 0 && (
        <>
          <div className="metric-row">
            <span className="metric-label">Paths</span>
            <span className="metric-value">{paths.length}</span>
          </div>
          <button type="button" className="panel-btn panel-btn--danger" onClick={clearCirculation}>
            <Trash2 size={14} strokeWidth={2} /> Clear unlocked
          </button>
        </>
      )}
    </div>
  )
}

// ─── Constraints / Area-Lock (Foundation A) ──────────────────────────────────

function ConstraintsSection() {
  const boundary = useDrawingStore((s) => s.boundary)
  const setBoundaryLocked = useDrawingStore((s) => s.setBoundaryLocked)
  const circulationPaths = useDrawingStore((s) => s.circulationPaths)
  const setCirculationLocked = useDrawingStore((s) => s.setCirculationLocked)

  const circLocked = circulationPaths.length > 0 && circulationPaths.every((p) => p.isLocked)
  const hasFeatures = boundary != null || circulationPaths.length > 0

  return (
    <div className="right-panel-section right-panel-section--grow">
      <h2 className="right-panel-heading">
        <Lock size={13} strokeWidth={2} /> Constraints
      </h2>

      {!hasFeatures ? (
        <p className="right-panel-empty">
          Lockable features (boundary, corridors, departments, rooms) appear here as
          you build each layer.
        </p>
      ) : (
        <ul className="constraint-list">
          {boundary && (
            <li className={`constraint-row${boundary.isLocked ? ' is-locked' : ''}`}>
              <span className="constraint-name">Lot Boundary</span>
              <button
                type="button"
                className="lock-toggle"
                aria-pressed={boundary.isLocked ?? false}
                title={boundary.isLocked ? 'Unlock boundary' : 'Lock boundary (freeze as anchor)'}
                onClick={() => setBoundaryLocked(!boundary.isLocked)}
              >
                {boundary.isLocked ? <Lock size={15} strokeWidth={2} /> : <Unlock size={15} strokeWidth={2} />}
              </button>
            </li>
          )}
          {circulationPaths.length > 0 && (
            <li className={`constraint-row${circLocked ? ' is-locked' : ''}`}>
              <span className="constraint-name">Circulation ({circulationPaths.length})</span>
              <button
                type="button"
                className="lock-toggle"
                aria-pressed={circLocked}
                title={circLocked ? 'Unlock all corridors' : 'Lock all corridors'}
                onClick={() => setCirculationLocked(!circLocked)}
              >
                {circLocked ? <Lock size={15} strokeWidth={2} /> : <Unlock size={15} strokeWidth={2} />}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
