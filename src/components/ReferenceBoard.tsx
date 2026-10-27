import { useEffect, useRef, useState } from 'react'
import { useStore, uid } from '../store'
import type { Reference, Shape, ShapeType, Space } from '../types'
import { fileToImage, imagesFromClipboard, loadImage } from '../lib/img'
import { drawShapes } from '../lib/annotate'

const TOOLS: [ShapeType, string][] = [['pin', '① Pin'], ['rect', '▭ Box'], ['arrow', '↗ Arrow'], ['free', '✎ Draw'], ['text', 'T Text']]
const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#111111']

function Markup({ reference, space }: { reference: Reference; space: Space }) {
  const updateSpace = useStore((s) => s.updateSpace)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<ShapeType>('pin')
  const [color, setColor] = useState(COLORS[0])
  const [draft, setDraft] = useState<Shape | null>(null)

  const patchRef = (p: Partial<Reference>) =>
    updateSpace(space.id, { references: space.references.map((r) => (r.id === reference.id ? { ...r, ...p } : r)) })

  useEffect(() => { loadImage(reference.image).then(setImg) }, [reference.image])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !img) return
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    drawShapes(ctx, draft ? [...reference.shapes, draft] : reference.shapes, img.width)
  }, [img, reference.shapes, draft])

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height }
  }

  const add = (s: Shape) => patchRef({ shapes: [...reference.shapes, s] })

  const down = (e: React.PointerEvent) => {
    const p = pos(e)
    if (tool === 'pin') {
      const t = prompt('What is this pin pointing at / for? (e.g. "use this leg shape")')
      if (t !== null) add({ id: uid(), type: 'pin', color, x: p.x, y: p.y, text: t })
    } else if (tool === 'text') {
      const t = prompt('Text label')
      if (t?.trim()) add({ id: uid(), type: 'text', color, x: p.x, y: p.y, text: t.trim() })
    } else {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      setDraft(tool === 'free'
        ? { id: uid(), type: 'free', color, x: p.x, y: p.y, points: [p.x, p.y] }
        : { id: uid(), type: tool, color, x: p.x, y: p.y, w: 0, h: 0 })
    }
  }
  const move = (e: React.PointerEvent) => {
    if (!draft) return
    const p = pos(e)
    setDraft(draft.type === 'free' ? { ...draft, points: [...(draft.points ?? []), p.x, p.y] } : { ...draft, w: p.x - draft.x, h: p.y - draft.y })
  }
  const up = () => {
    if (!draft) return
    const d = draft
    setDraft(null)
    const tiny = d.type === 'free' ? (d.points?.length ?? 0) < 6 : Math.abs(d.w ?? 0) < 4 && Math.abs(d.h ?? 0) < 4
    if (tiny) return
    const t = prompt('Say what this mark is for (optional)')
    add({ ...d, text: t?.trim() || undefined })
  }

  const linked = space.elements.find((e) => e.id === reference.elementId)

  return (
    <div className="split">
      <div>
        <div className="toolbar">
          {TOOLS.map(([t, l]) => <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(t)}>{l}</button>)}
          <span style={{ width: 8 }} />
          {COLORS.map((c) => (
            <button key={c} aria-label={`colour ${c}`} onClick={() => setColor(c)} style={{ width: 24, height: 24, padding: 0, background: c, borderRadius: 99, outline: color === c ? '2px solid var(--ink)' : 'none', outlineOffset: 2 }} />
          ))}
          <button disabled={!reference.shapes.length} onClick={() => patchRef({ shapes: reference.shapes.slice(0, -1) })}>Undo</button>
        </div>
        <div className="stagewrap" style={{ display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
          <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '70vh', touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} />
        </div>
      </div>

      <div className="col" style={{ overflow: 'auto' }}>
        <div className="card">
          <label style={{ marginTop: 0 }}>Name</label>
          <input value={reference.name} onChange={(e) => patchRef({ name: e.target.value })} />
          <label>What is this reference for? <span className="bad">*</span></label>
          <textarea value={reference.purpose} placeholder='e.g. "Sofa style and fabric only. Ignore the room."' onChange={(e) => patchRef({ purpose: e.target.value })} />
          {!reference.purpose.trim() && <div className="warn">Add a purpose so the AI knows how to use this image.</div>}
          <label>Applies to plan element</label>
          <select value={reference.elementId ?? ''} onChange={(e) => patchRef({ elementId: e.target.value || undefined })}>
            <option value="">None (general reference)</option>
            {space.elements.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {linked && <div className="mute">The AI is told this applies to "{linked.name}".</div>}
        </div>
        <div className="card">
          <h3>Marks ({reference.shapes.length})</h3>
          {reference.shapes.length === 0 && <p className="mute">Pick a tool and click or drag on the image. Each mark can carry a note.</p>}
          {reference.shapes.map((s, i) => (
            <div key={s.id} className="row" style={{ alignItems: 'center', marginBottom: 4 }}>
              <span style={{ color: s.color }}>●</span>
              <span className="mute" style={{ width: 40 }}>{s.type}</span>
              <input value={s.text ?? ''} placeholder="note" onChange={(e) => patchRef({ shapes: reference.shapes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <button className="ghost danger" onClick={() => patchRef({ shapes: reference.shapes.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </div>
        <button className="danger" onClick={() => confirm(`Remove "${reference.name}"?`) && updateSpace(space.id, { references: space.references.filter((r) => r.id !== reference.id) })}>Remove reference</button>
      </div>
    </div>
  )
}

export function ReferenceBoard({ space }: { space: Space }) {
  const updateSpace = useStore((s) => s.updateSpace)
  const fileRef = useRef<HTMLInputElement>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)

  const addFiles = async (files: Blob[]) => {
    const made: Reference[] = []
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      const { image, width, height } = await fileToImage(f)
      made.push({ id: uid(), name: (f as File).name?.replace(/\.[^.]+$/, '') || `Reference ${space.references.length + made.length + 1}`, image, width, height, purpose: '', shapes: [] })
    }
    if (!made.length) return
    updateSpace(space.id, { references: [...space.references, ...made] })
    setSelId(made[made.length - 1].id)
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return
      const files = imagesFromClipboard(e)
      if (files.length) { e.preventDefault(); addFiles(files) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const current = space.references.find((r) => r.id === selId) ?? space.references[0]

  return (
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)) }}
      style={{ outline: drag ? '2px dashed var(--accent)' : 'none', borderRadius: 10 }}>
      <div className="toolbar">
        <button className="primary" onClick={() => fileRef.current?.click()}>Add images</button>
        <span className="mute">or paste with Ctrl/Cmd+V, or drop files here</span>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>
      {space.references.length === 0 ? (
        <div className="empty">Paste or drop reference images here. You can mark up each one and say what it is for.</div>
      ) : (
        <>
          <div className="row" style={{ overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
            {space.references.map((r) => (
              <button key={r.id} className={r.id === current?.id ? 'active' : ''} onClick={() => setSelId(r.id)} style={{ padding: 4, flex: '0 0 auto', width: 110, textAlign: 'left' }}>
                <img src={r.image} alt="" style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                <div style={{ fontSize: 11 }} className={r.purpose.trim() ? 'ok' : 'warn'}>{r.purpose.trim() ? '✓ purpose set' : 'needs purpose'}</div>
              </button>
            ))}
          </div>
          {current && <Markup key={current.id} reference={current} space={space} />}
        </>
      )}
    </div>
  )
}
