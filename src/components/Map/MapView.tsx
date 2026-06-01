import { useEffect, useRef, useState } from 'react'
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
import { mercatorMetersPerWorldUnit, formatScale } from '../../geometry/geoScale'
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
  const [metric, setMetric] = useState<Metric | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    })

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
      setScale(mpu)
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
      setMetric(null)
      setScale(null)
      // Leaving the map removes its real-world calibration from the canvas.
      setGeoScale(null)
    }
  }, [active, setMapGeometry, setGeoScale])

  if (!active) return null

  return (
    <div className="map-overlay">
      <div ref={containerRef} className="map-container" />
      {(scale !== null || metric) && (
        <div className="map-hud" role="status">
          {scale !== null && (
            <>
              <span className="map-hud-label">Scale · 1 unit ≈</span>
              <span className="map-hud-value">{formatScale(scale)}</span>
            </>
          )}
          {metric && (
            <>
              <span className="map-hud-label">{metric.label}</span>
              <span className="map-hud-value">{metric.value}</span>
            </>
          )}
        </div>
      )}
      {error && <div className="map-error">{error}</div>}
    </div>
  )
}
