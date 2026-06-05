import { describe, it, expect } from 'vitest'
import { initialsOf } from './RoomsOverlay'
import { DEPARTMENT_META, DEPARTMENT_TYPES } from '../../types/geometry'

/** Room labels show the department-type initials (plus a small area figure). */
describe('initialsOf', () => {
  it('takes the first letter of each word for multi-word types', () => {
    expect(initialsOf('Open Office')).toBe('OO')
    expect(initialsOf('Conference / Meeting')).toBe('CM') // punctuation ignored
    expect(initialsOf('Break Room / Pantry')).toBe('BRP')
  })

  it('uses the first two letters for single-word types', () => {
    expect(initialsOf('Core')).toBe('CO')
    expect(initialsOf('Mechanical')).toBe('ME')
  })

  it('produces a non-empty code for every department type', () => {
    for (const t of DEPARTMENT_TYPES) {
      const code = initialsOf(DEPARTMENT_META[t].label)
      expect(code.length).toBeGreaterThanOrEqual(1)
      expect(code).toBe(code.toUpperCase())
    }
  })

  it('falls back gracefully on empty input', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('123 / !!')).toBe('?')
  })
})
