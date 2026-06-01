/**
 * Geospatial scale calibration (Cluster 2, Task 2.2).
 *
 * When the Mapbox overlay is active it defines a real-world scale for the canvas.
 * In Web Mercator the ground distance covered by one screen pixel depends on both
 * the zoom level and the latitude (meridians converge toward the poles), so the
 * scale must be recomputed live as the map pans/zooms.
 *
 * Because the canvas uses 1 world unit = 1 screen pixel at zoom 1, the Mercator
 * "meters per pixel" value IS the meters-per-world-unit conversion factor. That
 * single scalar lets every world-space measurement be reported in real units.
 */

// Earth's equatorial circumference (meters). Web Mercator tiles are 256 px wide,
// so the equator spans 256 · 2^zoom pixels ⇒ 2^(zoom+8) pixels.
const EARTH_CIRCUMFERENCE_M = 40075016.686

/**
 * Web Mercator ground resolution: meters of real-world distance per screen pixel
 * at the given latitude and map zoom. Equal to meters-per-world-unit on our canvas.
 */
export function mercatorMetersPerWorldUnit(latitudeDeg: number, zoom: number): number {
  const latRad = (latitudeDeg * Math.PI) / 180
  return (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / Math.pow(2, zoom + 8)
}

/** Human-readable scale label, e.g. "0.30 m" or "1.42 km" per world unit. */
export function formatScale(metersPerWorldUnit: number): string {
  if (!Number.isFinite(metersPerWorldUnit) || metersPerWorldUnit <= 0) return '—'
  if (metersPerWorldUnit >= 1000) return `${(metersPerWorldUnit / 1000).toFixed(2)} km`
  if (metersPerWorldUnit >= 1) return `${metersPerWorldUnit.toFixed(2)} m`
  return `${(metersPerWorldUnit * 100).toFixed(1)} cm`
}
