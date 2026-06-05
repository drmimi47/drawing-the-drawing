import { useEffect, useMemo } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useDrawingStore, activeOrigin } from '../../store/drawingStore'
import { DEPARTMENT_META, type Department } from '../../types/geometry'
import { buildDepartmentField, type FieldDept } from '../../geometry/departmentField'
import { PIN_REFERENCE_COLOR } from './IntentFieldView'

/**
 * Department field visualization (restructure_v1 Stage 3 + geodesic revamp).
 *
 * The soft per-department gradients are GEODESIC: each department's influence falls off by
 * the shortest path that stays inside the lot and wraps AROUND main corridors, not the
 * straight-line distance. So the fields MORPH around corners and fill concave nooks, and
 * same/different colors blend together smoothly with no sightline seams — while still
 * obeying the hard constraints (lot boundary, MAIN corridors). See geometry/departmentField.
 *
 * The whole blend is rasterized into a single RGBA texture on the CPU (departments are few)
 * and drawn by a trivial sampler shader, clipped to the active board's white page rect.
 */

const FIELD_Z = -0.35
const MARKER_Z = 0.62

const vertexShader = /* glsl */ `
  out vec2 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Samples the precomputed geodesic field texture (straight-alpha linear RGBA), clipped to
// the board's page rect. All the field math now lives on the CPU (departmentField.ts).
const fragmentShader = /* glsl */ `
  precision highp float;
  in vec2 vWorld;
  out vec4 fragColor;

  uniform sampler2D uField;
  uniform vec2 uFieldMin;
  uniform vec2 uFieldSize;
  uniform vec2 uClipMin;
  uniform vec2 uClipMax;
  uniform float uClipEnabled;

  void main() {
    if (uClipEnabled > 0.5 &&
        (vWorld.x < uClipMin.x || vWorld.x > uClipMax.x ||
         vWorld.y < uClipMin.y || vWorld.y > uClipMax.y)) discard;

    vec2 uv = (vWorld - uFieldMin) / uFieldSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

    vec4 c = texture(uField, uv);
    if (c.a <= 0.001) discard;
    fragColor = c;
  }
