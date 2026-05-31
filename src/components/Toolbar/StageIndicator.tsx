import { useDrawingStore, type Stage, type ToolMode } from '../../store/drawingStore'

/**
 * Top-center stage indicator (Cluster G, G1).
 *
 * Shows the guided workflow as a non-modal row of stages; clicking a stage sets
 * it (and switches to the tool that stage primarily uses). The user may click
 * any stage at any time.
 */

const STAGES: { key: Stage; label: string; tool?: ToolMode; ready: boolean }[] = [
  { key: 'SKETCH', label: 'Sketch', tool: 'DRAW', ready: true },
  { key: 'NORMALIZE', label: 'Normalize', tool: 'SELECT', ready: true },
  { key: 'LOCK_INTENT', label: 'Lock / Intent', tool: 'LASSO_LOCK', ready: true },
  { key: 'GENERATE', label: 'Generate', ready: false },
]

export function StageIndicator() {
  const stage = useDrawingStore((s) => s.stage)
  const setStage = useDrawingStore((s) => s.setStage)
  const setTool = useDrawingStore((s) => s.setTool)

  return (
    <div className="stage-bar" role="tablist" aria-label="Workflow stages">
      {STAGES.map(({ key, label, tool, ready }, i) => (
        <span key={key} className="stage-item">
          {i > 0 && <span className="stage-arrow">→</span>}
          <button
            type="button"
            role="tab"
            aria-selected={stage === key}
            className={`stage-chip${stage === key ? ' is-active' : ''}${ready ? '' : ' is-future'}`}
            title={ready ? label : `${label} (coming soon)`}
            onClick={() => {
              setStage(key)
              if (tool) setTool(tool)
            }}
          >
            {label}
          </button>
        </span>
      ))}
    </div>
  )
}
