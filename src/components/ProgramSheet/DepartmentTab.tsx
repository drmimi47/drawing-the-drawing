import { useEffect, useMemo } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { useProgramSheet } from '../../store/programSheetStore'
import { computeDepartmentAreas } from '../../geometry/departmentAreas'
import { formatArea } from '../../geometry/area'
import { DEPARTMENT_META } from '../../types/geometry'
import { NumberCell, TextCell, type ValidateResult } from './cells'
import { useColumnWidths, ColGroup, ColHandle } from './columns'

/**
 * TAB 2 — Department Schedule (document_int.txt §3): one row per store.departments. Editable
 * name, target SQF, and room count N (the UPSTREAM binding) with live derived areas. Editing N
 * re-slices that department (setRoomCount → Stage 4); editing the target stores the goal (the
 * pin-diameter constraint it drives is a later step). Invalid N is rejected (§4.3).
 */

const positiveOrZero = (raw: string): ValidateResult => {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return { ok: false, msg: 'Target must be a positive number.' }
  return { ok: true, value: Math.round(n) }
}

const roomCountValid = (raw: string): ValidateResult => {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return { ok: false, msg: 'Room count must be a whole number ≥ 1.' }
  return { ok: true, value: n }
}

export function DepartmentTab() {
  const departments = useDrawingStore((s) => s.departments)
  const rooms = useDrawingStore((s) => s.rooms)
  const boundary = useDrawingStore((s) => s.boundary)
  const circulationPaths = useDrawingStore((s) => s.circulationPaths)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)
  const rename = useDrawingStore((s) => s.renameDepartment)
  const applyTarget = useDrawingStore((s) => s.applyDepartmentTarget)
  const setRoomCount = useDrawingStore((s) => s.setRoomCount)
  const flash = useProgramSheet((s) => s.flash)
  const setHighlight = useProgramSheet((s) => s.setHighlight)
  useEffect(() => () => setHighlight(null), [setHighlight]) // clear highlight on unmount

  const unit = mpu != null && mpu > 0 ? 'ft²' : 'units²'

  const areas = useMemo(() => {
    const mainPaths = circulationPaths.filter((p) => p.tier !== 'MINOR')
    return computeDepartmentAreas(boundary, mainPaths, departments, mpu).areas
  }, [boundary, circulationPaths, departments, mpu])

  const roomCountById = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rooms) m.set(r.parentDeptId, (m.get(r.parentDeptId) ?? 0) + 1)
    return m
  }, [rooms])

  const { widths, total, onResizeDown } = useColumnWidths('departments', [160, 140, 96, 84, 84, 76])

  if (departments.length === 0) {
    return <div className="ps-empty">No departments yet — drop department pins on the Departments layer.</div>
  }

  return (
    <div className="ps-tab-pane">
      <table className="ps-table ps-table--resizable" style={{ width: total }}>
        <ColGroup widths={widths} />
        <thead>
          <tr>
            <th>Department<ColHandle onPointerDown={onResizeDown(0)} /></th>
            <th>Type<ColHandle onPointerDown={onResizeDown(1)} /></th>
            <th className="ps-num">Target {unit}<ColHandle onPointerDown={onResizeDown(2)} /></th>
            <th className="ps-num">Core<ColHandle onPointerDown={onResizeDown(3)} /></th>
            <th className="ps-num">Max<ColHandle onPointerDown={onResizeDown(4)} /></th>
            <th className="ps-num">Rooms N<ColHandle onPointerDown={onResizeDown(5)} /></th>
          </tr>
        </thead>
        <tbody>
          {departments.map((d) => {
            const a = areas[d.id]
            const actualN = roomCountById.get(d.id) ?? 0
            const over = d.targetSqf != null && d.targetSqf > 0 && (a?.maxSqf ?? 0) < d.targetSqf
            return (
              <tr
                key={d.id}
                onMouseEnter={() => setHighlight({ kind: 'dept', id: d.id })}
                onMouseLeave={() => setHighlight(null)}
              >
                <td>
                  <div className="ps-name-cell">
                    <span className="ps-swatch" style={{ background: d.color }} aria-hidden />
                    <TextCell value={d.name} onCommit={(v) => rename(d.id, v)} ariaLabel="Department name" />
                    {d.targetSqf != null && (
                      <span className="ps-chip" title="Pin diameter is sized from this sheet target">⊏ sheet</span>
                    )}
                  </div>
                </td>
                <td className="ps-dim">{d.deptType ? DEPARTMENT_META[d.deptType].label : '—'}</td>
                <td className={`ps-num${over ? ' ps-neg' : ''}`} title={over ? 'Max footprint is below target' : undefined}>
                  <NumberCell
                    value={d.targetSqf ?? null}
                    placeholder="—"
                    validate={positiveOrZero}
                    onCommit={(v) => applyTarget(d.id, v)}
                    onClear={() => applyTarget(d.id, undefined)}
                    onReject={flash}
                    ariaLabel={`${d.name} target`}
                  />
                </td>
                <td className="ps-num ps-dim">{formatArea(a?.coreSqf ?? 0)}</td>
                <td className="ps-num ps-dim">{formatArea(a?.maxSqf ?? 0)}</td>
                <td className="ps-num ps-col-n">
                  <NumberCell
                    value={d.roomCount ?? actualN}
                    validate={roomCountValid}
                    onCommit={(v) => setRoomCount(d.id, v)}
                    onReject={flash}
                    ariaLabel={`${d.name} room count`}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="ps-hint">
        Edit a <strong>target</strong> to size that department's pin to the goal (the
        <span className="ps-chip">⊏ sheet</span> chip marks it referenced from here); clear it to
        resize the pin freely. Edit <strong>Rooms N</strong> to re-slice. Core = exclusive
        footprint, Max = incl. negotiable overlap.
      </p>
    </div>
  )
}
