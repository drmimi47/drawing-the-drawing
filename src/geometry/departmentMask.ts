import { pointInPolygon } from './locks'
import { pointSegmentDistSq } from './graph'
import type { Boundary, CirculationPath } from '../types/geometry'

/**
 * Department field hard-mask (restructure_v1 Stage 3.2).
 *
 * The domain a department field is allowed to occupy: INSIDE the closed lot boundary
 * AND OUTSIDE every (main) circulation corridor. It's rasterized once per topology
 * change into a coarse grid covering the boundary's bounding box.
 *
 * Two channels (visual revamp 2026-06-04):
 *   • R = crisp LOT FILL — 1 inside the lot (including under corridors, so the gradient
 *     tucks beneath the opaque corridor band), 0 outside. LinearFilter gives a ~1-texel
 *     anti-alias at the lot edge so it reads clean, with NO feather.
 *   • G = soft CORRIDOR KEEP-OUT ramp (0 on a main artery → 1 once clear), 0 outside the
 *     lot. Consumed ONLY by the shader's line-of-sight gate (topological-leak guard) —
 *     it no longer carves the visible fill, since the opaque corridor now covers it.
 *
 * RGBA (not single-channel R8) is used deliberately — it sidesteps WebGL row
 * unpack-alignment pitfalls for odd-width single-byte textures.
 */

export interface FieldMask {
  /** RGBA bytes, row-major, width*height*4. r = g = b = soft coverage (0..255),
   *  a = 255. Pinned to a plain ArrayBuffer so it satisfies three's DataTexture
   *  BufferSource. */
  data: Uint8Array<ArrayBuffer>
  width: number
  height: number
  /** World coords of the rasterized region (texel grid spans [min, min+world]). */
  minX: number
  minY: number
  worldW: number
  worldH: number
}

/** Target texel count along the longer axis (resolution of the mask grid). */
const TARGET_TEXELS = 256
/** Width (in texels) of the soft keep-out band over which the field eases to 0. */
const MARGIN_TEXELS = 6

export function buildDepartmentMask(
  boundary: Boundary | null,
  circulationPaths: CirculationPath[],
): FieldMask | null {
  if (!boundary || boundary.isClosed === false || boundary.ring.length < 3) return null
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
  const data = new Uint8Array(width * height * 4)

  // Flatten the corridor centerlines into segments + squared half-widths.
  const segs: { a: { x: number; y: number }; b: { x: number; y: number }; hw2: number }[] = []
  for (const path of circulationPaths) {
    const c = path.centerline
    const hw2 = (path.width / 2) * (path.width / 2)
    for (let i = 0; i < c.length - 1; i++) segs.push({ a: c[i], b: c[i + 1], hw2 })
  }

  // 1) Per texel: inside the lot? sitting on a MAIN corridor?
  const insideLot = new Uint8Array(width * height)
  const onCorridor = new Uint8Array(width * height)
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

  // 2) Approximate distance (in texels) to the nearest MAIN corridor, via a two-pass
  //    chamfer transform. Only corridors seed it (out-of-grid neighbours are NOT seeds),
  //    so the ramp eases purely AROUND arteries — never at the lot boundary, which stays
  //    crisp. Used ONLY by the field's line-of-sight gate (not the visible fill).
  const INF = 1e9
  const SQRT2 = Math.SQRT2
  const cdist = new Float32Array(width * height)
  for (let k = 0; k < cdist.length; k++) cdist[k] = onCorridor[k] ? 0 : INF
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? INF : cdist[y * width + x])
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const idx = j * width + i
      if (cdist[idx] === 0) continue
      cdist[idx] = Math.min(cdist[idx], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + SQRT2, at(i + 1, j - 1) + SQRT2)
    }
  }
  for (let j = height - 1; j >= 0; j--) {
    for (let i = width - 1; i >= 0; i--) {
      const idx = j * width + i
      if (cdist[idx] === 0) continue
      cdist[idx] = Math.min(cdist[idx], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + SQRT2, at(i - 1, j + 1) + SQRT2)
    }
  }

  // 3) Pack two channels:
  //    R = crisp lot fill (1 inside the lot, INCLUDING under corridors so the gradient
  //        tucks beneath the opaque corridor band). LinearFilter sampling gives a ~1-texel
  //        anti-alias at the lot edge, so it reads clean — no feather.
  //    G = soft corridor keep-out ramp (0 on a main artery → 1 clear), 0 outside the lot.
  //        Consumed ONLY by the shader's line-of-sight gate (topological-leak guard).
  for (let k = 0; k < insideLot.length; k++) {
    const o = k * 4
    const inLot = insideLot[k] === 1
    data[o] = inLot ? 255 : 0
    const g = inLot ? Math.round(Math.min(1, cdist[k] / MARGIN_TEXELS) * 255) : 0
    data[o + 1] = g
    data[o + 2] = g
    data[o + 3] = 255
  }

  return { data, width, height, minX, minY, worldW, worldH }
}
