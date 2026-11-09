import { useMemo, useState } from 'react'
import { GrowthChart, Heatmap, Sparkline, ToneLegend } from './charts.tsx'
import { calc, cellFor, classGrowth, compareMethods, explain, explainCell, growthSeries, khanSearch, levelInfo, METHODS, methodLabel, rowGrade, scaleMax, scaleMin, toLevel } from './engine/mastery.ts'
import { reteachGroups } from './engine/groups.ts'
import { compareSnapshots, heatmapCsv, heatmapXlsx, tone } from './engine/report.ts'
import type { Method, ReassessRule } from './engine/types.ts'
import type { Tab, TabProps } from './Project.tsx'
import { displayName, stdDesc, stdQuery } from './projectData.ts'
import { deleteSnapshotCloud } from './sync.ts'
import { CopyButton, download, Empty, fmtDate, fmtPct, fmtShort, go, Link, Modal, toast } from './ui.tsx'

export default function Tabs(p: TabProps & { tab: Tab }) {
  if (p.tab === 'methods') return <Methods {...p} />
  if (p.tab === 'reteach') return <Reteach {...p} />
  if (p.tab === 'students') return <Students {...p} />
  if (p.tab === 'history') return <History {...p} />
  return <Gradebook {...p} />
}

const slug = (s: string) => s.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const useDescs = (codes: string[], ds: TabProps['ds']) => useMemo(() => Object.fromEntries(codes.map(c => [c, stdDesc(c, ds)])), [codes, ds])

// ---------- Gradebook ----------

