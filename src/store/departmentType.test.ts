import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import { DEPARTMENT_META, type DepartmentType } from '../types/geometry'

/**
 * Department placement now picks a program TYPE from a popup (mirroring intent pins):
 * center → type → radius → commit. The type drives the default name + color, and the
 * service types (Core / Mechanical) keep a fixed grey / black that can't be recolored.
 */

beforeEach(() => {
  useDrawingStore.setState({ departments: [], pendingDept: null })
})

const place = (type: DepartmentType, x = 100, y = 100) => {
  const s = useDrawingStore.getState()
  s.beginDept(x, y, 0, 0)
  expect(useDrawingStore.getState().pendingDept?.phase).toBe('type')
  s.setDeptType(type)
  expect(useDrawingStore.getState().pendingDept?.phase).toBe('radius')
  s.setDeptRadius(80)
  s.commitDept()
  const list = useDrawingStore.getState().departments
  return list[list.length - 1]
}

describe('department type placement flow', () => {
  it('names and colors a new department from its chosen type', () => {
    const d = place('OPEN_OFFICE')
    expect(d.deptType).toBe('OPEN_OFFICE')
    expect(d.name).toBe(DEPARTMENT_META.OPEN_OFFICE.label)
    expect(d.color).toBe(DEPARTMENT_META.OPEN_OFFICE.color)
    expect(d.radius).toBe(80)
  })

  it('assigns black to Mechanical and grey to Core', () => {
    const mech = place('MECHANICAL')
    const core = place('CORE')
    expect(mech.color).toBe('#111111')
    expect(core.color).toBe('#9ca3af')
  })

  it('keeps Core / Mechanical color fixed; recolors normal types', () => {
    const mech = place('MECHANICAL')
    useDrawingStore.getState().setDepartmentColor(mech.id, '#ff0000')
    expect(useDrawingStore.getState().departments.find((x) => x.id === mech.id)!.color).toBe('#111111')

    const office = place('OPEN_OFFICE')
    useDrawingStore.getState().setDepartmentColor(office.id, '#ff0000')
    expect(useDrawingStore.getState().departments.find((x) => x.id === office.id)!.color).toBe('#ff0000')
  })

  it('does not commit without a chosen type', () => {
    const s = useDrawingStore.getState()
    s.beginDept(50, 50, 0, 0)
    s.commitDept() // still in type phase, no type picked
    expect(useDrawingStore.getState().departments.length).toBe(0)
    expect(useDrawingStore.getState().pendingDept).toBeNull()
  })
})
