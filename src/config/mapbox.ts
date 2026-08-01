/**
 * Mapbox configuration, read once from the build-time environment.
 *
 * `VITE_`-prefixed vars are inlined into the client bundle at build time, so the
 * token below ships to every visitor in plain text. It must therefore be a
 * URL-restricted public (`pk.`) token — never a secret (`sk.`) one.
 *
 * When no token is configured the app stays fully usable with map mode switched
 * off, rather than mounting a map that can only fail. `MAPBOX_ENABLED` gates
 * every entry point into that mode.
 */

/** Access token; empty when map mode is intentionally disabled. */
export const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim()

/** Style URL — a published Studio style owned by the token's account, else the stock fallback. */
export const MAPBOX_STYLE =
  (import.meta.env.VITE_MAPBOX_STYLE ?? '').trim() || 'mapbox://styles/mapbox/streets-v12'

/** True when a usable token is configured. */
export const MAPBOX_ENABLED = MAPBOX_TOKEN.length > 0

/** Shown wherever map mode is offered but no token is configured. */
export const MAPBOX_DISABLED_MESSAGE =
  'Map mode is off — this build ships without a Mapbox access token. ' +
  'Use Blank sheet or Import to keep working.'
