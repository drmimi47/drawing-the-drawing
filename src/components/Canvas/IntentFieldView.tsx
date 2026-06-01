import { useMemo, useState } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { INTENT_META, type IntentPin } from '../../types/geometry'
import type { PendingPin } from '../../store/drawingStore'

/**
 * Intent-pin visualization (Cluster H, H6). Each pin emits a soft color-coded
 * radial field plus a constant-size CIRCLE marker. Hovering a pin shows its
 * intent type label above it. The pending pin renders live while sizing.
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
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor, (1.0 - d) * uMaxAlpha);
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

function IntentField({
  x,
  y,
  radius,
  color,
  onOver,
  onOut,
}: {
  x: number
  y: number
  radius: number
  color: string
  onOver?: () => void
  onOut?: () => void
}) {
  const uniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(color) }, uMaxAlpha: { value: MAX_ALPHA } }),
    [color],
  )
  return (
    <mesh
      position={[x, y, FIELD_Z]}
      renderOrder={-1}
      raycast={onOver ? undefined : () => null}
      onPointerOver={onOver}
      onPointerOut={onOut}
    >
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
  )
}

export function IntentFieldView({ pins, pending }: { pins: IntentPin[]; pending: PendingPin | null }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const hoveredPin = hovered ? pins.find((p) => p.id === hovered) ?? null : null

  return (
    <>
      {pins.map((p) => (
        <IntentField
          key={p.id}
          x={p.x}
          y={p.y}
          radius={p.radius}
          color={INTENT_META[p.intentType].color}
          onOver={() => setHovered(p.id)}
          onOut={() => setHovered((h) => (h === p.id ? null : h))}
        />
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

      {hoveredPin && (
        <Html position={[hoveredPin.x, hoveredPin.y, 1]} center pointerEvents="none" zIndexRange={[8, 0]}>
          <div className="intent-hover-label" style={{ borderColor: INTENT_META[hoveredPin.intentType].color }}>
            {INTENT_META[hoveredPin.intentType].label}
          </div>
        </Html>
      )}
    </>
  )
}
