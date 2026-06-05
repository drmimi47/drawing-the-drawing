import { describe, it, expect } from 'vitest'
import type { Boundary, CirculationPath } from '../types/geometry'
import { buildDepartmentField, type FieldDept, type DepartmentFieldTex } from './departmentField'

const lot = (size: number): Boundary => ({
  ring: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }],
  isClosed: true,
})

const corridor = (centerline: { x: number; y: number }[], width: number): CirculationPath =>
  ({ id: 'c', centerline, width, tier: 'MAIN' }) as CirculationPath

/** Field alpha byte (0..255) at a world point. */
function alphaAt(f: DepartmentFieldTex, x: number, y: number): number {
  const i = Math.min(f.width - 1, Math.max(0, Math.floor(((x - f.minX) / f.worldW) * f.width)))
  const j = Math.min(f.height - 1, Math.max(0, Math.floor(((y - f.minY) / f.worldH) * f.height)))
  return f.data[(j * f.width + i) * 4 + 3]
}

describe('buildDepartmentField — geodesic gradient', () => {
  it('fills the lot near a pin and stays bounded', () => {
    const f = buildDepartmentField(lot(300), [], [{ x: 150, y: 150, radius: 200, color: '#ff0000' }])!
    expect(f).toBeTruthy()
    expect(alphaAt(f, 150, 150)).toBeGreaterThan(0)
    // Opacity never exceeds the configured peak (0.4 * 255 ≈ 102).
    let maxA = 0
    for (let k = 0; k < f.width * f.height; k++) maxA = Math.max(maxA, f.data[k * 4 + 3])
    expect(maxA).toBeLessThanOrEqual(103)
  })

  it('cannot cross a corridor that fully splits the lot', () => {
    const paths = [corridor([{ x: 150, y: 0 }, { x: 150, y: 300 }], 40)]
    const depts: FieldDept[] = [{ x: 75, y: 150, radius: 1000, color: '#ff0000' }]
    const f = buildDepartmentField(lot(300), paths, depts)!
    expect(alphaAt(f, 75, 150)).toBeGreaterThan(0) // near (left) side
    expect(alphaAt(f, 260, 150)).toBe(0) // far (right) side — barrier respected
  })

  it('morphs AROUND a corridor spur to fill a pocket the straight ray cannot see', () => {
    // A spur rising from the bottom edge to y=180 blocks the lower-middle; left & right
    // connect only OVER the spur tip (y > 180).
    const paths = [corridor([{ x: 150, y: 0 }, { x: 150, y: 180 }], 40)]
    const depts: FieldDept[] = [{ x: 50, y: 50, radius: 800, color: '#ff0000' }]
    const f = buildDepartmentField(lot(300), paths, depts)!

    const aroundCorner = alphaAt(f, 250, 50) // behind the spur — only reachable by wrapping
    const sameEuclid = alphaAt(f, 50, 250) // same straight-line distance (200), clear path

    expect(aroundCorner).toBeGreaterThan(0) // the field DID wrap around (euclidean+LOS would cut it)
    // Geodesic path to the pocket is longer than the equal-euclidean clear point, so it's weaker.
    expect(aroundCorner).toBeLessThan(sameEuclid)
  })

  it('returns null without a closed lot or any departments', () => {
    expect(buildDepartmentField(null, [], [{ x: 0, y: 0, radius: 10, color: '#f00' }])).toBeNull()
    expect(buildDepartmentField(lot(100), [], [])).toBeNull()
  })
})
