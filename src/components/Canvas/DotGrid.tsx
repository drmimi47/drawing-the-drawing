import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Infinite dot grid rendered on a single full-viewport quad.
 *
 * The quad follows the camera every frame and is scaled to cover the visible
 * world rectangle. A fragment shader draws dots in *world* space, so the grid
 * pans and zooms with the canvas like Figma / Miro.
 *
 * Dot spacing adapts to the zoom level (snapped to a "nice" 1/2/5 step) so the
 * on-screen density stays roughly constant, and the whole grid fades out when
 * zoomed far enough that the dots would otherwise crowd together.
 */

const TARGET_SCREEN_SPACING_PX = 26 // desired on-screen gap between dots
const DOT_RADIUS_PX = 1.5
const BASE_OPACITY = 0.55

const vertexShader = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;

  uniform float uSpacing;     // world units between dots
  uniform float uPxPerUnit;   // screen pixels per world unit
  uniform float uDotRadiusPx; // dot radius in screen pixels
  uniform float uOpacity;
  uniform vec3 uColor;

  void main() {
    // Distance (world units) from this fragment to the nearest grid node.
    vec2 m = abs(fract(vWorld / uSpacing + 0.5) - 0.5) * uSpacing;
    float d = length(m);

    float r = uDotRadiusPx / uPxPerUnit;  // dot radius in world units
    float aa = 1.0 / uPxPerUnit;          // ~1px antialiasing band

    float alpha = (1.0 - smoothstep(r - aa, r + aa, d)) * uOpacity;
    if (alpha <= 0.001) discard;

    gl_FragColor = vec4(uColor, alpha);
  }
`

/** Snap a raw spacing to the nearest "nice" 1 / 2 / 5 * 10^n value. */
function niceSpacing(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 1
  const exponent = Math.floor(Math.log10(raw))
  const fraction = raw / Math.pow(10, exponent)
  const niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10
  return niceFraction * Math.pow(10, exponent)
}

export function DotGrid() {
  const meshRef = useRef<THREE.Mesh>(null)

  const uniforms = useMemo(
    () => ({
      uSpacing: { value: 1 },
      uPxPerUnit: { value: 1 },
      uDotRadiusPx: { value: DOT_RADIUS_PX },
      uOpacity: { value: BASE_OPACITY },
      uColor: { value: new THREE.Color('#9aa0a6') },
    }),
    [],
  )

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return

    const camera = state.camera as THREE.OrthographicCamera
    const { height } = state.size

    // Visible world rectangle for the current ortho frustum + zoom.
    const worldHeight = (camera.top - camera.bottom) / camera.zoom
    const worldWidth = (camera.right - camera.left) / camera.zoom
    if (!isFinite(worldHeight) || worldHeight <= 0) return

    const pxPerUnit = height / worldHeight

    // Cover the viewport (with margin) and follow the camera. Sit behind the
    // z = 0 drawing plane that later clusters render onto.
    mesh.position.set(camera.position.x, camera.position.y, -1)
    mesh.scale.set(worldWidth * 1.5, worldHeight * 1.5, 1)

    // Adaptive spacing keeps on-screen dot density stable across zoom levels.
    const spacing = niceSpacing(TARGET_SCREEN_SPACING_PX / pxPerUnit)

    uniforms.uSpacing.value = spacing
    uniforms.uPxPerUnit.value = pxPerUnit
    uniforms.uColor.value.set('#9aa0a6')

    // Fade out as the grid gets dense (very zoomed out), avoiding moiré noise.
    const screenSpacing = spacing * pxPerUnit
    const fade = THREE.MathUtils.clamp((screenSpacing - 6) / 14, 0, 1)
    uniforms.uOpacity.value = BASE_OPACITY * fade
  })

  return (
    <mesh ref={meshRef} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
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
