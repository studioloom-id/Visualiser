import { useState } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { FloorPlanEditor } from './components/FloorPlanEditor'
import { ReferenceBoard } from './components/ReferenceBoard'
import { GeneratePanel } from './components/GeneratePanel'
import { Gallery } from './components/Gallery'
import { SettingsModal, StylesModal, BackupModal } from './components/Modals'

type Tab = 'plan' | 'refs' | 'gen' | 'gallery'

export default function App() {
  const { spaces, selectedId, renders, settings } = useStore()
  const [tab, setTab] = useState<Tab>('refs')
  const [modal, setModal] = useState<'settings' | 'styles' | 'backup' | null>(null)
  const space = spaces.find((s) => s.id === selectedId)
  const count = space ? renders.filter((r) => r.spaceId === space.id).length : 0
  const hasKey = settings.geminiKey.trim() || settings.openaiKey.trim()

  return (
    <div className="app">
      <Sidebar onSettings={() => setModal('settings')} onStyles={() => setModal('styles')} onBackup={() => setModal('backup')} />
      <main className="main">
        {!space ? (
          <div className="body"><div className="empty" style={{ marginTop: 40 }}>
            <h2>Interior design visualiser</h2>
            <p>Create a project in the sidebar, or select one.</p>
            <p className="mute">Add a floor plan (optional), paste in references and mark them up, then generate renders that follow your plan.</p>
          </div></div>
        ) : (
          <>
            <div className="topbar">
              <h2>{space.name} <span className="badge">{space.kind}</span></h2>
              {!hasKey && <button className="primary" onClick={() => setModal('settings')}>Add an API key to generate</button>}
            </div>
            <div className="tabs">
              <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>Floor plan{space.floorPlan ? '' : ' (optional)'}</button>
              <button className={tab === 'refs' ? 'active' : ''} onClick={() => setTab('refs')}>References ({space.references.length})</button>
              <button className={tab === 'gen' ? 'active' : ''} onClick={() => setTab('gen')}>Generate</button>
              <button className={tab === 'gallery' ? 'active' : ''} onClick={() => setTab('gallery')}>Renders ({count})</button>
            </div>
            <div className="body" key={space.id + tab}>
              {tab === 'plan' && <FloorPlanEditor space={space} />}
              {tab === 'refs' && <ReferenceBoard space={space} />}
              {tab === 'gen' && <GeneratePanel space={space} onDone={() => setTab('gallery')} />}
              {tab === 'gallery' && <Gallery space={space} />}
            </div>
          </>
        )}
      </main>
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'styles' && <StylesModal onClose={() => setModal(null)} />}
      {modal === 'backup' && <BackupModal onClose={() => setModal(null)} />}
    </div>
  )
}
