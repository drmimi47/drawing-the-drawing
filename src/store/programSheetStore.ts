import { create } from 'zustand'

/**
 * Program Sheet view-state (document_int.txt §1 — UI/UX Placement & Modal Viewstate).
 *
 * This is UI-only chrome state (which is why it lives OUTSIDE drawingStore and its undo
 * history). The sheet itself is just an alternative visual representation of drawingStore;
 * the bi-directional data binding (§2) and the grid tabs' content (§3) land in later steps.
 *
 *   view:  'closed' | 'split' (canvas left, sheet right) | 'full' (high-density overlay modal)
 *   tab:   which of the three schedule tabs is showing.
 */

export type ProgramSheetView = 'closed' | 'split' | 'full'
export type ProgramSheetTab = 'dashboard' | 'departments' | 'rooms'

/** The floorplan element a hovered sheet row links to (highlighted on the canvas). */
export type SheetHighlight = { kind: 'room' | 'dept'; id: string } | null

/** A transient advisory message (§4.3): invalid cell entries flag here instead of letting bad
 *  values reach the slicing engine. `id` bumps each flash so the banner re-triggers its timeout. */
export interface Advisory {
  msg: string
  id: number
}

interface ProgramSheetState {
  view: ProgramSheetView
  tab: ProgramSheetTab
  advisory: Advisory | null
  /** Floorplan element linked to the currently-hovered sheet row (null = none). */
  highlight: SheetHighlight
  /** Open the sheet (defaults to split-screen). */
  open: (view?: Exclude<ProgramSheetView, 'closed'>) => void
  close: () => void
  setView: (view: ProgramSheetView) => void
  /** Header button: open at split if closed, otherwise close. */
  toggle: () => void
  setTab: (tab: ProgramSheetTab) => void
  /** Flash a transient advisory (rejected input, etc.). */
  flash: (msg: string) => void
  clearAdvisory: () => void
  /** Set/clear the floorplan highlight for a hovered sheet row. */
  setHighlight: (highlight: SheetHighlight) => void
}

export const useProgramSheet = create<ProgramSheetState>((set) => ({
  view: 'closed',
  tab: 'dashboard',
  advisory: null,
  highlight: null,
  open: (view = 'split') => set({ view }),
  close: () => set({ view: 'closed' }),
  setView: (view) => set({ view }),
  toggle: () => set((s) => ({ view: s.view === 'closed' ? 'split' : 'closed' })),
  setTab: (tab) => set({ tab }),
  flash: (msg) => set((s) => ({ advisory: { msg, id: (s.advisory?.id ?? 0) + 1 } })),
  clearAdvisory: () => set({ advisory: null }),
  setHighlight: (highlight) => set({ highlight }),
}))
