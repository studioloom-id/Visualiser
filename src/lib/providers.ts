import type { Provider, Quality, Review, Settings } from '../types'
import type { BuiltPrompt } from './prompt'
import { dataUrlToBlob, splitDataUrl } from './img'

export class ApiError extends Error {}

const keyFor = (s: Settings, p: Provider) => {
  const k = p === 'gemini' ? s.geminiKey : s.openaiKey
  if (!k.trim()) throw new ApiError(`Add your ${p === 'gemini' ? 'Gemini' : 'OpenAI'} API key in Settings first.`)
  return k.trim()
}

async function check(res: Response) {
  if (res.ok) return res
  let detail = ''
  try {
    const j = await res.json()
    detail = j?.error?.message ?? JSON.stringify(j)
  } catch {
    detail = await res.text().catch(() => '')
  }
  throw new ApiError(`API error ${res.status}: ${detail}`.slice(0, 500))
}

export interface GenerateOptions {
  settings: Settings
  provider: Provider
  quality: Quality
  prompt: BuiltPrompt
  /** for "upgrade to final": the draft whose composition must be kept */
  baseImage?: string
}

// ---------- Gemini ----------

type GPart = { text: string } | { inline_data: { mime_type: string; data: string } }

const gImg = (dataUrl: string): GPart => {
  const { mime, b64 } = splitDataUrl(dataUrl)
  return { inline_data: { mime_type: mime, data: b64 } }
}

async function geminiCall(s: Settings, model: string, parts: GPart[], config: Record<string, unknown>) {
  const res = await check(
    await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keyFor(s, 'gemini') },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: config }),
    }),
  )
  return res.json()
}

function geminiImageOut(j: any): string {
  const parts = j?.candidates?.[0]?.content?.parts ?? []
  for (const p of parts) {
    const d = p.inlineData ?? p.inline_data
    if (d?.data) return `data:${d.mimeType ?? d.mime_type ?? 'image/png'};base64,${d.data}`
  }
  const text = parts.map((p: any) => p.text).filter(Boolean).join(' ')
  throw new ApiError(`Gemini returned no image.${text ? ` It said: ${text}` : ''}`.slice(0, 400))
}

function geminiParts(prompt: BuiltPrompt, baseImage?: string): GPart[] {
  const parts: GPart[] = [{ text: prompt.text }]
  if (baseImage) {
    parts.push({ text: 'DRAFT to upgrade: keep this exact composition, layout, camera and objects; re-render at higher fidelity and resolution.' }, gImg(baseImage))
  }
  for (const im of prompt.images) parts.push({ text: im.label }, gImg(im.dataUrl))
  return parts
}

// ---------- OpenAI ----------

const oaiSize = (q: Quality) => (q === 'draft' ? '1024x1024' : '1536x1024')
const oaiQuality = (q: Quality) => (q === 'draft' ? 'low' : 'high')

async function openaiImages(s: Settings, form: FormData | null, json: Record<string, unknown> | null) {
  const key = keyFor(s, 'openai')
  const res = await check(
    form
      ? await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form })
      : await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        }),
  )
  const j = await res.json()
  const b64 = j?.data?.[0]?.b64_json
  if (!b64) throw new ApiError('OpenAI returned no image.')
  return `data:image/png;base64,${b64}`
}

// ---------- public API ----------

export async function generateImage(o: GenerateOptions): Promise<string> {
  const { settings: s, provider, quality, prompt } = o
  if (provider === 'gemini') {
    const model = quality === 'draft' ? s.geminiDraftModel : s.geminiFinalModel
    const config: Record<string, unknown> = { responseModalities: ['TEXT', 'IMAGE'] }
    if (quality === 'final') config.imageConfig = { imageSize: '2K' }
    return geminiImageOut(await geminiCall(s, model, geminiParts(prompt, o.baseImage), config))
  }

  const images = [...(o.baseImage ? [{ label: 'draft', dataUrl: o.baseImage }] : []), ...prompt.images]
  const text = o.baseImage
    ? `${prompt.text}\n\nThe first image is a DRAFT: keep its exact composition, camera and objects, and re-render at higher fidelity.`
    : prompt.text + (images.length ? `\n\nImage order: ${images.map((im, i) => `${i + 1}) ${im.label}`).join(' | ')}` : '')
  if (!images.length) {
    return openaiImages(s, null, { model: s.openaiModel, prompt: text, size: oaiSize(quality), quality: oaiQuality(quality), n: 1 })
  }
  const form = new FormData()
  form.append('model', s.openaiModel)
  form.append('prompt', text)
  form.append('size', oaiSize(quality))
  form.append('quality', oaiQuality(quality))
  images.forEach((im, i) => form.append('image[]', dataUrlToBlob(im.dataUrl), `input-${i}.png`))
  return openaiImages(s, form, null)
}

