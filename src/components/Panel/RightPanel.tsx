import { useMemo, useRef, useState } from 'react'
import { Map as MapIcon, Square, Upload, Lock, Trash2, Grid3x3, MapPin } from 'lucide-react'
import { useDrawingStore, type PipelineLayer, type ToolMode, type GridType } from '../../store/drawingStore'
import { polygonAreaWorld, worldAreaToSqft, formatArea } from '../../geometry/area'
import { computeDepartmentAreas, type DeptAreas } from '../../geometry/departmentAreas'
import { FIXED_COLOR_DEPT_TYPES } from '../../types/geometry'
import { importUnderlay } from '../../io/importUnderlay'
import './RightPanel.css'

/**
 * Right-panel "Layer Hierarchy" (Gradia restructure — Foundation A).
 *
 *   (1) LAYER NAVIGATOR — the pipeline as a revisitable vertical stack. Clicking a
 *       layer activates it (and its default tool); switching layers is what
 *       locks/freezes earlier work, so there is no separate constraints panel.
 *   (2) ACTIVE-LAYER CONTROLS — controls for the current layer (Context substrate;
 *       Stage-1 boundary area + advisory delta; Stage-2 circulation width).
 */

const LAYERS: { key: PipelineLayer; label: string; n: number }[] = [
  { key: 'CONTEXT', label: 'Context', n: 0 },
  { key: 'BOUNDARY', label: 'Lot Boundary', n: 1 },
  { key: 'CIRCULATION', label: 'Circulation', n: 2 },
  { key: 'DEPARTMENTS', label: 'Departments', n: 3 },
  { key: 'ROOMS', label: 'Rooms', n: 4 },
  // PARKED layers (not shown): INTENT — the standalone abstract-intent layer; intent now lives
  // inside each department as its "grain". GENERATE — the deferred LLM pass. Their code stays
  // dormant; re-add a row here (e.g. { key: 'INTENT', label: 'Intent', n: 5 }) to revive one.
]

/** The tool each layer activates on entry (so the wizard hands the right tool). */
const LAYER_TOOL: Partial<Record<PipelineLayer, ToolMode>> = {
  CONTEXT: 'PAN', // map-setup only; creation tools are disabled in this layer
  BOUNDARY: 'POLYLINE',
  CIRCULATION: 'POLYLINE',
  DEPARTMENTS: 'DEPT', // the Departments layer hands the (now-unlocked) Dept tool
  ROOMS: 'ERASE', // default to Erase so the user can immediately delete walls (merge rooms)
}

/** Layers whose stage isn't implemented yet (scaffold only). Empty now that Generate is gone. */
const NOT_YET = new Set<PipelineLayer>()

/** Pipeline index of the Rooms layer (it + everything after need full department coverage). */
const ROOMS_N = 4
/** Department gradients must cover at least this fraction of the lot infill before the Rooms
 *  layer unlocks — room generation is informed by department coverage, so a mostly-bare lot
 *  would mis-inform it. 0.85 leaves some slack so a few uncovered corners don't block entry. */
const DEPT_COVERAGE_MIN = 0.85

