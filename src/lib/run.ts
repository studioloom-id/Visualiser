import { useStore, projectOf, uid } from '../store'
import type { Provider, Quality, Render, Space } from '../types'
import { buildPrompt, inView, relativeBearing, describeBearing, distanceM, type BuiltPrompt } from './prompt'
import { renderAnnotated, renderAnnotatedPlan } from './annotate'
import { generateImage, regionEdit, reviewRender } from './providers'
import { renderGuide } from './guide'
import { budgetBlock, estimateCost, projectSpend } from './cost'

export interface GenParams {
  spaceId: string
  viewpointId?: string
  provider: Provider
  quality: Quality
  count: number
  userNote?: string
  fixes?: string[]
  excludeRefs?: string[]
  /** a prompt written by Claude (or edited by the user) that replaces the generated text */
  promptOverride?: string
}

export const guideSize = (q: Quality) => (q === 'draft' ? { w: 1024, h: 1024 } : { w: 1536, h: 1024 })

/** Builds everything, including the plan image Claude reads. Use forGenerator() before sending to the image model. */
export async function prepare(p: Omit<GenParams, 'count' | 'provider' | 'quality'> & { quality?: Quality }): Promise<BuiltPrompt> {
  const st = useStore.getState()
  const space = st.spaces.find((s) => s.id === p.spaceId)!
  const referenceImages: Record<string, string> = {}
  for (const r of space.references) if (!p.excludeRefs?.includes(r.id)) referenceImages[r.id] = await renderAnnotated(r)
  const vp = space.viewpoints.find((v) => v.id === p.viewpointId)
  const guideImage = space.floorPlan?.pxPerMeter && vp ? renderGuide(space, vp, guideSize(p.quality ?? 'draft').w, guideSize(p.quality ?? 'draft').h) : undefined
  const planImage = space.floorPlan ? await renderAnnotatedPlan(space.floorPlan) : undefined
  return buildPrompt({
    guideImage,
    planImage,
    space: { ...space, references: space.references.filter((r) => !p.excludeRefs?.includes(r.id)) },
    viewpointId: p.viewpointId,
    style: st.styles.find((s) => s.id === space.styleId),
    referenceImages,
    userNote: p.userNote,
    fixes: p.fixes,
  })
}

/** The plan image is for Claude's reading only when a layout guide exists. */
export const forGenerator = (b: BuiltPrompt): BuiltPrompt => (b.planExcluded ? { ...b, images: b.images.filter((i) => i.kind !== 'plan') } : b)

export const withOverride = (b: BuiltPrompt, text?: string): BuiltPrompt => (text?.trim() ? { ...b, text: text.trim() } : b)

/** Throws with a readable message if the project's budget would be exceeded. */
export function assertBudget(spaceId: string, provider: Provider, quality: Quality, count: number) {
  const st = useStore.getState()
  const project = projectOf(st.spaces, spaceId)
  if (!project) return
  const reason = budgetBlock(project.budgetCap, projectSpend(st.spaces, st.renders, project.id), estimateCost(st.settings, provider, quality, count))
  if (reason) throw new Error(reason)
}

export async function runGeneration(p: GenParams, opts: { baseImage?: string; parentId?: string; kind?: Render['kind'] } = {}): Promise<Render[]> {
  assertBudget(p.spaceId, p.provider, p.quality, p.count)
  const st = useStore.getState()
  const prompt = forGenerator(withOverride(await prepare(p), p.promptOverride))
  const out: Render[] = []
  for (let i = 0; i < p.count; i++) {
    assertBudget(p.spaceId, p.provider, p.quality, 1)
    const image = await generateImage({ settings: st.settings, provider: p.provider, quality: p.quality, prompt, baseImage: opts.baseImage })
    const r: Render = {
      id: uid(), spaceId: p.spaceId, viewpointId: p.viewpointId, provider: p.provider, quality: p.quality,
      prompt: prompt.text, image, cost: estimateCost(useStore.getState().settings, p.provider, p.quality),
      createdAt: Date.now(), parentId: opts.parentId, kind: opts.kind ?? 'render',
    }
    useStore.getState().addRender(r)
    out.push(r)
  }
  return out
}

export async function runRegionEdit(render: Render, a: { provider: Provider; quality: Quality; mask: string; overlay: string; instruction: string }) {
  assertBudget(render.spaceId, a.provider, a.quality, 1)
  const settings = useStore.getState().settings
  const image = await regionEdit({ settings, provider: a.provider, quality: a.quality, base: render.image, mask: a.mask, overlay: a.overlay, instruction: a.instruction })
  const r: Render = {
    id: uid(), spaceId: render.spaceId, viewpointId: render.viewpointId, provider: a.provider, quality: a.quality,
    prompt: `Region edit: ${a.instruction}`, image, cost: estimateCost(settings, a.provider, a.quality), createdAt: Date.now(), parentId: render.id, kind: 'region-edit',
  }
  useStore.getState().addRender(r)
  return r
}

export function expectedElements(space: Space, viewpointId?: string) {
  const vp = space.viewpoints.find((v) => v.id === viewpointId)
  const ppm = space.floorPlan?.pxPerMeter
  if (!vp || !ppm) return null
  const inside = space.elements.filter((e) => inView(vp, e))
  return {
    vp,
    expected: inside.map((e) => `${e.name}: ${distanceM(vp, e, ppm).toFixed(1)} m away, ${describeBearing(relativeBearing(vp, e.x, e.y))}${e.locked ? ' (locked)' : ''}`),
    hidden: space.elements.filter((e) => !inView(vp, e)).map((e) => e.name),
    visibleNames: inside.map((e) => e.name),
  }
}

export async function runReview(render: Render, provider: Provider) {
  const st = useStore.getState()
  const space = st.spaces.find((s) => s.id === render.spaceId)
  if (!space?.floorPlan) throw new Error('Reviewing needs a floor plan on this project or folder.')
  const exp = expectedElements(space, render.viewpointId)
  if (!exp) throw new Error('Reviewing needs a calibrated floor plan and the camera this render was made from.')
  const review = await reviewRender({
    settings: st.settings, provider, render: render.image, plan: space.floorPlan.image,
    expected: exp.expected, hidden: exp.hidden, viewpoint: `"${exp.vp.name}", ${exp.vp.fov}° field of view`,
  })
  useStore.getState().updateRender(render.id, { review })
  return review
}
