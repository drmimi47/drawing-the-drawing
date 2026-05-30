import type { StrokePoint } from '../../store/drawingStore'
import type { RawPoint } from '../../geometry/simplify'

/**
 * Stroke rendering geometry (Cluster B).
 *
 * Native WebGL lines can't reliably vary thickness, so each stroke is rendered
 * as a flat triangle ribbon: every polyline point is offset along its normal by
 * a per-point half-width. This gives smooth, pressure-driven line weight.
 */

/** Map a pressure value (0..1) to a half-width in world units. */
export function halfWidthForPressure(
  baseWidth: number,
  pressure: number,
  usePressure: boolean,
): number {
  const halfWidth = baseWidth / 2
  if (!usePressure) return halfWidth
  const clamped = Math.min(Math.max(pressure, 0), 1)
  // Map pressure to a 0.3x..1.5x weight range so light/heavy strokes read clearly.
  return halfWidth * (0.3 + 1.2 * clamped)
}

export function rawToStrokePoints(
  points: RawPoint[],
  baseWidth: number,
  usePressure: boolean,
): StrokePoint[] {
  return points.map((p) => ({
    x: p.x,
    y: p.y,
    w: halfWidthForPressure(baseWidth, p.p, usePressure),
  }))
}

/**
 * Build a triangle-ribbon buffer for a stroke. Returns null buffers when there
 * are too few points to form a ribbon (caller should render nothing).
 */
export function buildRibbon(points: StrokePoint[]): {
  positions: Float32Array | null
  indices: Uint32Array | null
} {
  const n = points.length
  if (n < 2) return { positions: null, indices: null }

  const positions = new Float32Array(n * 2 * 3)

  for (let i = 0; i < n; i++) {
    // Vertex tangent = direction between neighbours (averaged at interior points).
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(n - 1, i + 1)]
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len

    // Left/right offsets along the normal (-dy, dx).
    const nx = -dy
    const ny = dx
    const hw = points[i].w
    const cx = points[i].x
    const cy = points[i].y

    const o = i * 6
    positions[o + 0] = cx + nx * hw
    positions[o + 1] = cy + ny * hw
    positions[o + 2] = 0
    positions[o + 3] = cx - nx * hw
    positions[o + 4] = cy - ny * hw
    positions[o + 5] = 0
  }

  const indices = new Uint32Array((n - 1) * 6)
  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2
    const r0 = i * 2 + 1
    const l1 = (i + 1) * 2
    const r1 = (i + 1) * 2 + 1
    const o = i * 6
    indices[o + 0] = l0
    indices[o + 1] = r0
    indices[o + 2] = l1
    indices[o + 3] = r0
    indices[o + 4] = r1
    indices[o + 5] = l1
  }

  return { positions, indices }
}