export function RightPanel() {
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const setActiveLayer = useDrawingStore((s) => s.setActiveLayer)
  const setTool = useDrawingStore((s) => s.setTool)
  const context = useDrawingStore((s) => s.context)
  const setContext = useDrawingStore((s) => s.setContext)
  const boundary = useDrawingStore((s) => s.boundary)
  const circulationPaths = useDrawingStore((s) => s.circulationPaths)
  const departments = useDrawingStore((s) => s.departments)
  const rooms = useDrawingStore((s) => s.rooms)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)
  const maxLayerReached = useDrawingStore((s) => s.maxLayerReached)
  const sheetName = useDrawingStore((s) => s.sheetName)

  // Department footprint diagnostics (areas + lot coverage). Computed once here and shared
  // with DepartmentControls; coverage gates the Rooms unlock (the entire lot infill must be
  // under a gradient before room generation can run on accurate department coverage).
  const deptDiag = useMemo(() => {
    const mainPaths = circulationPaths.filter((p) => p.tier !== 'MINOR')
    return computeDepartmentAreas(boundary, mainPaths, departments, mpu)
  }, [boundary, circulationPaths, departments, mpu])
  const deptCoverageComplete = departments.length > 0 && deptDiag.coverage >= DEPT_COVERAGE_MIN

  const layerStatus = (key: PipelineLayer): string => {
    if (key === 'CONTEXT') return context ? (context === 'MAP' ? 'Map underlay' : 'Blank sheet') : 'Choose a substrate'
    if (key === 'BOUNDARY')
      return boundary ? (boundary.isClosed === false ? 'Incomplete' : 'Defined') : 'Not defined'
    if (key === 'CIRCULATION')
      return circulationPaths.length ? `${circulationPaths.length} path${circulationPaths.length > 1 ? 's' : ''}` : 'None yet'
    if (key === 'DEPARTMENTS')
      return departments.length ? `${departments.length} zone${departments.length > 1 ? 's' : ''}` : 'None yet'
    if (key === 'ROOMS')
      return rooms.length ? `${rooms.length} room${rooms.length > 1 ? 's' : ''}` : 'None yet'
    return NOT_YET.has(key) ? 'Coming soon' : ''
  }

  const selectLayer = (key: PipelineLayer) => {
    setActiveLayer(key)
    const t = LAYER_TOOL[key]
    if (t) setTool(t)
  }

  return (
    <aside className="right-panel" aria-label="Layer hierarchy and constraints">
      {/* The layer hierarchy below belongs to the ACTIVE board — each board keeps its
          own independent layer memory. */}
      <div className="right-panel-section board-header">
        <h2 className="board-name" title={sheetName}>{sheetName}</h2>
      </div>

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
            //   • EVERY layer after Lot Boundary stays locked until a *complete closed*
            //     boundary exists. Erasing a boundary segment opens the ring (isClosed
            //     false), which re-locks them until the lot is re-closed.
            const boundaryComplete = boundary != null && boundary.isClosed !== false
            // Rooms (and everything after) also require the department gradients to fully
            // cover the lot infill — partial coverage would mis-inform room generation.
            const coverageBlocked = n >= ROOMS_N && !deptCoverageComplete
            const locked =
              n > maxLayerReached + 1 ||
              (key === 'BOUNDARY' && context == null) ||
              (n >= LAYERS[1].n + 1 && !boundaryComplete) ||
              coverageBlocked
            // When the only thing blocking is coverage, say so (with the current %).
            const coverageOnly =
              coverageBlocked && n <= maxLayerReached + 1 && boundaryComplete && context != null
            const lockTitle = coverageOnly
              ? `Cover the whole lot with department gradients to unlock (currently ${Math.round(
                  deptDiag.coverage * 100,
                )}%)`
              : locked
                ? 'Complete the earlier steps first'
                : label
            const lockedStatus =
              coverageOnly && key === 'ROOMS' ? `Cover lot — ${Math.round(deptDiag.coverage * 100)}%` : 'Locked'
            return (
              <li key={key}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={locked}
                  className={`layer-row${active ? ' is-active' : ''}${future ? ' is-future' : ''}${locked ? ' is-locked' : ''}`}
                  title={lockTitle}
                  onClick={() => !locked && selectLayer(key)}
                >
                  <span className="layer-index">{locked ? <Lock size={11} strokeWidth={2.5} /> : n}</span>
                  <span className="layer-text">
                    <span className="layer-label">{label}</span>
                    <span className="layer-status">{locked ? lockedStatus : layerStatus(key)}</span>
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
      {activeLayer === 'DEPARTMENTS' && (
        <DepartmentControls areas={deptDiag.areas} coverage={deptDiag.coverage} covered={deptCoverageComplete} />
      )}
      {activeLayer === 'ROOMS' && <RoomControls />}
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
            Pan/zoom to frame the site; moving to Lot Boundary freezes it for tracing.
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
  const fitToTarget = useDrawingStore((s) => s.fitBoundaryToTarget)
  const clearBoundary = useDrawingStore((s) => s.clearBoundary)
  const infillOpacity = useDrawingStore((s) => s.boundaryInfillOpacity)
  const setInfillOpacity = useDrawingStore((s) => s.setBoundaryInfillOpacity)
  const lotGridSpacing = useDrawingStore((s) => s.lotGridSpacing)
  const setLotGridSpacing = useDrawingStore((s) => s.setLotGridSpacing)
  const lotGridSeams = useDrawingStore((s) => s.lotGridSeams)
  const clearLotGridSeams = useDrawingStore((s) => s.clearLotGridSeams)

  if (!boundary) {
    return (
      <div className="right-panel-section">
        <h2 className="right-panel-heading">Lot Boundary</h2>
        <p className="right-panel-empty">
          Trace a closed boundary with the Polyline tool; close the loop to commit.
        </p>
      </div>
    )
  }

  // The segment eraser opened the ring — downstream layers are re-locked until the
  // lot is re-closed (redraw it with the Polyline tool and close the loop).
  if (boundary.isClosed === false) {
    return (
      <div className="right-panel-section">
        <h2 className="right-panel-heading">Lot Boundary</h2>
        <div className="delta-readout" style={{ borderLeftColor: '#dc2626' }}>
          <span className="metric-label" style={{ color: '#dc2626' }}>Boundary incomplete</span>
        </div>
        <p className="right-panel-hint">
          A segment was erased, so the lot is open. Bridge the gap with the Polyline tool, or
          redraw and close the loop, to re-enable the later layers (Ctrl+Z undoes the erase).
        </p>
        <button type="button" className="panel-btn panel-btn--danger" onClick={clearBoundary}>
          <Trash2 size={14} strokeWidth={2} /> Clear &amp; redraw
        </button>
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

      <GridToggle />

      <div className="metric-row">
        <span className="metric-label">Current</span>
        <span className="metric-value">{formatArea(current)} {unit}</span>
      </div>
      {!hasScale && <p className="right-panel-hint">No map scale — showing world units. Use a Map context for real ft².</p>}

      <label className="field">
        <span className="field-label">Infill opacity — {Math.round(infillOpacity * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={infillOpacity}
          onChange={(e) => setInfillOpacity(Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span className="field-label">Grid spacing — {lotGridSpacing}</span>
        <input
          type="range"
          min={12}
          max={160}
          step={4}
          value={lotGridSpacing}
          onChange={(e) => setLotGridSpacing(Number(e.target.value))}
        />
      </label>
      <p className="right-panel-hint">
        A grid is auto-fit to the lot. Draw a <strong>seam</strong> (Polyline, vertex to vertex)
        to split it — each region gets its own best-fit grid.
        {lotGridSeams.length > 0 && ` (${lotGridSeams.length} seam${lotGridSeams.length > 1 ? 's' : ''})`}
      </p>
      {lotGridSeams.length > 0 && (
        <button type="button" className="panel-btn panel-btn--danger" onClick={clearLotGridSeams}>
          <Trash2 size={14} strokeWidth={2} /> Clear seams
        </button>
      )}

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
          // Commit on Enter / blur — fits the lot to the typed target in one undo step
          // (avoids re-scaling on every keystroke of a multi-digit number).
          onBlur={() => fitToTarget()}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
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
        Set a target to fit the lot on Enter/blur; while set, dragging a corner holds the area
        locked. Clear it to edit freely.
      </p>

      <button type="button" className="panel-btn panel-btn--danger" onClick={clearBoundary}>
        <Trash2 size={14} strokeWidth={2} /> Clear &amp; redraw
      </button>
    </div>
  )
}

// ─── Stage 3 — department zones ──────────────────────────────────────────────

function DepartmentControls({
  areas,
  coverage,
  covered,
}: {
  areas: Record<string, DeptAreas>
  coverage: number
  covered: boolean
}) {
  const departments = useDrawingStore((s) => s.departments)
  const boundary = useDrawingStore((s) => s.boundary)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)
  const rename = useDrawingStore((s) => s.renameDepartment)
  const setColor = useDrawingStore((s) => s.setDepartmentColor)
  const setTarget = useDrawingStore((s) => s.setDepartmentTarget)
  const remove = useDrawingStore((s) => s.removeDepartment)

  const unit = mpu != null && mpu > 0 ? 'ft²' : 'units²'
  const boundaryReady = boundary != null && boundary.isClosed !== false

  return (
    <div className="right-panel-section">
      <h2 className="right-panel-heading">Departments</h2>

      <GridToggle />

      {!boundaryReady ? (
        <p className="right-panel-empty">
          Define a closed lot boundary first — zones are placed inside it.
        </p>
      ) : departments.length === 0 ? (
        <p className="right-panel-empty">
          Drop a zone with the Dept tool and drag to size it. Fields stay inside the lot and
          off MAIN corridors.
        </p>
      ) : (
        <ul className="dept-list">
          {departments.map((d) => {
            const a = areas[d.id]
            const core = a?.coreSqf ?? 0
            const max = a?.maxSqf ?? 0
            const negotiable = Math.max(0, max - core)
            const over = d.targetSqf != null && d.targetSqf > 0 && max < d.targetSqf
            const colorLocked = d.deptType != null && FIXED_COLOR_DEPT_TYPES.has(d.deptType)
            return (
              <li key={d.id} className="dept-item">
                <div className="dept-row">
                  <input
                    type="color"
                    className="dept-swatch"
                    value={d.color}
                    disabled={colorLocked}
                    title={colorLocked ? `${d.name} color is fixed` : 'Zone color'}
                    onChange={(e) => setColor(d.id, e.target.value)}
                  />
                  <input
                    type="text"
                    className="dept-name"
                    value={d.name}
                    aria-label="Department name"
                    onChange={(e) => rename(d.id, e.target.value)}
                  />
                  <input
                    type="number"
                    className="dept-target"
                    min={0}
                    inputMode="numeric"
                    placeholder={`Target ${unit}`}
                    value={d.targetSqf ?? ''}
                    aria-label={`Target ${unit}`}
                    onChange={(e) => {
                      const v = e.target.value
                      setTarget(d.id, v === '' ? undefined : Math.max(0, Number(v)))
                    }}
                  />
                  <button
                    type="button"
                    className="dept-del"
                    title="Delete zone"
                    onClick={() => remove(d.id)}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </div>
                {/* Dual readout (3.5.3): Core = exclusive, Max = inclusive of overlaps. */}
                <div className="dept-areas">
                  <span title="Exclusive footprint (not shared with any neighbor)">
                    Core <strong>{formatArea(core)}</strong>
                  </span>
                  <span title="Full footprint including negotiable overlap zones">
                    Max <strong>{formatArea(max)}</strong> {unit}
                  </span>
                  {negotiable > 0 && (
                    <span className="dept-negotiable" title="Overlap shared with neighboring zones">
                      ⇄ {formatArea(negotiable)}
                    </span>
                  )}
                  {over && (
                    <span className="dept-over" title="Max potential is below the target area">
                      under target
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {boundaryReady && departments.length > 0 && (
        <div className={`dept-coverage${covered ? ' is-complete' : ''}`}>
          <div className="dept-coverage-row">
            <span>Lot coverage</span>
            <strong>{Math.round(coverage * 100)}%</strong>
          </div>
          <div className="dept-coverage-bar">
            <span style={{ width: `${Math.min(100, Math.round(coverage * 100))}%` }} />
          </div>
          <p className="right-panel-hint">
            {covered
              ? 'The whole lot is covered — Rooms is unlocked.'
              : 'Cover the whole lot with gradients (no white left) to unlock Rooms.'}
          </p>
        </div>
      )}

      {boundaryReady && (
        <p className="right-panel-hint">
          Zones overlap freely; only the boundary and MAIN corridors are hard limits.{' '}
          <strong>Core</strong> = owned exclusively, <strong>Max</strong> = incl. shared overlap (⇄).
        </p>
      )}
    </div>
  )
}

// ─── Stage 4 — parametric room subdivision ───────────────────────────────────

/** Show/hide the lot structural grid — shared across the Boundary, Circulation, Departments, and
 *  Rooms layers (it renders on all of them). Hidden until the lot is a closed ring. */
function GridToggle() {
  const boundary = useDrawingStore((s) => s.boundary)
  const gridVisible = useDrawingStore((s) => s.lotGridVisible)
  const setGridVisible = useDrawingStore((s) => s.setLotGridVisible)
  if (!boundary || boundary.isClosed === false || boundary.ring.length < 3) return null
  return (
    <button
      type="button"
      className={`panel-btn panel-btn--toggle${gridVisible ? ' is-active' : ''}`}
      aria-pressed={gridVisible}
      title="Toggle the structural grid (shown on all lot layers)"
      onClick={() => setGridVisible(!gridVisible)}
    >
      <Grid3x3 size={14} strokeWidth={2} /> Structural grid {gridVisible ? 'on' : 'off'}
    </button>
  )
}

/** Show/hide the placed Intent Pins + their metaball field (Rooms layer). Appears only once at
 *  least one Intent Pin has been placed. */
function IntentPinsToggle() {
  const intentPins = useDrawingStore((s) => s.intentPins)
  const visible = useDrawingStore((s) => s.intentPinsVisible)
  const setVisible = useDrawingStore((s) => s.setIntentPinsVisible)
  if (intentPins.length === 0) return null
  return (
    <button
      type="button"
      className={`panel-btn panel-btn--toggle${visible ? ' is-active' : ''}`}
      aria-pressed={visible}
      title="Toggle the placed Intent Pins and their field"
      onClick={() => setVisible(!visible)}
    >
      <MapPin size={14} strokeWidth={2} /> Intent pins {visible ? 'on' : 'off'}
    </button>
  )
}

function RoomControls() {
  const departments = useDrawingStore((s) => s.departments)
  const rooms = useDrawingStore((s) => s.rooms)
  const setRoomCount = useDrawingStore((s) => s.setRoomCount)
  const clearRoomLocks = useDrawingStore((s) => s.clearRoomLocks)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)
  const unit = mpu != null && mpu > 0 ? 'ft²' : 'units²'

  // Completeness = share of room area the user has frozen (locked). 100% ⇒ "complete".
  const totalArea = rooms.reduce((s, r) => s + r.areaSqf, 0)
  const lockedArea = rooms.reduce((s, r) => (r.isLocked ? s + r.areaSqf : s), 0)
  const lockedCount = rooms.filter((r) => r.isLocked).length
  const lockedPct = totalArea > 0 ? lockedArea / totalArea : 0

  if (departments.length === 0) {
    return (
      <div className="right-panel-section">
        <h2 className="right-panel-heading">Rooms</h2>
        <p className="right-panel-empty">
          Add department zones first — rooms subdivide each department's footprint.
        </p>
      </div>
    )
  }

  return (
    <div className="right-panel-section">
      <h2 className="right-panel-heading">Rooms</h2>
      <GridToggle />
      <IntentPinsToggle />
      <p className="right-panel-hint">
        The structural grid sits behind the rooms; rooms are cut to each region's orientation.
      </p>
      <ul className="dept-list">
        {departments.map((d) => {
          const deptRooms = rooms.filter((r) => r.parentDeptId === d.id)
          const deptRoomCount = deptRooms.length
          const deptArea = deptRooms.reduce((sum, r) => sum + r.areaSqf, 0)
          return (
            <li key={d.id} className="dept-item">
              <div className="dept-row">
                <span
                  aria-hidden
                  style={{ width: 14, height: 14, borderRadius: '50%', background: d.color, flex: '0 0 auto' }}
                />
                <span className="dept-name" style={{ border: 'none', background: 'transparent' }}>{d.name}</span>
                <input
                  type="number"
                  className="dept-target"
                  min={0}
                  inputMode="numeric"
                  placeholder="N"
                  value={d.roomCount ?? ''}
                  title="Manual room count (overrides grain)"
                  aria-label={`${d.name} room count`}
                  onChange={(e) => {
                    const v = e.target.value
                    setRoomCount(d.id, v === '' ? 0 : Math.max(0, Number(v)))
                  }}
                />
              </div>
              <div className="dept-areas">
                <span>{deptRoomCount} room{deptRoomCount === 1 ? '' : 's'}</span>
                {deptRoomCount > 0 && (
                  <span>
                    <strong>{formatArea(deptArea)}</strong> {unit}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <div className={`dept-coverage${lockedPct >= 0.999 ? ' is-complete' : ''}`}>
        <div className="dept-coverage-row">
          <span>{lockedPct >= 0.999 ? 'Complete' : 'Locked'}</span>
          <strong>{Math.round(lockedPct * 100)}%</strong>
        </div>
        <div className="dept-coverage-bar">
          <span style={{ width: `${Math.min(100, Math.round(lockedPct * 100))}%` }} />
        </div>
        {lockedCount > 0 && (
          <button type="button" className="panel-btn panel-btn--danger" onClick={clearRoomLocks}>
            <Lock size={13} strokeWidth={2} /> Unlock all ({lockedCount})
          </button>
        )}
      </div>

      <p className="right-panel-hint">
        Drop <strong>Intent Pins</strong> (Density / Openness), then <strong>Adjust</strong> on the
        pin bar — adds rooms where Density wins, removes where Openness wins (or type N to override).
        With the <strong>Lock</strong> tool, click a room to freeze it from Adjust.
      </p>
    </div>
  )
}

// ─── Stage 2 — circulation width + paths ─────────────────────────────────────

function CirculationControls() {
  const paths = useDrawingStore((s) => s.circulationPaths)
  const mainWidth = useDrawingStore((s) => s.circulationWidth)
  const minorWidth = useDrawingStore((s) => s.circulationMinorWidth)
  const setMainWidth = useDrawingStore((s) => s.setCirculationWidth)
  const setMinorWidth = useDrawingStore((s) => s.setCirculationMinorWidth)
  const tier = useDrawingStore((s) => s.circulationTier)
  const setTier = useDrawingStore((s) => s.setCirculationTier)
  const clearCirculation = useDrawingStore((s) => s.clearCirculation)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)

  const minor = tier === 'MINOR'
  const width = minor ? minorWidth : mainWidth
  const setWidth = minor ? setMinorWidth : setMainWidth
  const hasScale = mpu != null && mpu > 0
  const widthFt = hasScale ? width * mpu * 3.28084 : null

  return (
    <div className="right-panel-section">
      <h2 className="right-panel-heading">Circulation</h2>

      <GridToggle />

      <p className="right-panel-hint">
        Polyline draws <strong>{minor ? 'minor' : 'main'}</strong> pathways — {minor
          ? 'permeable connectors; fields bleed across them.'
          : 'the structural spine; fields stop hard against them.'} Finish with Enter or double-click.
      </p>

      <div className="field">
        <span className="field-label">Pathway type</span>
        <div className="seg-group">
          <button
            type="button"
            className={`seg-btn${!minor ? ' is-active' : ''}`}
            aria-pressed={!minor}
            onClick={() => setTier('MAIN')}
          >
            Main
          </button>
          <button
            type="button"
            className={`seg-btn${minor ? ' is-active' : ''}`}
            aria-pressed={minor}
            onClick={() => setTier('MINOR')}
          >
            Minor
          </button>
        </div>
      </div>

      <label className="field">
        <span className="field-label">{minor ? 'Minor' : 'Main'} pathway width (world units)</span>
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

