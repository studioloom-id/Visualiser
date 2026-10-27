import { useState } from 'react'
import { useStore, projectOf } from '../store'
import type { Provider, Quality, Space } from '../types'
import { estimateCost, projectSpend, usd, budgetBlock } from '../lib/cost'
import { prepare, runGeneration, withOverride, expectedElements, forGenerator } from '../lib/run'
import { writePromptWithClaude, missingMentions, writerLabel } from '../lib/claude'
import type { BuiltPrompt } from '../lib/prompt'

export function GeneratePanel({ space, onDone }: { space: Space; onDone: () => void }) {
  const { settings, styles, spaces, renders, updateSpace } = useStore()
  const [viewpointId, setViewpointId] = useState('')
  const [provider, setProvider] = useState<Provider>(settings.provider)
  const [quality, setQuality] = useState<Quality>('draft')
  const [count, setCount] = useState(1)
  const [note, setNote] = useState('')
  const [exclude, setExclude] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<BuiltPrompt | null>(null)
  const [wish, setWish] = useState('')
  const [written, setWritten] = useState('')
  const [writtenFor, setWrittenFor] = useState('')
  const [writing, setWriting] = useState(false)
  const [understood, setUnderstood] = useState<{ understanding: string; questions: string } | null>(null)

  const project = projectOf(spaces, space.id)!
  const spent = projectSpend(spaces, renders, project.id)
  const cost = estimateCost(settings, provider, quality, count)
  const blocked = budgetBlock(project.budgetCap, spent, cost)
  const vpId = space.viewpoints.some((v) => v.id === viewpointId) ? viewpointId : ''
  const params = { spaceId: space.id, viewpointId: vpId || undefined, userNote: note, excludeRefs: exclude, quality }
  const sig = JSON.stringify([vpId, exclude, space.references.length, space.elements.length])
  const stale = !!written && writtenFor !== sig
  const exp = expectedElements(space, vpId || undefined)
  const missing = written ? missingMentions(written, exp ? exp.visibleNames : space.elements.map((e) => e.name)) : []

  const write = async () => {
    setWriting(true); setError('')
    try {
      const built = await prepare(params)
      const w = await writePromptWithClaude({ settings, description: wish, built })
      setWritten(w.prompt)
      setUnderstood({ understanding: w.understanding, questions: w.questions })
      setWrittenFor(sig)
      setProvider('openai')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWriting(false)
    }
  }

  const run = async () => {
    setBusy(true); setError('')
    try {
      await runGeneration({ ...params, promptOverride: written, provider, quality, count })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const showPreview = async () => {
    setError('')
    try { setPreview(forGenerator(withOverride(await prepare(params), written))) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="split">
      <div className="col">
        <div className="card">
          <h3>Describe what you want</h3>
          <textarea value={wish} placeholder='e.g. "Evening view from the door, cosy and warm, the green armchair is the hero"' onChange={(e) => setWish(e.target.value)} />
          <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
            <button className="primary" onClick={write} disabled={writing || busy}>{written ? `Rewrite prompt with ${writerLabel(settings)}` : `Write prompt with ${writerLabel(settings)}`}</button>
            <span className="mute">{writerLabel(settings)} reads your plan, sizes and references, then writes the prompt for {provider === 'openai' ? 'OpenAI' : 'the image model'}.</span>
          </div>
          {writing && <p className="mute">{writerLabel(settings)} is writing…</p>}
          {written && (
            <>
              {understood?.understanding && (
                <div className="card" style={{ background: 'var(--bg)', marginTop: 8 }}>
                  <h3>What {writerLabel(settings)} understood. Check this is right</h3>
                  <pre className="prompt" style={{ maxHeight: 'none', border: 'none', padding: 0 }}>{understood.understanding}</pre>
                  {understood.questions && (<><h3 style={{ marginTop: 8 }}>{writerLabel(settings)} is unsure about</h3><pre className="prompt warn" style={{ maxHeight: 'none', border: 'none', padding: 0 }}>{understood.questions}</pre><p className="mute" style={{ margin: 0 }}>Answer in the box above and press Rewrite, or fix the plan.</p></>)}
                </div>
              )}
              <label>Prompt that will be sent (edit freely)</label>
              <textarea style={{ minHeight: 200 }} value={written} onChange={(e) => setWritten(e.target.value)} />
              {stale && <p className="warn">You changed the camera or references after this was written. Rewrite it so it matches.</p>}
              {missing.length > 0 && <p className="warn">The prompt never mentions: {missing.join(', ')}. Add them or rewrite.</p>}
              <button onClick={() => { setWritten(''); setUnderstood(null) }}>Discard and use the automatic prompt</button>
            </>
          )}
          {!written && <p className="mute" style={{ marginBottom: 0 }}>Optional. Without it, a prompt is assembled automatically from your plan and notes.</p>}
        </div>
        <div className="card">
          <h3>Brief</h3>
          <textarea value={space.brief} placeholder="What should this space feel like? Mood, use, must-haves." onChange={(e) => updateSpace(space.id, { brief: e.target.value })} />
          <label>Style preset</label>
          <select value={space.styleId ?? ''} onChange={(e) => updateSpace(space.id, { styleId: e.target.value || undefined })}>
            <option value="">None</option>
            {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {styles.length === 0 && <div className="mute">Create presets under Styles in the sidebar.</div>}
        </div>

        <div className="card">
          <h3>What to render</h3>
          {space.floorPlan ? (
            <>
              <label style={{ marginTop: 0 }}>Camera viewpoint</label>
              <select value={vpId} onChange={(e) => setViewpointId(e.target.value)}>
                <option value="">None (AI picks the angle)</option>
                {space.viewpoints.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {!space.floorPlan.pxPerMeter && <div className="warn">The floor plan has no scale yet, so sizes will not be sent.</div>}
            </>
          ) : (
            <p className="mute" style={{ margin: 0 }}>No floor plan here, so this renders from the brief and references only. You can add a plan on the Floor plan tab at any time.</p>
          )}
          {space.references.length > 0 && (
            <>
              <label>References to include</label>
              {space.references.map((r) => (
                <label key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink)', margin: '2px 0' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={!exclude.includes(r.id)}
                    onChange={(e) => setExclude(e.target.checked ? exclude.filter((x) => x !== r.id) : [...exclude, r.id])} />
                  {r.name} <span className={r.purpose.trim() ? 'mute' : 'warn'}>{r.purpose.trim() || '(no purpose)'}</span>
                </label>
              ))}
            </>
          )}
          <label>Extra direction for this render</label>
          <textarea value={note} placeholder="e.g. late afternoon light, curtains half drawn" onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="col">
        <div className="card">
          <h3>Render settings</h3>
          <label style={{ marginTop: 0 }}>Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
          </select>
          <label>Resolution</label>
          <div className="row">
            <button style={{ flex: 1 }} className={quality === 'draft' ? 'active' : ''} onClick={() => setQuality('draft')}>Draft<br /><small className="mute">low-res, cheap</small></button>
            <button style={{ flex: 1 }} className={quality === 'final' ? 'active' : ''} onClick={() => setQuality('final')}>Final<br /><small className="mute">high-res</small></button>
          </div>
          <label>Variations ({count})</label>
          <input type="range" min="1" max="4" value={count} onChange={(e) => setCount(Number(e.target.value))} />
          <p style={{ margin: '10px 0 0' }}>Estimated cost: <b>{usd(cost)}</b></p>
          <p className="mute" style={{ margin: 0 }}>Project spend so far: {usd(spent)}{project.budgetCap ? ` of ${usd(project.budgetCap)}` : ''}</p>
          <label>Budget cap for "{project.name}" (USD, 0 = none)</label>
          <input type="number" min="0" step="1" value={project.budgetCap ?? 0} onChange={(e) => useStore.getState().updateSpace(project.id, { budgetCap: Math.max(0, Number(e.target.value) || 0) })} />
          {blocked && <p className="bad">{blocked}</p>}
          {error && <p className="bad" role="alert">{error}</p>}
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={showPreview} disabled={busy}>Preview prompt</button>
            <button className="primary" style={{ flex: 1 }} onClick={run} disabled={busy || !!blocked}>{busy ? 'Generating…' : `Generate ${count > 1 ? count + ' ' : ''}${quality}`}</button>
          </div>
        </div>
      </div>

      {preview && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className="box wide">
            <div className="row" style={{ alignItems: 'center' }}><h2 style={{ flex: 1, margin: 0 }}>Exactly what will be sent</h2><button onClick={() => setPreview(null)}>Close</button></div>
            {preview.notes.length > 0 && <ul className="warn">{preview.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            <h3>Text</h3>
            <pre className="prompt">{preview.text}</pre>
            <h3>Images ({preview.images.length})</h3>
            {preview.images.length === 0 && <p className="mute">No images attached.</p>}
            <div className="grid">
              {preview.images.map((im, i) => (
                <div key={i}><img className="thumb" src={im.dataUrl} alt="" /><div className="mute" style={{ fontSize: 12 }}>{im.label}</div></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
