import { lazy, Suspense, useEffect, useState } from 'react'
import { METHODS, methodLabel } from './engine/mastery.ts'
import { snapshot } from './engine/report.ts'
import type { Config, Dataset, Method } from './engine/types.ts'
import { useAnalysis, useProject } from './projectData.ts'
import { uuid, type Project } from './store.ts'
import { Empty, go, isTyping, Link, Modal, SyntheticBadge, toast } from './ui.tsx'

const Tabs = lazy(() => import('./Tabs.tsx'))
const DataTab = lazy(() => import('./Data.tsx'))

export const TABS = [['gradebook', 'Gradebook'], ['methods', 'Compare methods'], ['reteach', 'Reteach groups'], ['students', 'Students'], ['history', 'History'], ['data', 'Data & setup']] as const
export type Tab = (typeof TABS)[number][0]

export interface TabProps {
  project: Project
  ds: Dataset
  cfg: Config
  a: NonNullable<ReturnType<typeof useAnalysis>>
  setConfig(p: Partial<Config>): void
  update(p: Partial<Project>): void
  sid: string | null
}

export default function ProjectView({ id, tab: rawTab }: { id: string; tab: string }) {
  const { loading, project, ds, setConfig, update } = useProject(id)
  const tab = (TABS.some(t => t[0] === rawTab) ? rawTab : 'gradebook') as Tab
  const cfg = project?.config
  const a = useAnalysis(ds, cfg)
  const [help, setHelp] = useState(false)
  const [snapOpen, setSnapOpen] = useState(false)
  const sid = new URLSearchParams(location.search).get('s')

  useEffect(() => { if (project) document.title = `${project.name} · Mastery Book` }, [project?.name])

  const setTab = (t: Tab) => go(`/app/p/${id}${t === 'gradebook' ? '' : '/' + t}`, { keepScroll: true })
  const lastDate = ds?.assessments.map(x => x.date).filter(Boolean).sort().at(-1) ?? new Date().toISOString().slice(0, 10)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) { e.preventDefault(); setTab(TABS[n - 1][0]) }
      else if (e.key === '?') setHelp(true)
      else if (e.key === 's') { e.preventDefault(); setSnapOpen(true) }
      else if (e.key === 'p') go(`/app/p/${id}/report`)
      else if (e.key === 'm' && cfg) {
        const i = METHODS.findIndex(x => x.id === cfg.method)
        const next = METHODS[(i + 1) % METHODS.length].id
        setConfig({ method: next })
        toast(`Method: ${methodLabel(next, cfg)}`, { ttl: 1500 })
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Opening the gradebook</div>
  if (!project || !cfg) return (
    <section className="page narrow center">
      <Empty title="Class not found"><p className="muted">It may have been deleted, or it lives on another device.</p><Link href="/app" className="btn primary">All classes</Link></Empty>
    </section>
  )
  const empty = !ds?.students.length || !a?.m.standards.length

  return (
    <section className="page">
      <div className="proj-head">
        <div>
          <div className="eyebrow"><Link href="/app">Classes</Link></div>
          <h1 className="row gap wrap">{project.name} {project.sampleId && <SyntheticBadge />}</h1>
          {!empty && <p className="muted small" style={{ margin: 0 }}>{ds!.students.length} students · {a!.m.standards.length} standards · {ds!.assessments.length} assessments · {cfg.scale.name}</p>}
        </div>
        {!empty && (
          <div className="toolbar">
            <label className="method-pick"><span className="sr-only">Calculation method</span>
              <select value={cfg.method} onChange={e => setConfig({ method: e.target.value as Method })} aria-label="Calculation method" title="Calculation method (M cycles)">
                {METHODS.map(m => <option key={m.id} value={m.id}>{methodLabel(m.id, cfg)}</option>)}
              </select>
            </label>
            <button type="button" className="btn outline" onClick={() => setSnapOpen(true)} title="Save a term snapshot (S)">Save snapshot</button>
            <Link href={`/app/p/${id}/report`} className="btn primary" title="Family progress reports (P)">Family reports</Link>
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Class sections">
        {TABS.map(([t, l], i) => <Link key={t} href={`/app/p/${id}${t === 'gradebook' ? '' : '/' + t}`} aria-current={t === tab ? 'page' : undefined} title={`${l} (${i + 1})`}>{l}</Link>)}
      </nav>
      <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
        {tab === 'data' || empty
          ? <DataTab project={project} ds={ds!} cfg={cfg} update={update} setConfig={setConfig} />
          : <Tabs tab={tab} project={project} ds={ds!} cfg={cfg} a={a!} setConfig={setConfig} update={update} sid={sid} />}
      </Suspense>
      <Modal open={snapOpen} onClose={() => setSnapOpen(false)} title="Save a term snapshot">
        <form onSubmit={e => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const label = String(f.get('label')).trim() || 'Snapshot', date = String(f.get('date')) || lastDate
          const snap = snapshot(ds!, cfg, uuid(), label, date)
          const before = project.snapshots
          void update({ snapshots: [...before, snap].sort((x, y) => x.date.localeCompare(y.date)) })
          setSnapOpen(false)
          toast(`Saved “${label}”`, { tone: 'ok', undo: () => void update({ snapshots: before }) })
        }}>
          <p className="muted small">Freezes every student&rsquo;s level on every standard and their letter grade, using evidence up to the date below and the current method ({methodLabel(cfg.method, cfg)}). Compare terms on the History tab.</p>
          <label className="field"><span>Label</span><input name="label" defaultValue={`Progress report ${project.snapshots.length + 1}`} required /></label>
          <label className="field"><span>Evidence up to</span><input name="date" type="date" defaultValue={lastDate} /></label>
          <div className="row end gap"><button type="button" className="btn ghost" onClick={() => setSnapOpen(false)}>Cancel</button><button className="btn primary">Save snapshot</button></div>
        </form>
      </Modal>
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>6</kbd></dt><dd>Switch sections</dd></div>
          <div><dt><kbd>M</kbd></dt><dd>Cycle the calculation method</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a term snapshot</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Open the family reports</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete</dd></div>
        </dl>
      </Modal>
    </section>
  )
}
