import { useMemo } from 'react'
import * as THREE from 'three'
import { INTENT_META, type IntentPin } from '../../types/geometry'
import type { PendingPin } from '../../store/drawingStore'

/**
 * Intent-pin visualization (Cluster H, H6). Each pin emits a soft color-coded
 * radial field (metaball-like) plus a constant-size center marker. The pending
 * pin (while sizing) renders the same way so the user sees the field grow.
 */

const FIELD_Z = -0.4
const MARKER_Z = 0.6
const MAX_ALPHA = 0.35

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uMaxAlpha;
  void main() {
    float d = length(vUv - 0.5) * 2.0; // 0 at center, 1 at edge
    if (d > 1.0) discard;
    float a = (1.0 - d) * uMaxAlpha;   // soft radial falloff
    gl_FragColor = vec4(uColor, a);
  }
`

function IntentField({ x, y, radius, color }: { x: number; y: number; radius: number; color: string }) {
  const uniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(color) }, uMaxAlpha: { value: MAX_ALPHA } }),
    [color],
  )
  return (
    <mesh position={[x, y, FIELD_Z]} raycast={() => null} renderOrder={-1}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

/** Constant-screen-size center dots for all pins (committed + pending). */
function PinMarkers({ pins, pending }: { pins: IntentPin[]; pending: PendingPin | null }) {
  const { positions, colors } = useMemo(() => {
    const all: { x: number; y: number; color: string }[] = pins.map((p) => ({
      x: p.x,
      y: p.y,
      color: INTENT_META[p.intentType].color,
    }))
    if (pending) {
      all.push({
        x: pending.x,
        y: pending.y,
        color: pending.intentType ? INTENT_META[pending.intentType].color : '#555555',
      })
    }
    const positions = new Float32Array(all.length * 3)
    const colors = new Float32Array(all.length * 3)
    const c = new THREE.Color()
    all.forEach((m, i) => {
      positions[i * 3] = m.x
      positions[i * 3 + 1] = m.y
      positions[i * 3 + 2] = MARKER_Z
      c.set(m.color)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    })
    return { positions, colors }
  }, [pins, pending])

  if (positions.length === 0) return null

  return (
    <points raycast={() => null} renderOrder={26}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={10} sizeAttenuation={false} vertexColors depthTest={false} />
    </points>
  )
}

export function IntentFieldView({ pins, pending }: { pins: IntentPin[]; pending: PendingPin | null }) {
  return (
    <>
      {pins.map((p) => (
        <IntentField key={p.id} x={p.x} y={p.y} radius={p.radius} color={INTENT_META[p.intentType].color} />
      ))}
      {pending && pending.phase === 'radius' && pending.intentType && (
        <IntentField
          x={pending.x}
          y={pending.y}
          radius={pending.radius}
          color={INTENT_META[pending.intentType].color}
        />
      )}
      <PinMarkers pins={pins} pending={pending} />
    </>
  )
}
