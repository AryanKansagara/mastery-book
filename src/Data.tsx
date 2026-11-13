import { useMemo, useRef, useState } from 'react'
import { assessmentColumns, autoMap, detectKind, FIELD_LABEL, FIELDS_FOR, isWide, KINDS, mergeDataset, parseCsv, toCsv, validate, type Csv, type Kind, type Mapping, type Validation } from './engine/csv.ts'
import { SCALES, standardsInUse } from './engine/mastery.ts'
import { CCSS, normalizeCode } from './engine/standards.ts'
import type { Assessment, Config, Dataset, GradeRule } from './engine/types.ts'
import { createBlankProject, displayName, stdDesc } from './projectData.ts'
import { putData, saveProject, uuid, type Project } from './store.ts'
import { RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, fmtShort, go, Link, toast } from './ui.tsx'

interface Pending { id: string; name: string; kind: Kind; csv: Csv; map: Mapping; cols: number[] }

const TEMPLATES: Record<string, string> = {
  'mapping-template.csv': 'assessment,standard,item,date,points possible,reassessment of\nUnit 1 Test,7.RP.A.1,Q1,2026-09-15,40,\nUnit 1 Test,7.RP.A.1,Q2,,,\nUnit 1 Test,7.RP.A.2,Q3,,,\nUnit 1 Test,7.RP.A.3,Q4,,,\nQuiz 1.2,7.RP.A.2,,2026-09-04,10,\nReassessment: Quiz 1.2,7.RP.A.2,,2026-09-24,10,Quiz 1.2\n',
  'item-scores-template.csv': 'student id,student name,assessment,item,score,max\nS1001,Ada Okafor,Unit 1 Test,Q1,9,10\nS1001,Ada Okafor,Unit 1 Test,Q2,7,10\nS1001,Ada Okafor,Unit 1 Test,Q3,10,10\n',
  'scores-template.csv': 'student id,student name,assessment,date,score,points possible\nS1001,Ada Okafor,Quiz 1.1,2026-08-28,8,10\nS1002,Bo Ng,Quiz 1.1,2026-08-28,6,10\n',
}

