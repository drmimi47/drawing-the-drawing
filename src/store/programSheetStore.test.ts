import { describe, it, expect, beforeEach } from 'vitest'
import { useProgramSheet } from './programSheetStore'

/** Program Sheet view-state (document_int.txt §1): open/close/split/full + tab selection. */
beforeEach(() => {
  useProgramSheet.setState({ view: 'closed', tab: 'dashboard' })
})

describe('programSheetStore', () => {
  it('toggle opens to split from closed, and closes again', () => {
    useProgramSheet.getState().toggle()
    expect(useProgramSheet.getState().view).toBe('split')
    useProgramSheet.getState().toggle()
    expect(useProgramSheet.getState().view).toBe('closed')
  })

  it('open defaults to split, or honors an explicit mode', () => {
    useProgramSheet.getState().open()
    expect(useProgramSheet.getState().view).toBe('split')
    useProgramSheet.getState().open('full')
    expect(useProgramSheet.getState().view).toBe('full')
  })

  it('setView switches between split and full; close resets', () => {
    useProgramSheet.getState().open('split')
    useProgramSheet.getState().setView('full')
    expect(useProgramSheet.getState().view).toBe('full')
    useProgramSheet.getState().close()
    expect(useProgramSheet.getState().view).toBe('closed')
  })

  it('tracks the active tab', () => {
    useProgramSheet.getState().setTab('departments')
    expect(useProgramSheet.getState().tab).toBe('departments')
    useProgramSheet.getState().setTab('rooms')
    expect(useProgramSheet.getState().tab).toBe('rooms')
  })
})
