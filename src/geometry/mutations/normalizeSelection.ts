import type { Graph } from '../../types/geometry'
import { resolveStrokePoints } from '../graph'
import { normalizeStroke } from './normalize'

/**
 * Compute per-vertex original and normalized-target positions for a set of
 * strokes (Cluster G). The caller morphs original → target by a strength m to
 * preview / commit a selection-scoped "Clean up".
 *
 * Vertices whose stroke has no confident primitive fit keep their original
 * position (target == original), so they don't move.
 */
export function computeNormalizeTargets(
  graph: Graph,
  strokeIds: string[],
): { originals: Map<string, { x: number; y: number }>; targets: Map<string, { x: number; y: number }> } {
  const originals = new Map<string, { x: number; y: number }>()
  const targets = new Map<string, { x: number; y: number }>()
  const ids = new Set(strokeIds)

  for (const stroke of graph.strokes) {
    if (!ids.has(stroke.id)) continue

    for (const pp of stroke.path) {
      const v = graph.vertices[pp.v]
      if (v) originals.set(pp.v, { x: v.x, y: v.y })
    }

    const pts = resolveStrokePoints(graph, stroke).map((p) => ({ x: p.x, y: p.y }))
    const fitted = normalizeStroke(pts)
    if (fitted) {
      stroke.path.forEach((pp, i) => {
        const t = fitted[i]
        if (t) targets.set(pp.v, { x: t.x, y: t.y })
      })
    }
  }

  return { originals, targets }
}
