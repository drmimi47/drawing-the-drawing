import { useMemo } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { computeProgramMetrics } from '../../geometry/programMetrics'
import { formatArea } from '../../geometry/area'
import { useColumnWidths, ColGroup, ColHandle } from './columns'

/**
 * TAB 1 — Project Dashboard (document_int.txt §3): read-only macro efficiency, computed live
 * from the canvas (the downstream binding). Re-renders whenever boundary / circulation / rooms
 * change in the store.
 */
export function DashboardTab() {
  const boundary = useDrawingStore((s) => s.boundary)
  const circulationPaths = useDrawingStore((s) => s.circulationPaths)
  const rooms = useDrawingStore((s) => s.rooms)
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)

  const m = useMemo(
    () => computeProgramMetrics(boundary, circulationPaths, rooms, mpu),
    [boundary, circulationPaths, rooms, mpu],
  )

  const target = boundary?.targetSqf ?? null
  const siteVariance = target != null ? m.grossSite - target : null
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const { widths, total, onResizeDown } = useColumnWidths('dashboard', [180, 110, 110, 110, 100])

  // Metric Name | Target | Actual | Variance | Efficiency % (document_int.txt §3 TAB 1).
  const rows = [
    {
      name: 'Gross Site Area',
      target: target != null ? formatArea(target) : '—',
      actual: formatArea(m.grossSite),
      variance:
        siteVariance != null ? `${siteVariance >= 0 ? '+' : ''}${formatArea(siteVariance)}` : '—',
      neg: siteVariance != null && siteVariance < 0,
      eff: target != null && target > 0 ? pct(m.grossSite / target) : '—', // % of target met
    },
    {
      name: 'Gross Circulation Area',
      target: '—',
      actual: formatArea(m.grossCirculation),
      variance: '—',
      neg: false,
      eff: m.grossSite > 0 ? pct(m.grossCirculation / m.grossSite) : '—', // share of site
    },
    {
      name: 'Net Assignable Area',
      target: '—',
      actual: formatArea(m.netAssignable),
      variance: '—',
      neg: false,
      eff: m.grossSite > 0 ? pct(m.netAssignable / m.grossSite) : '—', // = net-to-gross
    },
  ]

  return (
    <div className="ps-tab-pane">
      <table className="ps-table ps-table--resizable" style={{ width: total }}>
        <ColGroup widths={widths} />
        <thead>
          <tr>
            <th>Metric<ColHandle onPointerDown={onResizeDown(0)} /></th>
            <th className="ps-num">Target ({m.unit})<ColHandle onPointerDown={onResizeDown(1)} /></th>
            <th className="ps-num">Actual ({m.unit})<ColHandle onPointerDown={onResizeDown(2)} /></th>
            <th className="ps-num">Variance<ColHandle onPointerDown={onResizeDown(3)} /></th>
            <th className="ps-num">Efficiency<ColHandle onPointerDown={onResizeDown(4)} /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="ps-num ps-dim">{r.target}</td>
              <td className="ps-num">{r.actual}</td>
              <td className={`ps-num${r.neg ? ' ps-neg' : ''}`}>{r.variance}</td>
              <td className="ps-num ps-dim">{r.eff}</td>
            </tr>
          ))}
          <tr className="ps-row-strong">
            <td>Net-to-Gross Ratio</td>
            <td className="ps-num ps-dim">—</td>
            <td className="ps-num">{pct(m.netToGross)}</td>
            <td className="ps-num">—</td>
            <td className="ps-num">{pct(m.netToGross)}</td>
          </tr>
        </tbody>
      </table>
      <p className="ps-hint">
        Live figures from the canvas. Efficiency = share of the gross site (or % of target met for
        the site row). Set a lot target on the Boundary layer to see site variance.
      </p>
    </div>
  )
}
