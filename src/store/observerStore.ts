import { create } from 'zustand'

/**
 * Viewport observer config (Cluster E).
 *
 * The "observation boundary" is the real viewport inset by `marginPx` pixels.
 * Geometry outside it is unobserved (at-risk); inside it is protected. Insetting
 * keeps the unobserved band ON SCREEN so the behavior is visible while debugging
 * (with margin = 0 the boundary becomes the true viewport edge).
 */

interface ObserverState {
  /** Show the boundary rectangle + at-risk edge highlight. */
  debug: boolean
  /** Inset of the observation boundary from the viewport edge, in screen pixels. */
  marginPx: number

  toggleDebug: () => void
  setMargin: (px: number) => void
}

export const useObserverStore = create<ObserverState>((set) => ({
  debug: true,
  marginPx: 70,
  toggleDebug: () => set((s) => ({ debug: !s.debug })),
  setMargin: (px) => set({ marginPx: px }),
}))