function Gradebook({ project, ds, cfg, a }: TabProps) {
  const { m } = a
  const [cell, setCell] = useState<{ s: string; std: string } | null>(null)
  const descs = useDescs(m.standards, ds)
  const growth = useMemo(() => classGrowth(ds, cfg), [ds, cfg])
  const flat = m.cells.flat().filter(Boolean)
  const share = flat.length ? flat.filter(c => c!.level >= cfg.scale.proficient).length / flat.length : 0
  const perStd = m.standards.map((code, j) => {
    const cs = m.cells.map(r => r[j]).filter(Boolean)
    return { code, n: cs.length, share: cs.length ? cs.filter(c => c!.level >= cfg.scale.proficient).length / cs.length : 0 }
  })
  const weak = perStd.filter(s => s.share < 0.6).length
  const reassessed = flat.filter(c => c!.dropped.length).length
  const letters = m.cells.map(r => rowGrade(r, cfg).letter)
  const grades = cfg.grading.rules.map(r => ({ letter: r.letter, n: letters.filter(l => l === r.letter).length }))

  const name = slug(project.name)
  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>Student-standards at {levelInfo(cfg.scale.proficient, cfg.scale).label}</small><b>{fmtPct(share)}</b><p>{flat.length} with evidence</p></div>
        <div className="kpi"><small>Grade spread</small><div className="grade-bars">{grades.map(g => <span key={g.letter} title={`${g.letter}: ${g.n} students`}><i style={{ height: 3 + g.n / Math.max(1, ...grades.map(x => x.n)) * 30 }} className={`g-${g.letter}`} /><em>{g.n}</em><em>{g.letter}</em></span>)}</div></div>
        <div className="kpi"><small>Standards under 60% proficient</small><b>{weak}</b><p>of {m.standards.length}; see Reteach groups</p></div>
        <div className="kpi"><small>Student-standards with a replaced score</small><b>{reassessed}</b><p>Rule: {cfg.reassess === 'replace' ? 'reassessment replaces' : cfg.reassess === 'keep' ? 'keep both' : cfg.reassess}</p></div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>Class heatmap</h2>
          <div className="row gap-sm wrap">
            <button type="button" className="btn sm outline" onClick={() => download(`${name}-heatmap.csv`, heatmapCsv(m, cfg))}>Download CSV</button>
            <button type="button" className="btn sm outline" onClick={() => download(`${name}-heatmap.xlsx`, new Blob([heatmapXlsx(ds, cfg, descs) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))}>Download XLSX</button>
          </div>
        </div>
        <div className="row between wrap gap"><ToneLegend cfg={cfg} /><span className="muted small">{methodLabel(cfg.method, cfg)}. Click a cell for the evidence, a name for the explainer.</span></div>
        <Heatmap m={m} cfg={cfg} descs={descs} onCell={(s, std) => setCell({ s, std })} onStudent={s => go(`/app/p/${project.id}/students?s=${s}`, { keepScroll: false })} caption={`${project.name} mastery heatmap`} />
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Standards</h2><span className="muted small">Share of students at {levelInfo(cfg.scale.proficient, cfg.scale).label} or above</span></div>
          <ul className="std-list">
            {perStd.map(s => (
              <li key={s.code}>
                <div className="row between gap"><span><b className="mono">{s.code}</b> <span className="muted small">{descs[s.code]}</span></span><b className="tab-nums">{fmtPct(s.share)}</b></div>
                <div className="share"><span className={s.share < 0.6 ? 'over' : ''} style={{ width: `${s.share * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Growth over time</h2><span className="muted small">Share proficient after each assessment date</span></div>
          <GrowthChart points={growth} />
          <p className="muted small">Each point recalculates every student with only the evidence available on that date, using the current method and reassessment rule.</p>
        </div>
      </div>
      <CellModal p={{ project, ds, cfg, a } as TabProps} cell={cell} onClose={() => setCell(null)} />
    </>
  )
}

function CellModal({ p, cell, onClose }: { p: TabProps; cell: { s: string; std: string } | null; onClose(): void }) {
  const { ds, cfg, a } = p
  const st = cell && ds.students.find(s => s.id === cell.s)
  const raw = cell ? a.ev.get(cell.s)?.get(cell.std) : undefined
  const c = cell ? cellFor(raw, cfg) : null
  return (
    <Modal open={!!cell} onClose={onClose} title={st && cell ? `${displayName(st)} · ${cell.std}` : ''} wide>
      {c && cell && raw && (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>{stdDesc(cell.std, ds)}</p>
          <div className="row gap wrap">
            <span className={`level-pill t-${tone(c.level, cfg)}`}>{c.level} {levelInfo(c.level, cfg.scale).label}</span>
            <Sparkline values={growthSeries(raw, cfg).map(x => x.value)} min={scaleMin(cfg.scale)} max={scaleMax(cfg.scale)} proficient={cfg.scale.proficient} w={180} h={40} />
          </div>
          <p>{explainCell(c, cfg)}</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Assessment</th><th>Date</th><th className="num">Level</th><th>Counts?</th></tr></thead>
            <tbody>{raw.map(e => {
              const kept = c.evidence.find(x => x.a === e.a)
              return <tr key={e.a}><th scope="row">{e.name}</th><td>{fmtShort(e.date)}</td><td className="num">{Math.round(e.value * 100) / 100}</td><td className="small">{kept ? kept.note ? `Yes, ${kept.note}${kept.value !== e.value ? ` (${Math.round(kept.value * 100) / 100})` : ''}` : 'Yes' : <span className="muted">Replaced by a reassessment</span>}</td></tr>
            })}</tbody>
          </table></div>
          <div>
            <h3 className="small strong">What each method says</h3>
            <div className="method-chips">{METHODS.map(m => {
              const v = calc(c.evidence.map(e => e.value), m.id, { decay: cfg.decay, recentN: cfg.recentN, min: scaleMin(cfg.scale), max: scaleMax(cfg.scale) })!
              const l = toLevel(v, cfg.scale, cfg.rounding)
              return <span key={m.id} className={`chip t-${tone(l, cfg)}${m.id === cfg.method ? ' on' : ''}`}>{m.short} <b>{l}</b></span>
            })}</div>
          </div>
          <a className="btn sm outline" href={khanSearch(cell.std, stdQuery(cell.std, ds))} target="_blank" rel="noreferrer">Practice on Khan Academy &rarr;</a>
        </div>
      )}
    </Modal>
  )
}

// ---------- Methods (the department-meeting table) ----------

function Methods({ ds, cfg, setConfig }: TabProps) {
  const cmp = useMemo(() => compareMethods(ds, cfg), [ds, cfg])
  const [vs, setVs] = useState<Method>(cfg.method === 'mean' ? 'recent' : 'mean')
  const [onlyDiff, setOnlyDiff] = useState(true)
  const base = cfg.method
  const rows = [...cmp.rows].sort((x, y) => y.spread - x.spread || x.name.localeCompare(y.name)).filter(r => !onlyDiff || r.spread > 0)
  const nDiff = cmp.changed(base, vs)
  const letters = cfg.grading.rules.map(r => r.letter)
  const summary = [
    `Same evidence, ${cmp.rows.length} students, ${cmp.mats[base].standards.length} standards. Grade rule: ${cfg.grading.mode === 'share' ? 'share of standards at proficient' : 'average level'}.`,
    ...cmp.methods.map(m => `${methodLabel(m, cfg)}: ${letters.map(l => `${cmp.dist[m][l]} ${l}`).join(', ')}${m !== base ? ` (${cmp.changed(base, m)} letters differ from ${methodLabel(base, cfg)})` : ''}`),
    `${cmp.rows.filter(r => r.spread > 0).length} students would get a different letter depending on the method; ${cmp.rows.filter(r => r.spread >= 2).length} by two letters or more.`,
  ].join('\n')

  return (
    <>
      <div className="banner"><span><strong>{nDiff} of {cmp.rows.length} students</strong> get a different letter under {methodLabel(base, cfg)} than under {methodLabel(vs, cfg)}, from exactly the same scores.</span>
        <label className="row gap-sm small">Compare with <select value={vs} onChange={e => setVs(e.target.value as Method)} style={{ width: 'auto' }}>{METHODS.filter(m => m.id !== base).map(m => <option key={m.id} value={m.id}>{methodLabel(m.id, cfg)}</option>)}</select></label>
      </div>
      <div className="method-grid">
        {cmp.methods.map(mid => {
          const meta = METHODS.find(x => x.id === mid)!
          const total = cmp.rows.length || 1
          return (
            <button key={mid} type="button" className={`method-card${mid === base ? ' on' : ''}`} onClick={() => setConfig({ method: mid })} aria-pressed={mid === base}>
              <span className="row between"><b>{methodLabel(mid, cfg)}</b>{mid === base ? <span className="badge">In use</span> : <span className="muted small">{cmp.changed(base, mid)} differ</span>}</span>
              <span className="dist">{letters.map(l => <i key={l} className={`g-${l}`} style={{ flexGrow: cmp.dist[mid][l] }} title={`${l}: ${cmp.dist[mid][l]}`}>{cmp.dist[mid][l] / total > 0.08 ? l : ''}</i>)}</span>
              <small>{meta.how}</small>
            </button>
          )
        })}
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Method settings</h2><span className="muted small">These apply to every view of this class</span></div>
        <div className="inline-fields">
          <label className="field"><span>Decaying average: weight on newest ({Math.round(cfg.decay * 100)}%)</span><input type="range" min="0.3" max="0.9" step="0.05" value={cfg.decay} onChange={e => setConfig({ decay: Number(e.target.value) })} /></label>
          <label className="field"><span>Most recent N</span><input type="number" min="2" max="6" value={cfg.recentN} onChange={e => setConfig({ recentN: Math.max(1, Math.min(10, Number(e.target.value) || 3)) })} /></label>
          <label className="field"><span>Reassessments</span>
            <select value={cfg.reassess} onChange={e => setConfig({ reassess: e.target.value as ReassessRule })}>
              <option value="replace">Replace the original score</option><option value="highest">Keep the higher score</option><option value="average">Average the two</option><option value="keep">Keep both as evidence</option>
            </select></label>
          <label className="field"><span>Rounding to a level</span>
            <select value={cfg.rounding} onChange={e => setConfig({ rounding: e.target.value as 'nearest' | 'down' })}><option value="nearest">Nearest (2.5 becomes 3)</option><option value="down">Down (2.9 stays 2)</option></select></label>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>Letter grade by method</h2>
          <div className="row gap wrap"><label className="row gap-sm small"><input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> Only students whose letter changes</label><CopyButton text={summary} label="Copy summary for the meeting" /></div>
        </div>
        {rows.length === 0 ? <Empty title="Every method agrees">With this evidence no student&rsquo;s letter depends on the method.</Empty> : (
          <div className="table-wrap"><table className="cmp-table">
            <thead><tr><th>Student</th>{cmp.methods.map(mid => <th key={mid} className={`center${mid === base ? ' on' : ''}`}>{METHODS.find(x => x.id === mid)!.short}</th>)}<th className="num">Spread</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}><th scope="row">{displayName(r)}</th>
                {cmp.methods.map(mid => <td key={mid} className={`center${mid === base ? ' on' : ''}`}><span className={`letter g-${r.letters[mid]}${r.letters[mid] !== r.letters[base] ? ' diff' : ''}`}>{r.letters[mid]}</span></td>)}
                <td className="num">{r.spread ? `${r.spread} letter${r.spread > 1 ? 's' : ''}` : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  )
}

// ---------- Reteach ----------

const ACTIVITY: Record<'low' | 'near', string> = {
  low: 'Reteach from a concrete model: worked example, then two guided problems with a partner before independent practice.',
  near: 'Error analysis: show two common wrong answers, students find and fix the mistake, then three independent problems.',
}

function Reteach({ project, ds, cfg, a, setConfig }: TabProps) {
  const g = useMemo(() => reteachGroups(a.m, cfg), [a.m, cfg])
  const plan = (grp: (typeof g.groups)[number]) => [
    `Reteach group ${grp.id} (${grp.students.length} students): ${grp.students.map(s => displayName(s)).join(', ')}`,
    ...grp.focus.map(f => `- ${f.code} ${stdDesc(f.code, ds)} (${f.count} of ${grp.students.length} below ${levelInfo(cfg.scale.proficient, cfg.scale).label})\n  Practice: ${khanSearch(f.code, stdQuery(f.code, ds))}`),
    `Plan: 10 min warm-up on ${grp.focus[0]?.code ?? 'the focus standard'}, 15 min small-group reteach, 10 min practice, exit ticket. Offer a reassessment once the exit ticket is at ${levelInfo(cfg.scale.proficient, cfg.scale).label}.`,
  ].join('\n')
  const all = g.groups.map(plan).join('\n\n')
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Grouping</h2><span className="muted small">Students are clustered by the standards they have not met yet</span></div>
        <div className="row gap wrap">
          <label className="field" style={{ minWidth: 140 }}><span>Groups (k)</span><input type="number" min="1" max="10" value={cfg.groups.k} onChange={e => setConfig({ groups: { ...cfg.groups, k: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } })} /></label>
          <label className="field" style={{ minWidth: 140 }}><span>Max group size</span><input type="number" min="2" max="15" value={cfg.groups.maxSize} onChange={e => setConfig({ groups: { ...cfg.groups, maxSize: Math.max(1, Math.min(30, Number(e.target.value) || 1)) } })} /></label>
          <div className="grow" />
          <CopyButton text={all} label="Copy all plans" />
          <button type="button" className="btn sm outline" onClick={() => download(`${slug(project.name)}-reteach-plans.txt`, all, 'text/plain')}>Download plans</button>
        </div>
        {g.k > g.requestedK && <p className="warn-text small">{g.requestedK} groups of {cfg.groups.maxSize} cannot hold everyone who needs reteaching, so this makes {g.k}.</p>}
      </div>
      {g.groups.length === 0 ? <Empty title="Nobody needs reteaching">Every student is at {levelInfo(cfg.scale.proficient, cfg.scale).label} or above on every assessed standard.</Empty> : (
        <div className="group-grid">
          {g.groups.map(grp => (
            <article key={grp.id} className="group-card">
              <div className="row between"><h3>Group {grp.id}</h3><span className="badge">{grp.students.length} students</span></div>
              <p className="small">{grp.students.map((s, i) => <span key={s.id}>{i ? ', ' : ''}<Link href={`/app/p/${project.id}/students?s=${s.id}`}>{displayName(s)}</Link></span>)}</p>
              <ol className="focus">
                {grp.focus.map(f => {
                  const j = a.m.standards.indexOf(f.code)
                  const lv = grp.students.map(s => a.m.cells[a.m.students.findIndex(x => x.id === s.id)][j]?.level).filter((x): x is number => x !== undefined)
                  const low = lv.filter(l => tone(l, cfg) === 'low').length > lv.length / 2
                  return (
                    <li key={f.code}>
                      <div><b className="mono">{f.code}</b> <span className="muted small">{f.count} of {grp.students.length} not yet</span></div>
                      <div className="small">{stdDesc(f.code, ds)}</div>
                      <div className="small muted">{ACTIVITY[low ? 'low' : 'near']}</div>
                      <a className="ka-link" href={khanSearch(f.code, stdQuery(f.code, ds))} target="_blank" rel="noreferrer">Khan Academy practice: {stdQuery(f.code, ds)} &rarr;</a>
                    </li>
                  )
                })}
              </ol>
              <CopyButton text={plan(grp)} label="Copy plan" />
            </article>
          ))}
        </div>
      )}
      {g.onTrack.length > 0 && <div className="panel tint"><h2>On track ({g.onTrack.length})</h2><p className="small">{g.onTrack.map(s => displayName(s)).join(', ')}</p><p className="muted small" style={{ margin: 0 }}>At {levelInfo(cfg.scale.proficient, cfg.scale).label} or above everywhere. Good candidates for extension tasks or peer tutoring while groups meet.</p></div>}
      <p className="muted small">Practice links open a Khan Academy search for the standard&rsquo;s topic. Nothing is fetched from Khan Academy by this app.</p>
    </>
  )
}

// ---------- Students and the "why is my grade B" explainer ----------

function Students({ project, ds, cfg, a, sid }: TabProps) {
  const students = a.m.students
  const cur = students.find(s => s.id === sid) ?? students[0]
  const x = useMemo(() => cur ? explain(ds, cfg, cur.id, cfg.method, a.ev) : null, [ds, cfg, cur?.id, a.ev])
  const [q, setQ] = useState('')
  if (!cur || !x) return <Empty title="No students yet" />
  const pick = (id: string) => go(`/app/p/${project.id}/students?s=${id}`, { replace: true, keepScroll: true })
  const text = [
    `${displayName(cur)}: ${x.grade.letter}`,
    `${x.grade.nMet} of ${x.grade.nAssessed} standards at ${levelInfo(cfg.scale.proficient, cfg.scale).label} or above (${fmtPct(x.grade.share)}).`,
    `Grading rule: ${x.ruleText}.`,
    ...x.standards.map(s => `${s.code}: ${s.steps}`),
    x.next ?? '',
  ].filter(Boolean).join('\n')
  return (
    <div className="students">
      <aside className="student-list" aria-label="Students">
        <input placeholder="Find a student" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a student" />
        <ul>{students.filter(s => displayName(s).toLowerCase().includes(q.toLowerCase())).map(s => {
          const i = a.m.students.indexOf(s)
          const ls = a.m.cells[i].filter(Boolean).map(c => c!.level)
          const met = ls.filter(l => l >= cfg.scale.proficient).length
          return <li key={s.id}><button type="button" className={s.id === cur.id ? 'on' : ''} aria-current={s.id === cur.id} onClick={() => pick(s.id)}><span>{displayName(s)}</span><small>{met}/{ls.length}</small></button></li>
        })}</ul>
      </aside>
      <div>
        <div className="panel explainer">
          <div className="row between top gap wrap">
            <div>
              <div className="eyebrow">Why is this grade {x.grade.letter}?</div>
              <h2>{displayName(cur)}</h2>
            </div>
            <div className={`big-letter g-${x.grade.letter}`}>{x.grade.letter}</div>
          </div>
          <p className="lede-sm"><b>{x.grade.nMet} of {x.grade.nAssessed}</b> standards are at {levelInfo(cfg.scale.proficient, cfg.scale).label} or above ({fmtPct(x.grade.share)}){x.grade.lowest !== null ? <>; the lowest is level {x.grade.lowest}</> : null}. {cfg.grading.mode === 'average' && <>Average level {Math.round(x.grade.avg * 100) / 100}. </>}Under the class rule that is {x.grade.letter}.</p>
          <p className="muted small">Rule ({cfg.grading.mode === 'share' ? 'share of standards met' : 'average level'}): {x.ruleText}. Method: {methodLabel(cfg.method, cfg)}.</p>
          {x.next && <div className="banner good"><span><strong>Next step.</strong> {x.next}</span></div>}
          <div className="row gap wrap"><CopyButton text={text} label="Copy explanation" /><Link className="btn sm primary" href={`/app/p/${project.id}/report?s=${cur.id}`}>Family report</Link></div>
        </div>
        <div className="panel">
          <h2>Standard by standard</h2>
          <div className="table-wrap"><table className="explain-table">
            <thead><tr><th>Standard</th><th>Scores (oldest first)</th><th>Growth</th><th>Level</th><th>How it was calculated</th><th></th></tr></thead>
            <tbody>{x.standards.map(s => {
              const raw = a.ev.get(cur.id)?.get(s.code)
              return (
                <tr key={s.code}>
                  <th scope="row"><b className="mono">{s.code}</b><div className="muted tiny">{stdDesc(s.code, ds)}</div></th>
                  <td><div className="ev-chips">{raw?.map(e => {
                    const dropped = s.cell.dropped.some(d => d.a === e.a)
                    return <span key={e.a} className={`ev t-${tone(Math.round(e.value), cfg)}${dropped ? ' dropped' : ''}`} title={`${e.name}, ${fmtDate(e.date)}${dropped ? ' (replaced by a reassessment)' : ''}`}>{Math.round(e.value * 10) / 10}</span>
                  })}</div></td>
                  <td><Sparkline values={growthSeries(raw, cfg).map(g => g.value)} min={scaleMin(cfg.scale)} max={scaleMax(cfg.scale)} proficient={cfg.scale.proficient} /></td>
                  <td><span className={`level-pill t-${tone(s.cell.level, cfg)}`}>{s.cell.level}</span></td>
                  <td className="small">{s.steps}</td>
                  <td>{s.cell.level < cfg.scale.proficient && <a className="small" href={khanSearch(s.code, stdQuery(s.code, ds))} target="_blank" rel="noreferrer">Practice</a>}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
          {x.missing.length > 0 && <p className="muted small">No evidence yet on {x.missing.join(', ')}; these do not count toward the grade.</p>}
        </div>
      </div>
    </div>
  )
}

// ---------- History ----------

function History({ project, ds, cfg, update }: TabProps) {
  const snaps = project.snapshots
  const [ai, setAi] = useState(Math.max(0, snaps.length - 2))
  const [bi, setBi] = useState(snaps.length - 1)
  const names = useMemo(() => new Map(ds.students.map(s => [s.id, displayName(s)])), [ds])
  if (!snaps.length) return <Empty title="No snapshots yet"><p className="muted">Save a snapshot at each progress report or term end (button above, or press S). Snapshots freeze levels and letters so you can show growth later.</p></Empty>
  const A = snaps[Math.min(ai, snaps.length - 1)], B = snaps[Math.min(bi, snaps.length - 1)]
  const d = A && B && A.id !== B.id ? compareSnapshots(A, B, cfg) : null
  const remove = (id: string) => {
    const before = snaps
    void update({ snapshots: snaps.filter(s => s.id !== id) })
    void deleteSnapshotCloud(id)
    toast('Snapshot deleted', { undo: () => void update({ snapshots: before }) })
  }
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Term snapshots</h2><span className="muted small">Stored with pseudonymous ids; names come from this device</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Label</th><th>Evidence up to</th><th>Method</th><th className="num">Students</th><th className="num">Proficient</th><th /></tr></thead>
          <tbody>{snaps.map(s => <tr key={s.id}><th scope="row">{s.label}</th><td>{fmtDate(s.date)}</td><td className="small">{methodLabel(s.method, cfg)}</td><td className="num">{s.rows.length}</td><td className="num">{fmtPct(s.share)}</td><td className="num"><button type="button" className="btn sm danger-ghost" onClick={() => remove(s.id)}>Delete</button></td></tr>)}</tbody>
        </table></div>
      </div>
      {snaps.length < 2 ? <p className="muted">Save a second snapshot to compare terms.</p> : (
        <div className="panel">
          <div className="panel-head">
            <h2>Compare</h2>
            <div className="row gap-sm wrap">
              <select value={ai} onChange={e => setAi(Number(e.target.value))} aria-label="Earlier snapshot" style={{ width: 'auto' }}>{snaps.map((s, i) => <option key={s.id} value={i}>{s.label}</option>)}</select>
              <span aria-hidden="true">&rarr;</span>
              <select value={bi} onChange={e => setBi(Number(e.target.value))} aria-label="Later snapshot" style={{ width: 'auto' }}>{snaps.map((s, i) => <option key={s.id} value={i}>{s.label}</option>)}</select>
            </div>
          </div>
          {!d ? <p className="muted">Pick two different snapshots.</p> : (
            <>
              <div className="kpis">
                <div className="kpi"><small>Proficient</small><b>{fmtPct(d.share.after)}</b><span className="was">{fmtPct(d.share.before)}</span></div>
                <div className="kpi"><small>Letters up</small><b className="good-text">{d.up}</b></div>
                <div className="kpi"><small>Letters down</small><b className="error">{d.down}</b></div>
                <div className="kpi"><small>Unchanged</small><b>{d.same}</b></div>
              </div>
              {A.method !== B.method && <p className="warn-text small">These snapshots used different methods ({methodLabel(A.method, cfg)} vs {methodLabel(B.method, cfg)}), so some moves come from the method, not learning.</p>}
              <div className="grid-2">
                <div>
                  <h3>Standards</h3>
                  <ul className="std-list">{d.standards.map(s => (
                    <li key={s.code}><div className="row between"><b className="mono">{s.code}</b><span className="small tab-nums">{s.before === null ? 'new' : fmtPct(s.before)} &rarr; {s.after === null ? '—' : fmtPct(s.after)}</span></div>
                      <div className="share two">{s.before !== null && <span className="ghost" style={{ width: `${s.before * 100}%` }} />}{s.after !== null && <span style={{ width: `${s.after * 100}%` }} />}</div></li>
                  ))}</ul>
                </div>
                <div>
                  <h3>Students whose letter moved</h3>
                  <div className="table-wrap"><table>
                    <thead><tr><th>Student</th><th className="center">{A.label.replace(/\s*\(.*\)$/, '')}</th><th className="center">{B.label.replace(/\s*\(.*\)$/, '')}</th></tr></thead>
                    <tbody>{d.students.filter(s => s.before !== s.after).sort((x, y) => y.move - x.move).map(s => (
                      <tr key={s.sid}><th scope="row">{names.get(s.sid) ?? `Student ${s.sid.slice(1, 6)}`}</th><td className="center"><span className={`letter g-${s.before}`}>{s.before ?? '—'}</span></td><td className="center"><span className={`letter g-${s.after}`}>{s.after ?? '—'}</span> <span className={s.move > 0 ? 'good-text' : 'error'}>{s.move > 0 ? '▲' : s.move < 0 ? '▼' : ''}</span></td></tr>
                    ))}</tbody>
                  </table></div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
