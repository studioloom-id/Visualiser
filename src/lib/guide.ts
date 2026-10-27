import type { PlanElement, Space, Viewpoint } from '../types'

export const EYE = 1.5
export const CEILING = 2.6
const NEAR = 0.1

type V3 = { s: number; u: number; d: number } // side (right +), up (from floor), depth (forward)

/** Plan pixel position to camera space metres (side = right of camera, depth = ahead). */
export function toCamera(vp: Viewpoint, ppm: number, px: number, py: number) {
  const a = (vp.angle * Math.PI) / 180
  const dx = (px - vp.x) / ppm
  const dy = (py - vp.y) / ppm
  // forward = (sin a, -cos a), right = (cos a, sin a) in plan coordinates (y down)
  return { s: dx * Math.cos(a) + dy * Math.sin(a), d: dx * Math.sin(a) - dy * Math.cos(a) }
}

export function projectToScreen(p: V3, w: number, h: number, fovDeg: number) {
  const f = w / 2 / Math.tan((fovDeg * Math.PI) / 360)
  return { x: w / 2 + (f * p.s) / p.d, y: h / 2 - (f * (p.u - EYE)) / p.d }
}

function clipNear(poly: V3[]): V3[] {
  const out: V3[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const ain = a.d >= NEAR, bin = b.d >= NEAR
    if (ain) out.push(a)
    if (ain !== bin) {
      const t = (NEAR - a.d) / (b.d - a.d)
      out.push({ s: a.s + (b.s - a.s) * t, u: a.u + (b.u - a.u) * t, d: NEAR })
    }
  }
  return out
}

interface Face { poly: V3[]; fill: string; depth: number }

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`
}

const PALETTE = ['#d9534f', '#3b82c4', '#e0a030', '#4caf7a', '#9b59b6', '#e67e9a', '#2fb5b5', '#8d6e63', '#7cb342', '#ff7043']

function boxFaces(vp: Viewpoint, ppm: number, el: PlanElement, color: string): Face[] {
  const r = (el.rotation * Math.PI) / 180
  const hw = (el.w * ppm) / 2, hd = (el.d * ppm) / 2
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => {
    const px = el.x + x * Math.cos(r) - y * Math.sin(r)
    const py = el.y + x * Math.sin(r) + y * Math.cos(r)
    return toCamera(vp, ppm, px, py)
  })
  const z0 = el.z ?? 0, z1 = z0 + el.h
  const at = (i: number, u: number): V3 => ({ s: corners[i].s, u, d: corners[i].d })
  const faces: Face[] = []
  const add = (poly: V3[], k: number) => faces.push({ poly, fill: shade(color, k), depth: poly.reduce((a, p) => a + p.d, 0) / poly.length })
  add([at(0, z1), at(1, z1), at(2, z1), at(3, z1)], 1.1)
  const ks = [0.8, 0.65, 0.9, 0.7]
  for (let i = 0; i < 4; i++) add([at(i, z0), at((i + 1) % 4, z0), at((i + 1) % 4, z1), at(i, z1)], ks[i])
  return faces
}

export function elementColor(space: Space, el: PlanElement) {
  if (el.kind === 'door') return '#8d5a2b'
  if (el.kind === 'window') return '#7fb8e8'
  const idx = space.elements.filter((e) => e.kind !== 'door' && e.kind !== 'window').findIndex((e) => e.id === el.id)
  return PALETTE[Math.max(0, idx) % PALETTE.length]
}

export function renderGuide(space: Space, vp: Viewpoint, width: number, height: number): string {
  const plan = space.floorPlan
  const ppm = plan?.pxPerMeter
  if (!plan || !ppm) throw new Error('A calibrated floor plan is needed to draw the layout guide.')
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#efefef'
  ctx.fillRect(0, 0, width, height)

  const room = plan.room ?? { x: 0, y: 0, w: plan.width, h: plan.height }
  const rc = [[room.x, room.y], [room.x + room.w, room.y], [room.x + room.w, room.y + room.h], [room.x, room.y + room.h]].map(([x, y]) => toCamera(vp, ppm, x, y))
  const flat = (u: number): V3[] => rc.map((p) => ({ s: p.s, u, d: p.d }))

  const draw = (poly: V3[], fill: string, stroke = 'rgba(0,0,0,.25)') => {
    const cl = clipNear(poly)
    if (cl.length < 3) return
    ctx.beginPath()
    cl.forEach((p, i) => { const q = projectToScreen(p, width, height, vp.fov); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y) })
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // floor and ceiling, then walls far to near
  draw(flat(0), '#dcd6ca')
  draw(flat(CEILING), '#f6f6f6')
  const walls: Face[] = []
  for (let i = 0; i < 4; i++) {
    const a = rc[i], b = rc[(i + 1) % 4]
    const poly: V3[] = [{ s: a.s, u: 0, d: a.d }, { s: b.s, u: 0, d: b.d }, { s: b.s, u: CEILING, d: b.d }, { s: a.s, u: CEILING, d: a.d }]
    walls.push({ poly, fill: ['#c9c9c9', '#bdbdbd', '#d3d3d3', '#c2c2c2'][i], depth: Math.max(a.d, b.d) })
  }
  walls.sort((x, y) => y.depth - x.depth).forEach((f) => draw(f.poly, f.fill))

  // furniture, doors and windows (nearer drawn last)
  const items = space.elements.filter((e) => Math.hypot(e.x - vp.x, e.y - vp.y) / ppm > 0.3)
  const faces = items.flatMap((e) => boxFaces(vp, ppm, e, elementColor(space, e)))
  faces.sort((x, y) => y.depth - x.depth).forEach((f) => draw(f.poly, f.fill))

  // labels so every box is identifiable
  ctx.font = `600 ${Math.round(width / 50)}px sans-serif`
  ctx.textAlign = 'center'
  for (const e of items) {
    const top = toCamera(vp, ppm, e.x, e.y)
    const p: V3 = { s: top.s, u: (e.z ?? 0) + e.h, d: top.d }
    if (p.d < NEAR) continue
    const q = projectToScreen(p, width, height, vp.fov)
    if (q.x < 0 || q.x > width || q.y < 0 || q.y > height) continue
    const tw = ctx.measureText(e.name).width
    ctx.fillStyle = 'rgba(255,255,255,.9)'
    ctx.fillRect(q.x - tw / 2 - 4, q.y - width / 50 - 2, tw + 8, width / 50 + 8)
    ctx.fillStyle = '#111'
    ctx.fillText(e.name, q.x, q.y)
  }
  return c.toDataURL('image/jpeg', 0.9)
}
