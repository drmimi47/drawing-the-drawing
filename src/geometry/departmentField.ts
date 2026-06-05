import * as THREE from 'three'
import { pointInPolygon } from './locks'
import { pointSegmentDistSq } from './graph'
import type { Boundary, CirculationPath } from '../types/geometry'

/**
 * Department GRADIENT field, computed by GEODESIC distance (restructure_v2 — replaces the
 * old euclidean + line-of-sight shader, which left hard shadow seams at corners a pin
 * couldn't "see" — limitation L6).
 *
 * Each department's influence falls off with the shortest path that stays INSIDE the lot
 * and goes AROUND main-circulation corridors (not the straight-line distance). So the
 * field MORPHS around corners and fills concave nooks instead of getting cut along the
 * sightline, while still obeying the hard constraints (lot boundary, MAIN corridors).
 *
 * All departments are blended into a single premultiplied-free RGBA texture on the CPU
 * (departments are few; the grid is coarse), so same- and different-colored fields melt
 * together smoothly with no overlap seams. The texture is sampled by a trivial shader.
 *
 * Pipeline per cell of a coarse grid over the lot bbox:
 *   1. classify: inside the lot? on a MAIN corridor? → the traversable DOMAIN.
 *   2. per department: bounded Dijkstra from the pin over the domain (8-connected, ortho
 *      cost = texel, diagonal = √2·texel), stopping at the pin's radius. Accumulate a
 *      Wyvill falloff (1 − (dGeo/r)²)³ weighted color sum.
 *   3. blend: color = Σ falloff·color / Σ falloff ; alpha from Σ falloff (soft outer edge).
 *   4. tuck the field UNDER the opaque corridor bands (dilation) so no seam shows at a band.
 */

export interface DepartmentFieldTex {
  /** Straight-alpha linear RGBA, row-major width*height*4 (rgb = blended dept color in the
   *  same LINEAR space the old shader emitted; a = field opacity). */
  data: Uint8Array<ArrayBuffer>
  width: number
  height: number
  minX: number
  minY: number
  worldW: number
  worldH: number
}

export interface FieldDept {
  x: number
  y: number
  radius: number
  color: string
}

/** Target texel count along the longer axis. Coarser than the old hard-mask (256) — the
 *  geodesic march is CPU work that reruns while a pin is dragged, so we trade a little
 *  resolution for responsiveness; LinearFilter sampling keeps the gradient smooth. */
