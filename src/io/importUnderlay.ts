/**
 * Import a PDF or image file as a tracing underlay.
 *
 * Returns a raster data URL plus the asset's INTRINSIC pixel dimensions. A PDF's
 * first page is rendered to a raster via pdf.js; images are read directly. The
 * store decides where/how big to place the asset within the page frame (its mesh
 * transform) — the import step no longer presumes or alters the artboard size.
 */

export interface ImportedUnderlay {
  src: string
  /** Intrinsic raster pixel dimensions of the asset. */
  width: number
  height: number
}

const PDF_RENDER_SCALE = 2 // supersample the PDF raster for crisp tracing

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function importImage(file: File): Promise<ImportedUnderlay> {
  const src = await readAsDataURL(file)
  const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
  return { src, width: dims.w, height: dims.h }
}

async function importPdf(file: File): Promise<ImportedUnderlay> {
  // Dynamic import keeps pdf.js (and its worker) out of the main bundle.
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  const page = await pdf.getPage(1)

  const natural = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context for PDF rendering')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise

  const src = canvas.toDataURL('image/png')
  return { src, width: natural.width, height: natural.height }
}

/** Import any supported file (PDF or image) as an underlay. */
export async function importUnderlay(file: File): Promise<ImportedUnderlay> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  return isPdf ? importPdf(file) : importImage(file)
}
