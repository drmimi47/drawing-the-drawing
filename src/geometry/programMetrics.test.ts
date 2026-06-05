import { describe, it, expect } from 'vitest'
import type { Boundary, CirculationPath, Room } from '../types/geometry'
import { computeProgramMetrics } from './programMetrics'

/** Project Dashboard metrics (document_int.txt §3 TAB 1) — downstream binding. */

const lot: Boundary = {
  ring: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  isClosed: true,
}
const room = (parentDeptId: string, y0: number, y1: number): Room => ({
  roomId: `r-${y0}`,
  parentDeptId,
  polygon: [{ x: 0, y: y0 }, { x: 100, y: y0 }, { x: 100, y: y1 }, { x: 0, y: y1 }],
  areaSqf: 100 * (y1 - y0),
  isLocked: false,
})

describe('computeProgramMetrics', () => {
  it('reports gross site, net assignable, and net-to-gross from the canvas', () => {
    const rooms = [room('A', 0, 40), room('B', 60, 100)] // 4000 + 4000 = 8000
    const m = computeProgramMetrics(lot, [], rooms, null)
    expect(m.grossSite).toBe(10000)
    expect(m.netAssignable).toBe(8000)
    expect(m.netToGross).toBeCloseTo(0.8, 5)
    expect(m.grossCirculation).toBe(0)
    expect(m.unit).toBe('units²')
  })

  it('clips circulation bands to the lot', () => {
    const corridor: CirculationPath = {
      id: 'c', centerline: [{ x: -10, y: 50 }, { x: 110, y: 50 }], width: 10, tier: 'MAIN',
    }
    const m = computeProgramMetrics(lot, [corridor], [], null)
    // 100-long × 10-wide strip inside the lot ≈ 1000 (extended ends are clipped off).
    expect(m.grossCirculation).toBeGreaterThan(900)
    expect(m.grossCirculation).toBeLessThan(1100)
  })

  it('handles an empty canvas', () => {
    const m = computeProgramMetrics(null, [], [], null)
    expect(m.grossSite).toBe(0)
    expect(m.netToGross).toBe(0)
  })
})
