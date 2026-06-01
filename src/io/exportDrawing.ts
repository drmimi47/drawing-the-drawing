import { useDrawingStore } from '../store/drawingStore'
import { resolveStrokePoints } from '../geometry/graph'
import { dashArray } from '../components/Canvas/strokeGeometry'
import type { Graph, LineStyle, SamplePoint, Stroke, TextLabel } from '../types/geometry'

/**
 * Export the drawing as clean vector (SVG / PDF) or raster (PNG), bounded to the
 * page sheet (Cluster K). The page spans world coords x∈[-W/2, W/2], y∈[-H/2,
 * H/2]; output uses a top-left origin with y pointing down.
 *
 * SVG and PDF emit true vector polylines (so they open cleanly in Bluebeam /
 * CAD); PNG and PDF also composite the tracing underlay for visual fidelity,
 * while SVG stays vector-only.
 */

/** Underlay placement in export pixel space (top-left origin, y down). */
interface UnderlayRect {
  src: string
  left: number
  top: number
  width: number
  height: number
}

interface Scene {
  graph: Graph
  textLabels: TextLabel[]
  width: number
  height: number
  underlay: UnderlayRect | null
}

function readScene(): Scene {
  const s = useDrawingStore.getState()
  const W = s.pageWidth
  const H = s.pageHeight
  // Map the underlay's centered world rect into the page's top-left pixel frame.
  const underlay: UnderlayRect | null = s.underlay
    ? {
        src: s.underlay.src,
        left: s.underlay.x - s.underlay.width / 2 + W / 2,
        top: H / 2 - (s.underlay.y + s.underlay.height / 2),
        width: s.underlay.width,
        height: s.underlay.height,
      }
    : null
  return { graph: s.graph, textLabels: s.textLabels, width: W, height: H, underlay }
}

/** Average full stroke width (2 × mean half-width), with a sensible minimum. */
function meanStrokeWidth(points: SamplePoint[]): number {
  if (points.length === 0) return 1
  const sum = points.reduce((acc, p) => acc + p.w, 0)
  return Math.max(0.75, (sum / points.length) * 2)
}

interface ExportStroke {
  color: string
  width: number
  lineStyle?: LineStyle
  pts: SamplePoint[]
}

function strokePolylines(graph: Graph): ExportStroke[] {
  return graph.strokes
    .map((stroke: Stroke) => {
      const pts = resolveStrokePoints(graph, stroke)
      // Explicit drafting width wins; otherwise derive from the path half-widths.
      const width = stroke.strokeWidth ?? meanStrokeWidth(pts)
      return { color: stroke.color, width, lineStyle: stroke.lineStyle, pts }
    })
    .filter((s) => s.pts.length >= 2)
}

function download(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ---- SVG (vector only) ----------------------------------------------------

function buildSvg(scene: Scene): string {
  const { graph, textLabels, width: W, height: H } = scene
  const fx = (x: number) => (x + W / 2).toFixed(2)
  const fy = (y: number) => (H / 2 - y).toFixed(2)

  const lines: string[] = []
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">`,
  )
  lines.push(`<rect x="0" y="0" width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#ffffff"/>`)

  for (const s of strokePolylines(graph)) {
    const pts = s.pts.map((p) => `${fx(p.x)},${fy(p.y)}`).join(' ')
    const dash = dashArray(s.lineStyle, s.width)
    const dashAttr = dash ? ` stroke-dasharray="${dash[0].toFixed(2)} ${dash[1].toFixed(2)}"` : ''
    lines.push(
      `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}/>`,
    )
  }

  for (const t of textLabels) {
    const esc = t.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    lines.push(
      `<text x="${fx(t.x)}" y="${fy(t.y)}" font-family="sans-serif" font-size="${t.size}" fill="${t.color}" dominant-baseline="middle">${esc}</text>`,
    )
  }

  lines.push('</svg>')
  return lines.join('\n')
}

export function exportSVG() {
  const svg = buildSvg(readScene())
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  download(url, 'metaball-sketch.svg')
  URL.revokeObjectURL(url)
}

// ---- PNG (raster, composites underlay) ------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load underlay'))
    img.src = src
  })
}

export async function exportPNG() {
  const scene = readScene()
  const { width: W, height: H } = scene
  const scale = 2 // supersample for crisp raster
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(W * scale)
  canvas.height = Math.ceil(H * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  if (scene.underlay) {
    try {
      const img = await loadImage(scene.underlay.src)
      ctx.drawImage(img, scene.underlay.left, scene.underlay.top, scene.underlay.width, scene.underlay.height)
    } catch {
      /* underlay is optional; skip on failure */
    }
  }

  const fx = (x: number) => x + W / 2
  const fy = (y: number) => H / 2 - y
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokePolylines(scene.graph)) {
    ctx.beginPath()
    s.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(fx(p.x), fy(p.y)) : ctx.lineTo(fx(p.x), fy(p.y))))
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    const dash = dashArray(s.lineStyle, s.width)
    ctx.setLineDash(dash ?? [])
    ctx.stroke()
  }
  ctx.setLineDash([])

  for (const t of scene.textLabels) {
    ctx.fillStyle = t.color
    ctx.font = `${t.size}px sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillText(t.text, fx(t.x), fy(t.y))
  }

  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    download(url, 'metaball-sketch.png')
    URL.revokeObjectURL(url)
  }, 'image/png')
}

// ---- PDF (vector, composites underlay) ------------------------------------

export async function exportPDF() {
  const scene = readScene()
  const { width: W, height: H } = scene
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: W >= H ? 'landscape' : 'portrait', unit: 'pt', format: [W, H] })

  if (scene.underlay) {
    try {
      pdf.addImage(scene.underlay.src, 'PNG', scene.underlay.left, scene.underlay.top, scene.underlay.width, scene.underlay.height)
    } catch {
      /* underlay is optional; skip on failure */
    }
  }

  const fx = (x: number) => x + W / 2
  const fy = (y: number) => H / 2 - y
  pdf.setLineCap('round')
  pdf.setLineJoin('round')
  for (const s of strokePolylines(scene.graph)) {
    const [r, g, b] = hexToRgb(s.color)
    pdf.setDrawColor(r, g, b)
    pdf.setLineWidth(s.width)
    const dash = dashArray(s.lineStyle, s.width)
    pdf.setLineDashPattern(dash ?? [], 0)
    // Connected path via relative deltas so joins render with the round linejoin.
    const x0 = fx(s.pts[0].x)
    const y0 = fy(s.pts[0].y)
    const deltas: [number, number][] = []
    for (let i = 1; i < s.pts.length; i++) {
      deltas.push([fx(s.pts[i].x) - fx(s.pts[i - 1].x), fy(s.pts[i].y) - fy(s.pts[i - 1].y)])
    }
    pdf.lines(deltas, x0, y0, [1, 1], 'S', false)
  }
  pdf.setLineDashPattern([], 0)

  for (const t of scene.textLabels) {
    const [r, g, b] = hexToRgb(t.color)
    pdf.setTextColor(r, g, b)
    pdf.setFontSize(t.size)
    pdf.text(t.text, fx(t.x), fy(t.y), { baseline: 'middle' })
  }

  pdf.save('metaball-sketch.pdf')
}
