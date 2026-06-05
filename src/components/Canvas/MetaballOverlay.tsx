import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { INTENT_META, INTENT_TYPES, type IntentPin, type IntentType } from '../../types/geometry'

/**
 * Multi-channel metaball concentration overlay (Cluster 2 + improvements C1).
 *
 * A single full-coverage plane whose fragment shader evaluates the cumulative
 * Wyvill field for each of the 4 intent types INDEPENDENTLY at every fragment,
 * then blends the four brand colors by their relative concentration. This mirrors
 * the CPU math in utils/metaballField.ts, but on the GPU for real-time fill.
 *
 * Crucially the types never overwrite one another: an overlap of green
 * (Pedestrian) and purple (Density) renders as the concentration-weighted blend
 * (teal-purple), shifting continuously toward whichever field dominates. Fragment
 * alpha tracks the absolute total field strength, so cores read solid and edges
 * fade out; below VIS_THRESHOLD the fragment is dropped so faint wash disappears.
 *
 * --- DATA-TEXTURE PIN STREAMING (improvements C1) ---
 * Pins used to be passed as flat uniform arrays (`uniform vec2 uPinPos[64]`),
 * which hard-capped the scene at 64 concurrent intent pins — exhausted instantly
 * for dense urban master planning. Pins are now packed into a floating-point
 * DataTexture (one RGBA texel per pin: x, y, radius, typeIndex) and streamed to
 * the GPU. The shader (GLSL ES 3.0, so it can use a dynamic loop bound) samples
 * one texel per pin and accumulates the field. There is no fixed cap; the texture
 * grows by row as pins are added, so thousands of pins render in a single draw
 * call. Pin mutations only rewrite the texture's backing Float32Array and flip
 * `needsUpdate` — the shader program is never rebuilt.
 */

const FIELD_Z = -0.4
const MAX_ALPHA = 0.35
const VIS_THRESHOLD = 0.15
const EDGE_PAD = 2 // world-unit padding so the plane never clips a field edge

// Pin texture is packed one RGBA float texel per pin, TEX_WIDTH texels per row.
// 256 keeps rows shallow (2000 pins => 8 rows) while staying well under the
// max-texture-size limit; height grows on demand.
const TEX_WIDTH = 256

const typeIndex = (t: IntentType) => INTENT_TYPES.indexOf(t)

const vertexShader = /* glsl */ `
  out vec2 vWorld;
  void main() {
    // World-space position of this fragment (the plane is placed in world units).
    vWorld = (modelMatrix * vec4(position, 1.0)).xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// highp is required: fragments carry world coordinates (up to ~1e3) and squared
// distances (up to ~1e6) that overflow mediump's ~65504 range. GLSL ES 3.0 lets
// the field loop use the runtime `uTotalPins` bound (no constant cap).
const fragmentShader = /* glsl */ `
  precision highp float;

  in vec2 vWorld;
  out vec4 fragColor;

  uniform sampler2D uPinTexture; // one texel/pin: rgba = (x, y, radius, typeIndex)
  uniform int uTotalPins;
  uniform float uTexWidth;
  uniform float uTexHeight;
  uniform vec3 uColors[4];
  uniform float uMaxAlpha;
  uniform float uThreshold;
  uniform vec2 uClipMin;     // board (page) rect in world coords — gradient is clipped
  uniform vec2 uClipMax;     // to this so it never spills onto the grey workspace
  uniform float uClipEnabled;

  void main() {
    // Clip to the selected board's white page rect: drop any fragment outside it so
    // the field never bleeds onto the grey background between/around boards.
    if (uClipEnabled > 0.5 &&
        (vWorld.x < uClipMin.x || vWorld.x > uClipMax.x ||
         vWorld.y < uClipMin.y || vWorld.y > uClipMax.y)) {
      discard;
    }

    // Accumulate each intent type's field independently (isolation).
    float f0 = 0.0, f1 = 0.0, f2 = 0.0, f3 = 0.0;
    for (int i = 0; i < uTotalPins; i++) {
      float fi = float(i);
      // Decode the texel for pin i: NearestFilter sampling at the texel center.
      float col = mod(fi, uTexWidth);
      float row = floor(fi / uTexWidth);
      vec2 uv = vec2((col + 0.5) / uTexWidth, (row + 0.5) / uTexHeight);
      vec4 pin = texture(uPinTexture, uv);

      float r = pin.b;
      if (r <= 0.0) continue;
      vec2 dd = vWorld - pin.xy;
      float d2 = dot(dd, dd);
      float r2 = r * r;
      if (d2 >= r2) continue;
      // Wyvill soft-object falloff: (1 - d^2/r^2)^3.
      float fall = 1.0 - d2 / r2;
      fall = fall * fall * fall;
      int t = int(pin.a + 0.5);
      if (t == 0) f0 += fall;
      else if (t == 1) f1 += fall;
      else if (t == 2) f2 += fall;
      else f3 += fall;
    }

    float total = f0 + f1 + f2 + f3;
    if (total < uThreshold) discard;

    // Color = concentration-weighted blend (independent of absolute strength).
    vec3 col = (f0 * uColors[0] + f1 * uColors[1] + f2 * uColors[2] + f3 * uColors[3]) / total;
    // Alpha = absolute field strength, saturating at the cap.
    float alpha = clamp(total, 0.0, 1.0) * uMaxAlpha;
    fragColor = vec4(col, alpha);
  }