export default function DataTab({ project, ds, cfg, update, setConfig }: { project: Project; ds: Dataset; cfg: Config; update(p: Partial<Project>): void; setConfig(p: Partial<Config>): void }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sync = useSync()
  const rawSize = useMemo(() => project.sampleId ? 0 : JSON.stringify(ds).length, [ds, project.sampleId])
  const readOnly = !!project.sampleId

  const readFiles = async (files: FileList | File[]) => {
    const next: Pending[] = []
    for (const f of [...files]) {
      if (f.size > 20_000_000) { toast(`${f.name} is over 20 MB. Export one class at a time.`, { tone: 'error' }); continue }
      if (/\.xlsx?$/i.test(f.name)) { toast(`${f.name}: save the sheet as CSV first (File > Download > CSV).`, { tone: 'error' }); continue }
      const csv = parseCsv(await f.text())
      if (csv.rows.length < 2) { toast(`${f.name} has no data rows.`, { tone: 'error' }); continue }
      const kind = detectKind(csv.rows[0], csv.rows)
      const map = autoMap(csv.rows[0], kind)
      next.push({ id: uuid(), name: f.name, kind, csv, map, cols: assessmentColumns(csv, map) })
    }
    setPending(p => [...p, ...next])
  }

  /** Samples are read-only: importing into one starts a new class. */
  const commit = async (p: Pending, v: Validation) => {
    const t = readOnly ? await createBlankProject('My class') : project
    const merged = mergeDataset(readOnly ? { students: [], assessments: [], scores: [], itemScores: [] } : ds, v.part)
    await putData(t.id, merged)
    const meta = { id: uuid(), kind: p.kind, fileName: p.name, rows: v.rows, skipped: v.skipped, at: Date.now() }
    // Level-scored gradebooks (max 4 everywhere) are switched to level mode automatically.
    const levelLike = merged.assessments.length > 0 && merged.assessments.every(a => a.max > 0 && a.max <= 5) && merged.itemScores.every(i => i.max <= 5)
    const config = !readOnly && project.imports.length ? cfg : { ...t.config, scoreMode: levelLike ? 'level' as const : 'percent' as const }
    await saveProject({ ...t, config, imports: [...(readOnly ? [] : project.imports), meta], dataMissing: false })
    setPending(x => x.filter(y => y.id !== p.id))
    toast(`Imported ${p.name}: ${v.summary}`, { tone: 'ok' })
    if (readOnly) go(`/app/p/${t.id}/data`)
  }

  const saveDs = async (next: Dataset, msg?: string) => {
    const before = ds
    await putData(project.id, next)
    update({})
    if (msg) toast(msg, { undo: async () => { await putData(project.id, before); update({}) } })
  }
  const setAssessment = (id: string, patch: Partial<Assessment>) => void saveDs({ ...ds, assessments: ds.assessments.map(a => a.id === id ? { ...a, ...patch } : a) })

  const stds = standardsInUse(ds)
  const untagged = ds.assessments.filter(a => !a.standards.length)

  return (
    <>
      {project.dataMissing && <div className="banner warn"><span><strong>This class&rsquo;s gradebook is on another device.</strong> Settings, mappings and snapshots synced. Student names never sync, and gradebooks over {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB stay where they were imported. Re-import here to see names.</span></div>}
      {!ds.students.length && !pending.length && (
        <div className="banner"><span><strong>Start here.</strong> 1. Export your gradebook (<Link href="/docs">exact steps for Google Classroom, Canvas and PowerSchool</Link>). 2. Drop it below. 3. Tag each assessment with its standards, or drop a mapping file too.</span></div>
      )}
      {ds.students.length > 0 && untagged.length > 0 && !readOnly && <div className="banner warn"><span><strong>{untagged.length} assessment{untagged.length > 1 ? 's have' : ' has'} no standards yet.</strong> Scores only count once an assessment is tagged. Use the Assessments panel below or import a mapping file.</span></div>}

      <div className="panel">
        <div className="panel-head"><h2>Import</h2><span className="muted small">Google Classroom · Canvas · Khan Academy · PowerSchool · any CSV · mapping · item scores · standards list</span></div>
        {readOnly && <p className="muted small">This is a synthetic sample, so its data is read-only. Importing here starts a new class. Want to rehearse? <button type="button" className="linkish" onClick={() => download(`${project.sampleId}-gradebook.csv`, gradebookCsv(ds))}>Download the sample gradebook</button> and <button type="button" className="linkish" onClick={() => download(`${project.sampleId}-mapping.csv`, mappingCsv(ds))}>its mapping</button>, then drop both back in.</p>}
        <div className={`drop${drag ? ' over' : ''}`} role="button" tabIndex={0} aria-label="Choose CSV files to import"
          onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void readFiles(e.dataTransfer.files) }}>
          <h3>Drop CSV exports here, or click to choose</h3>
          <p className="muted small" style={{ margin: 0 }}>Parsed in your browser. Several files at once is fine: gradebook, mapping and item scores. Re-importing updates scores instead of duplicating them.</p>
          <input ref={input} type="file" accept=".csv,.tsv,.txt" multiple hidden onChange={e => { if (e.target.files) void readFiles(e.target.files); e.target.value = '' }} />
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>Templates: {Object.keys(TEMPLATES).map((n, i) => <span key={n}>{i ? ' · ' : ''}<button type="button" className="linkish" onClick={() => download(n, TEMPLATES[n])}>{n}</button></span>)}</p>
      </div>

      {pending.map(p => <PendingFile key={p.id} p={p} onChange={n => setPending(x => x.map(y => y.id === p.id ? n : y))} onCancel={() => setPending(x => x.filter(y => y.id !== p.id))} onCommit={commit} />)}

      {ds.assessments.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Assessments and standards</h2><span className="muted small">{ds.assessments.length} assessments · {stds.length} standards in use</span></div>
          <datalist id="ccss">{[...(ds.customStandards ?? []), ...CCSS].map(s => <option key={s.code} value={s.code}>{s.desc}</option>)}</datalist>
          <div className="table-wrap"><table className="assess-table">
            <thead><tr><th>Assessment</th><th>Date</th><th className="num">Points</th><th>Standards</th><th>Reassessment of</th></tr></thead>
            <tbody>{[...ds.assessments].sort((x, y) => (x.date || '9').localeCompare(y.date || '9') || x.order - y.order).map(a => (
              <tr key={a.id}>
                <th scope="row" className="break">{a.name}{a.items && Object.keys(a.items).length > 0 && <div className="muted tiny">{Object.keys(a.items).length} tagged items</div>}</th>
                <td><input className="table-input" type="date" value={a.date} disabled={readOnly} aria-label={`Date of ${a.name}`} onChange={e => setAssessment(a.id, { date: e.target.value })} /></td>
                <td className="num"><input className="table-input" type="number" min="1" style={{ width: 70 }} value={a.max} disabled={readOnly} aria-label={`Points possible for ${a.name}`} onChange={e => setAssessment(a.id, { max: Math.max(0, Number(e.target.value)) })} /></td>
                <td><StdChips a={a} readOnly={readOnly} ds={ds} onChange={standards => setAssessment(a.id, { standards })} /></td>
                <td><select className="table-input" value={a.reassessOf ?? ''} disabled={readOnly} aria-label={`${a.name} is a reassessment of`} onChange={e => setAssessment(a.id, { reassessOf: e.target.value || undefined })}>
                  <option value="">Not a reassessment</option>
                  {ds.assessments.filter(o => o.id !== a.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select></td>
              </tr>
            ))}</tbody>
          </table></div>
          {!readOnly && <div className="row gap wrap" style={{ marginTop: 12 }}><button type="button" className="btn sm outline" onClick={() => download(`${project.name.replace(/\W+/g, '-').toLowerCase()}-mapping.csv`, mappingCsv(ds))}>Download mapping CSV</button></div>}
        </div>
      )}

      <GradingSetup cfg={cfg} setConfig={setConfig} />

      {(project.imports.length > 0 || ds.students.length > 0) && (
        <div className="panel">
          <div className="panel-head"><h2>Imported data</h2><span className="muted small">{ds.students.length} students · {(ds.scores.length + ds.itemScores.length).toLocaleString()} scores{rawSize ? ` · ${(rawSize / 1e6).toFixed(2)} MB` : ''}</span></div>
          <div className="table-wrap"><table>
            <thead><tr><th>File</th><th>Format</th><th className="num">Rows</th><th className="num">Skipped</th><th>When</th></tr></thead>
            <tbody>{[...project.imports].reverse().map(i => <tr key={i.id}><th scope="row" className="break">{i.fileName}</th><td>{KINDS[i.kind] ?? i.kind}</td><td className="num">{i.rows.toLocaleString()}</td><td className="num">{i.skipped}</td><td className="small">{new Date(i.at).toLocaleString()}</td></tr>)}</tbody>
          </table></div>
          <p className="muted small">{sync.user
            ? rawSize > RAW_SYNC_LIMIT ? `This gradebook is over ${(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB, so scores stay on this device. Settings, mappings and snapshots still sync.` : 'Scores, mappings and snapshots sync with pseudonymous student ids. Student names stay on this device.'
            : 'Stored in this browser only. Sign in to sync across devices; student names never leave this device either way.'}</p>
          <div className="row gap wrap">
            <button type="button" className="btn sm outline" onClick={() => download(`${project.name.replace(/\W+/g, '-').toLowerCase()}-scores.csv`, scoresCsv(ds))}>Download normalized scores</button>
            {!readOnly && <button type="button" className="btn sm danger-ghost" onClick={async () => {
              if (!(await ask('Clear the gradebook?', 'Removes every student, assessment and score from this class on this device. Settings and snapshots stay. You can undo for a few seconds.', 'Clear gradebook'))) return
              const before = ds, imports = project.imports
              await putData(project.id, { students: [], assessments: [], scores: [], itemScores: [] })
              update({ imports: [] })
              toast('Cleared the gradebook', { undo: async () => { await putData(project.id, before); update({ imports }) } })
            }}>Clear gradebook</button>}
          </div>
        </div>
      )}
    </>
  )
}

