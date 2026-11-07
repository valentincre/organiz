// QR codes are drawn in the browser, with no external service. The library is
// imported on demand, so only the QR dialog fetches it.

/** Medium error correction: still reads from a photo of a screen or a creased print. */
const ECC = 'M'
/** The quiet zone the QR specification asks for around the code, in modules. */
const QUIET_ZONE = 4

/** The code as an SVG document, black on white, scaling to any size. */
export async function qrSvg(text: string): Promise<string> {
  const { renderSVG } = await import('uqr')
  return renderSVG(text, { ecc: ECC, border: QUIET_ZONE, pixelSize: 1 })
}

/** The code as a PNG of `size` × `size` pixels, black on white, with whole pixels per module. */
export async function qrPng(text: string, size: number): Promise<Blob> {
  const { encode } = await import('uqr')
  const { data } = encode(text, { ecc: ECC, border: QUIET_ZONE })
  const modules = data.length
  const scale = Math.max(1, Math.floor(size / modules))
  const offset = Math.floor((size - modules * scale) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is not available')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, size, size)
  context.fillStyle = '#000'
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) context.fillRect(offset + x * scale, offset + y * scale, scale, scale)
    }),
  )
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the QR code'))), 'image/png'),
  )
}
