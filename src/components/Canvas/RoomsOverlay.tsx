import { useMemo } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useDrawingStore } from '../../store/drawingStore'
import { useProgramSheet } from '../../store/programSheetStore'
import { DEPARTMENT_META } from '../../types/geometry'
import { formatArea } from '../../geometry/area'

/**
 * Room subdivision rendering (restructure_v2 Stage 4). Each room is a filled polygon
 * tinted with its parent department's color plus a crisp outline, and labelled with its
 * department's INITIALS and a small floor-area figure, shown on the Rooms layer.
 *
 * On the CIRCULATION layer the room walls are echoed as a light-magenta CONTEXT ghost
 * (outline + initials only, non-interactive) so the user can see the room layout while
 * adding minor circulation paths — mirroring the magenta department back-reference.
 */

const ROOM_Z = 6.5 // above strokes / boundary fill, below the CAD snap overlays
const OUTLINE_COLOR = '#1f2937'
const LOCKED_OUTLINE = '#0f172a' // darker, heavier edge marks a frozen room
const CONTEXT_OUTLINE = '#f0a6e6' // light magenta — room walls as Circulation-layer context
const CONTEXT_LABEL = '#f3b6ec' // LIGHT magenta — room initials on Circulation, kept faint so they
//                                 don't compete with the normal/darker magenta refs already on screen
const HIGHLIGHT_COLOR = '#f59e0b' // amber — links a hovered Program Sheet row to its floorplan room(s)
/** Skip labels on rooms too small (in world units) to hold legible text, to avoid clutter. */
const LABEL_MIN_DIM = 22

