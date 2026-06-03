import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { INTENT_META, type IntentPin } from '../../types/geometry'
import { useDrawingStore, type PendingPin } from '../../store/drawingStore'
import { MetaballOverlay } from './MetaballOverlay'
import { IntentConcentrationGrid } from './IntentConcentrationGrid'

/**
 * Intent-pin visualization (Cluster H, H6 + Cluster 2). Pins are rendered as
 * constant-size CIRCLE markers; their fields are drawn by a single multi-channel
 * MetaballOverlay that blends overlapping intent types by concentration (so
 * overlaps no longer overwrite each other). Hovering the toolbar's Intent pin
 * button reveals every pin's type label. The pending pin previews live (it feeds
 * the overlay while its radius is being sized).
 */

const MARKER_Z = 0.6

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

export function PinMarkers({ pins, pending }: { pins: IntentPin[]; pending: PendingPin | null }) {
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
  const showLabels = useDrawingStore((s) => s.showIntentLabels)
  const showGrid = useDrawingStore((s) => s.showIntentGrid)

  // All fields drawn in one pass; the pending pin previews live while sizing.
  const fieldPins = useMemo(() => {
    if (pending && pending.phase === 'radius' && pending.intentType) {
      return [
        ...pins,
        { id: 'pending', x: pending.x, y: pending.y, radius: pending.radius, intentType: pending.intentType },
      ]
    }
    return pins
  }, [pins, pending])

  return (
    <>
      <MetaballOverlay pins={fieldPins} />

      {showGrid && <IntentConcentrationGrid pins={pins} />}

      <PinMarkers pins={pins} pending={pending} />

      {showLabels &&
        pins.map((p) => (
          <Html key={'lbl-' + p.id} position={[p.x, p.y, 1]} center pointerEvents="none" zIndexRange={[8, 0]}>
            <div className="intent-pin-label" style={{ color: INTENT_META[p.intentType].color }}>
              {INTENT_META[p.intentType].label}
            </div>
          </Html>
        ))}
    </>
  )
}