`

/** World-space rectangle the gradient is confined to (a board's white page). */
export interface FieldClip {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function MetaballOverlay({ pins, clip }: { pins: IntentPin[]; clip?: FieldClip | null }) {
  // The pin DataTexture lives across renders; we only reallocate when the pin
  // count needs more rows than are currently allocated (grow-only), and dispose
  // it on unmount so rapid pin mutations never leak GPU memory.
  const texRef = useRef<THREE.DataTexture | null>(null)

  // Stable uniform objects (allocated once); `.value`s are mutated in place as
  // pins change so the material never recompiles.
  const uniforms = useMemo(() => {
    const colors = new Float32Array(4 * 3)
    const c = new THREE.Color()
    INTENT_TYPES.forEach((t, i) => {
      c.set(INTENT_META[t].color)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    })
    return {
      uPinTexture: { value: null as THREE.DataTexture | null },
      uTotalPins: { value: 0 },
      uTexWidth: { value: TEX_WIDTH },
      uTexHeight: { value: 1 },
      uColors: { value: colors },
      uMaxAlpha: { value: MAX_ALPHA },
      uThreshold: { value: VIS_THRESHOLD },
      uClipMin: { value: new THREE.Vector2(0, 0) },
      uClipMax: { value: new THREE.Vector2(0, 0) },
      uClipEnabled: { value: 0 },
    }
  }, [])

  // Dispose the GPU texture when the overlay unmounts.
  useEffect(() => {
    return () => {
      texRef.current?.dispose()
      texRef.current = null
    }
  }, [])

  // Pack pins into the data texture and compute the bounding plane.
  const aabb = useMemo(() => {
    const count = pins.length
    const rows = Math.max(1, Math.ceil(count / TEX_WIDTH))

    // (Re)allocate only when more rows are needed than currently exist. The
    // backing array carries TEX_WIDTH * rows * 4 floats (RGBA per texel).
    let tex = texRef.current
    if (!tex || tex.image.height < rows) {
      tex?.dispose()
      const data = new Float32Array(TEX_WIDTH * rows * 4)
      tex = new THREE.DataTexture(data, TEX_WIDTH, rows, THREE.RGBAFormat, THREE.FloatType)
      tex.minFilter = THREE.NearestFilter
      tex.magFilter = THREE.NearestFilter
      texRef.current = tex
      uniforms.uPinTexture.value = tex
    }

    // Fill texels 0..count-1: rgba = (x, y, radius, typeIndex). Texels beyond
    // `count` are never sampled (the shader loop bound is uTotalPins = count).
    const data = tex.image.data as unknown as Float32Array
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < count; i++) {
      const p = pins[i]
      const o = i * 4
      data[o] = p.x
      data[o + 1] = p.y
      data[o + 2] = p.radius
      data[o + 3] = typeIndex(p.intentType)
      if (p.x - p.radius < minX) minX = p.x - p.radius
      if (p.y - p.radius < minY) minY = p.y - p.radius
      if (p.x + p.radius > maxX) maxX = p.x + p.radius
      if (p.y + p.radius > maxY) maxY = p.y + p.radius
    }
    tex.needsUpdate = true

    uniforms.uTotalPins.value = count
    uniforms.uTexHeight.value = tex.image.height

    if (count === 0) return null
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      w: maxX - minX + EDGE_PAD * 2,
      h: maxY - minY + EDGE_PAD * 2,
    }
  }, [pins, uniforms])

  // Feed the board-rect clip into the (stable) uniforms each render; mutating .value
  // leaves the material/program intact.
  if (clip) {
    uniforms.uClipMin.value.set(clip.minX, clip.minY)
    uniforms.uClipMax.value.set(clip.maxX, clip.maxY)
    uniforms.uClipEnabled.value = 1
  } else {
    uniforms.uClipEnabled.value = 0
  }

  if (!aabb) return null

  return (
    // renderOrder 26: the intent field is the topmost analytical layer, so it sorts
    // ABOVE the boundary infill (19/20) and circulation bands (24/25) — a 100% white
    // lot infill no longer paints over the gradient. depthTest off so it isn't
    // occluded by the depth buffer (mirrors the other canvas overlays). The solid pin
    // dots (PinMarkers, renderOrder 27) stay just above this wash.
    <mesh position={[aabb.cx, aabb.cy, FIELD_Z]} renderOrder={26} raycast={() => null}>
      <planeGeometry args={[aabb.w, aabb.h]} />
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
  )
}