`

/** A soft white-filled circle texture so gl points render round, not square. */
let circleTexture: THREE.CanvasTexture | null = null
function getCircleTexture(): THREE.CanvasTexture {
  if (circleTexture) return circleTexture
  const s = 64
  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  circleTexture = new THREE.CanvasTexture(canvas)
  circleTexture.needsUpdate = true
  return circleTexture
}

export function DepartmentFieldOverlay() {
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const departments = useDrawingStore((s) => s.departments)
  const pendingDept = useDrawingStore((s) => s.pendingDept)
  const boundary = useDrawingStore((s) => s.boundary)
  const circulationPaths = useDrawingStore((s) => s.circulationPaths)
  const pageWidth = useDrawingStore((s) => s.pageWidth)
  const pageHeight = useDrawingStore((s) => s.pageHeight)
  const origin = useDrawingStore((s) => activeOrigin(s))

  // Visibility mirrors the intent pins: full color + gradient on the owning layer
  // (Departments); magenta back-reference dots on the Circulation layer; hidden elsewhere.
  const onDepartments = activeLayer === 'DEPARTMENTS'
  const onCirculation = activeLayer === 'CIRCULATION'
  const showMarkers = onDepartments || onCirculation
  const showField = onDepartments

  // Live preview while sizing: once a type is chosen (radius phase), the pending department
  // joins the field in that type's color.
  const fieldDepts = useMemo<FieldDept[]>(() => {
    const list: FieldDept[] = departments.map((d) => ({ x: d.x, y: d.y, radius: d.radius, color: d.color }))
    if (pendingDept && pendingDept.phase === 'radius' && pendingDept.deptType) {
      list.push({
        x: pendingDept.x,
        y: pendingDept.y,
        radius: pendingDept.radius,
        color: DEPARTMENT_META[pendingDept.deptType].color,
      })
    }
    return list
  }, [departments, pendingDept])

  // Only MAIN paths are hard barriers; MINOR paths are permeable (fields bleed across them).
  const mainPaths = useMemo(() => circulationPaths.filter((p) => p.tier !== 'MINOR'), [circulationPaths])

  // The geodesic field texture — rebuilt whenever the lot, MAIN corridors, or any department
  // (incl. the live drag/size preview) changes. Skipped entirely off the Departments layer.
  const field = useMemo(() => {
    if (!showField) return null
    const f = buildDepartmentField(boundary, mainPaths, fieldDepts)
    if (!f) return null
    const tex = new THREE.DataTexture(f.data, f.width, f.height, THREE.RGBAFormat, THREE.UnsignedByteType)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return { tex, minX: f.minX, minY: f.minY, worldW: f.worldW, worldH: f.worldH }
  }, [showField, boundary, mainPaths, fieldDepts])

  useEffect(() => () => field?.tex.dispose(), [field])

  // Stable uniform objects; values are mutated in place each render (no recompiles).
  const uniforms = useMemo(
    () => ({
      uField: { value: null as THREE.Texture | null },
      uFieldMin: { value: new THREE.Vector2() },
      uFieldSize: { value: new THREE.Vector2(1, 1) },
      uClipMin: { value: new THREE.Vector2() },
      uClipMax: { value: new THREE.Vector2() },
      uClipEnabled: { value: 0 },
    }),
    [],
  )

  // Per-dept marker buffers. Off the Departments layer the centers read as a single magenta
  // back-reference (matching the intent pins on their reference layer).
  const markers = useMemo(() => {
    const positions = new Float32Array(fieldDepts.length * 3)
    const colors = new Float32Array(fieldDepts.length * 3)
    const c = new THREE.Color()
    fieldDepts.forEach((d, i) => {
      positions[i * 3] = d.x
      positions[i * 3 + 1] = d.y
      positions[i * 3 + 2] = MARKER_Z
      c.set(onDepartments ? d.color : PIN_REFERENCE_COLOR)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    })
    return { positions, colors }
  }, [fieldDepts, onDepartments])

  if (!showMarkers || fieldDepts.length === 0) return null

  if (field) {
    uniforms.uField.value = field.tex
    uniforms.uFieldMin.value.set(field.minX, field.minY)
    uniforms.uFieldSize.value.set(field.worldW, field.worldH)
    uniforms.uClipMin.value.set(origin.x - pageWidth / 2, origin.y - pageHeight / 2)
    uniforms.uClipMax.value.set(origin.x + pageWidth / 2, origin.y + pageHeight / 2)
    uniforms.uClipEnabled.value = 1
  }

  return (
    <>
      {/* Gradient field only on the Departments layer. */}
      {showField && field && (
        <mesh
          position={[field.minX + field.worldW / 2, field.minY + field.worldH / 2, FIELD_Z]}
          renderOrder={26}
          raycast={() => null}
        >
          <planeGeometry args={[field.worldW, field.worldH]} />
          <shaderMaterial
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            uniforms={uniforms}
            glslVersion={THREE.GLSL3}
            transparent
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}

      <points raycast={() => null} renderOrder={31} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[markers.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[markers.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={getCircleTexture()}
          size={12}
          sizeAttenuation={false}
          vertexColors
          transparent
          alphaTest={0.5}
          depthTest={false}
        />
      </points>

      {/* Name labels only on the Departments layer (the magenta reference stays clean).
          NOTE: drei's <Html> only honors the `pointerEvents` prop in its `transform`
          mode; for a plain (non-transform) label the wrapper defaults to pointer-events:
          auto, so the label — centered right on the pin head — would SWALLOW the click and
          block the Edit tool from grabbing the department. Force it off via `style` (which
          drei does apply to the wrapper) so pins stay grabbable. */}
      {onDepartments &&
        departments.map((d: Department) => (
          <Html
            key={d.id}
            position={[d.x, d.y, MARKER_Z]}
            center
            pointerEvents="none"
            style={{ pointerEvents: 'none' }}
            zIndexRange={[7, 0]}
          >
            <div className="dept-label" style={{ color: d.color }}>{d.name}</div>
          </Html>
        ))}
    </>
  )
}
