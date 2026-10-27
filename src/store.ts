import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { Render, Settings, Space, StylePreset } from './types'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

const idbStorage: StateStorage = {
  getItem: async (k) => (await idbGet(k)) ?? null,
  setItem: (k, v) => idbSet(k, v),
  removeItem: (k) => idbDel(k),
}

export const defaultSettings: Settings = {
  provider: 'gemini',
  geminiKey: '',
  openaiKey: '',
  anthropicKey: '',
  writer: 'auto',
  openaiTextModel: 'gpt-4o',
  claudeModel: 'claude-sonnet-5-5',
  geminiDraftModel: 'gemini-2.5-flash-image',
  geminiFinalModel: 'gemini-3-pro-image-preview',
  openaiModel: 'gpt-image-1.5',
  geminiReviewModel: 'gemini-2.5-flash',
  openaiReviewModel: 'gpt-4o-mini',
  costs: {
    gemini: { draft: 0.04, final: 0.13 },
    openai: { draft: 0.02, final: 0.19 },
  },
}

export const newSpace = (kind: Space['kind'], name: string, parentId: string | null): Space => ({
  id: uid(), kind, parentId, name, brief: '', elements: [], viewpoints: [], references: [], createdAt: Date.now(),
})

interface State {
  spaces: Space[]
  renders: Render[]
  styles: StylePreset[]
  settings: Settings
  selectedId: string | null
  addSpace: (kind: Space['kind'], name: string, parentId: string | null) => string
  updateSpace: (id: string, patch: Partial<Space>) => void
  deleteSpace: (id: string) => void
  moveSpace: (id: string, parentId: string | null) => void
  select: (id: string | null) => void
  addRender: (r: Render) => void
  updateRender: (id: string, patch: Partial<Render>) => void
  deleteRender: (id: string) => void
  addStyle: (s: Omit<StylePreset, 'id'>) => void
  updateStyle: (id: string, patch: Partial<StylePreset>) => void
  deleteStyle: (id: string) => void
  setSettings: (patch: Partial<Settings>) => void
  importAll: (data: { spaces: Space[]; renders: Render[]; styles: StylePreset[] }) => void
}

export const descendantIds = (spaces: Space[], id: string): string[] => {
  const kids = spaces.filter((s) => s.parentId === id).flatMap((s) => descendantIds(spaces, s.id))
  return [id, ...kids]
}

export const projectOf = (spaces: Space[], id: string): Space | undefined => {
  let cur = spaces.find((s) => s.id === id)
  while (cur?.parentId) cur = spaces.find((s) => s.id === cur!.parentId)
  return cur
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      spaces: [],
      renders: [],
      styles: [],
      settings: defaultSettings,
      selectedId: null,
      addSpace: (kind, name, parentId) => {
        const s = newSpace(kind, name, parentId)
        set((st) => ({ spaces: [...st.spaces, s], selectedId: s.id }))
        return s.id
      },
      updateSpace: (id, patch) => set((st) => ({ spaces: st.spaces.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
      deleteSpace: (id) => {
        const ids = new Set(descendantIds(get().spaces, id))
        set((st) => ({
          spaces: st.spaces.filter((s) => !ids.has(s.id)),
          renders: st.renders.filter((r) => !ids.has(r.spaceId)),
          selectedId: st.selectedId && ids.has(st.selectedId) ? null : st.selectedId,
        }))
      },
      moveSpace: (id, parentId) => {
        if (parentId && descendantIds(get().spaces, id).includes(parentId)) return
        const target = parentId ? get().spaces.find((s) => s.id === parentId) : null
        if (parentId && target?.kind !== 'project' && target?.kind !== 'folder') return
        const moving = get().spaces.find((s) => s.id === id)
        if (!moving) return
        // a project is always a root; only folders can move
        if (moving.kind === 'project') return
        set((st) => ({ spaces: st.spaces.map((s) => (s.id === id ? { ...s, parentId } : s)) }))
      },
      select: (id) => set({ selectedId: id }),
      addRender: (r) => set((st) => ({ renders: [r, ...st.renders] })),
      updateRender: (id, patch) => set((st) => ({ renders: st.renders.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      deleteRender: (id) => set((st) => ({ renders: st.renders.filter((r) => r.id !== id) })),
      addStyle: (s) => set((st) => ({ styles: [...st.styles, { ...s, id: uid() }] })),
      updateStyle: (id, patch) => set((st) => ({ styles: st.styles.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
      deleteStyle: (id) => set((st) => ({
        styles: st.styles.filter((s) => s.id !== id),
        spaces: st.spaces.map((s) => (s.styleId === id ? { ...s, styleId: undefined } : s)),
      })),
      setSettings: (patch) => set((st) => ({ settings: { ...st.settings, ...patch } })),
      importAll: (data) => set({ spaces: data.spaces, renders: data.renders, styles: data.styles, selectedId: null }),
    }),
    {
      name: 'design-visualiser',
      storage: createJSONStorage(() => idbStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>
        return { ...current, ...p, settings: { ...defaultSettings, ...p.settings, costs: { ...defaultSettings.costs, ...p.settings?.costs } } }
      },
    },
  ),
)
