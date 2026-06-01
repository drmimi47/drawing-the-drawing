import { Html } from '@react-three/drei'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * Renders committed text labels (Cluster H addition) anchored to world points.
 * Uses drei <Html> so labels stay pinned to the canvas as it pans/zooms and use
 * crisp DOM fonts. The label currently being edited is hidden (the DOM editor
 * shows it instead).
 */
export function TextLayer() {
  const labels = useDrawingStore((s) => s.textLabels)
  const pending = useDrawingStore((s) => s.pendingText)
  const editingId = pending?.id ?? null

  return (
    <>
      {labels.map((label) =>
        label.id === editingId ? null : (
          <Html key={label.id} position={[label.x, label.y, 0.7]} pointerEvents="none" zIndexRange={[5, 0]}>
            <div
              style={{
                color: label.color,
                fontSize: `${label.size}px`,
                fontWeight: 600,
                whiteSpace: 'pre',
                userSelect: 'none',
                lineHeight: 1,
              }}
            >
              {label.text}
            </div>
          </Html>
        ),
      )}
    </>
  )
}
