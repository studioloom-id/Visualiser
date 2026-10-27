import type { PlanElement, Space, StylePreset, Viewpoint } from '../types'

export interface PromptImage {
  label: string
  dataUrl: string
  kind: 'plan' | 'guide' | 'ref'
}

export interface BuiltPrompt {
  text: string
  images: PromptImage[]
  /** things the user should know before spending credits */
  notes: string[]
  /** true when the plan image is kept for Claude only and not sent to the image generator */
  planExcluded: boolean
}

const norm = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180

/** Bearing of a plan point from a viewpoint, relative to where the camera faces. Positive = to the right. */
export function relativeBearing(vp: Viewpoint, x: number, y: number): number {
  const dx = x - vp.x
  const dy = y - vp.y
  const abs = (Math.atan2(dx, -dy) * 180) / Math.PI // 0 = up, clockwise
  return norm(abs - vp.angle)
}

export function distanceM(vp: Viewpoint, el: PlanElement, pxPerMeter: number): number {
  return Math.hypot(el.x - vp.x, el.y - vp.y) / pxPerMeter
}

export function inView(vp: Viewpoint, el: PlanElement): boolean {
  return Math.abs(relativeBearing(vp, el.x, el.y)) <= vp.fov / 2
}

export function describeBearing(b: number): string {
  const a = Math.abs(b)
  const side = b < 0 ? 'left' : 'right'
  if (a < 8) return 'straight ahead'
  if (a < 25) return `slightly to the ${side}`
  if (a < 50) return `to the ${side}`
  return `far ${side}`
}

