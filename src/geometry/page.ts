/**
 * Artboard (page sheet) confinement (Bloom restructure).
 *
 * The page sheet is a fixed-size white rectangle centered at the world origin
 * (store.pageWidth × store.pageHeight). Drawing tools clamp their input to it so
 * geometry can't be created out in the grey workspace — the way Photoshop keeps
 * painting on the artboard.
 */

type Pt = { x: number; y: number }

/** Clamp a world point into the centered page rectangle. */
export function clampToPage(p: Pt, pageWidth: number, pageHeight: number): Pt {
  const hw = pageWidth / 2
  const hh = pageHeight / 2
  return {
    x: Math.max(-hw, Math.min(hw, p.x)),
    y: Math.max(-hh, Math.min(hh, p.y)),
  }
}
