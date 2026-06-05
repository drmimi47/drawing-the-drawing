import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import type { Department, Room } from '../types/geometry'

/**
 * Program Sheet §3 upstream actions: applyDepartmentTarget (target → pin size), and the room
 * row actions split / merge / rename.
 */

const dept = (id: string): Department => ({ id, name: id, x: 200, y: 200, radius: 60, color: '#39c' })
const sq = (id: string, deptId: string, x0: number, x1: number, locked = false): Room => ({
  roomId: id, parentDeptId: deptId, isLocked: locked, areaSqf: (x1 - x0) * 100,
  polygon: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 100 }, { x: x0, y: 100 }],
})

beforeEach(() => {
  useDrawingStore.setState({ departments: [], rooms: [], boundary: null, metersPerWorldUnit: null })
})

describe('applyDepartmentTarget', () => {
  it('sizes the pin radius to the target SQF and records the goal', () => {
    useDrawingStore.setState({ departments: [dept('A')] })
    useDrawingStore.getState().applyDepartmentTarget('A', 1684) // ≈ π·0.536·r² ⇒ r ≈ √(1684/1.684)=√1000
    const a = useDrawingStore.getState().departments.find((d) => d.id === 'A')!
    expect(a.targetSqf).toBe(1684)
    expect(a.radius).toBeCloseTo(Math.sqrt(1684 / (Math.PI * 0.536)), 0) // ≈ 31.6
  })

  it('clearing the target leaves the radius alone (free to resize)', () => {
    useDrawingStore.setState({ departments: [{ ...dept('A'), radius: 77, targetSqf: 500 }] })
    useDrawingStore.getState().applyDepartmentTarget('A', undefined)
    const a = useDrawingStore.getState().departments.find((d) => d.id === 'A')!
    expect(a.targetSqf).toBeUndefined()
    expect(a.radius).toBe(77)
  })
})

describe('room row actions', () => {
  it('splitRoom replaces a room with two halves', () => {
    useDrawingStore.setState({ rooms: [sq('r', 'A', 0, 100)] })
    useDrawingStore.getState().splitRoom('r')
    expect(useDrawingStore.getState().rooms.length).toBe(2)
  })

  it('mergeRoom merges a room into its same-department neighbor', () => {
    useDrawingStore.setState({ rooms: [sq('a', 'A', 0, 100), sq('b', 'A', 100, 200)] })
    useDrawingStore.getState().mergeRoom('a')
    expect(useDrawingStore.getState().rooms.length).toBe(1)
  })

  it('renameRoom sets and clears a transient name', () => {
    useDrawingStore.setState({ rooms: [sq('r', 'A', 0, 100)] })
    useDrawingStore.getState().renameRoom('r', 'Lobby')
    expect(useDrawingStore.getState().rooms[0].name).toBe('Lobby')
    useDrawingStore.getState().renameRoom('r', '   ')
    expect(useDrawingStore.getState().rooms[0].name).toBeUndefined()
  })

  it('does not split or merge a locked room', () => {
    useDrawingStore.setState({ rooms: [sq('a', 'A', 0, 100, true), sq('b', 'A', 100, 200)] })
    useDrawingStore.getState().splitRoom('a')
    useDrawingStore.getState().mergeRoom('a')
    expect(useDrawingStore.getState().rooms.length).toBe(2) // unchanged
  })
})
