import { useRef, useState } from 'react'
import { useStore, descendantIds } from '../store'
import type { Provider, Quality, Render, Review, Space } from '../types'
import { estimateCost, usd } from '../lib/cost'
import { expectedElements, runGeneration, runRegionEdit, runReview } from '../lib/run'
import { loadImage } from '../lib/img'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const STATUS_COLOR = { seen: '#2e7d32', missing: '#b3261e', misplaced: '#e08a1b' } as const

function PlanOverlay({ space, render, review }: { space: Space; render: Render; review?: Review }) {
  const plan = space.floorPlan!
  const vp = space.viewpoints.find((v) => v.id === render.viewpointId)
  const ppm = plan.pxPerMeter ?? plan.width / 12
  const statusOf = (name: string) => review?.items.find((i) => i.element.toLowerCase() === name.toLowerCase())?.status
  return (
    <svg viewBox={`0 0 ${plan.width} ${plan.height}`} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }}>
      <image href={plan.image} width={plan.width} height={plan.height} />
      {vp && (() => {
        const r = 3 * ppm, a0 = ((vp.angle - vp.fov / 2 - 90) * Math.PI) / 180, a1 = ((vp.angle + vp.fov / 2 - 90) * Math.PI) / 180
        return <path d={`M${vp.x},${vp.y} L${vp.x + r * Math.cos(a0)},${vp.y + r * Math.sin(a0)} A${r},${r} 0 0 1 ${vp.x + r * Math.cos(a1)},${vp.y + r * Math.sin(a1)} Z`} fill="rgba(47,93,80,.2)" stroke="#2f5d50" strokeWidth={plan.width / 400} />
      })()}
      {space.elements.map((el) => {
        const st = statusOf(el.name)
        const w = el.w * ppm, d = el.d * ppm
        return (
          <g key={el.id} transform={`translate(${el.x},${el.y}) rotate(${el.rotation})`}>
            <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={st ? STATUS_COLOR[st] : '#c98a3c'} fillOpacity={0.5} stroke={st ? STATUS_COLOR[st] : '#c98a3c'} strokeWidth={plan.width / 400} />
            <text y={d / 2 + plan.width / 55} textAnchor="middle" fontSize={plan.width / 60} fill="#111">{el.name}</text>
          </g>
        )
      })}
    </svg>
  )
}

function RegionEditor({ render, onClose }: { render: Render; onClose: (made?: Render) => void }) {
  const settings = useStore((s) => s.settings)
  const cv = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [brush, setBrush] = useState(8)
  const [text, setText] = useState('')
  const [provider, setProvider] = useState<Provider>(render.provider)
  const [quality, setQuality] = useState<Quality>(render.quality)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [painting, setPainting] = useState(false)
  const [dirty, setDirty] = useState(false)

  const pos = (e: React.PointerEvent) => {
    const c = cv.current!, r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height }
  }
  const dot = (e: React.PointerEvent) => {
    const c = cv.current!, ctx = c.getContext('2d')!, p = pos(e)
    ctx.fillStyle = '#e53935'
    ctx.beginPath(); ctx.arc(p.x, p.y, (brush / 100) * c.width * 0.5, 0, Math.PI * 2); ctx.fill()
    setDirty(true)
  }
  const apply = async () => {
    setBusy(true); setError('')
    try {
      const base = await loadImage(render.image)
      const paint = cv.current!
      const mask = document.createElement('canvas'); mask.width = base.width; mask.height = base.height
      const mx = mask.getContext('2d')!
      mx.fillStyle = '#000'; mx.fillRect(0, 0, mask.width, mask.height)
      mx.globalCompositeOperation = 'destination-out'
      mx.drawImage(paint, 0, 0, mask.width, mask.height)
      const ov = document.createElement('canvas'); ov.width = base.width; ov.height = base.height
      const ox = ov.getContext('2d')!
      ox.drawImage(base, 0, 0); ox.globalAlpha = 0.5; ox.drawImage(paint, 0, 0, ov.width, ov.height)
      const made = await runRegionEdit(render, { provider, quality, mask: mask.toDataURL('image/png'), overlay: ov.toDataURL('image/png'), instruction: text })
      onClose(made)
    } catch (e) { setError(msg(e)); setBusy(false) }
  }
  const cost = estimateCost(settings, provider, quality)

  return (
    <div>
      <p className="mute">Paint over the area to change, describe the change, then apply. Everything else is told to stay as is. The result is saved as a new render.</p>
      <div style={{ position: 'relative' }}>
        <img ref={imgRef} src={render.image} alt="" style={{ width: '100%', display: 'block', borderRadius: 8 }}
          onLoad={(e) => { const i = e.currentTarget; setSize({ w: i.naturalWidth, h: i.naturalHeight }) }} />
        {size.w > 0 && (
          <canvas ref={cv} width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5, cursor: 'crosshair', touchAction: 'none' }}
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setPainting(true); dot(e) }}
            onPointerMove={(e) => painting && dot(e)} onPointerUp={() => setPainting(false)} />
        )}
      </div>
      <div className="row" style={{ marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ margin: 0 }}>Brush</label>
        <input type="range" min="2" max="30" value={brush} onChange={(e) => setBrush(Number(e.target.value))} style={{ width: 120 }} />
        <button onClick={() => { cv.current?.getContext('2d')?.clearRect(0, 0, size.w, size.h); setDirty(false) }}>Clear</button>
        <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} style={{ width: 'auto' }}><option value="gemini">Gemini</option><option value="openai">OpenAI</option></select>
        <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} style={{ width: 'auto' }}><option value="draft">Draft</option><option value="final">Final</option></select>
      </div>
      <label>What should change in the painted area?</label>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "replace with a green velvet armchair"' />
      {error && <p className="bad" role="alert">{error}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => onClose()}>Cancel</button>
        <button className="primary" disabled={busy || !dirty || !text.trim()} onClick={apply}>{busy ? 'Editing…' : `Apply edit (${usd(cost)})`}</button>
      </div>
    </div>
  )
}

