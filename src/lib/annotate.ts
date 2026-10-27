import type { Reference, Shape } from '../types'
import { loadImage } from './img'

export const fontFor = (width: number) => Math.max(14, Math.round(width / 55))

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, fs: number) {
  if (!text) return
  ctx.font = `600 ${fs}px sans-serif`
  const w = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(255,255,255,.9)'
  ctx.fillRect(x - 3, y - fs, w + 6, fs + 6)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], imgWidth: number, opts: { ppm?: number } = {}) {
  const fs = fontFor(imgWidth)
  const lw = Math.max(2, Math.round(imgWidth / 400))
  let pin = 0
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of shapes) {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = lw
    if (s.type === 'rect') {
      ctx.strokeRect(s.x, s.y, s.w ?? 0, s.h ?? 0)
      label(ctx, s.text ?? '', s.x + 4, Math.min(s.y, s.y + (s.h ?? 0)) - 6, s.color, fs)
    } else if (s.type === 'line') {
      const x2 = s.x + (s.w ?? 0), y2 = s.y + (s.h ?? 0)
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(x2, y2); ctx.stroke()
      const len = opts.ppm ? `${(Math.hypot(x2 - s.x, y2 - s.y) / opts.ppm).toFixed(2)} m` : ''
      const t = [s.text, len && (s.text ? `(${len})` : len)].filter(Boolean).join(' ')
      label(ctx, t, (s.x + x2) / 2 + 4, (s.y + y2) / 2 - 6, s.color, fs)
    } else if (s.type === 'arrow') {
      const x2 = s.x + (s.w ?? 0), y2 = s.y + (s.h ?? 0)
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(x2, y2); ctx.stroke()
      const a = Math.atan2(y2 - s.y, x2 - s.x), hl = fs * 1.1
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - hl * Math.cos(a - 0.45), y2 - hl * Math.sin(a - 0.45))
      ctx.lineTo(x2 - hl * Math.cos(a + 0.45), y2 - hl * Math.sin(a + 0.45))
      ctx.closePath(); ctx.fill()
      label(ctx, s.text ?? '', s.x + 4, s.y - 6, s.color, fs)
    } else if (s.type === 'pin') {
      pin++
      const r = fs * 0.85
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = `700 ${fs}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(String(pin), s.x, s.y + fs * 0.35)
      ctx.textAlign = 'left'
      label(ctx, s.text ?? '', s.x + r + 4, s.y + fs * 0.35, s.color, fs)
    } else if (s.type === 'text') {
      label(ctx, s.text ?? '', s.x, s.y, s.color, fs)
    } else if (s.type === 'free' && s.points && s.points.length >= 4) {
      ctx.beginPath()
      ctx.moveTo(s.points[0], s.points[1])
      for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(s.points[i], s.points[i + 1])
      ctx.stroke()
      if (s.text) label(ctx, s.text, s.points[0] + 4, s.points[1] - 6, s.color, fs)
    }
  }
}

/** The reference with its markup burned in; this is what gets sent to the AI. */
export async function renderAnnotated(ref: Reference, maxSide = 1600): Promise<string> {
  const img = await loadImage(ref.image)
  const k = Math.min(1, maxSide / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, c.width, c.height)
  if (ref.shapes.length) {
    ctx.scale(k, k)
    drawShapes(ctx, ref.shapes, img.width)
  }
  return c.toDataURL('image/jpeg', 0.88)
}

/** The plan with the designer's annotations burned in; sent to the AI that writes the prompt. */
export async function renderAnnotatedPlan(plan: { image: string; width: number; height: number; pxPerMeter?: number; notes?: Shape[] }, maxSide = 2000): Promise<string> {
  if (!plan.notes?.length) return plan.image
  const img = await loadImage(plan.image)
  const k = Math.min(1, maxSide / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  ctx.scale(k, k)
  drawShapes(ctx, plan.notes, img.width, { ppm: plan.pxPerMeter })
  return c.toDataURL('image/jpeg', 0.9)
}