/** Department-type initials, e.g. "Open Office" → "OO", "Conference / Meeting" → "CM". */
export function initialsOf(base: string): string {
  const words = base.replace(/[^a-zA-Z ]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('')
}

export function RoomsOverlay() {
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const toolMode = useDrawingStore((s) => s.toolMode)
  const rooms = useDrawingStore((s) => s.rooms)
  const departments = useDrawingStore((s) => s.departments)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)
  const toggleRoomLock = useDrawingStore((s) => s.toggleRoomLock)
  const highlight = useProgramSheet((s) => s.highlight)

  // Department color + initials by id (initials come from the program TYPE label when set,
  // else the department's name).
  const deptInfo = useMemo(() => {
    const m = new Map<string, { color: string; initials: string }>()
    for (const d of departments) {
      const base = d.deptType ? DEPARTMENT_META[d.deptType].label : d.name
      m.set(d.id, { color: d.color, initials: initialsOf(base) })
    }
    return m
  }, [departments])

  const unit = mpu != null && mpu > 0 ? ' sf' : ''

  const built = useMemo(
    () =>
      rooms
        .filter((r) => r.polygon.length >= 3)
        .map((r) => {
          const shape = new THREE.Shape(r.polygon.map((p) => new THREE.Vector2(p.x, p.y)))
          const pos = new Float32Array(r.polygon.length * 3)
          let cx = 0
          let cy = 0
          let minX = Infinity
          let maxX = -Infinity
          let minY = Infinity
          let maxY = -Infinity
          r.polygon.forEach((p, i) => {
            pos[i * 3] = p.x
            pos[i * 3 + 1] = p.y
            pos[i * 3 + 2] = ROOM_Z
            cx += p.x
            cy += p.y
            if (p.x < minX) minX = p.x
            if (p.x > maxX) maxX = p.x
            if (p.y < minY) minY = p.y
            if (p.y > maxY) maxY = p.y
          })
          cx /= r.polygon.length
          cy /= r.polygon.length
          const info = deptInfo.get(r.parentDeptId)
          return {
            id: r.roomId,
            deptId: r.parentDeptId,
            shape,
            pos,
            cx,
            cy,
            color: info?.color ?? '#888888',
            initials: info?.initials ?? '?',
            areaText: `${formatArea(r.areaSqf)}${unit}`,
            // Only label rooms wide AND tall enough that the screen-constant text fits cleanly.
            labelOk: Math.min(maxX - minX, maxY - minY) >= LABEL_MIN_DIM,
            locked: r.isLocked,
          }
        }),
    [rooms, deptInfo, unit],
  )

  // Rooms linked to the hovered Program Sheet row (a room id, or a whole department's rooms).
  const isHighlighted = (b: { id: string; deptId: string }) =>
    highlight != null && (highlight.kind === 'room' ? highlight.id === b.id : highlight.id === b.deptId)

  const onRooms = activeLayer === 'ROOMS'
  const onCirculation = activeLayer === 'CIRCULATION'
  if ((!onRooms && !onCirculation) || built.length === 0) return null

  // CIRCULATION context: room walls + initials only, light magenta, non-interactive — so the
  // user can place minor circulation against the room layout without entering the Rooms layer.
  if (onCirculation) {
    return (
      <>
        {built.map((b) => (
          <group key={b.id}>
            <lineLoop renderOrder={29} raycast={() => null} frustumCulled={false}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[b.pos, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={CONTEXT_OUTLINE} depthTest={false} transparent opacity={0.7} toneMapped={false} />
            </lineLoop>
            {b.labelOk && (
              <Html position={[b.cx, b.cy, ROOM_Z]} center pointerEvents="none" style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
                <div style={{ ...labelBase, color: CONTEXT_LABEL }}>
                  <span style={initialsStyle}>{b.initials}</span>
                </div>
              </Html>
            )}
          </group>
        ))}
      </>
    )
  }

  // Click-to-lock only with the (default) PAN tool — so the Erase tool can delete walls and the
  // Edit tool can drag corners on the Rooms layer without a stray lock toggle. With those tools
  // active the fills are non-interactive (raycast off) so their pointer events pass through.
  const lockable = toolMode === 'PAN'

  return (
    <>
      {built.map((b) => {
        const hl = isHighlighted(b)
        return (
        <group key={b.id}>
          {/* Locked rooms read as solid/frozen (stronger fill); clicking toggles the lock.
              A Program-Sheet-hovered room gets a stronger fill + amber outline below. */}
          <mesh
            position={[0, 0, ROOM_Z]}
            renderOrder={30}
            frustumCulled={false}
            raycast={lockable ? undefined : () => null}
            onClick={
              lockable
                ? (e) => {
                    e.stopPropagation()
                    toggleRoomLock(b.id)
                  }
                : undefined
            }
            onPointerOver={
              lockable
                ? (e) => {
                    e.stopPropagation()
                    document.body.style.cursor = 'pointer'
                  }
                : undefined
            }
            onPointerOut={lockable ? () => { document.body.style.cursor = 'default' } : undefined}
          >
            <shapeGeometry args={[b.shape]} />
            <meshBasicMaterial
              color={hl ? HIGHLIGHT_COLOR : b.color}
              transparent
              opacity={hl ? 0.5 : b.locked ? 0.5 : 0.22}
              depthTest={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <lineLoop renderOrder={hl ? 32 : 31} raycast={() => null} frustumCulled={false}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[b.pos, 3]} />
            </bufferGeometry>
            <lineBasicMaterial
              color={hl ? HIGHLIGHT_COLOR : b.locked ? LOCKED_OUTLINE : OUTLINE_COLOR}
              linewidth={hl ? 3 : b.locked ? 2 : 1}
              depthTest={false}
              transparent
              toneMapped={false}
            />
          </lineLoop>
          {/* Department initials + small floor-area figure, centered in the room. */}
          {b.labelOk && (
            <Html position={[b.cx, b.cy, ROOM_Z]} center pointerEvents="none" style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
              <div style={{ ...labelBase, color: OUTLINE_COLOR }}>
                <span style={initialsStyle}>{b.initials}</span>
                <span style={areaStyle}>{b.areaText}</span>
              </div>
            </Html>
          )}
        </group>
        )
      })}
    </>
  )
}

const labelBase: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  lineHeight: 1.05,
  pointerEvents: 'none',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  textShadow: '0 0 2px #fff, 0 0 2px #fff', // keep legible over the tinted fill
  fontFamily: 'system-ui, sans-serif',
}
const initialsStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }
const areaStyle: React.CSSProperties = { fontSize: 8, fontWeight: 500, opacity: 0.8 }
