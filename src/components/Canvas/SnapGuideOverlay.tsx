import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SnapGuide } from '../../types/geometry'

/**
 * Smart Track visual guide overlay (Step 3).
 *
 * Draws CAD-style guidelines when the polyline snapping pipeline (Step 2) has
 * an active snap:
 *   - Endpoint:      hollow green square at the target vertex
 *   - Midpoint:      hollow green triangle at the exact edge centre
 *   - Intersection:  green ✕ at the (apparent) crossing of two lines
 *   - Perpendicular: bright green dashed line P→cursor + right-angle ∟ glyph
 *   - Parallel:      magenta dashed line along the parallel ray + ∥ glyph
 *   - Extension:     green dashed track along the last segment's trajectory
 *
 * All geometry lives inside the R3F scene graph and respects the orthographic
 * camera's pan/zoom transforms. Line dashes and glyphs are sized in screen
 * pixels (divided by camera.zoom each frame) so they stay crisp and constant
 * at every zoom level.
 */

// ─── Colors ──────────────────────────────────────────────────────────────────
const COLOR_GREEN = '#22c55e'    // endpoint / perpendicular guides
const COLOR_MAGENTA = '#e879f9'  // parallel guides

// ─── Screen-constant sizing ──────────────────────────────────────────────────
/** Half-extent of glyphs in screen pixels. */
export const GLYPH_HALF_PX = 7
/** Z-depth for overlays — above strokes (1), above selection ants (30). */
export const GUIDE_Z = 6
/** Extension length (px) beyond toPoint for dashed lines. */
const EXTENSION_PX = 2000

// ─── Dashed line shader ──────────────────────────────────────────────────────
// Same approach as MarchingAntsLine: lineDistance attribute accumulates world
// distance along the line, then the fragment shader converts to screen pixels
// (× zoom) and discards gap fragments.
const DASH_PX = 4
const GAP_PX = 4

const guideVertexShader = /* glsl */ `
  attribute float lineDistance;
  varying float vDist;
  uniform float uZoom;
  void main() {
    vDist = lineDistance * uZoom;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const guideFragmentShader = /* glsl */ `
  precision mediump float;
  varying float vDist;
  uniform vec3 uColor;
  void main() {
    float period = ${(DASH_PX + GAP_PX).toFixed(1)};
    float dash = ${DASH_PX.toFixed(1)};
    float t = mod(vDist, period);
    if (t > dash) discard;
    gl_FragColor = vec4(uColor, 1.0);
  }
