/**
 * Circulation corridor geometry (Gradia Draw restructure — Stage 2).
 *
 * Offsets a hallway centerline into a closed corridor BAND polygon (ring). The
 * collection of bands is the circulation keep-out mask consumed by the Stage-3
 * department field solver (point-in-any-band exclusion).
 *
 * NOTE (vs spec 2.4): we store the ARRAY of per-path band rings and test
 * point-in-ANY-band rather than first computing a single Turf-union multi-polygon.
 * For the exclusion use case the two are functionally equivalent, and skipping the
 * boolean union removes the main robustness risk (self-intersection / MultiPolygon
 * handling). A true union can be produced later for clean outline rendering and the
 * Stage-5 LLM payload.
 */

type Pt = { x: number; y: number }

/**
 * Closed band ring for a centerline at the given full width. Each centerline
 * point is offset ±half-width along its AVERAGED-tangent normal (smooth joins),
 * then the left side and the reversed right side are concatenated into a ring
 * (butt ends). Mirrors the offset math in buildRibbon, emitted as a polygon.
 */
export function centerlineToBandRing(line: Pt[], width: number): Pt[] {
  const n = line.length
  if (n < 2 || width <= 0) return []
  const hw = width / 2

  const normalAt = (i: number): [number, number] => {
    let inx = line[i].x - line[Math.max(0, i - 1)].x
    let iny = line[i].y - line[Math.max(0, i - 1)].y
    let outx = line[Math.min(n - 1, i + 1)].x - line[i].x
    let outy = line[Math.min(n - 1, i + 1)].y - line[i].y
    const il = Math.hypot(inx, iny)
    const ol = Math.hypot(outx, outy)
    if (il > 1e-9) { inx /= il; iny /= il } else { inx = outx; iny = outy }
    if (ol > 1e-9) { outx /= ol; outy /= ol } else { outx = inx; outy = iny }
    let tx = inx + outx
    let ty = iny + outy
    const tl = Math.hypot(tx, ty)
    if (tl < 1e-6) { tx = outx; ty = outy } else { tx /= tl; ty /= tl }
    return [-ty, tx] // normal = tangent rotated 90°
  }

  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i < n; i++) {
    const [nx, ny] = normalAt(i)
    left.push({ x: line[i].x + nx * hw, y: line[i].y + ny * hw })
    right.push({ x: line[i].x - nx * hw, y: line[i].y - ny * hw })
  }
  right.reverse()
  return [...left, ...right]
}

/** Build the circulation keep-out mask: one band ring per path (≥3 pts each). */
export function buildCirculationMask(
  paths: { centerline: Pt[]; width: number }[],
): Pt[][] {
  return paths
    .map((p) => centerlineToBandRing(p.centerline, p.width))
    .filter((ring) => ring.length >= 3)
}
