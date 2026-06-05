/**
 * Artboard (page sheet) confinement (Gradia restructure).
 *
 * The page sheet is a fixed-size white rectangle (store.pageWidth × store.pageHeight)
 * centered at the ACTIVE board's world origin — the central board is at (0,0), but
 * design-option boards sit at offsets. Drawing tools clamp their input to that
 * rectangle so geometry can't be created out in the grey workspace — the way
 * Photoshop keeps painting on the artboard. Callers pass the active board's origin
 * as `center` (defaults to the world origin for the single-board case).
 */

type Pt = { x: number; y: number }

/** Clamp a world point into the page rectangle centered at `center` (default origin). */
export function clampToPage(
  p: Pt,
  pageWidth: number,
  pageHeight: number,
  center: Pt = { x: 0, y: 0 },
): Pt {
  const hw = pageWidth / 2
  const hh = pageHeight / 2
  return {
    x: Math.max(center.x - hw, Math.min(center.x + hw, p.x)),
    y: Math.max(center.y - hh, Math.min(center.y + hh, p.y)),
  }
}

/** True when a world point lies inside the page rectangle centered at `center`. */
export function isInsidePage(
  p: Pt,
  pageWidth: number,
  pageHeight: number,
  center: Pt = { x: 0, y: 0 },
): boolean {
  return Math.abs(p.x - center.x) <= pageWidth / 2 && Math.abs(p.y - center.y) <= pageHeight / 2
}
