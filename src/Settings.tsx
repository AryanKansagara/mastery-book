import { useState } from 'react'
import { deleteProject, getDefaults, getProjects, setDefaults, type Defaults } from './store.ts'
import { exportAll, RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, setTheme, toast, useDark } from './ui.tsx'
import { METHODS, SCALES } from './engine/mastery.ts'
import type { Method, ReassessRule } from './engine/types.ts'

export default function Settings() {
  const [d, setD] = useState<Defaults>(getDefaults)
  const dark = useDark()
  const sync = useSync()
  const save = (p: Partial<Defaults>) => { const next = { ...d, ...p }; setD(next); setDefaults(next); toast('Saved', { tone: 'ok', ttl: 1500 }) }

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Defaults for new classes</h2>
        <p className="muted small">Existing classes keep their own setup; change those on the class&rsquo;s Data &amp; setup and Compare methods tabs.</p>
        <div className="inline-fields">
          <label className="field"><span>Proficiency scale</span><select value={d.scaleId} onChange={e => save({ scaleId: e.target.value })}>{SCALES.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field"><span>Calculation method</span><select value={d.method} onChange={e => save({ method: e.target.value as Method })}>{METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
          <label className="field"><span>Decaying average weight (%)</span><input type="number" min="30" max="90" step="5" value={Math.round(d.decay * 100)} onChange={e => save({ decay: Math.min(0.9, Math.max(0.3, Number(e.target.value) / 100)) })} /></label>
          <label className="field"><span>Most recent N</span><input type="number" min="2" max="6" value={d.recentN} onChange={e => save({ recentN: Math.max(1, Number(e.target.value) || 3) })} /></label>
          <label className="field"><span>Reassessments</span><select value={d.reassess} onChange={e => save({ reassess: e.target.value as ReassessRule })}><option value="replace">Replace the original</option><option value="highest">Keep the higher</option><option value="average">Average the two</option><option value="keep">Keep both</option></select></label>
          <label className="field"><span>Rounding</span><select value={d.rounding} onChange={e => save({ rounding: e.target.value as 'nearest' | 'down' })}><option value="nearest">Nearest</option><option value="down">Down</option></select></label>
          <label className="field"><span>Max reteach group size</span><input type="number" min="2" max="15" value={d.maxGroup} onChange={e => save({ maxGroup: Math.max(2, Number(e.target.value) || 6) })} /></label>
        </div>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Classes live in this browser (IndexedDB). {sync.user ? <>Signed in as <b>{sync.user.email}</b>: settings, mappings, snapshots and gradebooks under {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB sync to your account with pseudonymous student ids. Names stay here.</> : 'Sign in from the account menu (top right) to sync across devices. It is optional, and student names never leave this device.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`mastery-book-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete all local classes?', `Removes ${list.length} class${list.length > 1 ? 'es' : ''} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(p => deleteProject(p.id)))
            toast(`Deleted ${list.length} classes`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all classes</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>6</kbd></dt><dd>Switch class sections</dd></div>
          <div><dt><kbd>M</kbd></dt><dd>Cycle the calculation method</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a term snapshot</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Family progress reports</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>Show shortcuts on a class page</dd></div>
        </dl>
      </div>
    </section>
  )
}
