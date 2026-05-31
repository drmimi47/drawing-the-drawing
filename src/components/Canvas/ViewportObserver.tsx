import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../../store/drawingStore'
import { useObserverStore } from '../../store/observerStore'
import { normalizeStroke, DECAY_MAX_MS, type Pt } from '../../geometry/mutations/normalize'
import {
  computeViewportAABB,
  insetAABB,
  segmentIntersectsAABB,
  type ViewportAABB,
} from '../../utils/viewport'

/**
 * Viewport observer + mutation driver (Clusters E & F).
 *
 * Each frame, every stroke is classified against the observation boundary
 * (viewport inset by a margin). While a stroke is entirely outside (unobserved),
 * it morphs CONTINUOUSLY toward its normalized primitive — fraction
 * clamp(timeOutside / DECAY_MAX_MS, 0, 1) — so the longer it stays out, the more
 * it normalizes. When it re-enters it freezes ("what is watched stays fixed"); a
 * later exit re-fits from the now-cleaner shape, so normalization is progressive.
 *
 * The boundary rectangle and the unobserved (morphing) strokes are drawn as a
 * debug overlay.
 */

const OVERLAY_Z = 1

interface StrokeMutation {
  observed: boolean
  tLeft: number
  done: boolean
  /** Positions to morph FROM, with the vertex id each maps to. */
  baseline: { vid: string; x: number; y: number }[]
  /** Positions to morph TO (aligned with baseline), or null when nothing to do. */
  target: Pt[] | null
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

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function ViewportObserver() {
  const states = useRef<Map<string, StrokeMutation>>(new Map())
  const lastObs = useRef<ViewportAABB | null>(null)
  const lastGraph = useRef<ReturnType<typeof useDrawingStore.getState>['graph'] | null>(null)
  const idle = useRef(false)

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
    const store = useDrawingStore.getState()
    const { debug, marginPx } = useObserverStore.getState()

    const viewport = computeViewportAABB(cam)
    if (!viewport) return
    const obs = insetAABB(viewport, marginPx / cam.zoom)
    boundary.visible = debug
    atRisk.visible = debug

    const graph = store.graph
    const moved = aabbChanged(lastObs.current, obs)
    const graphChanged = graph !== lastGraph.current
    if (!moved && !graphChanged && idle.current) return
    lastObs.current = obs
    lastGraph.current = graph

    const mode = store.mutationMode
    const now = performance.now()
    const updates: Record<string, { x: number; y: number }> = {}
    const overlay: number[] = []
    const seen = new Set<string>()
    let activeMorph = false

    for (const stroke of graph.strokes) {
      seen.add(stroke.id)
      const pts: Pt[] = stroke.path.map((pp) => {
        const v = graph.vertices[pp.v]
        return { x: v.x, y: v.y }
      })
      if (pts.length < 2) continue

      let observed = false
      for (let i = 0; i < pts.length - 1; i++) {
        if (segmentIntersectsAABB(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, obs)) {
          observed = true
          break
        }
      }

      let st = states.current.get(stroke.id)

      if (observed) {
        // Freeze: keep whatever it morphed to; ready to re-fit on next exit.
        states.current.set(stroke.id, { observed: true, tLeft: 0, done: false, baseline: [], target: null })
        continue
      }

      // Unobserved.
      if (!st || st.observed) {
        const baseline = stroke.path.map((pp, i) => ({ vid: pp.v, x: pts[i].x, y: pts[i].y }))
        const target = mode === 'NORMALIZATION' ? normalizeStroke(pts) : null
        st = { observed: false, tLeft: now, done: false, baseline, target }
        states.current.set(stroke.id, st)
      }

      for (let i = 0; i < pts.length - 1; i++) {
        overlay.push(pts[i].x, pts[i].y, OVERLAY_Z, pts[i + 1].x, pts[i + 1].y, OVERLAY_Z)
      }

      if (mode === 'NORMALIZATION' && st.target && !st.done) {
        const raw = Math.min(1, (now - st.tLeft) / DECAY_MAX_MS)
        const m = easeInOutCubic(raw)
        for (let i = 0; i < st.baseline.length; i++) {
          const base = st.baseline[i]
          const tgt = st.target[i]
          updates[base.vid] = { x: base.x + (tgt.x - base.x) * m, y: base.y + (tgt.y - base.y) * m }
        }
        if (raw >= 1) st.done = true
        else activeMorph = true
      }
    }

    for (const key of [...states.current.keys()]) {
      if (!seen.has(key)) states.current.delete(key)
    }

    if (debug) {
      const bp = boundary.geometry.getAttribute('position') as THREE.BufferAttribute
      bp.setXYZ(0, obs.minX, obs.minY, OVERLAY_Z)
      bp.setXYZ(1, obs.maxX, obs.minY, OVERLAY_Z)
      bp.setXYZ(2, obs.maxX, obs.maxY, OVERLAY_Z)
      bp.setXYZ(3, obs.minX, obs.maxY, OVERLAY_Z)
      bp.needsUpdate = true
      atRisk.geometry.setAttribute('position', new THREE.Float32BufferAttribute(overlay, 3))
    }

    if (Object.keys(updates).length > 0) store.setVertexPositions(updates)

    // Idle when nothing is actively morphing — lets the early-out skip work.
    idle.current = !activeMorph
  })

  return (
    <>
      <primitive object={boundary} />
      <primitive object={atRisk} />
    </>
  )
}