export function describeDepth(d: number): string {
  if (d < 1.5) return 'in the foreground'
  if (d < 4) return 'in the mid-ground'
  return 'in the background'
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

function locateOnPlan(fx: number, fy: number): string {
  const v = fy < 0.34 ? 'top' : fy < 0.67 ? 'middle' : 'bottom'
  const h = fx < 0.34 ? 'left' : fx < 0.67 ? 'centre' : 'right'
  return `${v}-${h} of the plan`
}

function locateFromCamera(vp: Viewpoint, x: number, y: number, ppm: number): string {
  const b = relativeBearing(vp, x, y)
  const d = Math.hypot(x - vp.x, y - vp.y) / ppm
  return Math.abs(b) <= vp.fov / 2 ? `${f1(d)} m from the camera, ${describeBearing(b)}, ${describeDepth(d)}` : 'outside the camera view'
}

export interface PromptInput {
  space: Space
  viewpointId?: string
  style?: StylePreset
  /** annotated reference composites, keyed by reference id */
  referenceImages: Record<string, string>
  userNote?: string
  fixes?: string[]
  /** rendered blockout of the room from the chosen camera */
  guideImage?: string
  /** the plan with the designer's annotations burned in, if any */
  planImage?: string
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const { space, style } = input
  const notes: string[] = []
  const images: PromptImage[] = []
  const lines: string[] = []

  lines.push('Create a photorealistic interior design visualisation.')

  if (space.brief.trim()) lines.push(`Design brief: ${space.brief.trim()}`)
  if (style) {
    const bits = [
      style.materials && `materials: ${style.materials}`,
      style.palette && `colour palette: ${style.palette}`,
      style.lighting && `lighting: ${style.lighting}`,
    ].filter(Boolean)
    if (bits.length) lines.push(`Style "${style.name}" — ${bits.join('; ')}.`)
  }

  const plan = space.floorPlan
  const vp = plan ? space.viewpoints.find((v) => v.id === input.viewpointId) : undefined
  const scale = plan?.pxPerMeter

  if (!plan) {
    notes.push('No floor plan: the render uses your brief, references and notes only. Layout and scale checks are off.')
  } else {
    if (input.guideImage && vp) {
      images.push({ label: 'Floor plan (for reading only, not sent to the image generator)', dataUrl: input.planImage ?? plan.image, kind: 'plan' })
      images.push({ label: 'Layout guide: rough 3D blockout of the room seen from the camera', dataUrl: input.guideImage, kind: 'guide' })
      lines.push('The first image is a LAYOUT GUIDE: a rough 3D blockout of the room seen from the camera position. Match its composition exactly. Every coloured box is a piece of furniture or a door/window at that exact position, scale and proportion. Replace each box with a realistic item of the kind named in the element list below. Grey planes are walls, floor and ceiling. Do not add, remove or move anything. Never draw the boxes, flat colours or the guide\'s text labels in the final image: it must look like a photograph.')
    } else {
      images.push({ label: 'Floor plan (top-down layout; the source of truth for placement)', dataUrl: input.planImage ?? plan.image, kind: 'plan' })
      lines.push('The first image is the floor plan. Follow its layout exactly: do not add, remove or relocate walls, doors, windows or furniture.')
    }
    if (!scale) {
      notes.push('Floor plan has no scale yet, so sizes and distances are left out of the prompt.')
    } else {
      lines.push(`Scale: the floor plan image covers about ${f1(plan.width / scale)} m × ${f1(plan.height / scale)} m.`)
    }

    const planNotes = plan.notes ?? []
    if (planNotes.length) lines.push("The plan image also carries the designer's own coloured annotations (lines, arrows and text). Treat them as instructions.")
    const texts = planNotes.filter((n) => n.type === 'text' && n.text?.trim())
    if (texts.length) {
      lines.push("Designer's notes written on the plan (follow them):")
      for (const t of texts) {
        const at = vp && scale ? locateFromCamera(vp, t.x, t.y, scale) : locateOnPlan(t.x / plan.width, t.y / plan.height)
        lines.push(`- "${t.text!.trim()}" (${at})`)
      }
    }

    if (space.elements.length) {
      lines.push('Elements in the plan:')
      for (const el of space.elements) {
        const size = scale ? ` (${f1(el.w)} × ${f1(el.d)} m footprint, ${f1(el.h)} m high)` : ''
        let where = ''
        if (vp && scale) {
          const d = distanceM(vp, el, scale)
          where = inView(vp, el)
            ? `; ${f1(d)} m from camera, ${describeBearing(relativeBearing(vp, el.x, el.y))}, ${describeDepth(d)}`
            : '; outside the camera view, do not show it'
        }
        const lock = el.locked ? ' [LOCKED: keep exactly as described, do not move, resize or restyle]' : ''
        const kind = el.kind === 'door' ? ' [door]' : el.kind === 'window' ? ' [window]' : ''
        lines.push(`- ${el.name}${kind}${size}${where}${lock}`)
      }
    }
  }

  if (vp) {
    lines.push(`Camera: placed at the viewpoint "${vp.name}" on the plan, facing the direction marked, with a ${vp.fov}° horizontal field of view, at eye height (about 1.5 m).`)
  } else if (plan) {
    notes.push('No viewpoint selected: the AI will choose its own camera angle.')
  }

  const refs = space.references.filter((r) => input.referenceImages[r.id])
  if (refs.length) {
    lines.push('Reference images follow. Use each ONLY for the purpose stated; coloured markup on a reference shows the area it applies to.')
    refs.forEach((r, i) => {
      const linked = space.elements.find((e) => e.id === r.elementId)
      const purpose = r.purpose.trim() || '(no purpose written; treat as general mood only)'
      if (!r.purpose.trim()) notes.push(`Reference "${r.name}" has no purpose note.`)
      images.push({ label: `Reference ${i + 1}: ${purpose}`, dataUrl: input.referenceImages[r.id], kind: 'ref' })
      lines.push(`Reference ${i + 1} ("${r.name}"): ${purpose}${linked ? ` — applies to the element "${linked.name}"` : ''}.`)
    })
  }

  if (input.fixes?.length) {
    lines.push('Corrections from the previous attempt, which must be fixed:')
    input.fixes.forEach((f) => lines.push(`- ${f}`))
  }
  if (input.userNote?.trim()) lines.push(`Additional direction: ${input.userNote.trim()}`)

  return { text: lines.join('\n'), images, notes, planExcluded: images.some((i) => i.kind === 'guide') }
}
