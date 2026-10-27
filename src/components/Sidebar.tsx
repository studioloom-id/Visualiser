import { useState } from 'react'
import { useStore } from '../store'
import type { Space } from '../types'

function Node({ space, depth }: { space: Space; depth: number }) {
  const { spaces, selectedId, select, addSpace, updateSpace, deleteSpace, moveSpace } = useStore()
  const [open, setOpen] = useState(true)
  const [over, setOver] = useState(false)
  const kids = spaces.filter((s) => s.parentId === space.id)

  const rename = () => {
    const n = prompt('Rename', space.name)
    if (n?.trim()) updateSpace(space.id, { name: n.trim() })
  }
  const remove = () => {
    if (confirm(`Delete "${space.name}" and everything inside it, including its renders?`)) deleteSpace(space.id)
  }

  return (
    <div>
      <div
        className={`node${selectedId === space.id ? ' sel' : ''}${over ? ' over' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={space.kind === 'folder'}
        onDragStart={(e) => e.dataTransfer.setData('text/space', space.id)}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const id = e.dataTransfer.getData('text/space')
          if (id && id !== space.id) moveSpace(id, space.id)
        }}
        onClick={() => select(space.id)}
      >
        <span onClick={(e) => { e.stopPropagation(); setOpen(!open) }} style={{ width: 14, color: 'var(--mute)' }}>
          {kids.length ? (open ? '▾' : '▸') : ''}
        </span>
        <span>{space.kind === 'project' ? '◼' : '▢'}</span>
        <span className="name">{space.name}</span>
        <span className="acts">
          <button title="New folder inside" onClick={(e) => { e.stopPropagation(); const n = prompt('Folder name (e.g. Living room)'); if (n?.trim()) addSpace('folder', n.trim(), space.id) }}>＋</button>
          <button title="Rename" onClick={(e) => { e.stopPropagation(); rename() }}>✎</button>
          <button title="Delete" onClick={(e) => { e.stopPropagation(); remove() }}>✕</button>
        </span>
      </div>
      {open && kids.map((k) => <Node key={k.id} space={k} depth={depth + 1} />)}
    </div>
  )
}

export function Sidebar({ onSettings, onStyles, onBackup }: { onSettings: () => void; onStyles: () => void; onBackup: () => void }) {
  const { spaces, addSpace, moveSpace } = useStore()
  const roots = spaces.filter((s) => s.parentId === null)
  return (
    <aside className="side">
      <header>
        <b>Projects</b>
        <button className="primary" onClick={() => { const n = prompt('Project name'); if (n?.trim()) addSpace('project', n.trim(), null) }}>＋ New</button>
      </header>
      <div
        className="tree"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { const id = e.dataTransfer.getData('text/space'); if (id) moveSpace(id, null) }}
      >
        {roots.length === 0 && <p className="mute" style={{ padding: 8 }}>No projects yet. Create one to get started. Inside a project you can add folders, such as one per room, and drag folders to reorganise.</p>}
        {roots.map((r) => <Node key={r.id} space={r} depth={0} />)}
      </div>
      <footer>
        <button onClick={onStyles}>Styles</button>
        <button onClick={onBackup}>Backup</button>
        <button onClick={onSettings}>Settings</button>
      </footer>
    </aside>
  )
}
