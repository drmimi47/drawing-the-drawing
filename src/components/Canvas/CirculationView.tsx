import { useMemo } from 'react'
import * as THREE from 'three'
import { useDrawingStore } from '../../store/drawingStore'
import type { CirculationPath } from '../../types/geometry'
import { buildStrokeGeometry } from './strokeGeometry'

/**
 * Circulation corridors (Gradia restructure — Stage 2).
 *
 * In the Circulation layer (and forward) the corridor bands render as a SINGLE
 * flat-shaded region: every band's geometry is marked into the stencil buffer
 * (no colour written), then one translucent grey quad fills exactly that union.
 * This is what keeps the grey uniform — overlapping paths, self-overlapping sharp
 * corners, and dense intersecting networks never compound their alpha into darker
 * patches, because the colour is blended over the background exactly once.
 *
 * Stepping BACK to the Lot Boundary layer shows just the magenta centerlines as a
 * light back-reference (not the bands). The Context layer hides corridors entirely
 * — only the lot-boundary outline shows there.
 */

const FILL_COLOR = '#9aa3af' // corridor fill (solid grey)
const REFERENCE_COLOR = '#e000c0' // magenta centerline back-reference (Lot Boundary)
const BAND_OPACITY = 1 // solid (opaque) — corridors read as flat grey paths, no transparency
const Z = 8 // on top of strokes, grid, map, and the boundary frame

/** One band's geometry, writing only to the stencil buffer (coverage mask). */
function CorridorMask({ path }: { path: CirculationPath }) {
  const geometry = useMemo(
    () =>
      buildStrokeGeometry(
        path.centerline.map((p) => ({ x: p.x, y: p.y, w: path.width / 2 })),
        true,
        'solid',
        path.width,
      ),
    [path],
  )

  if (!geometry.positions || !geometry.indices) return null

  return (
    // frustumCulled off: the geometry is rebuilt only on edit, so its (lazily
    // cached) bounding sphere would otherwise go stale and cull when zoomed in.
    // colorWrite off + Replace→1 on the stencil marks the union without drawing.
    <mesh raycast={() => null} renderOrder={24} frustumCulled={false} position={[0, 0, Z]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      <meshBasicMaterial
        colorWrite={false}
        depthWrite={false}
        depthTest={false}
        side={THREE.DoubleSide}
        stencilWrite
        stencilRef={1}
        stencilFunc={THREE.AlwaysStencilFunc}
        stencilFail={THREE.KeepStencilOp}
        stencilZFail={THREE.KeepStencilOp}
        stencilZPass={THREE.ReplaceStencilOp}
      />
    </mesh>
  )
}

/** Single uniform grey fill clipped to the stencil-marked corridor union. Exported
 *  so read-only neighbor boards (InactiveCanvases) render the same offset bands. */
export function CorridorUnion({ paths }: { paths: CirculationPath[] }) {
  const masks = paths.map((p) => <CorridorMask key={p.id} path={p} />)

  // A quad covering the bounding box of every band (centerlines padded by half the
  // widest corridor). The stencil test restricts the actual fill to the union.
  const box = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxW = 0
    for (const p of paths) {
      maxW = Math.max(maxW, p.width)
      for (const pt of p.centerline) {
        if (pt.x < minX) minX = pt.x
        if (pt.y < minY) minY = pt.y
        if (pt.x > maxX) maxX = pt.x
        if (pt.y > maxY) maxY = pt.y
      }
    }
    const pad = maxW / 2 + 4
    return {
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    }
  }, [paths])

  if (!isFinite(box.w) || box.w <= 0) return null

  return (
    <>
      {masks}
      <mesh
        raycast={() => null}
        renderOrder={30}
        frustumCulled={false}
        position={[box.cx, box.cy, Z]}
      >
        <planeGeometry args={[box.w, box.h]} />
        <meshBasicMaterial
          color={FILL_COLOR}
          transparent
          opacity={BAND_OPACITY}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
          // Draw only where the stencil was marked (the band union); don't modify it.
          stencilWrite
          stencilRef={1}
          stencilFunc={THREE.EqualStencilFunc}
          stencilFail={THREE.KeepStencilOp}
          stencilZFail={THREE.KeepStencilOp}
          stencilZPass={THREE.KeepStencilOp}
        />
      </mesh>
    </>
  )
}

/** Magenta centerline-only back-reference shown in the Lot Boundary layer. */
function CenterlineRef({ path }: { path: CirculationPath }) {
  // Expand the centerline into discrete segment pairs for <lineSegments>
  // (an open polyline, so it isn't closed like a lineLoop).
  const positions = useMemo(() => {
    const c = path.centerline
    const arr = new Float32Array(Math.max(0, c.length - 1) * 6)
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i]
      const b = c[i + 1]
      arr.set([a.x, a.y, Z, b.x, b.y, Z], i * 6)
    }
    return arr
  }, [path])

  if (path.centerline.length < 2) return null

  return (
    <lineSegments key={positions.length} raycast={() => null} renderOrder={25} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      {/* transparent so it joins the transparent pass and sorts above the boundary fill */}
      <lineBasicMaterial color={REFERENCE_COLOR} depthTest={false} transparent toneMapped={false} />
    </lineSegments>
  )
}

export function CirculationView() {
  const paths = useDrawingStore((s) => s.circulationPaths)
  const activeLayer = useDrawingStore((s) => s.activeLayer)

  // Context: corridors hidden (only the lot-boundary reference shows).
  if (activeLayer === 'CONTEXT') return null

  // Lot Boundary: magenta centerlines only (back-reference, not the full bands).
  if (activeLayer === 'BOUNDARY') {
    return (
      <>
        {paths.map((p) => (
          <CenterlineRef key={p.id} path={p} />
        ))}
      </>
    )
  }

  // Circulation layer and forward: one flat-shaded union of all corridor bands.
  if (paths.length === 0) return null
  return <CorridorUnion paths={paths} />
}
