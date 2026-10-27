import type { FloorPlan, PlanElement, Settings, Viewpoint } from '../types'
import type { BuiltPrompt } from './prompt'
import { shrink, splitDataUrl } from './img'
import { ApiError } from './providers'
import { uid } from '../store'

export const writerOf = (s: Settings): 'claude' | 'openai' => (s.writer === 'auto' ? (s.anthropicKey.trim() ? 'claude' : 'openai') : s.writer)
export const writerLabel = (s: Settings) => (writerOf(s) === 'claude' ? 'Claude' : 'OpenAI')

async function openaiTextCall(settings: Settings, system: string, content: any[], maxTokens: number): Promise<string> {
  const key = settings.openaiKey.trim()
  if (!key) throw new ApiError('Add your OpenAI API key in Settings first.')
  const parts = content.map((b) => (b.type === 'image' ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } } : b))
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: settings.openaiTextModel, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: parts }] }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new ApiError(`OpenAI error ${res.status}: ${j?.error?.message ?? res.statusText}`.slice(0, 400))
  }
  const text = ((await res.json())?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new ApiError('OpenAI returned an empty reply.')
  return text
}

async function claudeCall(settings: Settings, system: string, content: unknown[], maxTokens: number): Promise<string> {
  if (writerOf(settings) === 'openai') return openaiTextCall(settings, system, content as any[], maxTokens)
  const key = settings.anthropicKey.trim()
  if (!key) throw new ApiError('Add your Anthropic API key in Settings first.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: settings.claudeModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new ApiError(`Claude error ${res.status} (you can switch the prompt writer to OpenAI in Settings): ${j?.error?.message ?? res.statusText}`.slice(0, 400))
  }
  const j = await res.json()
  const text = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
  if (!text) throw new ApiError('Claude returned an empty reply.')
  return text
}

const imageBlock = async (dataUrl: string, max = 1400) => {
  const { mime, b64 } = splitDataUrl(await shrink(dataUrl, max))
  return { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }
}

// ---------- prompt writing ----------

const SYSTEM = `You write prompts for an AI image generator (OpenAI gpt-image) that renders interior designs.
You are given: the designer's request, structured facts from their project (floor plan scale, elements with real sizes and positions relative to the camera, locked elements, reference purposes), and the images. Images marked "for reading only" are for your understanding and will NOT be sent to the image generator. Every other image is sent with your prompt, in the numbered order shown.
Write ONE prompt for the image generator.
Rules:
- Treat the structured facts as ground truth. Never change sizes, positions, counts or layout, and never drop an element that is in view. Elements marked LOCKED must be described exactly as given.
- Describe the scene the way a photographer would see it from the camera: what is nearest, what is left, right and at the back, and how far apart things are. Use left/right/foreground/background, never plan terms like "north" or "top of the plan".
- If a layout guide image is present, say the generated image must follow its composition and replace each box with the matching real item, and never show boxes, flat colours or labels.
- Refer to attached images by their number and say precisely what each is used for, matching the stated purposes. Coloured markup on references only shows where to look and must not appear in the render.
- Be concrete: camera height and angle, lens feel, materials, colours, light direction and quality, mood, time of day. Fill gaps in the request with choices that suit the brief and references.
- Do not invent furniture or architecture that is not in the plan or request.
- The prompt itself is plain prose, no markdown, under 350 words.
First, prove you read the plan. Reply in exactly this format, with these three headings on their own lines:
UNDERSTANDING:
- 4 to 8 short bullets restating what you understood: room size from the scale, each element with its size and where it sits relative to the camera, which are locked, the camera, and what each attached image is for.
QUESTIONS:
- Anything ambiguous, missing or contradictory in the plan or request that could make the render wrong (write "none" if clear).
PROMPT:
the prompt text`

export interface WriteOptions {
  settings: Settings
  description: string
  built: BuiltPrompt
}

export interface WrittenPrompt {
  understanding: string
  questions: string
  prompt: string
}

export function parseWritten(text: string): WrittenPrompt {
  const m = /UNDERSTANDING:\s*([\s\S]*?)\n\s*QUESTIONS:\s*([\s\S]*?)\n\s*PROMPT:\s*([\s\S]*)$/i.exec(text)
  if (!m) return { understanding: '', questions: '', prompt: text.trim() }
  const q = m[2].trim()
  return { understanding: m[1].trim(), questions: /^-?\s*none\.?$/i.test(q) ? '' : q, prompt: m[3].trim() }
}

export async function writePromptWithClaude({ settings, description, built }: WriteOptions): Promise<WrittenPrompt> {
  const content: unknown[] = [
    { type: 'text', text: `Designer's request:\n${description.trim() || '(none: write the best render prompt from the facts below)'}\n\nProject facts:\n${built.text}\n\nAttached images:` },
  ]
  let n = 0
  for (const im of built.images) {
    const label = im.kind === 'plan' && built.planExcluded ? `Floor plan, FOR READING ONLY (not sent to the image generator)` : `Image ${++n}: ${im.label}`
    content.push({ type: 'text', text: label }, await imageBlock(im.dataUrl, im.kind === 'plan' ? 1800 : 1400))
  }
  const out = parseWritten(await claudeCall(settings, SYSTEM, content, 2500))
  if (!out.prompt) throw new ApiError('Claude returned an empty prompt.')
  return out
}

