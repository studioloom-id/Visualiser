import { describe, it, expect } from 'vitest'
import { buildPrompt, relativeBearing, inView } from './prompt'
import { budgetBlock } from './cost'
import { parseReview } from './providers'
import type { Space } from '../types'

const base: Space = {
  id: 's', kind: 'folder', parentId: null, name: 'Living', brief: 'Calm and warm', elements: [], viewpoints: [], references: [], createdAt: 0,
}
const withPlan: Space = {
  ...base,
  floorPlan: { image: 'data:image/png;base64,AAAA', width: 1000, height: 800, pxPerMeter: 100 },
  viewpoints: [{ id: 'v', name: 'Door', x: 500, y: 700, angle: 0, fov: 70 }],
  elements: [
    { id: 'a', name: 'Sofa', x: 500, y: 400, w: 2.2, d: 0.9, h: 0.8, rotation: 0, locked: true },
    { id: 'b', name: 'Desk', x: 900, y: 700, w: 1.4, d: 0.7, h: 0.75, rotation: 0, locked: false },
  ],
  references: [
    { id: 'r1', name: 'Chair', image: 'x', width: 1, height: 1, purpose: 'Chair shape only', shapes: [] },
    { id: 'r2', name: 'Mood', image: 'x', width: 1, height: 1, purpose: '', shapes: [] },
  ],
}
const refs = { r1: 'data:image/jpeg;base64,BBBB', r2: 'data:image/jpeg;base64,CCCC' }

describe('bearing', () => {
  it('is 0 straight ahead, positive to the right', () => {
    const vp = withPlan.viewpoints[0]
    expect(Math.round(relativeBearing(vp, 500, 400))).toBe(0)
    expect(relativeBearing(vp, 900, 700)).toBeGreaterThan(80)
    expect(relativeBearing(vp, 100, 700)).toBeLessThan(-80)
  })
  it('respects the field of view', () => {
    expect(inView(withPlan.viewpoints[0], withPlan.elements[0])).toBe(true)
    expect(inView(withPlan.viewpoints[0], withPlan.elements[1])).toBe(false)
  })
})

describe('buildPrompt', () => {
  it('works without a floor plan', () => {
    const p = buildPrompt({ space: base, referenceImages: {} })
    expect(p.text).toContain('Calm and warm')
    expect(p.images).toHaveLength(0)
    expect(p.notes.join(' ')).toMatch(/No floor plan/)
  })
  it('includes every element, size, lock, camera and reference purpose', () => {
    const p = buildPrompt({ space: withPlan, viewpointId: 'v', referenceImages: refs })
    expect(p.text).toContain('Sofa (2.2 × 0.9 m footprint, 0.8 m high)')
    expect(p.text).toContain('3 m from camera, straight ahead')
    expect(p.text).toContain('[LOCKED')
    expect(p.text).toContain('Desk')
    expect(p.text).toContain('outside the camera view')
    expect(p.text).toContain('Chair shape only')
    expect(p.text).toContain('covers about 10 m × 8 m')
    expect(p.images).toHaveLength(3)
    expect(p.notes.join(' ')).toMatch(/"Mood" has no purpose/)
  })
  it('flags a missing scale and omits sizes', () => {
    const s = { ...withPlan, floorPlan: { ...withPlan.floorPlan!, pxPerMeter: undefined } }
    const p = buildPrompt({ space: s, viewpointId: 'v', referenceImages: {} })
    expect(p.text).not.toContain('footprint')
    expect(p.notes.join(' ')).toMatch(/no scale/)
  })
  it('adds fixes', () => {
    const p = buildPrompt({ space: base, referenceImages: {}, fixes: ['Sofa: too small'] })
    expect(p.text).toContain('Sofa: too small')
  })
})

describe('budget', () => {
  it('blocks when over the cap, allows when none', () => {
    expect(budgetBlock(1, 0.9, 0.2)).toMatch(/Budget cap/)
    expect(budgetBlock(1, 0.5, 0.2)).toBeNull()
    expect(budgetBlock(0, 99, 5)).toBeNull()
    expect(budgetBlock(undefined, 99, 5)).toBeNull()
  })
})

describe('parseReview', () => {
  it('reads JSON and normalises bad statuses', () => {
    const r = parseReview('```json\n{"items":[{"element":"Sofa","status":"seen","note":"ok"},{"element":"Rug","status":"??","note":"x"}],"summary":"fine"}\n```')
    expect(r.items[0].status).toBe('seen')
    expect(r.items[1].status).toBe('misplaced')
    expect(() => parseReview('nope')).toThrow()
  })
})

import { missingMentions } from './claude'
describe('missingMentions', () => {
  it('lists element names the written prompt omits', () => {
    expect(missingMentions('A sofa by the window', ['Sofa', 'Desk'])).toEqual(['Desk'])
  })
})

import { parseWritten } from './claude'
describe('parseWritten', () => {
  it('splits understanding, questions and prompt', () => {
    const r = parseWritten('UNDERSTANDING:\n- Room 5 m wide\nQUESTIONS:\n- none\nPROMPT:\nA bright room.')
    expect(r.understanding).toContain('Room 5 m')
    expect(r.questions).toBe('')
    expect(r.prompt).toBe('A bright room.')
    expect(parseWritten('just a prompt').prompt).toBe('just a prompt')
  })
})

import { toCamera } from './guide'
describe('toCamera', () => {
  it('puts things ahead at positive depth and to the right at positive side', () => {
    const vp = { id: 'v', name: 'v', x: 100, y: 100, angle: 0, fov: 70 }
    expect(toCamera(vp, 100, 100, 0)).toMatchObject({ s: 0, d: 1 })
    expect(toCamera(vp, 100, 200, 100).s).toBeCloseTo(1)
    const east = { ...vp, angle: 90 }
    expect(toCamera(east, 100, 200, 100).d).toBeCloseTo(1)
    expect(toCamera(east, 100, 100, 200).s).toBeCloseTo(1)
  })
  it('builds a guide prompt that keeps the plan for Claude only', () => {
    const p = buildPrompt({ space: withPlan, viewpointId: 'v', referenceImages: {}, guideImage: 'data:image/jpeg;base64,GGGG' })
    expect(p.planExcluded).toBe(true)
    expect(p.images.map((i) => i.kind)).toEqual(['plan', 'guide'])
    expect(p.text).toContain('LAYOUT GUIDE')
  })
})
