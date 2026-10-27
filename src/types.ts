export type Provider = 'gemini' | 'openai'
export type Quality = 'draft' | 'final'

export interface FloorPlan {
  image: string
  width: number
  height: number
  /** pixels per metre once the scale has been calibrated */
  pxPerMeter?: number
  /** interior of the main room, in plan pixels (used for the layout guide) */
  room?: { x: number; y: number; w: number; h: number }
}

export interface PlanElement {
  id: string
  name: string
  /** centre, in floor plan pixels */
  x: number
  y: number
  /** real-world size in metres */
  w: number
  d: number
  h: number
  rotation: number
  locked: boolean
  kind?: 'furniture' | 'door' | 'window'
  /** height of the underside above the floor, metres (windows) */
  z?: number
}

export interface Viewpoint {
  id: string
  name: string
  x: number
  y: number
  /** direction the camera faces, degrees, 0 = up/north on the plan, clockwise */
  angle: number
  fov: number
}

export type ShapeType = 'rect' | 'arrow' | 'pin' | 'text' | 'free'

export interface Shape {
  id: string
  type: ShapeType
  color: string
  x: number
  y: number
  w?: number
  h?: number
  points?: number[]
  text?: string
}

export interface Reference {
  id: string
  name: string
  image: string
  width: number
  height: number
  purpose: string
  elementId?: string
  shapes: Shape[]
}

/** A project or a folder. Both carry the same optional floor plan slot. */
export interface Space {
  id: string
  kind: 'project' | 'folder'
  parentId: string | null
  name: string
  brief: string
  floorPlan?: FloorPlan
  elements: PlanElement[]
  viewpoints: Viewpoint[]
  references: Reference[]
  styleId?: string
  /** project only */
  budgetCap?: number
  createdAt: number
}

export interface StylePreset {
  id: string
  name: string
  materials: string
  palette: string
  lighting: string
}

export interface ReviewItem {
  element: string
  status: 'seen' | 'missing' | 'misplaced'
  note: string
}

export interface Review {
  items: ReviewItem[]
  summary: string
}

export interface Render {
  id: string
  spaceId: string
  viewpointId?: string
  provider: Provider
  quality: Quality
  prompt: string
  image: string
  cost: number
  createdAt: number
  parentId?: string
  kind: 'render' | 'upgrade' | 'region-edit'
  review?: Review
}

export interface Settings {
  provider: Provider
  geminiKey: string
  openaiKey: string
  anthropicKey: string
  claudeModel: string
  geminiDraftModel: string
  geminiFinalModel: string
  openaiModel: string
  geminiReviewModel: string
  openaiReviewModel: string
  /** estimated USD per image */
  costs: Record<Provider, Record<Quality, number>>
}
