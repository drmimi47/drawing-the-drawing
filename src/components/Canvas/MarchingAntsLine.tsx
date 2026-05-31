import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Animated dashed outline ("marching ants", Photoshop-style) for selection
 * shapes. Dashes are sized and animated in SCREEN pixels (distance is scaled by
 * camera zoom in the shader), so they look the same at any zoom level.
 */

const OVERLAY_Z = 3
const SPEED_PX_PER_S = 30
const DASH_PX = 4
const GAP_PX = 4

const vertexShader = /* glsl */ `
  attribute float lineDistance;
  varying float vDist;
  uniform float uZoom;
  void main() {
    vDist = lineDistance * uZoom; // world distance -> screen pixels
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vDist;
  uniform float uTime;
  uniform vec3 uColor;
  void main() {
    float period = ${(DASH_PX + GAP_PX).toFixed(1)};
    float dash = ${DASH_PX.toFixed(1)};
    float t = mod(vDist - uTime * ${SPEED_PX_PER_S.toFixed(1)}, period);
    if (t > dash) discard;
    gl_FragColor = vec4(uColor, 1.0);
  }
`

export function MarchingAntsLine({
  points,
  closed = true,
  color = '#111111',
}: {
  points: { x: number; y: number }[]
  closed?: boolean
  color?: string
}) {
  const line = useMemo(() => {
    const pts = closed && points.length > 1 ? [...points, points[0]] : points
    const n = pts.length
    const position = new Float32Array(n * 3)
    const lineDistance = new Float32Array(n)
    let d = 0
    for (let i = 0; i < n; i++) {
      position[i * 3] = pts[i].x
      position[i * 3 + 1] = pts[i].y
      position[i * 3 + 2] = OVERLAY_Z
      if (i > 0) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      lineDistance[i] = d
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.setAttribute('lineDistance', new THREE.BufferAttribute(lineDistance, 1))
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uZoom: { value: 1 }, uColor: { value: new THREE.Color(color) } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
    })
    const obj = new THREE.Line(geometry, material)
    obj.renderOrder = 30
    obj.frustumCulled = false
    return obj
  }, [points, closed, color])

  useEffect(() => {
    return () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
  }, [line])

  useFrame((state) => {
    const material = line.material as THREE.ShaderMaterial
    material.uniforms.uTime.value = performance.now() / 1000
    material.uniforms.uZoom.value = (state.camera as THREE.OrthographicCamera).zoom
  })

  return <primitive object={line} />
}
