export const readFile = (f: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = rej
    r.readAsDataURL(f)
  })

export const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = src
  })

/** downscale big pastes so IndexedDB and API payloads stay reasonable */
export async function fileToImage(f: Blob, maxSide = 2400) {
  const src = await readFile(f)
  const img = await loadImage(src)
  const k = Math.min(1, maxSide / Math.max(img.width, img.height))
  if (k === 1) return { image: src, width: img.width, height: img.height }
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return { image: c.toDataURL('image/jpeg', 0.9), width: c.width, height: c.height }
}

/** shrink an image to fit within maxSide, as JPEG, for vision calls */
export async function shrink(dataUrl: string, maxSide = 1400): Promise<string> {
  const img = await loadImage(dataUrl)
  const k = Math.min(1, maxSide / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.85)
}

export const imagesFromClipboard = (e: ClipboardEvent): File[] =>
  Array.from(e.clipboardData?.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f)

export const splitDataUrl = (d: string) => {
  const m = /^data:([^;]+);base64,(.*)$/.exec(d)
  return { mime: m?.[1] ?? 'image/png', b64: m?.[2] ?? '' }
}

export const dataUrlToBlob = (d: string): Blob => {
  const { mime, b64 } = splitDataUrl(d)
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
