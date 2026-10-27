import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KImage, Rect, Text, Line, Arrow, Circle, Wedge, Group, Label, Tag } from 'react-konva'
import type Konva from 'konva'
import { useStore, uid } from '../store'
import type { PlanElement, Shape, ShapeType, Space, Viewpoint } from '../types'
import { fileToImage, imagesFromClipboard, loadImage } from '../lib/img'
import { inView } from '../lib/prompt'
import { detectPlan, writerLabel } from '../lib/claude'
import { elementColor } from '../lib/guide'
import { fontFor } from '../lib/annotate'

type Tool = 'select' | 'pan' | 'calibrate' | 'room' | 'element' | 'viewpoint' | ShapeType
type Sel = { type: 'el' | 'vp' | 'note'; id: string } | null

const NOTE_TOOLS: [ShapeType, string][] = [['line', '／ Line'], ['arrow', '↗ Arrow'], ['free', '✎ Draw'], ['text', 'T Text']]
const NOTE_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#111111']

const num = (v: string, min = 0) => Math.max(min, Number(v) || 0)

export function FloorPlanEditor({ space }: { space: Space }) {
  const updateSpace = useStore((s) => s.updateSpace)
  const settings = useStore((s) => s.settings)
  const [detecting, setDetecting] = useState(false)
  const [detectMsg, setDetectMsg] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const plan = space.floorPlan
  const fileRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 600, h: 520 })
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [sel, setSel] = useState<Sel>(null)
  const [calPts, setCalPts] = useState<{ x: number; y: number }[]>([])
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0])
  const [draft, setDraft] = useState<Shape | null>(null)

  const setPlanImage = async (f: Blob) => {
    const { image, width, height } = await fileToImage(f, 3000)
    if (plan && !confirm('Replace the floor plan? Elements and cameras stay where they are, but the scale, room outline and your annotations on the old plan are cleared.')) return
    updateSpace(space.id, { floorPlan: { image, width, height } })
  }

  const dropProps = {
    onDragOver: (e: React.DragEvent) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setDragOver(true) } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
      if (f) setPlanImage(f)
    },
    style: { outline: dragOver ? '2px dashed var(--accent)' : 'none', outlineOffset: 4, borderRadius: 10 } as React.CSSProperties,
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = imagesFromClipboard(e)[0]
      if (f && !(e.target as HTMLElement)?.closest('input,textarea')) setPlanImage(f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  useEffect(() => {
    if (!plan) return setImg(null)
    let live = true
    loadImage(plan.image).then((i) => live && setImg(i))
    return () => { live = false }
  }, [plan?.image])

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: Math.max(420, Math.min(680, window.innerHeight - 260)) }))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [!!plan])

  const fit = () => {
    if (!plan) return
    const k = Math.min(size.w / plan.width, size.h / plan.height) * 0.95
    setView({ k, x: (size.w - plan.width * k) / 2, y: (size.h - plan.height * k) / 2 })
  }
  useEffect(fit, [plan?.image, size.w])

  if (!plan) {
    return (
      <div className="empty" {...dropProps}>
        <p><b>No floor plan yet.</b> That is fine: you can still generate renders from a brief and references.</p>
        <p>When you have one, add it here to lock in layout and scale.</p>
        <button className="primary" onClick={() => fileRef.current?.click()}>Add floor plan</button>
        <p className="mute">or drag an image here, or paste with Ctrl/Cmd+V</p>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && setPlanImage(e.target.files[0])} />
      </div>
    )
  }

  const ppm = plan.pxPerMeter
  const patchPlan = (p: Partial<typeof plan>) => updateSpace(space.id, { floorPlan: { ...plan, ...p } })
  const patchEl = (id: string, p: Partial<PlanElement>) =>
    updateSpace(space.id, { elements: space.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) })
  const patchVp = (id: string, p: Partial<Viewpoint>) =>
    updateSpace(space.id, { viewpoints: space.viewpoints.map((v) => (v.id === id ? { ...v, ...p } : v)) })

  const detect = async () => {
    setDetecting(true); setDetectMsg('')
    try {
      const d = await detectPlan(settings, plan)
      if ((space.elements.length || space.viewpoints.length) && !confirm('Replace your current elements and cameras with what was found?')) return
      const ids = new Set(d.elements.map((e) => e.id))
      updateSpace(space.id, {
        floorPlan: { ...plan, pxPerMeter: d.pxPerMeter, room: d.room ?? plan.room },
        elements: d.elements,
        viewpoints: d.camera ? [d.camera] : space.viewpoints,
        references: space.references.map((r) => (r.elementId && !ids.has(r.elementId) ? { ...r, elementId: undefined } : r)),
      })
      setSel(null)
      setDetectMsg(`${writerLabel(settings)} found ${d.elements.length} items${d.camera ? ' and a camera at the door' : ''}.${d.scaleEstimated ? ' The scale is an estimate: check it with "Set scale".' : ''} Check sizes and positions, then fix anything wrong.${d.notes ? ` Notes: ${d.notes}` : ''}`)
    } catch (e) {
      setDetectMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setDetecting(false)
    }
  }

  const notes = plan.notes ?? []
  const setNotes = (n: Shape[]) => patchPlan({ notes: n })
  const patchNote = (id: string, p: Partial<Shape>) => setNotes(notes.map((n) => (n.id === id ? { ...n, ...p } : n)))
  const moveNote = (id: string, dx: number, dy: number) =>
    setNotes(notes.map((n) => (n.id !== id ? n : { ...n, x: n.x + dx, y: n.y + dy, points: n.points?.map((v, i) => v + (i % 2 ? dy : dx)) })))

  const isDrawTool = tool === 'line' || tool === 'arrow' || tool === 'free'
  const down = () => {
    if (!isDrawTool) return
    const p = pointer()
    setDraft(tool === 'free'
      ? { id: uid(), type: 'free', color: noteColor, x: p.x, y: p.y, points: [p.x, p.y] }
      : { id: uid(), type: tool as ShapeType, color: noteColor, x: p.x, y: p.y, w: 0, h: 0 })
  }
  const move = () => {
    if (!draft) return
    const p = pointer()
    setDraft(draft.type === 'free' ? { ...draft, points: [...(draft.points ?? []), p.x, p.y] } : { ...draft, w: p.x - draft.x, h: p.y - draft.y })
  }
  const up = () => {
    if (!draft) return
    const d = draft
    setDraft(null)
    const tiny = d.type === 'free' ? (d.points?.length ?? 0) < 6 : Math.hypot(d.w ?? 0, d.h ?? 0) * view.k < 6
    if (tiny) return
    setNotes([...notes, d])
    setSel({ type: 'note', id: d.id })
  }

  const fs = fontFor(plan.width)
  const lw = Math.max(2, Math.round(plan.width / 400))
  const noteView = (s: Shape, isDraft = false) => {
    const on = sel?.type === 'note' && sel.id === s.id
    const stroke = { stroke: s.color, strokeWidth: lw * (on ? 1.8 : 1), lineCap: 'round' as const, lineJoin: 'round' as const, hitStrokeWidth: Math.max(lw * 3, 14 / view.k) }
    const x2 = s.x + (s.w ?? 0), y2 = s.y + (s.h ?? 0)
    const len = s.type === 'line' && ppm ? `${(Math.hypot(s.w ?? 0, s.h ?? 0) / ppm).toFixed(2)} m` : ''
    const cap = [s.text, len && (s.text ? `(${len})` : len)].filter(Boolean).join(' ')
    return (
      <Group key={s.id} draggable={tool === 'select' && !isDraft} listening={!isDraft}
        onDragEnd={(e) => { const dx = e.target.x(), dy = e.target.y(); e.target.position({ x: 0, y: 0 }); moveNote(s.id, dx, dy) }}
        onClick={(e) => { if (tool === 'select') { e.cancelBubble = true; setSel({ type: 'note', id: s.id }) } }}>
        {s.type === 'line' && <Line points={[s.x, s.y, x2, y2]} {...stroke} />}
        {s.type === 'arrow' && <Arrow points={[s.x, s.y, x2, y2]} fill={s.color} pointerLength={fs * 1.1} pointerWidth={fs * 0.9} {...stroke} />}
        {s.type === 'free' && <Line points={s.points ?? []} {...stroke} />}
        {(s.type === 'text' || ((s.type === 'line' || s.type === 'arrow') && cap)) && (
          <Label x={s.type === 'text' ? s.x : (s.x + x2) / 2 + 4} y={(s.type === 'text' ? s.y : (s.y + y2) / 2 - 6) - fs}>
            <Tag fill="rgba(255,255,255,.9)" stroke={on ? s.color : undefined} />
            <Text text={s.type === 'text' ? s.text ?? '' : cap} fontSize={fs} fontStyle="bold" fill={s.color} padding={3} />
          </Label>
        )}
      </Group>
    )
  }

  const pointer = () => stageRef.current!.getRelativePointerPosition() ?? { x: 0, y: 0 }

  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const onBg = e.target === stageRef.current || e.target.name() === 'plan'
    const p = pointer()
    if (tool === 'calibrate' && onBg) {
      const pts = [...calPts, p]
      if (pts.length < 2) return setCalPts(pts)
      const px = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const m = Number(prompt('Real-world distance between the two points, in metres (e.g. 3.2)'))
      if (m > 0 && px > 0) patchPlan({ pxPerMeter: px / m })
      setCalPts([])
      setTool('select')
    } else if (tool === 'room' && onBg) {
      const pts = [...calPts, p]
      if (pts.length < 2) return setCalPts(pts)
      const [a, b] = pts
      patchPlan({ room: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) } })
      setCalPts([])
      setTool('select')
    } else if (tool === 'text' && onBg) {
      const t = prompt('Text to write on the plan (e.g. "green velvet armchair here")')
      if (t?.trim()) {
        const n: Shape = { id: uid(), type: 'text', color: noteColor, x: p.x, y: p.y, text: t.trim() }
        setNotes([...notes, n])
        setSel({ type: 'note', id: n.id })
      }
    } else if (tool === 'element' && onBg && ppm) {
      const el: PlanElement = { id: uid(), name: `Element ${space.elements.length + 1}`, x: p.x, y: p.y, w: 1, d: 1, h: 1, rotation: 0, locked: false }
      updateSpace(space.id, { elements: [...space.elements, el] })
      setSel({ type: 'el', id: el.id })
      setTool('select')
    } else if (tool === 'viewpoint' && onBg) {
      const v: Viewpoint = { id: uid(), name: `View ${space.viewpoints.length + 1}`, x: p.x, y: p.y, angle: 0, fov: 70 }
      updateSpace(space.id, { viewpoints: [...space.viewpoints, v] })
      setSel({ type: 'vp', id: v.id })
      setTool('select')
    } else if (tool === 'select' && onBg) setSel(null)
  }

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const st = stageRef.current!
    const ptr = st.getPointerPosition()!
    const k = Math.min(8, Math.max(0.1, view.k * (e.evt.deltaY < 0 ? 1.1 : 1 / 1.1)))
    const mx = (ptr.x - view.x) / view.k
    const my = (ptr.y - view.y) / view.k
    setView({ k, x: ptr.x - mx * k, y: ptr.y - my * k })
  }

  const selEl = sel?.type === 'el' ? space.elements.find((e) => e.id === sel.id) : undefined
  const selNote = sel?.type === 'note' ? notes.find((n) => n.id === sel.id) : undefined
  const selVp = sel?.type === 'vp' ? space.viewpoints.find((v) => v.id === sel.id) : undefined
  const hint =
    tool === 'calibrate' ? `Click two points a known distance apart (${calPts.length}/2)` :
    tool === 'room' ? `Click two opposite inside corners of the main room (${calPts.length}/2)` :
    tool === 'element' ? 'Click on the plan to place an element' :
    tool === 'line' || tool === 'arrow' || tool === 'free' ? 'Click and drag on the plan to draw' :
    tool === 'text' ? 'Click on the plan where the text should go' :
    tool === 'viewpoint' ? 'Click on the plan to place a camera' : ''
  const cone = 3 * (ppm ?? plan.width / 12)

  return (
    <div className="split" {...dropProps}>
      <div>
        <div className="toolbar">
          {([['select', 'Select'], ['pan', 'Pan'], ['calibrate', 'Set scale'], ['room', 'Set room'], ['element', '＋ Element'], ['viewpoint', '＋ Camera']] as [Tool, string][]).map(([t, l]) => (
            <button key={t} className={tool === t ? 'active' : ''} disabled={t === 'element' && !ppm} title={t === 'element' && !ppm ? 'Set the scale first so elements can be drawn to size' : ''} onClick={() => { setTool(t); setCalPts([]) }}>{l}</button>
          ))}
          <button disabled={detecting} onClick={detect} title="The AI reads the plan and places furniture, doors, windows and a camera at the door">{detecting ? 'Reading plan…' : `Read plan with ${writerLabel(settings)}`}</button>
          <span style={{ width: 10 }} />
          {NOTE_TOOLS.map(([t, l]) => <button key={t} className={tool === t ? 'active' : ''} onClick={() => { setTool(t); setCalPts([]) }}>{l}</button>)}
          {NOTE_COLORS.map((c) => (
            <button key={c} aria-label={`colour ${c}`} onClick={() => { setNoteColor(c); if (sel?.type === 'note') patchNote(sel.id, { color: c }) }}
              style={{ width: 22, height: 22, padding: 0, background: c, borderRadius: 99, outline: noteColor === c ? '2px solid var(--ink)' : 'none', outlineOffset: 2 }} />
          ))}
          <button disabled={!notes.length} onClick={() => setNotes(notes.slice(0, -1))}>Undo mark</button>
          <span style={{ width: 10 }} />
          <button onClick={fit}>Fit</button>
          <button onClick={() => fileRef.current?.click()}>Replace plan</button>
          <button className="danger" onClick={() => confirm('Remove the floor plan? Elements and cameras are kept but will no longer be sent to the AI.') && updateSpace(space.id, { floorPlan: undefined })}>Remove plan</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && setPlanImage(e.target.files[0])} />
        </div>
        <p className={ppm ? 'mute' : 'warn'} style={{ margin: '0 0 8px' }}>
          {hint || (ppm ? `Scale set: the plan image covers ${(plan.width / ppm).toFixed(1)} × ${(plan.height / ppm).toFixed(1)} m. Scroll to zoom.` : 'Scale not set. Use "Set scale" and click two points whose real distance you know, such as a wall length.')}
        </p>
        {detectMsg && <p className={/ found \d+ items/.test(detectMsg) ? 'ok' : 'bad'} role="status">{detectMsg}</p>}
        <div className="stagewrap" ref={wrapRef} style={{ cursor: tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
          <Stage
            ref={stageRef} width={size.w} height={size.h}
            x={view.x} y={view.y} scaleX={view.k} scaleY={view.k}
            draggable={tool === 'pan'}
            onDragEnd={(e) => e.target === stageRef.current && setView({ ...view, x: e.target.x(), y: e.target.y() })}
            onWheel={onWheel} onClick={onStageClick}
            onMouseDown={down} onMouseMove={move} onMouseUp={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}
          >
            <Layer>
              {img && <KImage image={img} name="plan" width={plan.width} height={plan.height} />}
              {space.viewpoints.map((v) => {
                const on = sel?.id === v.id
                return (
                  <Group key={v.id} x={v.x} y={v.y} draggable={tool === 'select'}
                    onDragEnd={(e) => patchVp(v.id, { x: e.target.x(), y: e.target.y() })}
                    onClick={(e) => { if (tool === 'select') { e.cancelBubble = true; setSel({ type: 'vp', id: v.id }) } }}>
                    <Wedge radius={cone} angle={v.fov} rotation={v.angle - 90 - v.fov / 2} fill={on ? 'rgba(47,93,80,.35)' : 'rgba(47,93,80,.18)'} stroke="#2f5d50" strokeWidth={1 / view.k} />
                    <Circle radius={7 / view.k} fill="#2f5d50" />
                    <Text text={v.name} y={9 / view.k} x={-20} fontSize={12 / view.k} fill="#2f5d50" />
                  </Group>
                )
              })}
              {space.elements.map((el) => {
                const w = el.w * (ppm ?? 1), d = el.d * (ppm ?? 1)
                const on = sel?.id === el.id
                const vis = selVp ? inView(selVp, el) : true
                return (
                  <Group key={el.id} x={el.x} y={el.y} rotation={el.rotation} draggable={tool === 'select'} opacity={vis ? 1 : 0.35}
                    onDragEnd={(e) => patchEl(el.id, { x: e.target.x(), y: e.target.y() })}
                    onClick={(e) => { if (tool === 'select') { e.cancelBubble = true; setSel({ type: 'el', id: el.id }) } }}>
                    <Rect width={w} height={d} offsetX={w / 2} offsetY={d / 2} fill={elementColor(space, el)} fillOpacity={0.5} stroke={on ? '#1d1d1b' : elementColor(space, el)} strokeWidth={(on ? 2.5 : 1.5) / view.k} dash={el.locked ? [6 / view.k, 3 / view.k] : undefined} />
                    <Text text={`${el.locked ? '🔒 ' : ''}${el.name}`} fontSize={12 / view.k} fill="#1d1d1b" offsetX={w / 2} offsetY={-d / 2 - 2 / view.k} />
                  </Group>
                )
              })}
              {plan.room && <Rect x={plan.room.x} y={plan.room.y} width={plan.room.w} height={plan.room.h} stroke="#2f5d50" dash={[8 / view.k, 5 / view.k]} strokeWidth={2 / view.k} listening={false} />}
              {notes.map((s) => noteView(s))}
              {draft && noteView(draft, true)}
              {calPts.map((p, i) => <Circle key={i} x={p.x} y={p.y} radius={5 / view.k} fill="#b3261e" />)}
              {calPts.length === 2 && <Line points={[calPts[0].x, calPts[0].y, calPts[1].x, calPts[1].y]} stroke="#b3261e" strokeWidth={2 / view.k} />}
            </Layer>
          </Stage>
        </div>
      </div>

      <div className="col" style={{ overflow: 'auto' }}>
        <div className="card">
          <h3>Selected</h3>
          {selEl && (
            <>
              <label>Name</label>
              <input value={selEl.name} onChange={(e) => patchEl(selEl.id, { name: e.target.value })} />
              <label>Type</label>
              <select value={selEl.kind ?? 'furniture'} onChange={(e) => patchEl(selEl.id, { kind: e.target.value as PlanElement['kind'], z: e.target.value === 'window' ? selEl.z ?? 0.9 : undefined })}>
                <option value="furniture">Furniture</option><option value="door">Door</option><option value="window">Window</option>
              </select>
              <div className="row">
                {(['w', 'd', 'h'] as const).map((k) => (
                  <div key={k} style={{ flex: 1 }}>
                    <label>{k === 'w' ? 'Width m' : k === 'd' ? 'Depth m' : 'Height m'}</label>
                    <input type="number" step="0.1" min="0.05" value={selEl[k]} onChange={(e) => patchEl(selEl.id, { [k]: num(e.target.value, 0.05) })} />
                  </div>
                ))}
              </div>
              <label>Rotation ({Math.round(selEl.rotation)}°)</label>
              <input type="range" min="0" max="359" value={selEl.rotation} onChange={(e) => patchEl(selEl.id, { rotation: Number(e.target.value) })} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink)' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={selEl.locked} onChange={(e) => patchEl(selEl.id, { locked: e.target.checked })} />
                Locked: keep exactly as is in every render
              </label>
              <button className="danger" onClick={() => { updateSpace(space.id, { elements: space.elements.filter((e) => e.id !== selEl.id), references: space.references.map((r) => (r.elementId === selEl.id ? { ...r, elementId: undefined } : r)) }); setSel(null) }}>Delete element</button>
            </>
          )}
          {selVp && (
            <>
              <label>Name</label>
              <input value={selVp.name} onChange={(e) => patchVp(selVp.id, { name: e.target.value })} />
              <label>Facing ({Math.round(selVp.angle)}°, 0 = up, clockwise)</label>
              <input type="range" min="0" max="359" value={selVp.angle} onChange={(e) => patchVp(selVp.id, { angle: Number(e.target.value) })} />
              <label>Field of view ({selVp.fov}°)</label>
              <input type="range" min="30" max="120" value={selVp.fov} onChange={(e) => patchVp(selVp.id, { fov: Number(e.target.value) })} />
              <p className="mute">Elements outside the cone are dimmed on the plan and told to stay out of the render.</p>
              <button className="danger" onClick={() => { updateSpace(space.id, { viewpoints: space.viewpoints.filter((v) => v.id !== selVp.id) }); setSel(null) }}>Delete camera</button>
            </>
          )}
          {selNote && (
            <>
              <label>{selNote.type === 'text' ? 'Text' : 'Label (optional)'}</label>
              <textarea value={selNote.text ?? ''} onChange={(e) => patchNote(selNote.id, { text: e.target.value })} />
              {selNote.type === 'line' && ppm && <p className="mute">Length is shown automatically from the scale.</p>}
              <button className="danger" onClick={() => { setNotes(notes.filter((n) => n.id !== selNote.id)); setSel(null) }}>Delete mark</button>
            </>
          )}
          {!selEl && !selVp && !selNote && <p className="mute">Click an element, camera or mark on the plan to edit it. Drag to move it.</p>}
        </div>
        <div className="card">
          <h3>On this plan</h3>
          {space.elements.length + space.viewpoints.length + notes.length === 0 && <p className="mute">Nothing placed yet.</p>}
          {space.viewpoints.map((v) => <div key={v.id}><button className="ghost" onClick={() => setSel({ type: 'vp', id: v.id })}>📷 {v.name}</button></div>)}
          {space.elements.map((e) => <div key={e.id}><button className="ghost" onClick={() => setSel({ type: 'el', id: e.id })}>{e.locked ? '🔒' : '▫'} {e.name}</button></div>)}
          {notes.map((n) => <div key={n.id}><button className="ghost" style={{ color: n.color }} onClick={() => setSel({ type: 'note', id: n.id })}>✎ {n.text?.trim() || n.type}</button></div>)}
        </div>
      </div>
    </div>
  )
}
