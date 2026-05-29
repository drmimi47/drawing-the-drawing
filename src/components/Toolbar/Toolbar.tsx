import { Pencil, Hand, MapPin } from 'lucide-react'
import './Toolbar.css'

/**
 * Floating bottom-center tool dock.
 *
 * Cluster A scope: visual stub only. The buttons are placeholders for the
 * Draw / Pan / Lock tools wired up in Clusters B, C, and H. Tool state and
 * active highlighting come with the Zustand store in Cluster B.
 */

const TOOLS = [
  { key: 'DRAW', label: 'Draw', Icon: Pencil },
  { key: 'PAN', label: 'Pan', Icon: Hand },
  { key: 'LOCK', label: 'Lock', Icon: MapPin },
] as const

export function Toolbar() {
  return (
    <div className="toolbar-dock" role="toolbar" aria-label="Tools">
      {TOOLS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className="tool-button"
          title={label}
          aria-label={label}
          disabled
        >
          <Icon size={20} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  )
}
