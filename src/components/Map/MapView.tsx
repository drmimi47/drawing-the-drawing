import { type CSSProperties, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import * as turf from '@turf/turf'
import {
  SnapPolygonMode,
  SnapLineMode,
  SnapPointMode,
  SnapDirectSelect,
  SnapModeDrawStyles,
} from 'mapbox-gl-draw-snap-mode'
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import { mercatorMetersPerWorldUnit } from '../../geometry/geoScale'
import { artboardScreenRect } from '../../utils/viewport'
import './MapView.css'

/**
 * Mapbox map overlay (geospatial mode), confined to the canvas container.
 *
 * Self-contained: it mounts only while `mapActive`, owns the Mapbox GL JS map +
 * a snap-enabled MapboxDraw instance, computes live Turf.js measurements, and
 * publishes finalized geometry to the store as GeoJSON. Unmounting tears the map
 * down cleanly, returning the user to the standard canvas.
 *
 * The access token comes from the VITE_MAPBOX_TOKEN env var (never hardcoded).
 */

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const SQM_TO_SQFT = 10.7639
const SQM_TO_ACRE = 1 / 4046.8564224
const M_TO_FT = 3.28084

interface Metric {
  label: string
  value: string
}

/** Live measurement for a single drawn feature, or null if not measurable. */
function describeFeature(feature: GeoJSON.Feature): Metric | null {
  const type = feature.geometry?.type
  try {
    if (type === 'Polygon' || type === 'MultiPolygon') {
      const m2 = turf.area(feature)
      if (m2 <= 0) return null
      const acres = m2 * SQM_TO_ACRE
      const sqft = m2 * SQM_TO_SQFT
      return { label: 'Area', value: `${acres.toFixed(2)} ac · ${Math.round(sqft).toLocaleString()} ft²` }
    }
    if (type === 'LineString' || type === 'MultiLineString') {
      const km = turf.length(feature as GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>, {
        units: 'kilometers',
      })
      if (km <= 0) return null
      const m = km * 1000
      const ft = m * M_TO_FT
      return { label: 'Length', value: `${m.toFixed(1)} m · ${Math.round(ft).toLocaleString()} ft` }
    }
    if (type === 'Point') {
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates
      return { label: 'Point', value: `${lat.toFixed(5)}, ${lng.toFixed(5)}` }
    }
  } catch {
    return null
  }
  return null
}

/** Pick the most relevant feature to measure: selected first, else the newest. */
function pickTarget(fc: GeoJSON.FeatureCollection, selectedIds: string[]): GeoJSON.Feature | null {
  if (selectedIds.length > 0) {
    const sel = fc.features.find((f) => f.id != null && selectedIds.includes(String(f.id)))
    if (sel) return sel
  }
  return fc.features.length > 0 ? fc.features[fc.features.length - 1] : null
}

export function MapView() {
  const active = useDrawingStore((s) => s.mapActive)
  const setMapGeometry = useDrawingStore((s) => s.setMapGeometry)
  const setGeoScale = useDrawingStore((s) => s.setGeoScale)

  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [metric, setMetric] = useState<Metric | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Confine the map to the page-sheet (artboard) rectangle rather than the whole
  // canvas. Project the centered page rect to screen pixels using the live
  // viewport, so the map window tracks the artboard as the R3F camera pans/zooms.
  const viewport = useCanvasStore((s) => s.viewport)
  const pageW = useDrawingStore((s) => s.pageWidth)
  const pageH = useDrawingStore((s) => s.pageHeight)
  const mapDim = useDrawingStore((s) => s.mapDim)
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const [parent, setParent] = useState({ w: 0, h: 0 })

  // The map is the interactive surface only while framing the site in the Context
  // layer; leaving Context freezes it into a static tracing backdrop.
  const frozen = activeLayer !== 'CONTEXT'
  const mapRef = useRef<mapboxgl.Map | null>(null)
  // When frozen, the live map is replaced by a static snapshot that scales/pans
  // with the artboard like a pinned PNG (a live map can't scale its content).
  const [frozenImg, setFrozenImg] = useState<string | null>(null)

  useEffect(() => {
    const el = overlayRef.current?.parentElement
    if (!el) return
    const measure = () => setParent({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!active || !containerRef.current) return
    if (!TOKEN) {
      setError('Set VITE_MAPBOX_TOKEN in your .env to enable the map.')
      return
    }
    setError(null)
    mapboxgl.accessToken = TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-122.4194, 37.7749],
      zoom: 16,
      // Required so the canvas can be snapshotted to a PNG when the map freezes.
      preserveDrawingBuffer: true,
    })
    mapRef.current = map

    // Snap-enabled MapboxDraw: drawing snaps to existing vector vertices/edges
    // and guide lines (mapbox-gl-draw-snap-mode). Options beyond the base typings
    // (snap/snapOptions) are passed through.
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, line_string: true, point: true, trash: true },
      modes: {
        ...(MapboxDraw as unknown as { modes: Record<string, object> }).modes,
        draw_point: SnapPointMode,
        draw_polygon: SnapPolygonMode,
        draw_line_string: SnapLineMode,
        direct_select: SnapDirectSelect,
      },
      styles: SnapModeDrawStyles,
      userProperties: true,
      snap: true,
      snapOptions: { snapPx: 15, snapToMidPoints: true, snapVertexPriorityDistance: 1.25 },
      guides: false,
    } as unknown as ConstructorParameters<typeof MapboxDraw>[0])

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(draw as unknown as mapboxgl.IControl, 'top-left')

    // Publish finalized geometry to the store; refresh the live metric readout.
    const publish = () => setMapGeometry(draw.getAll())
    const refreshMetric = () => {
      const fc = draw.getAll()
      const target = pickTarget(fc, draw.getSelectedIds().map(String))
      setMetric(target ? describeFeature(target) : null)
    }

    map.on('draw.create', () => { publish(); refreshMetric() })
    map.on('draw.update', () => { publish(); refreshMetric() })
    map.on('draw.delete', () => { publish(); refreshMetric() })
    map.on('draw.selectionchange', refreshMetric)
    // Live measurement while the cursor moves mid-draw.
    map.on('draw.render', refreshMetric)

    // Live real-world scale: recompute meters-per-world-unit from the current
    // zoom + center latitude (Mercator), publish it to the store, and surface it
    // in the HUD. Mercator distortion grows with latitude, so this updates on
    // every pan/zoom — not just zoom.
    const refreshScale = () => {
      const mpu = mercatorMetersPerWorldUnit(map.getCenter().lat, map.getZoom())
      setGeoScale(mpu)
    }

    map.on('move', refreshScale)
    map.on('zoom', refreshScale)
    map.on('load', () => {
      map.resize()
      refreshScale()
    })

    // Keep the map sized to its container if the layout changes.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      setMetric(null)
      // Leaving the map removes its real-world calibration from the canvas.
      setGeoScale(null)
    }
  }, [active, setMapGeometry, setGeoScale])

  // Freeze/unfreeze the map's own interaction handlers when leaving/entering the
  // Context layer (event routing is already handled by the canvas pointer-events
  // toggle; this also stops momentum and is the source of truth for "frozen").
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handlers = [
      'dragPan',
      'scrollZoom',
      'boxZoom',
      'dragRotate',
      'keyboard',
      'doubleClickZoom',
      'touchZoomRotate',
    ] as const
    for (const name of handlers) {
      const h = (map as unknown as Record<string, { enable: () => void; disable: () => void }>)[name]
      if (h) (frozen ? h.disable() : h.enable())
    }
    // Snapshot the framed view on freeze (PNG-locked underlay); clear it on unfreeze
    // so the live map shows for re-framing.
    if (frozen) {
      try {
        setFrozenImg(map.getCanvas().toDataURL('image/png'))
      } catch {
        setFrozenImg(null) // ignore (e.g. not yet rendered)
      }
    } else {
      setFrozenImg(null)
    }
  }, [frozen])

  if (!active) return null

  const rect = parent.w && parent.h ? artboardScreenRect(pageW, pageH, viewport, parent.w, parent.h) : null
  // Context (interactive): map ABOVE the canvas so it captures events within the
  // artboard; the workspace outside falls through to the R3F camera. Frozen: map
  // BELOW the canvas so drawing renders on top.
  const overlayStyle: CSSProperties = {
    zIndex: frozen ? 1 : 3,
    ...(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { inset: 0 }),
  }

  return (
    <div ref={overlayRef} className={`map-overlay${frozen ? ' is-frozen' : ''}`} style={overlayStyle}>
      <div ref={containerRef} className="map-container" />
      {/* Frozen snapshot — a pinned PNG that scales/pans with the artboard. */}
      {frozen && frozenImg && <img className="map-frozen" src={frozenImg} alt="" draggable={false} />}
      {/* Adjustable dimmer — fades the map toward white so drawing reads clearly. */}
      <div className="map-dim" style={{ opacity: mapDim }} />
      {/* Live feature measurement (selected/drawn map feature). The real-world SCALE
          readout now lives outside the artboard (see <SheetScale/> in App) so it
          stays frozen + visible across every layer. */}
      {metric && (
        <div className="map-hud" role="status">
          <span className="map-hud-label">{metric.label}</span>
          <span className="map-hud-value">{metric.value}</span>
        </div>
      )}
      {error && <div className="map-error">{error}</div>}
    </div>
  )
}
