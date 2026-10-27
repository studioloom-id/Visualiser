import { useRef } from 'react'
import { useStore } from '../store'
import type { Provider, Quality } from '../types'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box">
        <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ flex: 1, margin: 0 }}>{title}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings: s, setSettings } = useStore()
  const setCost = (p: Provider, q: Quality, v: string) =>
    setSettings({ costs: { ...s.costs, [p]: { ...s.costs[p], [q]: Math.max(0, Number(v) || 0) } } })
  return (
    <Modal title="Settings" onClose={onClose}>
      <p className="mute">API keys stay in this browser only and are sent straight to the provider you pick. Anyone using this browser profile can read them.</p>
      <label>Default provider</label>
      <select value={s.provider} onChange={(e) => setSettings({ provider: e.target.value as Provider })}>
        <option value="gemini">Gemini</option>
        <option value="openai">OpenAI</option>
      </select>
      <label>Gemini API key</label>
      <input type="password" value={s.geminiKey} onChange={(e) => setSettings({ geminiKey: e.target.value })} autoComplete="off" />
      <label>OpenAI API key</label>
      <input type="password" value={s.openaiKey} onChange={(e) => setSettings({ openaiKey: e.target.value })} autoComplete="off" />
      <label>Prompt writer and plan reader</label>
      <select value={s.writer} onChange={(e) => setSettings({ writer: e.target.value as typeof s.writer })}>
        <option value="auto">Auto (Claude if an Anthropic key is set, otherwise OpenAI)</option>
        <option value="claude">Claude (needs Anthropic API credit)</option>
        <option value="openai">OpenAI (uses your OpenAI key)</option>
      </select>
      <label>Anthropic (Claude) API key</label>
      <input type="password" value={s.anthropicKey} onChange={(e) => setSettings({ anthropicKey: e.target.value })} autoComplete="off" />
      <h3 style={{ marginTop: 16 }}>Models</h3>
      <label>OpenAI text/vision model (prompt writer and plan reader)</label>
      <input value={s.openaiTextModel} onChange={(e) => setSettings({ openaiTextModel: e.target.value })} />
      <label>Claude model (prompt writer)</label>
      <input value={s.claudeModel} onChange={(e) => setSettings({ claudeModel: e.target.value })} />
      <p className="mute">Model names change over time. If a render fails with "model not found", update the name here.</p>
      <label>Gemini draft model (low-res)</label>
      <input value={s.geminiDraftModel} onChange={(e) => setSettings({ geminiDraftModel: e.target.value })} />
      <label>Gemini final model (high-res, 2K)</label>
      <input value={s.geminiFinalModel} onChange={(e) => setSettings({ geminiFinalModel: e.target.value })} />
      <label>OpenAI image model</label>
      <input value={s.openaiModel} onChange={(e) => setSettings({ openaiModel: e.target.value })} />
      <label>Gemini review model</label>
      <input value={s.geminiReviewModel} onChange={(e) => setSettings({ geminiReviewModel: e.target.value })} />
      <label>OpenAI review model</label>
      <input value={s.openaiReviewModel} onChange={(e) => setSettings({ openaiReviewModel: e.target.value })} />
      <h3 style={{ marginTop: 16 }}>Estimated cost per image (USD)</h3>
      <p className="mute">These drive the cost display and budget cap. They are estimates you can edit to match your provider's current pricing. The AI review check is not counted.</p>
      <div className="row">
        {(['gemini', 'openai'] as Provider[]).map((p) => (
          <div key={p} style={{ flex: 1 }}>
            <b>{p === 'gemini' ? 'Gemini' : 'OpenAI'}</b>
            {(['draft', 'final'] as Quality[]).map((q) => (
              <div key={q}>
                <label>{q === 'draft' ? 'Draft (low-res)' : 'Final (high-res)'}</label>
                <input type="number" step="0.01" min="0" value={s.costs[p][q]} onChange={(e) => setCost(p, q, e.target.value)} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function StylesModal({ onClose }: { onClose: () => void }) {
  const { styles, addStyle, updateStyle, deleteStyle } = useStore()
  return (
    <Modal title="Style presets" onClose={onClose}>
      <p className="mute">Save materials, palette and lighting once, then apply the preset to any project or folder from its Generate tab.</p>
      {styles.map((st) => (
        <div key={st.id} className="card" style={{ marginBottom: 8 }}>
          <div className="row">
            <input value={st.name} onChange={(e) => updateStyle(st.id, { name: e.target.value })} />
            <button className="danger" onClick={() => confirm(`Delete style "${st.name}"?`) && deleteStyle(st.id)}>Delete</button>
          </div>
          <label>Materials</label>
          <input value={st.materials} placeholder="oak flooring, lime plaster walls, brushed brass" onChange={(e) => updateStyle(st.id, { materials: e.target.value })} />
          <label>Colour palette</label>
          <input value={st.palette} placeholder="warm neutrals with olive green accents" onChange={(e) => updateStyle(st.id, { palette: e.target.value })} />
          <label>Lighting</label>
          <input value={st.lighting} placeholder="soft morning daylight, warm 2700K lamps" onChange={(e) => updateStyle(st.id, { lighting: e.target.value })} />
        </div>
      ))}
      <button className="primary" onClick={() => addStyle({ name: `Style ${styles.length + 1}`, materials: '', palette: '', lighting: '' })}>＋ New style</button>
    </Modal>
  )
}

export function BackupModal({ onClose }: { onClose: () => void }) {
  const { spaces, renders, styles, importAll } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ version: 1, spaces, renders, styles })], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `design-visualiser-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importFile = async (f: File) => {
    try {
      const d = JSON.parse(await f.text())
      if (!Array.isArray(d.spaces) || !Array.isArray(d.renders)) throw new Error('bad file')
      if (!confirm('Importing replaces everything currently in the app (API keys are kept). Continue?')) return
      importAll({ spaces: d.spaces, renders: d.renders, styles: d.styles ?? [] })
      onClose()
    } catch {
      alert('That file is not a Design Visualiser backup.')
    }
  }
  return (
    <Modal title="Backup" onClose={onClose}>
      <p className="mute">Everything lives in this browser. Export a backup file to move it elsewhere or keep a copy. API keys are not included.</p>
      <div className="row">
        <button className="primary" onClick={exportAll}>Export backup</button>
        <button onClick={() => fileRef.current?.click()}>Import backup…</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      </div>
    </Modal>
  )
}