function StdChips({ a, ds, readOnly, onChange }: { a: Assessment; ds: Dataset; readOnly: boolean; onChange(s: string[]): void }) {
  const [v, setV] = useState('')
  const add = () => { const c = normalizeCode(v); if (c && !a.standards.includes(c)) onChange([...a.standards, c]); setV('') }
  return (
    <div className="chips">
      {a.standards.map(s => <span key={s} className="chip" title={stdDesc(s, ds)}>{s}{!readOnly && <button type="button" aria-label={`Remove ${s} from ${a.name}`} onClick={() => onChange(a.standards.filter(x => x !== s))}>&times;</button>}</span>)}
      {!readOnly && <input className="table-input chip-input" list="ccss" placeholder="+ code" value={v} aria-label={`Add a standard to ${a.name}`} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} onBlur={() => v && add()} />}
    </div>
  )
}

function PendingFile({ p, onChange, onCancel, onCommit }: { p: Pending; onChange(p: Pending): void; onCancel(): void; onCommit(p: Pending, v: Validation): Promise<void> }) {
  const v = useMemo(() => validate(p.csv, p.kind, p.map, isWide(p.kind) ? p.cols : undefined), [p])
  const [busy, setBusy] = useState(false)
  const headers = p.csv.rows[0] ?? []
  const errors = v.issues.filter(i => i.level === 'error')
  const blocking = errors.some(e => /Map a column|No assessment columns/.test(e.message))
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="break">{p.name}</h2>
        <label className="row gap-sm small">Detected as
          <select value={p.kind} style={{ width: 'auto' }} onChange={e => { const kind = e.target.value as Kind; const map = autoMap(headers, kind); onChange({ ...p, kind, map, cols: assessmentColumns(p.csv, map) }) }}>
            {(Object.keys(KINDS) as Kind[]).map(k => <option key={k} value={k}>{KINDS[k]}</option>)}
          </select>
        </label>
      </div>
      <h3 className="small strong">Column mapping</h3>
      <div className="map-grid">
        {FIELDS_FOR[p.kind].map(({ f, req }) => (
          <label key={f} className="field"><span>{FIELD_LABEL[f]}{req ? ' *' : ''}</span>
            <select value={p.map[f] ?? ''} onChange={e => { const map = { ...p.map }; if (e.target.value === '') delete map[f]; else map[f] = Number(e.target.value); onChange({ ...p, map, cols: isWide(p.kind) ? assessmentColumns(p.csv, map) : p.cols }) }}>
              <option value="">Not mapped</option>
              {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
            </select>
          </label>
        ))}
      </div>
      {isWide(p.kind) && (
        <>
          <h3 className="small strong">Assessment columns ({p.cols.length})</h3>
          <div className="col-picks">{headers.map((h, i) => p.map && Object.values(p.map).includes(i) ? null : (
            <label key={i} className={`col-pick${p.cols.includes(i) ? ' on' : ''}`}><input type="checkbox" checked={p.cols.includes(i)} onChange={e => onChange({ ...p, cols: e.target.checked ? [...p.cols, i].sort((a, b) => a - b) : p.cols.filter(c => c !== i) })} />{h || `Column ${i + 1}`}</label>
          ))}</div>
        </>
      )}
      <h3 className="small strong" style={{ marginTop: 8 }}>Validation</h3>
      <p className="small"><strong className={blocking ? 'error' : 'good-text'}>{blocking ? 'Not ready' : v.summary}</strong> from {v.rows.toLocaleString()} rows{v.skipped > 0 && <>, <strong className="error">{v.skipped} skipped</strong></>}{v.issues.length > errors.length && <>, {v.issues.length - errors.length} warnings</>}.</p>
      {v.issues.length > 0 && (
        <div className="issues" role="log" aria-label="Validation issues">
          {v.issues.slice(0, 200).map((i, k) => <div key={k} className={i.level === 'error' ? 'error-row' : ''}><span className="ln">{i.line ? `line ${i.line}` : 'file'}</span><span>{i.message}</span></div>)}
          {v.issues.length > 200 && <div><span className="ln" /><span className="muted">and {v.issues.length - 200} more</span></div>}
        </div>
      )}
      <div className="row gap" style={{ marginTop: 14 }}>
        <button type="button" className="btn primary" disabled={blocking || !v.used || busy} onClick={async () => { setBusy(true); await onCommit(p, v); setBusy(false) }}>Import</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function GradingSetup({ cfg, setConfig }: { cfg: Config; setConfig(p: Partial<Config>): void }) {
  const levels = [...cfg.scale.levels].sort((a, b) => a.value - b.value)
  const setLevel = (value: number, patch: Partial<(typeof levels)[number]>) => setConfig({ scale: { ...cfg.scale, id: 'custom', levels: cfg.scale.levels.map(l => l.value === value ? { ...l, ...patch } : l) } })
  const setRule = (i: number, patch: Partial<GradeRule>) => setConfig({ grading: { ...cfg.grading, rules: cfg.grading.rules.map((r, j) => j === i ? { ...r, ...patch } : r) } })
  return (
    <div className="panel">
      <div className="panel-head"><h2>Grading setup</h2><span className="muted small">Proficiency scale and the letter-grade conversion</span></div>
      <div className="inline-fields">
        <label className="field"><span>Proficiency scale</span>
          <select value={SCALES.some(s => s.id === cfg.scale.id) ? cfg.scale.id : 'custom'} onChange={e => { const s = SCALES.find(x => x.id === e.target.value); if (s) setConfig({ scale: structuredClone(s) }) }}>
            {SCALES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            {!SCALES.some(s => s.id === cfg.scale.id) && <option value="custom">Custom</option>}
          </select></label>
        <label className="field"><span>Scores are</span>
          <select value={cfg.scoreMode} onChange={e => setConfig({ scoreMode: e.target.value as Config['scoreMode'] })}>
            <option value="percent">Points (converted with the cut-offs)</option><option value="level">Already proficiency levels</option>
          </select></label>
        <label className="field"><span>Counts as met</span>
          <select value={cfg.scale.proficient} onChange={e => setConfig({ scale: { ...cfg.scale, proficient: Number(e.target.value) } })}>
            {levels.map(l => <option key={l.value} value={l.value}>{l.value} {l.label} or above</option>)}
          </select></label>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Level</th><th>Label</th><th>From % of points</th><th>Plain-language meaning (family reports)</th></tr></thead>
        <tbody>{levels.map(l => (
          <tr key={l.value}><th scope="row">{l.value}</th>
            <td><input className="table-input" value={l.label} aria-label={`Label for level ${l.value}`} onChange={e => setLevel(l.value, { label: e.target.value })} /></td>
            <td><input className="table-input" type="number" min="0" max="100" style={{ width: 80 }} value={Math.round(l.minPct * 100)} aria-label={`Cut-off for level ${l.value}`} onChange={e => setLevel(l.value, { minPct: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })} /></td>
            <td><input className="table-input" value={l.plain} aria-label={`Meaning of level ${l.value}`} onChange={e => setLevel(l.value, { plain: e.target.value })} /></td></tr>
        ))}</tbody>
      </table></div>
      <h3 style={{ marginTop: 18 }}>Letter grade conversion</h3>
      <div className="seg-control" role="radiogroup" aria-label="Conversion mode" style={{ marginBottom: 12 }}>
        <button type="button" role="radio" aria-checked={cfg.grading.mode === 'share'} className={cfg.grading.mode === 'share' ? 'on' : ''} onClick={() => setConfig({ grading: { ...cfg.grading, mode: 'share' } })}>Share of standards met</button>
        <button type="button" role="radio" aria-checked={cfg.grading.mode === 'average'} className={cfg.grading.mode === 'average' ? 'on' : ''} onClick={() => setConfig({ grading: { ...cfg.grading, mode: 'average' } })}>Average level</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Letter</th>{cfg.grading.mode === 'share' ? <><th>At least this % of standards met</th><th>No standard below</th></> : <th>Average level at least</th>}</tr></thead>
        <tbody>{cfg.grading.rules.map((r, i) => (
          <tr key={i}><th scope="row"><input className="table-input" style={{ width: 60 }} value={r.letter} aria-label={`Letter ${i + 1}`} onChange={e => setRule(i, { letter: e.target.value.slice(0, 3) })} /></th>
            {cfg.grading.mode === 'share' ? <>
              <td><input className="table-input" type="number" min="0" max="100" style={{ width: 90 }} value={Math.round(r.minShare * 100)} aria-label={`Minimum share for ${r.letter}`} onChange={e => setRule(i, { minShare: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })} /></td>
              <td><select className="table-input" style={{ width: 120 }} value={r.floor} aria-label={`Floor for ${r.letter}`} onChange={e => setRule(i, { floor: Number(e.target.value) })}><option value={0}>No floor</option>{levels.map(l => <option key={l.value} value={l.value}>{l.value}</option>)}</select></td>
            </> : <td><input className="table-input" type="number" step="0.1" min="0" style={{ width: 90 }} value={r.minAvg} aria-label={`Minimum average for ${r.letter}`} onChange={e => setRule(i, { minAvg: Number(e.target.value) })} /></td>}
          </tr>
        ))}</tbody>
      </table></div>
      <p className="muted small">Rules are checked top to bottom; the first one a student meets is their letter. Only standards with evidence count.</p>
    </div>
  )
}

// ---------- CSV round trips ----------

const sorted = (ds: Dataset) => [...ds.assessments].sort((x, y) => (x.date || '9').localeCompare(y.date || '9') || x.order - y.order)
export function gradebookCsv(ds: Dataset): string {
  const as = sorted(ds)
  const pts = new Map(ds.scores.map(s => [`${s.s}|${s.a}`, s.pts]))
  return toCsv([
    ['Student ID', 'Student Name', ...as.map(a => a.name)],
    ['Date', '', ...as.map(a => a.date)],
    ['Points Possible', '', ...as.map(a => a.max)],
    ...ds.students.map(s => [s.id, displayName(s), ...as.map(a => pts.get(`${s.id}|${a.id}`) ?? '')]),
  ])
}
export function mappingCsv(ds: Dataset): string {
  const byId = new Map(ds.assessments.map(a => [a.id, a.name]))
  return toCsv([['assessment', 'standards', 'date', 'points possible', 'reassessment of'], ...sorted(ds).map(a => [a.name, a.standards.join('; '), a.date, a.max, a.reassessOf ? byId.get(a.reassessOf) ?? '' : ''])])
}
export function scoresCsv(ds: Dataset): string {
  const names = new Map(ds.students.map(s => [s.id, displayName(s)]))
  const as = new Map(ds.assessments.map(a => [a.id, a]))
  return toCsv([['student id', 'student name', 'assessment', 'date', 'standard', 'score', 'points possible'],
    ...ds.scores.map(s => [s.s, names.get(s.s), as.get(s.a)?.name, as.get(s.a)?.date, '', s.pts, as.get(s.a)?.max]),
    ...ds.itemScores.map(s => [s.s, names.get(s.s), as.get(s.a)?.name, as.get(s.a)?.date, s.std || s.item, s.pts, s.max])])
}