function Compare({ a, b }: { a: Render; b: Render }) {
  const [pos, setPos] = useState(50)
  return (
    <div>
      <div className="cmp">
        <img src={b.image} alt="after" />
        <div className="top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}><img src={a.image} alt="before" /></div>
        <div className="bar" style={{ left: `${pos}%` }} />
        <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Before and after slider" />
      </div>
      <div className="row mute" style={{ justifyContent: 'space-between' }}><span>◀ {new Date(a.createdAt).toLocaleString()} ({a.quality})</span><span>({b.quality}) {new Date(b.createdAt).toLocaleString()} ▶</span></div>
    </div>
  )
}

function Viewer({ render, onClose, onOpen }: { render: Render; onClose: () => void; onOpen: (r: Render) => void }) {
  const { spaces, renders, settings, deleteRender } = useStore()
  const space = spaces.find((s) => s.id === render.spaceId)!
  const siblings = renders.filter((r) => r.spaceId === render.spaceId && r.id !== render.id)
  const [mode, setMode] = useState<'view' | 'edit' | 'compare' | 'check'>('view')
  const [cmpId, setCmpId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<Provider>(settings.provider)

  const exp = expectedElements(space, render.viewpointId)
  const canReview = !!exp
  const cmp = siblings.find((r) => r.id === cmpId)
  const wrap = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError('')
    try { await fn() } catch (e) { setError(msg(e)) } finally { setBusy('') }
  }

  const upgrade = () => wrap('Upgrading…', async () => {
    const [r] = await runGeneration({ spaceId: render.spaceId, viewpointId: render.viewpointId, provider: render.provider, quality: 'final', count: 1, promptOverride: render.kind === 'region-edit' ? undefined : render.prompt }, { baseImage: render.image, parentId: render.id, kind: 'upgrade' })
    onOpen(r)
  })
  const review = () => wrap('Reviewing…', async () => { await runReview(render, provider); setMode('check') })
  const fixIt = () => wrap('Regenerating…', async () => {
    const fixes = (render.review?.items ?? []).filter((i) => i.status !== 'seen').map((i) => `${i.element}: ${i.note} (${i.status})`)
    const [r] = await runGeneration({ spaceId: render.spaceId, viewpointId: render.viewpointId, provider: render.provider, quality: render.quality, count: 1, fixes }, { parentId: render.id })
    onOpen(r)
  })
  const download = () => { const a = document.createElement('a'); a.href = render.image; a.download = `render-${render.id}.png`; a.click() }

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box wide">
        <div className="row" style={{ alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <h2 style={{ flex: 1, margin: 0 }}>Render <span className="badge">{render.quality}</span> <span className="badge">{render.provider}</span> <span className="badge">{usd(render.cost)}</span> {render.kind !== 'render' && <span className="badge">{render.kind}</span>}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="toolbar">
          <button className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>View</button>
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit region</button>
          <button className={mode === 'compare' ? 'active' : ''} disabled={!siblings.length} onClick={() => { setMode('compare'); if (!cmpId) setCmpId(siblings[0].id) }}>Before / after</button>
          <button className={mode === 'check' ? 'active' : ''} disabled={!space.floorPlan} onClick={() => setMode('check')}>Plan check</button>
          <span style={{ flex: 1 }} />
          {render.quality === 'draft' && <button disabled={!!busy} onClick={upgrade}>Upgrade to final ({usd(estimateCost(settings, render.provider, 'final'))})</button>}
          <button onClick={download}>Download</button>
          <button className="danger" onClick={() => { if (confirm('Delete this render?')) { deleteRender(render.id); onClose() } }}>Delete</button>
        </div>
        {busy && <p className="mute">{busy}</p>}
        {error && <p className="bad" role="alert">{error}</p>}

        {mode === 'view' && (
          <>
            <img src={render.image} alt="render" style={{ width: '100%', borderRadius: 8 }} />
            <details style={{ marginTop: 8 }}><summary className="mute">Prompt used</summary><pre className="prompt">{render.prompt}</pre></details>
          </>
        )}
        {mode === 'edit' && <RegionEditor render={render} onClose={(made) => (made ? onOpen(made) : setMode('view'))} />}
        {mode === 'compare' && (
          <>
            <label style={{ marginTop: 0 }}>Compare this render (right) with</label>
            <select value={cmpId} onChange={(e) => setCmpId(e.target.value)}>
              {siblings.map((r) => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.quality} · {r.kind}</option>)}
            </select>
            {cmp && <div style={{ marginTop: 8 }}><Compare a={cmp} b={render} /></div>}
          </>
        )}
        {mode === 'check' && space.floorPlan && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 380px' }}><img src={render.image} alt="render" style={{ width: '100%', borderRadius: 8 }} /></div>
            <div style={{ flex: '1 1 320px' }} className="col">
              <PlanOverlay space={space} render={render} review={render.review} />
              {!canReview && <p className="warn">AI review needs a calibrated floor plan and a camera chosen when this render was made.</p>}
              <div className="row" style={{ alignItems: 'center' }}>
                <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} style={{ width: 'auto' }}><option value="gemini">Gemini</option><option value="openai">OpenAI</option></select>
                <button className="primary" disabled={!canReview || !!busy} onClick={review}>{render.review ? 'Re-run check' : 'Check against plan'}</button>
              </div>
              <p className="mute" style={{ margin: 0 }}>Green = in the right place, orange = misplaced, red = missing. The check is an AI's opinion; verify by eye.</p>
              {render.review && (
                <>
                  <p>{render.review.summary}</p>
                  {render.review.items.map((i, k) => (
                    <div key={k}><b style={{ color: STATUS_COLOR[i.status] }}>{i.status === 'seen' ? '✓' : '✗'} {i.element}</b> <span className="mute">{i.note}</span></div>
                  ))}
                  {render.review.items.some((i) => i.status !== 'seen') && <button onClick={fixIt} disabled={!!busy}>Regenerate with these fixes ({usd(estimateCost(settings, render.provider, render.quality))})</button>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Gallery({ space }: { space: Space }) {
  const { renders, spaces } = useStore()
  const [deep, setDeep] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const ids = new Set(deep ? descendantIds(spaces, space.id) : [space.id])
  const list = renders.filter((r) => ids.has(r.spaceId))
  const open = renders.find((r) => r.id === openId)
  const hasKids = spaces.some((s) => s.parentId === space.id)
  return (
    <div>
      <div className="toolbar">
        <b>{list.length} render{list.length === 1 ? '' : 's'}</b>
        {hasKids && <label style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={deep} onChange={(e) => setDeep(e.target.checked)} />Include sub-folders</label>}
      </div>
      {list.length === 0 ? <div className="empty">No renders yet. Use the Generate tab.</div> : (
        <div className="grid">
          {list.map((r) => (
            <div key={r.id} className="card" style={{ padding: 8, cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
              <img className="thumb" src={r.image} alt="" />
              <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span className="badge">{r.quality}</span><span className="badge">{r.provider}</span><span className="badge">{usd(r.cost)}</span>
                {r.kind !== 'render' && <span className="badge">{r.kind}</span>}
                {r.review && <span className="badge">{r.review.items.every((i) => i.status === 'seen') ? '✓ plan ok' : '⚠ plan issues'}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <Viewer key={open.id} render={open} onClose={() => setOpenId(null)} onOpen={(r) => setOpenId(r.id)} />}
    </div>
  )
}
