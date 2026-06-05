import { useEffect } from 'react'
import { Table, X, Maximize2, Columns2, AlertTriangle } from 'lucide-react'
import { useProgramSheet, type ProgramSheetTab } from '../../store/programSheetStore'
import { DashboardTab } from './DashboardTab'
import { DepartmentTab } from './DepartmentTab'
import { RoomTab } from './RoomTab'
import './ProgramSheet.css'

/**
 * Program Sheet — the integrated space-programming grid (document_int.txt).
 *
 * STEP 1: UI/UX placement + modal viewstate (header button + split / full-screen).
 * STEP 2: the three tabs are LIVE & BI-DIRECTIONAL (downstream metrics; upstream targets / room
 *   count / locks). Invalid entries flash the advisory HUD (§4.3).
 * STEP 3 (this step): the grid matrix is complete — Dashboard shows Target/Actual/Variance/
 *   Efficiency; a Department target now SIZES its pin (⊏ sheet constraint chip); Room rows are
 *   nameable and have Split / Merge (Stage 4.4) row actions.
 * Still deferred: Excel import/export (§1.3).
 */

const TABS: { key: ProgramSheetTab; label: string }[] = [
  { key: 'dashboard', label: 'Project Dashboard' },
  { key: 'departments', label: 'Department Schedule' },
  { key: 'rooms', label: 'Room Schedule' },
]

export function ProgramSheet() {
  const view = useProgramSheet((s) => s.view)
  const tab = useProgramSheet((s) => s.tab)
  const advisory = useProgramSheet((s) => s.advisory)
  const setView = useProgramSheet((s) => s.setView)
  const setTab = useProgramSheet((s) => s.setTab)
  const close = useProgramSheet((s) => s.close)
  const clearAdvisory = useProgramSheet((s) => s.clearAdvisory)

  // Esc closes the full-screen overlay (it covers the app; split mode leaves the canvas usable).
  useEffect(() => {
    if (view !== 'full') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [view, close])

  // Auto-dismiss the advisory banner a moment after it flashes (id bumps each flash).
  useEffect(() => {
    if (!advisory) return
    const t = setTimeout(clearAdvisory, 2600)
    return () => clearTimeout(t)
  }, [advisory, clearAdvisory])

  if (view === 'closed') return null

  return (
    <section className={`program-sheet program-sheet--${view}`} aria-label="Program Sheet" role="region">
      <header className="ps-header">
        <div className="ps-title">
          <Table size={15} strokeWidth={2} />
          <span>Program Sheet</span>
        </div>
        <div className="ps-header-actions">
          <button
            type="button"
            className="ps-icon-btn"
            title={view === 'split' ? 'Full screen' : 'Split screen'}
            aria-label={view === 'split' ? 'Full screen' : 'Split screen'}
            onClick={() => setView(view === 'split' ? 'full' : 'split')}
          >
            {view === 'split' ? <Maximize2 size={15} strokeWidth={2} /> : <Columns2 size={15} strokeWidth={2} />}
          </button>
          <button type="button" className="ps-icon-btn" title="Close" aria-label="Close" onClick={close}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </header>

      <nav className="ps-tabs" role="tablist" aria-label="Program sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`ps-tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="ps-body" role="tabpanel">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'departments' && <DepartmentTab />}
        {tab === 'rooms' && <RoomTab />}
      </div>

      {advisory && (
        <div className="ps-advisory" role="alert">
          <AlertTriangle size={14} strokeWidth={2} />
          <span>{advisory.msg}</span>
        </div>
      )}
    </section>
  )
}
