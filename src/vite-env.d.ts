/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Mapbox GL JS access token (see .env). */
  readonly VITE_MAPBOX_TOKEN?: string
  /** Mapbox style URL (a published Studio style); defaults to mapbox/streets-v12. */
  readonly VITE_MAPBOX_STYLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// mapbox-gl-draw-snap-mode ships no usable type declarations.
declare module 'mapbox-gl-draw-snap-mode' {
  // Custom MapboxDraw modes + style preset (typed loosely; MapboxDraw modes are untyped).
  export const SnapPointMode: object
  export const SnapLineMode: object
  export const SnapPolygonMode: object
  export const SnapDirectSelect: object
  export const SnapModeDrawStyles: object[]
}
