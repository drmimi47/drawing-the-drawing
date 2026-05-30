import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../../store/drawingStore'
import { useObserverStore } from '../../store/observerStore'
import { deriveEdges } from '../../geometry/graph'
import {
  computeNormalizationTargets,
  DECAY_MAX_MS,
  type ReentryEvent,
} from '../../geometry/mutations/normalize'
import {
  computeViewportAABB,
  insetAABB,
  segmentIntersectsAABB,
  type ViewportAABB,
} from '../../utils/viewport'
import type { Graph } from '../../types/geometry'

/**
 * Viewport observer + mutation driver (Clusters E & F).
 *
 * Each time the camera or graph changes, edges are classified against the
 * observation boundary (viewport inset by a margin). Per-edge time-outside is
 * tracked; when an edge re-enters, Normalization snaps its angle toward the
 * nearest 15° increment scaled by that time, and the affected vertices animate
 * to their new positions over ~500ms. The boundary + at-risk edges are drawn as
 * a debug overlay.
 */

const OVERLAY_Z = 1
const REENTRY_MIN_MS = 200 // ignore brief flickers
const ANIM_MS = 500

interface EdgeTiming {
  outside: boolean
  exitedAt: number
}

interface VertexAnim {
  fromX: number
  fromY: number
  toX: number
  toY: number
  start: number
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

function pointInAABB(x: number, y: number, a: ViewportAABB): boolean {
  return x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function ViewportObserver() {
  const timing = useRef<Map<string, EdgeTiming>>(new Map())
  const anims = useRef<Map<string, VertexAnim>>(new Map())
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
    const cam = state.camera as OrthographicCamera
    const setVertexPositions = useDrawingStore.getState().setVertexPositions

    // 1. Advance in-flight vertex animations.
    if (anims.current.size > 0) {
      const now = performance.now()
      const updates: Record<string, { x: number; y: number }> = {}
      for (const [id, a] of anims.current) {
        const t = Math.min(1, (now - a.start) / ANIM_MS)
        const e = easeOutCubic(t)
        updates[id] = { x: a.fromX + (a.toX - a.fromX) * e, y: a.fromY + (a.toY - a.fromY) * e }
        if (t >= 1) anims.current.delete(id)
      }
      setVertexPositions(updates)
    }

    // 2. Classify edges against the observation boundary (on change only).
    const viewport = computeViewportAABB(cam)
    if (!viewport) return
    const { debug, marginPx } = useObserverStore.getState()
    const obs = insetAABB(viewport, marginPx / cam.zoom)

    boundary.visible = debug
    atRisk.visible = debug

    const graph = useDrawingStore.getState().graph
    const moved = aabbChanged(lastObs.current, obs)
    const graphChanged = graph !== lastGraph.current
    if (!moved && !graphChanged) return
    lastObs.current = obs
    lastGraph.current = graph

    const mutationMode = useDrawingStore.getState().mutationMode
    const now = performance.now()
    const seen = new Set<string>()
    const reentries: ReentryEvent[] = []
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
          if (dt >= REENTRY_MIN_MS) {
            const magnitude = Math.min(1, dt / DECAY_MAX_MS)
            reentries.push({ v0: edge.v0, v1: edge.v1, magnitude })
          }
        }
        timing.current.set(edge.id, { outside: false, exitedAt: 0 })
      }
    }

    for (const key of [...timing.current.keys()]) {
      if (!seen.has(key)) timing.current.delete(key)
    }

    // Boundary rectangle corners.
    const bp = boundary.geometry.getAttribute('position') as THREE.BufferAttribute
    bp.setXYZ(0, obs.minX, obs.minY, OVERLAY_Z)
    bp.setXYZ(1, obs.maxX, obs.minY, OVERLAY_Z)
    bp.setXYZ(2, obs.maxX, obs.maxY, OVERLAY_Z)
    bp.setXYZ(3, obs.minX, obs.maxY, OVERLAY_Z)
    bp.needsUpdate = true
    atRisk.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))

    // 3. Apply Normalization to re-entering edges.
    if (reentries.length > 0 && mutationMode === 'NORMALIZATION') {
      const isMutable = (vid: string) => {
        const v = graph.vertices[vid]
        return v ? !pointInAABB(v.x, v.y, obs) : false
      }
      const targets = computeNormalizationTargets(graph, reentries, isMutable)
      for (const id in targets) {
        const v = graph.vertices[id]
        if (!v) continue
        anims.current.set(id, {
          fromX: v.x,
          fromY: v.y,
          toX: targets[id].x,
          toY: targets[id].y,
          start: now,
        })
      }
    }
  })

  return (
    <>
      <primitive object={boundary} />
      <primitive object={atRisk} />
    </>
  )
}