const TARGET_TEXELS = 160
/** Peak field opacity (matches the old shader's MAX_ALPHA). */
const MAX_ALPHA = 0.4
/** Weight below which a cell carries no field (matches the old VIS_THRESHOLD). */
const VIS_THRESHOLD = 0.12

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function buildDepartmentField(
  boundary: Boundary | null,
  mainPaths: CirculationPath[],
  depts: FieldDept[],
): DepartmentFieldTex | null {
  if (!boundary || boundary.isClosed === false || boundary.ring.length < 3) return null
  if (depts.length === 0) return null
  const ring = boundary.ring

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of ring) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const worldW = maxX - minX
  const worldH = maxY - minY
  if (worldW <= 0 || worldH <= 0) return null

  const res = Math.max(worldW, worldH) / TARGET_TEXELS // world units per texel
  const width = Math.max(2, Math.ceil(worldW / res))
  const height = Math.max(2, Math.ceil(worldH / res))
  const N = width * height

  // Flatten MAIN corridor centerlines into segments + squared half-widths (barriers).
  const segs: { a: { x: number; y: number }; b: { x: number; y: number }; hw2: number }[] = []
  let maxHalfWidth = 0
  for (const path of mainPaths) {
    const c = path.centerline
    const hw = path.width / 2
    if (hw > maxHalfWidth) maxHalfWidth = hw
    const hw2 = hw * hw
    for (let i = 0; i < c.length - 1; i++) segs.push({ a: c[i], b: c[i + 1], hw2 })
  }

  // 1) Classify cells into the traversable domain (inside lot, off MAIN corridors).
  const insideLot = new Uint8Array(N)
  const onCorridor = new Uint8Array(N)
  for (let j = 0; j < height; j++) {
    const wy = minY + ((j + 0.5) / height) * worldH
    for (let i = 0; i < width; i++) {
      const wx = minX + ((i + 0.5) / width) * worldW
      if (!pointInPolygon(wx, wy, ring)) continue
      const idx = j * width + i
      insideLot[idx] = 1
      for (const s of segs) {
        if (pointSegmentDistSq(wx, wy, s.a, s.b) <= s.hw2) {
          onCorridor[idx] = 1
          break
        }
      }
    }
  }
  const isDomain = (k: number) => insideLot[k] === 1 && onCorridor[k] === 0

  // 2) Per-department bounded Dijkstra, accumulating a weighted color sum.
  const accR = new Float32Array(N)
  const accG = new Float32Array(N)
  const accB = new Float32Array(N)
  const accW = new Float32Array(N)
  const dist = new Float32Array(N)
  dist.fill(Infinity) // unvisited; per-department resets only touch the cells they reached
  const done = new Uint8Array(N)
  const col = new THREE.Color()

  const cO = res
  const cD = res * Math.SQRT2
  // (dx, dy, cost)
  const NEI: [number, number, number][] = [
    [1, 0, cO], [-1, 0, cO], [0, 1, cO], [0, -1, cO],
    [1, 1, cD], [1, -1, cD], [-1, 1, cD], [-1, -1, cD],
  ]

  // Min-heap over (key=dist, val=cell), parallel arrays reused across departments.
  const hd: number[] = []
  const hi: number[] = []
  const push = (d: number, i: number) => {
    hd.push(d)
    hi.push(i)
    let c = hd.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (hd[p] <= hd[c]) break
      const td = hd[p]; hd[p] = hd[c]; hd[c] = td
      const ti = hi[p]; hi[p] = hi[c]; hi[c] = ti
      c = p
    }
  }
  const pop = (): number => {
    const i = hi[0]
    const ld = hd.pop() as number
    const li = hi.pop() as number
    if (hd.length) {
      hd[0] = ld; hi[0] = li
      let c = 0
      const n = hd.length
      for (;;) {
        const l = 2 * c + 1
        const r = 2 * c + 2
        let s = c
        if (l < n && hd[l] < hd[s]) s = l
        if (r < n && hd[r] < hd[s]) s = r
        if (s === c) break
        const td = hd[s]; hd[s] = hd[c]; hd[c] = td
        const ti = hi[s]; hi[s] = hi[c]; hi[c] = ti
        c = s
      }
    }
    return i
  }

  const nearestDomain = (si: number, sj: number): number => {
    for (let rad = 1; rad <= 8; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue
          const ni = si + dx
          const nj = sj + dy
          if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue
          const v = nj * width + ni
          if (isDomain(v)) return v
        }
      }
    }
    return -1
  }

  const touched: number[] = []
  for (const d of depts) {
    if (d.radius <= 0) continue
    col.set(d.color)
    const cr = col.r
    const cg = col.g
    const cb = col.b

    let si = Math.min(width - 1, Math.max(0, Math.floor(((d.x - minX) / worldW) * width)))
    let sj = Math.min(height - 1, Math.max(0, Math.floor(((d.y - minY) / worldH) * height)))
    let seed = sj * width + si
    if (!isDomain(seed)) {
      seed = nearestDomain(si, sj)
      if (seed < 0) continue
    }

    // Reset only the cells touched by the previous department.
    for (const k of touched) {
      dist[k] = Infinity
      done[k] = 0
    }
    touched.length = 0
    hd.length = 0
    hi.length = 0

    dist[seed] = 0
    touched.push(seed)
    push(0, seed)
    const r = d.radius

    while (hd.length) {
      const u = pop()
      if (done[u]) continue
      const du = dist[u]
      if (du > r) break // bounded: every remaining cell is at least this far
      done[u] = 1

      const t = du / r
      const f = 1 - t * t
      const fall = f * f * f // Wyvill (1 − d²/r²)³, d geodesic
      accR[u] += fall * cr
      accG[u] += fall * cg
      accB[u] += fall * cb
      accW[u] += fall

      const ui = u % width
      const uj = (u / width) | 0
      for (let n = 0; n < 8; n++) {
        const ni = ui + NEI[n][0]
        const nj = uj + NEI[n][1]
        if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue
        const v = nj * width + ni
        if (!isDomain(v)) continue
        const nd = du + NEI[n][2]
        if (nd < dist[v]) {
          if (dist[v] === Infinity) touched.push(v)
          dist[v] = nd
          push(nd, v)
        }
      }
    }
  }

  // 3) Blend → straight-alpha linear RGBA.
  const data = new Uint8Array(N * 4)
  for (let k = 0; k < N; k++) {
    if (insideLot[k] !== 1) continue
    const w = accW[k]
    if (w <= 0) continue
    const a = Math.min(1, w) * MAX_ALPHA * smoothstep(VIS_THRESHOLD, VIS_THRESHOLD * 2, w)
    const o = k * 4
    // Keep the (hued) color even where alpha rounds to 0, so LinearFilter never bleeds the
    // gradient toward black at its soft outer edge.
    data[o] = Math.round((accR[k] / w) * 255)
    data[o + 1] = Math.round((accG[k] / w) * 255)
    data[o + 2] = Math.round((accB[k] / w) * 255)
    data[o + 3] = Math.round(a * 255)
  }

  // 4) Tuck the field under the opaque corridor bands so no seam shows where it stops at a
  //    band edge: dilate the blended RGBA into the on-corridor (but in-lot) cells.
  const passes = Math.min(16, Math.ceil(maxHalfWidth / res) + 1)
  if (passes > 0 && segs.length > 0) {
    let filled = new Uint8Array(N)
    for (let k = 0; k < N; k++) if (data[k * 4 + 3] > 0) filled[k] = 1
    const snap = data.slice()
    for (let p = 0; p < passes; p++) {
      let changed = false
      for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
          const k = j * width + i
          if (filled[k] || insideLot[k] !== 1 || onCorridor[k] !== 1) continue
          let sr = 0, sg = 0, sb = 0, sa = 0, cnt = 0
          for (let n = 0; n < 8; n++) {
            const ni = i + NEI[n][0]
            const nj = j + NEI[n][1]
            if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue
            const v = nj * width + ni
            if (!filled[v]) continue
            const vo = v * 4
            sr += snap[vo]; sg += snap[vo + 1]; sb += snap[vo + 2]; sa += snap[vo + 3]; cnt++
          }
          if (cnt === 0) continue
          const o = k * 4
          data[o] = Math.round(sr / cnt)
          data[o + 1] = Math.round(sg / cnt)
          data[o + 2] = Math.round(sb / cnt)
          data[o + 3] = Math.round(sa / cnt)
          changed = true
        }
      }
      if (!changed) break
      // Promote newly-filled cells for the next pass.
      for (let k = 0; k < N; k++) if (!filled[k] && data[k * 4 + 3] > 0) filled[k] = 1
      snap.set(data)
    }
  }

  return { data, width, height, minX, minY, worldW, worldH }
}