export interface RegionEditOptions {
  settings: Settings
  provider: Provider
  quality: Quality
  base: string
  /** PNG, transparent where the edit should happen (OpenAI mask convention) */
  mask: string
  /** the base image with the edit area tinted red (used for Gemini) */
  overlay: string
  instruction: string
}

export async function regionEdit(o: RegionEditOptions): Promise<string> {
  const guard = 'Change ONLY the described region. Everything outside it must stay pixel-identical: same layout, objects, lighting and camera.'
  if (o.provider === 'gemini') {
    const model = o.quality === 'draft' ? o.settings.geminiDraftModel : o.settings.geminiFinalModel
    const parts: GPart[] = [
      { text: `${guard}\nThe first image is the original. The second image is the same picture with the area to change tinted red. Edit: ${o.instruction}. Return the full edited image without the red tint.` },
      gImg(o.base),
      gImg(o.overlay),
    ]
    return geminiImageOut(await geminiCall(o.settings, model, parts, { responseModalities: ['TEXT', 'IMAGE'] }))
  }
  const form = new FormData()
  form.append('model', o.settings.openaiModel)
  form.append('prompt', `${guard}\nEdit: ${o.instruction}`)
  form.append('quality', oaiQuality(o.quality))
  form.append('image[]', dataUrlToBlob(o.base), 'base.png')
  form.append('mask', dataUrlToBlob(o.mask), 'mask.png')
  return openaiImages(o.settings, form, null)
}

export interface ReviewOptions {
  settings: Settings
  provider: Provider
  render: string
  plan: string
  /** elements expected to be visible, with where they should be */
  expected: string[]
  /** elements that must not appear */
  hidden: string[]
  viewpoint: string
}

const reviewInstruction = (o: ReviewOptions) =>
  `You check an AI-generated interior render against the designer's floor plan.
Image 1 is the render. Image 2 is the top-down floor plan.
Camera: ${o.viewpoint}
Elements that must be visible, with their expected position:
${o.expected.map((e) => `- ${e}`).join('\n') || '- (none)'}
Elements that must NOT be visible:
${o.hidden.map((e) => `- ${e}`).join('\n') || '- (none)'}
For each element, say whether it is "seen" in the right place, "missing", or "misplaced" (wrong position, wrong relative size, or visible when it should be hidden). Also note any obviously wrong scale, such as furniture too big or small for the room.
Reply ONLY with JSON: {"items":[{"element":"name","status":"seen|missing|misplaced","note":"short reason"}],"summary":"one or two sentences"}`

export async function reviewRender(o: ReviewOptions): Promise<Review> {
  const s = o.settings
  let raw: string
  if (o.provider === 'gemini') {
    const j = await geminiCall(s, s.geminiReviewModel, [{ text: reviewInstruction(o) }, gImg(o.render), gImg(o.plan)], {
      responseMimeType: 'application/json',
    })
    raw = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
  } else {
    const res = await check(
      await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${keyFor(s, 'openai')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.openaiReviewModel,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: reviewInstruction(o) },
                { type: 'image_url', image_url: { url: o.render } },
                { type: 'image_url', image_url: { url: o.plan } },
              ],
            },
          ],
        }),
      }),
    )
    raw = (await res.json())?.choices?.[0]?.message?.content ?? ''
  }
  return parseReview(raw)
}

export function parseReview(raw: string): Review {
  const m = /\{[\s\S]*\}/.exec(raw)
  if (!m) throw new ApiError('The review did not return readable results.')
  const j = JSON.parse(m[0])
  const items = Array.isArray(j.items) ? j.items : []
  return {
    summary: String(j.summary ?? ''),
    items: items.map((i: any) => ({
      element: String(i.element ?? ''),
      status: ['seen', 'missing', 'misplaced'].includes(i.status) ? i.status : 'misplaced',
      note: String(i.note ?? ''),
    })),
  }
}