`

// ─── Glyph geometries (unit-scale, reused) ───────────────────────────────────

/** Right-angle symbol ∟ — two perpendicular line segments forming an L. */
const RIGHT_ANGLE_PTS = new Float32Array([
  0, 0.7, 0,   0, 0, 0,   0.7, 0, 0,
])

/**
 * Parallel glyph ∥ — two short vertical bars side by side.
 * Drawn as lineSegments (pairs of vertices).
 */
const PARALLEL_PTS = new Float32Array([
  -0.35, -0.7, 0,  -0.35, 0.7, 0,   // left bar
   0.35, -0.7, 0,   0.35, 0.7, 0,    // right bar
])

/** Endpoint glyph — hollow green square (matching SnapIndicator shape). */
const ENDPOINT_SQUARE_PTS = new Float32Array([
  -1, -1, 0,   1, -1, 0,   1, 1, 0,   -1, 1, 0,
])

/** Edge ("on line") glyph — hollow green diamond (45°-rotated square). */
const EDGE_DIAMOND_PTS = new Float32Array([
  0, 1.25, 0,   1.25, 0, 0,   0, -1.25, 0,   -1.25, 0, 0,
])

/** Midpoint glyph — hollow green triangle (△), centroid-centered. */
const MIDPOINT_TRIANGLE_PTS = new Float32Array([
  0, 0.9, 0,   -0.78, -0.45, 0,   0.78, -0.45, 0,
])

/** Intersection glyph — green ✕ (two crossing diagonals). Drawn as lineSegments. */
const INTERSECTION_X_PTS = new Float32Array([
  -0.9, -0.9, 0,   0.9, 0.9, 0,    // ╱
  -0.9, 0.9, 0,    0.9, -0.9, 0,    // ╲
])

// ─── Sub-component: dashed guide line ────────────────────────────────────────

/**
 * A dashed line that extends from `from` through `to` and well beyond, giving
 * the impression of an infinite track guide. Dashes are screen-constant.
 */
export function DashedGuideLine({
  from,
  to,
  color,
  extend = false,
}: {
  from: [number, number]
  to: [number, number]
  color: string
  /** When true, the dashed line extends well beyond both ends to read as an
   *  infinite alignment track (parallel snap). When false, it's bounded exactly
   *  to from→to (perpendicular snap: last vertex → cursor). */
  extend?: boolean
}) {
  const lineObj = useMemo(() => {
    const positions = new Float32Array(2 * 3)
    const lineDistance = new Float32Array(2)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('lineDistance', new THREE.BufferAttribute(lineDistance, 1))

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uZoom: { value: 1 },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: guideVertexShader,
      fragmentShader: guideFragmentShader,
      transparent: true,
      depthTest: false,
    })

    const line = new THREE.Line(geo, mat)
    line.renderOrder = 35
    line.frustumCulled = false
    return line
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // stable — color changes rarely; material uniform updated below

  // Update color if it changes.
  useEffect(() => {
    const mat = lineObj.material as THREE.ShaderMaterial
    mat.uniforms.uColor.value.set(color)
  }, [color, lineObj])

  useEffect(() => () => {
    lineObj.geometry.dispose()
    ;(lineObj.material as THREE.Material).dispose()
  }, [lineObj])

  // Update positions and zoom uniform every frame.
  useFrame((state) => {
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const mat = lineObj.material as THREE.ShaderMaterial
    mat.uniforms.uZoom.value = zoom

    const pos = lineObj.geometry.attributes.position as THREE.BufferAttribute
    const dist = lineObj.geometry.attributes.lineDistance as THREE.BufferAttribute
    const posArr = pos.array as Float32Array
    const distArr = dist.array as Float32Array

    // Direction from → to
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const len = Math.sqrt(dx * dx + dy * dy)

    let ax: number, ay: number, bx: number, by: number
    if (extend && len > 1e-6) {
      // Extend well beyond both ends to read as an infinite alignment track.
      const extWorld = EXTENSION_PX / zoom
      const ex = dx / len
      const ey = dy / len
      ax = from[0] - ex * extWorld
      ay = from[1] - ey * extWorld
      bx = to[0] + ex * extWorld
      by = to[1] + ey * extWorld
    } else {
      // Bounded exactly to from→to.
      ax = from[0]; ay = from[1]
      bx = to[0]; by = to[1]
    }

    posArr[0] = ax;  posArr[1] = ay;  posArr[2] = GUIDE_Z
    posArr[3] = bx;  posArr[4] = by;  posArr[5] = GUIDE_Z

    distArr[0] = 0
    distArr[1] = Math.hypot(bx - ax, by - ay)

    pos.needsUpdate = true
    dist.needsUpdate = true
  })

  return <primitive object={lineObj} />
}

// ─── Sub-component: right-angle glyph (∟) ────────────────────────────────────

function RightAngleGlyph({
  position,
  from,
  to,
}: {
  /** World position to place the glyph (the snapped cursor coordinate). */
  position: [number, number]
  /** fromPoint — the last placed polyline vertex. */
  from: [number, number]
  /** toPoint — the snapped cursor coordinate. */
  to: [number, number]
}) {
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(RIGHT_ANGLE_PTS, 3))
    const mat = new THREE.LineBasicMaterial({
      color: COLOR_GREEN,
      depthTest: false,
      // transparent so the glyph joins the transparent render pass and its high
      // renderOrder (36) sorts ABOVE the boundary infill / circulation bands /
      // map underlay (all transparent) — otherwise opaque glyphs draw first and
      // get painted over by them.
      transparent: true,
      toneMapped: false,
    })
    const obj = new THREE.Line(g, mat)
    obj.renderOrder = 36
    obj.frustumCulled = false
    return obj
  }, [])

  useEffect(() => () => {
    lineObj.geometry.dispose()
    ;(lineObj.material as THREE.Material).dispose()
  }, [lineObj])

  useFrame((state) => {
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const s = GLYPH_HALF_PX / zoom

    // Orient the ∟ so that one arm points along the guide direction.
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const angle = Math.atan2(dy, dx)

    lineObj.position.set(position[0], position[1], GUIDE_Z)
    lineObj.scale.set(s, s, 1)
    lineObj.rotation.set(0, 0, angle - Math.PI / 2)
  })

  return <primitive object={lineObj} />
}

// ─── Sub-component: parallel glyph (∥) ──────────────────────────────────────

function ParallelGlyph({
  position,
  from,
  to,
}: {
  position: [number, number]
  from: [number, number]
  to: [number, number]
}) {
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(PARALLEL_PTS, 3))
    const mat = new THREE.LineBasicMaterial({
      color: COLOR_MAGENTA,
      depthTest: false,
      transparent: true, // see note in RightAngleGlyph — sort above transparent fills
      toneMapped: false,
    })
    const obj = new THREE.LineSegments(g, mat)
    obj.renderOrder = 36
    obj.frustumCulled = false
    return obj
  }, [])

  useEffect(() => () => {
    lineObj.geometry.dispose()
    ;(lineObj.material as THREE.Material).dispose()
  }, [lineObj])

  useFrame((state) => {
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const s = GLYPH_HALF_PX / zoom

    // Orient ∥ bars along the parallel direction.
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const angle = Math.atan2(dy, dx)

    lineObj.position.set(position[0], position[1], GUIDE_Z)
    lineObj.scale.set(s, s, 1)
    lineObj.rotation.set(0, 0, angle)
  })

  return <primitive object={lineObj} />
}

// ─── Sub-component: endpoint square glyph ────────────────────────────────────

function EndpointGlyph({ position }: { position: [number, number] }) {
  const ref = useRef<THREE.LineLoop>(null)

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(ENDPOINT_SQUARE_PTS, 3))
    return g
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state) => {
    const obj = ref.current
    if (!obj) return
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const s = GLYPH_HALF_PX / zoom
    obj.position.set(position[0], position[1], GUIDE_Z)
    obj.scale.set(s, s, 1)
  })

  return (
    <lineLoop ref={ref} geometry={geometry} renderOrder={36} frustumCulled={false}>
      <lineBasicMaterial color={COLOR_GREEN} depthTest={false} transparent toneMapped={false} />
    </lineLoop>
  )
}

// ─── Sub-component: edge ("on line") diamond glyph ───────────────────────────

function EdgeGlyph({ position }: { position: [number, number] }) {
  const ref = useRef<THREE.LineLoop>(null)

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(EDGE_DIAMOND_PTS, 3))
    return g
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state) => {
    const obj = ref.current
    if (!obj) return
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const s = GLYPH_HALF_PX / zoom
    obj.position.set(position[0], position[1], GUIDE_Z)
    obj.scale.set(s, s, 1)
  })

  return (
    <lineLoop ref={ref} geometry={geometry} renderOrder={36} frustumCulled={false}>
      <lineBasicMaterial color={COLOR_GREEN} depthTest={false} transparent toneMapped={false} />
    </lineLoop>
  )
}

// ─── Sub-component: midpoint triangle glyph ──────────────────────────────────

function MidpointGlyph({ position }: { position: [number, number] }) {
  const ref = useRef<THREE.LineLoop>(null)

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(MIDPOINT_TRIANGLE_PTS, 3))
    return g
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state) => {
    const obj = ref.current
    if (!obj) return
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const s = GLYPH_HALF_PX / zoom
    obj.position.set(position[0], position[1], GUIDE_Z)
    obj.scale.set(s, s, 1)
  })

  return (
    <lineLoop ref={ref} geometry={geometry} renderOrder={36} frustumCulled={false}>
      <lineBasicMaterial color={COLOR_GREEN} depthTest={false} transparent toneMapped={false} />
    </lineLoop>
  )
}

// ─── Sub-component: intersection ✕ glyph ─────────────────────────────────────

function IntersectionGlyph({ position }: { position: [number, number] }) {
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(INTERSECTION_X_PTS, 3))
    const mat = new THREE.LineBasicMaterial({
      color: COLOR_GREEN,
      depthTest: false,
      // transparent so the glyph joins the transparent render pass and its high
      // renderOrder (36) sorts ABOVE the boundary infill / circulation bands /
      // map underlay (all transparent) — otherwise opaque glyphs draw first and
      // get painted over by them.
      transparent: true,
      toneMapped: false,
    })
    const obj = new THREE.LineSegments(g, mat)
    obj.renderOrder = 36
    obj.frustumCulled = false
    return obj
  }, [])

  useEffect(() => () => {
    lineObj.geometry.dispose()
    ;(lineObj.material as THREE.Material).dispose()
  }, [lineObj])

  useFrame((state) => {
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const s = GLYPH_HALF_PX / zoom
    lineObj.position.set(position[0], position[1], GUIDE_Z)
    lineObj.scale.set(s, s, 1)
  })

  return <primitive object={lineObj} />
}

// ─── Main overlay component ──────────────────────────────────────────────────

/**
 * Reads the active snap guide from the polyline snapping pipeline and renders
 * the appropriate visual indicators. Renders nothing when guide is null.
 */
export function SnapGuideOverlay({ guide }: { guide: SnapGuide | null }) {
  if (!guide) return null

  const { type, fromPoint, toPoint } = guide

  switch (type) {
    case 'endpoint':
      // Hollow green square at the snapped vertex — no track line.
      return <EndpointGlyph position={toPoint} />

    case 'midpoint':
      // Hollow green triangle at the exact edge centre — no track line.
      return <MidpointGlyph position={toPoint} />

    case 'intersection':
      // Green ✕ at the (apparent) crossing of two lines — no track line.
      return <IntersectionGlyph position={toPoint} />

    case 'edge':
      // Hollow green diamond on the existing line — no track line.
      return <EdgeGlyph position={toPoint} />

    case 'perpendicular':
      // Bounded dashed line (last vertex → cursor) + right-angle glyph.
      return (
        <>
          <DashedGuideLine from={fromPoint} to={toPoint} color={COLOR_GREEN} />
          <RightAngleGlyph position={toPoint} from={fromPoint} to={toPoint} />
        </>
      )

    case 'parallel':
      // Extended magenta alignment track + parallel glyph.
      return (
        <>
          <DashedGuideLine from={fromPoint} to={toPoint} color={COLOR_MAGENTA} extend />
          <ParallelGlyph position={toPoint} from={fromPoint} to={toPoint} />
        </>
      )

    case 'extension':
      return <DashedGuideLine from={fromPoint} to={toPoint} color={COLOR_GREEN} extend />

    case 'tracking':
      // O-TRACK visuals (✛ anchors + alignment rays) are owned by TrackingOverlay,
      // which reads store.trackedPoints — nothing to draw from the guide alone.
      return null

    default:
      return null
  }
}
