import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../../store/drawingStore'
import { useObserverStore } from '../../store/observerStore'
import { deriveEdges } from '../../geometry/graph'
import {
  computeViewportAABB,
  insetAABB,
  segmentIntersectsAABB,
  type ViewportAABB,
} from '../../utils/viewport'
import type { Graph } from '../../types/geometry'

/**
 * Viewport observer + debug visualization (Cluster E).
 *
 * Each time the camera or graph changes, every edge is classified against the
 * observation boundary (viewport inset by a margin). Edges entirely outside are
 * "at-risk" (unobserved); the time each spent outside is tracked so Cluster F can
 * scale mutation by it. The boundary rectangle and at-risk edges are drawn as an
 * overlay so the behavior is visible.
 */

const OVERLAY_Z = 1 // sit above strokes (z = 0)

interface EdgeTiming {
  outside: boolean
  exitedAt: number
}

function aabbChanged(a: ViewportAABB | null, b: ViewportAABB): boolean {
  if (!a) return true
  const e = 1e-3
  return (
    Math.abs(a.minX - b.minX) > e ||
    Math.abs(a.minY - b.minY) > e ||
    Math.abs(a.maxX - b.maxX) > e ||
    Math.abs(a.maxY - b.maxY) > e
  )
}

export function ObserverDebug() {
  const timing = useRef<Map<string, EdgeTiming>>(new Map())
  const lastObs = useRef<ViewportAABB | null>(null)
  const lastGraph = useRef<Graph | null>(null)

  const boundary = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3))
    const line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: '#3b82f6' }))
    line.material.depthTest = false
    line.renderOrder = 10
    line.frustumCulled = false
    return line
  }, [])

  const atRisk = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    const seg = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#e23b3b' }))
    seg.material.depthTest = false
    seg.renderOrder = 11
    seg.frustumCulled = false
    return seg
  }, [])

  useFrame((state) => {
    const { debug, marginPx } = useObserverStore.getState()
    boundary.visible = debug
    atRisk.visible = debug
    if (!debug) return

    const cam = state.camera as OrthographicCamera
    const viewport = computeViewportAABB(cam)
    if (!viewport) return
    const obs = insetAABB(viewport, marginPx / cam.zoom)

    const graph = useDrawingStore.getState().graph
    const moved = aabbChanged(lastObs.current, obs)
    const graphChanged = graph !== lastGraph.current
    if (!moved && !graphChanged) return
    lastObs.current = obs
    lastGraph.current = graph

    // Boundary rectangle corners.
    const bp = boundary.geometry.getAttribute('position') as THREE.BufferAttribute
    bp.setXYZ(0, obs.minX, obs.minY, OVERLAY_Z)
    bp.setXYZ(1, obs.maxX, obs.minY, OVERLAY_Z)
    bp.setXYZ(2, obs.maxX, obs.maxY, OVERLAY_Z)
    bp.setXYZ(3, obs.minX, obs.maxY, OVERLAY_Z)
    bp.needsUpdate = true

    // Classify edges + update timing.
    const now = performance.now()
    const seen = new Set<string>()
    const positions: number[] = []

    for (const edge of deriveEdges(graph)) {
      const a = graph.vertices[edge.v0]
      const b = graph.vertices[edge.v1]
      if (!a || !b) continue
      seen.add(edge.id)

      const outside = !segmentIntersectsAABB(a.x, a.y, b.x, b.y, obs)
      const prev = timing.current.get(edge.id)

      if (outside) {
        if (!prev || !prev.outside) timing.current.set(edge.id, { outside: true, exitedAt: now })
        positions.push(a.x, a.y, OVERLAY_Z, b.x, b.y, OVERLAY_Z)
      } else {
        if (prev && prev.outside) {
          const dt = now - prev.exitedAt
          // Cluster F will consume this re-entry to scale mutation magnitude.
          console.debug(`[observer] edge ${edge.id} re-entered after ${(dt / 1000).toFixed(2)}s`)
        }
        timing.current.set(edge.id, { outside: false, exitedAt: 0 })
      }
    }

    // Drop timing entries for edges that no longer exist.
    for (const key of [...timing.current.keys()]) {
      if (!seen.has(key)) timing.current.delete(key)
    }

    atRisk.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  })

  return (
    <>
      <primitive object={boundary} />
      <primitive object={atRisk} />
    </>
  )
}
