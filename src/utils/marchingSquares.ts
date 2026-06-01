/**
 * 2D Marching Squares contour extraction (Cluster 3).
 *
 * Generic, field-agnostic: given a scalar field sampler, a bounding box, a cell
 * size, and an iso-level, it returns the iso-contours as closed vector polyline
 * rings. Used to trace the boundary of each isolated intent field independently.
 *
 * The classic 16-case algorithm samples the field on a regular grid; each cell's
 * four corners (above/below the iso-level) select a case that emits 0–2 line
 * segments, with crossing points placed by linear interpolation along the edges.
 * Loose segments are then stitched end-to-end into ordered rings. When the sample
 * border lies entirely below the iso-level (pad the bounds!), every ring closes.
 */

export interface Vec2 {
  x: number
  y: number
}

export type Ring = Vec2[]

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Linear interpolation of the iso-crossing between two corner samples. */
function interp(iso: number, xa: number, ya: number, va: number, xb: number, yb: number, vb: number): Vec2 {
  const denom = vb - va
  const t = Math.abs(denom) < 1e-12 ? 0.5 : (iso - va) / denom
  return { x: xa + t * (xb - xa), y: ya + t * (yb - ya) }
}

export function marchingSquares(
  field: (x: number, y: number) => number,
  bounds: Bounds,
  cellSize: number,
  iso: number,
): Ring[] {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize))
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellSize))
  const nx = cols + 1
  const ny = rows + 1

  const xs = new Float64Array(nx)
  const ys = new Float64Array(ny)
  for (let i = 0; i < nx; i++) xs[i] = bounds.minX + i * cellSize
  for (let j = 0; j < ny; j++) ys[j] = bounds.minY + j * cellSize

  const vals = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) vals[j * nx + i] = field(xs[i], ys[j])
  }
  const at = (i: number, j: number) => vals[j * nx + i]

  const segments: [Vec2, Vec2][] = []

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // Corners: BL=(i,j) BR=(i+1,j) TR=(i+1,j+1) TL=(i,j+1)
      const vBL = at(i, j)
      const vBR = at(i + 1, j)
      const vTR = at(i + 1, j + 1)
      const vTL = at(i, j + 1)

      let c = 0
      if (vBL >= iso) c |= 1
      if (vBR >= iso) c |= 2
      if (vTR >= iso) c |= 4
      if (vTL >= iso) c |= 8
      if (c === 0 || c === 15) continue

      const xL = xs[i]
      const xR = xs[i + 1]
      const yB = ys[j]
      const yT = ys[j + 1]

      // Edge crossing points (computed lazily per case).
      const B = () => interp(iso, xL, yB, vBL, xR, yB, vBR) // bottom: BL→BR
      const R = () => interp(iso, xR, yB, vBR, xR, yT, vTR) // right:  BR→TR
      const T = () => interp(iso, xL, yT, vTL, xR, yT, vTR) // top:    TL→TR
      const L = () => interp(iso, xL, yB, vBL, xL, yT, vTL) // left:   BL→TL

      switch (c) {
        case 1: segments.push([L(), B()]); break
        case 2: segments.push([B(), R()]); break
        case 3: segments.push([L(), R()]); break
        case 4: segments.push([R(), T()]); break
        case 5: segments.push([L(), B()], [R(), T()]); break // saddle
        case 6: segments.push([B(), T()]); break
        case 7: segments.push([L(), T()]); break
        case 8: segments.push([T(), L()]); break
        case 9: segments.push([T(), B()]); break
        case 10: segments.push([B(), R()], [T(), L()]); break // saddle
        case 11: segments.push([T(), R()]); break
        case 12: segments.push([R(), L()]); break
        case 13: segments.push([B(), R()]); break
        case 14: segments.push([L(), B()]); break
      }
    }
  }

  return stitch(segments, cellSize)
}

/** Stitch loose contour segments into ordered rings by matching endpoints. */
function stitch(segments: [Vec2, Vec2][], cellSize: number): Ring[] {
  if (segments.length === 0) return []
  const q = (cellSize || 1) * 1e-3
  const key = (p: Vec2) => `${Math.round(p.x / q)}:${Math.round(p.y / q)}`

  // Map each endpoint key to the segments touching it.
  const byKey = new Map<string, number[]>()
  segments.forEach((s, idx) => {
    for (const p of s) {
      const k = key(p)
      const arr = byKey.get(k)
      if (arr) arr.push(idx)
      else byKey.set(k, [idx])
    }
  })

  const used = new Array<boolean>(segments.length).fill(false)
  const rings: Ring[] = []

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue
    used[start] = true
    const ring: Vec2[] = [segments[start][0], segments[start][1]]
    const startKey = key(segments[start][0])
    let endKey = key(segments[start][1])

    while (endKey !== startKey) {
      const candidates = byKey.get(endKey)
      let nextIdx = -1
      if (candidates) {
        for (const ci of candidates) {
          if (!used[ci]) {
            nextIdx = ci
            break
          }
        }
      }
      if (nextIdx === -1) break // open chain / dead end
      used[nextIdx] = true
      const seg = segments[nextIdx]
      if (key(seg[0]) === endKey) {
        ring.push(seg[1])
        endKey = key(seg[1])
      } else {
        ring.push(seg[0])
        endKey = key(seg[0])
      }
    }

    // Drop the trailing duplicate of the start point (closure is implied).
    if (ring.length > 1 && key(ring[ring.length - 1]) === startKey) ring.pop()
    rings.push(ring)
  }

  return rings
}
