import { useEffect, useMemo } from 'react'
import { Lock, SplitSquareHorizontal, Combine } from 'lucide-react'
import { useDrawingStore } from '../../store/drawingStore'
import { useProgramSheet } from '../../store/programSheetStore'
import { formatArea } from '../../geometry/area'
import { useColumnWidths, ColGroup, ColHandle } from './columns'
import { TextCell } from './cells'

/**
 * TAB 3 — Room Schedule (document_int.txt §3): one row per store.rooms. Editable name and the
 * "Is Locked" checkbox are UPSTREAM bindings; Split / Merge row actions invoke the Stage-4.4
 * geometric slicing (split a room in two, or merge it into its best same-dept neighbor). Parent
 * department, actual SQF, and % of department total are derived.
 */
export function RoomTab() {
  const rooms = useDrawingStore((s) => s.rooms)
  const departments = useDrawingStore((s) => s.departments)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)
  const toggleRoomLock = useDrawingStore((s) => s.toggleRoomLock)
  const clearRoomLocks = useDrawingStore((s) => s.clearRoomLocks)
  const renameRoom = useDrawingStore((s) => s.renameRoom)
  const splitRoom = useDrawingStore((s) => s.splitRoom)
  const mergeRoom = useDrawingStore((s) => s.mergeRoom)
  const setHighlight = useProgramSheet((s) => s.setHighlight)
  useEffect(() => () => setHighlight(null), [setHighlight]) // clear highlight on unmount

  const unit = mpu != null && mpu > 0 ? 'ft²' : 'units²'

  const deptById = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>()
    for (const d of departments) m.set(d.id, { name: d.name, color: d.color })
    return m
  }, [departments])

  // Per-department total area, to express each room as a % of its department.
  const deptTotal = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rooms) m.set(r.parentDeptId, (m.get(r.parentDeptId) ?? 0) + r.areaSqf)
    return m
  }, [rooms])

  const lockedCount = rooms.filter((r) => r.isLocked).length
  const { widths, total, onResizeDown } = useColumnWidths('rooms', [140, 140, 90, 76, 56, 96])

  if (rooms.length === 0) {
    return <div className="ps-empty">No rooms yet — open the Rooms layer to generate them.</div>
  }

  return (
    <div className="ps-tab-pane">
      <table className="ps-table ps-table--resizable" style={{ width: total }}>
        <ColGroup widths={widths} />
        <thead>
          <tr>
            <th>Room<ColHandle onPointerDown={onResizeDown(0)} /></th>
            <th>Department<ColHandle onPointerDown={onResizeDown(1)} /></th>
            <th className="ps-num">Area ({unit})<ColHandle onPointerDown={onResizeDown(2)} /></th>
            <th className="ps-num">% of Dept<ColHandle onPointerDown={onResizeDown(3)} /></th>
            <th className="ps-center">Locked<ColHandle onPointerDown={onResizeDown(4)} /></th>
            <th className="ps-center">Actions<ColHandle onPointerDown={onResizeDown(5)} /></th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => {
            const dept = deptById.get(r.parentDeptId)
            const deptArea = deptTotal.get(r.parentDeptId) ?? 0
            const pct = deptArea > 0 ? Math.round((r.areaSqf / deptArea) * 100) : 0
            const code = dept ? dept.name : '—'
            return (
              <tr
                key={r.roomId}
                className={r.isLocked ? 'ps-row-locked' : undefined}
                onMouseEnter={() => setHighlight({ kind: 'room', id: r.roomId })}
                onMouseLeave={() => setHighlight(null)}
              >
                <td>
                  <TextCell
                    value={r.name ?? ''}
                    placeholder={r.roomId}
                    onCommit={(v) => renameRoom(r.roomId, v)}
                    ariaLabel={`Name ${r.roomId}`}
                  />
                </td>
                <td>
                  <div className="ps-name-cell">
                    <span className="ps-swatch" style={{ background: dept?.color ?? '#888' }} aria-hidden />
                    {code}
                  </div>
                </td>
                <td className="ps-num">{formatArea(r.areaSqf)}</td>
                <td className="ps-num ps-dim">{pct}%</td>
                <td className="ps-center">
                  <input
                    type="checkbox"
                    checked={r.isLocked}
                    onChange={() => toggleRoomLock(r.roomId)}
                    aria-label={`Lock ${r.roomId}`}
                  />
                </td>
                <td className="ps-center">
                  <div className="ps-row-actions">
                    <button
                      type="button"
                      className="ps-icon-btn ps-icon-btn--sm"
                      title="Split this room in two"
                      disabled={r.isLocked}
                      onClick={() => splitRoom(r.roomId)}
                    >
                      <SplitSquareHorizontal size={14} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="ps-icon-btn ps-icon-btn--sm"
                      title="Merge into adjacent same-department room"
                      disabled={r.isLocked}
                      onClick={() => mergeRoom(r.roomId)}
                    >
                      <Combine size={14} strokeWidth={2} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="ps-tab-foot">
        <span className="ps-hint">
          {lockedCount} of {rooms.length} room{rooms.length === 1 ? '' : 's'} locked. Locked rooms
          survive regeneration and become keep-outs the rest reflow around.
        </span>
        {lockedCount > 0 && (
          <button type="button" className="ps-foot-btn" onClick={clearRoomLocks}>
            <Lock size={12} strokeWidth={2} /> Unlock all
          </button>
        )}
      </div>
    </div>
  )
}