/** Names of in-view elements the written prompt never mentions. */
export const missingMentions = (prompt: string, names: string[]) =>
  names.filter((n) => n.trim() && !prompt.toLowerCase().includes(n.trim().toLowerCase()))

// ---------- reading the floor plan ----------

const DETECT_SYSTEM = `You read architectural floor plans for an interior design tool.
Look at the plan and list what is drawn in the MAIN room (the room containing the furniture). Reply ONLY with JSON:
{
 "image_width_m": estimated real width of the whole image in metres, from doors (about 0.9 m wide), standard furniture and any dimensions shown,
 "room": {"x":..,"y":..,"w":..,"h":..},
 "elements": [{"name":"Sofa","kind":"furniture|door|window","x":..,"y":..,"w":..,"d":..,"rotation":..,"height_m":..,"z_m":..}],
 "camera": {"name":"From the door","x":..,"y":..,"angle":..,"fov":70},
 "notes": "anything you were unsure about"
}
Coordinates: x and y are fractions (0 to 1) of the image width and height, measured from the top-left. "room" is the inside of the main room's walls. For elements, x,y is the CENTRE; w and d are the item's footprint along and across its own length as a fraction of the image WIDTH (both use the width, so units are equal); rotation is in degrees clockwise (0 means w runs left-right on the image). height_m is realistic real height (sofa 0.85, coffee table 0.4, armchair 0.85, door 2.1, window 1.2); z_m is height above the floor of the bottom edge (windows 0.9, others 0).
Give furniture realistic specific names ("Sofa", "Chaise", "Coffee table", "Armchair left", "Armchair right", "TV unit", "Round rug"). Split a sofa and its chaise into separate elements. A door's w is the door opening width, not its swing arc. Include doors and windows on the main room's walls.
"camera" is a person standing in the main entry doorway just inside the room, looking into the room. angle: 0 = toward the top of the image, 90 = right, 180 = down, 270 = left. Only include "camera" if there is a clear entry door.`

export interface DetectedPlan {
  elements: PlanElement[]
  room?: FloorPlan['room']
  camera?: Viewpoint
  pxPerMeter: number
  notes: string
  scaleEstimated: boolean
}

export async function detectPlan(settings: Settings, plan: FloorPlan): Promise<DetectedPlan> {
  const raw = await claudeCall(settings, DETECT_SYSTEM, [
    { type: 'text', text: `Image size: ${plan.width} x ${plan.height} px.${plan.pxPerMeter ? ` The user calibrated the scale: the image is ${(plan.width / plan.pxPerMeter).toFixed(2)} m wide.` : ''}` },
    await imageBlock(plan.image, 2000),
  ], 4000)
  const m = /\{[\s\S]*\}/.exec(raw)
  if (!m) throw new ApiError('Claude could not read the plan.')
  let j: any
  try { j = JSON.parse(m[0]) } catch { throw new ApiError('Claude returned unreadable plan data. Try again.') }

  const widthM = plan.pxPerMeter ? plan.width / plan.pxPerMeter : Number(j.image_width_m)
  if (!(widthM > 0.5 && widthM < 200)) throw new ApiError('Claude could not estimate the size of the plan. Set the scale yourself and try again.')
  const ppm = plan.pxPerMeter ?? plan.width / widthM
  const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

  const elements: PlanElement[] = (Array.isArray(j.elements) ? j.elements : []).map((e: any): PlanElement => {
    const kind = e.kind === 'door' || e.kind === 'window' ? e.kind : 'furniture'
    return {
      id: uid(), name: String(e.name ?? 'Item'), kind,
      x: num(e.x) * plan.width, y: num(e.y) * plan.height,
      w: Math.max(0.05, Math.round(num(e.w) * widthM * 100) / 100), d: Math.max(0.05, Math.round(num(e.d) * widthM * 100) / 100),
      h: Math.max(0.05, num(e.height_m, kind === 'door' ? 2.1 : kind === 'window' ? 1.2 : 0.8)),
      z: kind === 'window' ? num(e.z_m, 0.9) : undefined,
      rotation: ((num(e.rotation) % 360) + 360) % 360, locked: false,
    }
  })
  const r = j.room
  const room = r && num(r.w) > 0 && num(r.h) > 0
    ? { x: num(r.x) * plan.width, y: num(r.y) * plan.height, w: num(r.w) * plan.width, h: num(r.h) * plan.height }
    : undefined
  const c = j.camera
  const camera: Viewpoint | undefined = c && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y))
    ? { id: uid(), name: String(c.name ?? 'From the door'), x: num(c.x) * plan.width, y: num(c.y) * plan.height, angle: ((num(c.angle) % 360) + 360) % 360, fov: Math.min(120, Math.max(30, num(c.fov, 70))) }
    : undefined
  return { elements, room, camera, pxPerMeter: ppm, notes: String(j.notes ?? ''), scaleEstimated: !plan.pxPerMeter }
}
