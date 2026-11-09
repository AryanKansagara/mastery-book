import { useEffect, useMemo } from 'react'
import { Sparkline } from './charts.tsx'
import { explain, growthSeries, khanSearch, levelInfo, methodLabel, scaleMax, scaleMin } from './engine/mastery.ts'
import { tone } from './engine/report.ts'
import { displayName, stdDesc, stdQuery, useAnalysis, useProject } from './projectData.ts'
import { Link, SyntheticBadge } from './ui.tsx'

/** Printable family progress reports, one student per page. */
export default function Report({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const cfg = project?.config
  const a = useAnalysis(ds, cfg)
  const only = new URLSearchParams(location.search).get('s')
  useEffect(() => { if (project) document.title = `Family progress reports · ${project.name}` }, [project?.name])
  const reports = useMemo(() => {
    if (!a || !ds || !cfg) return []
    return a.m.students.filter(s => !only || s.id === only).map(s => ({ s, x: explain(ds, cfg, s.id, cfg.method, a.ev) }))
  }, [a, ds, cfg, only])

  if (loading) return <div className="boot"><span className="spinner" /> Building the reports</div>
  if (!project || !cfg || !ds) return <section className="page narrow center"><h1>Class not found</h1><Link href="/app" className="btn primary">All classes</Link></section>
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const prof = levelInfo(cfg.scale.proficient, cfg.scale).label

  return (
    <div className="reports">
      <div className="report-actions">
        <Link href={`/app/p/${id}${only ? `/students?s=${only}` : ''}`} className="btn ghost">&larr; Back</Link>
        <span className="muted small grow">{reports.length} report{reports.length === 1 ? '' : 's'}, one per page. {only && <Link href={`/app/p/${id}/report`}>Show the whole class</Link>}</span>
        <button type="button" className="btn primary" onClick={() => print()}>Print or save as PDF</button>
      </div>
      {reports.map(({ s, x }) => (
        <article key={s.id} className="family-report">
          <header className="fr-head">
            <div>
              <div className="fr-brand"><span className="monogram" aria-hidden="true">MB</span> {project.name} {project.sampleId && <SyntheticBadge />}</div>
              <h1>{displayName(s)}</h1>
              <p className="muted">Progress report · {today}</p>
            </div>
            <div className={`fr-grade g-${x.grade.letter}`}><small>Grade</small><b>{x.grade.letter}</b></div>
          </header>
          <section className="fr-summary">
            <p><b>{displayName(s).split(' ')[0]}</b> has shown <b>{prof.toLowerCase()}</b> work or better on <b>{x.grade.nMet} of {x.grade.nAssessed}</b> skills so far.
              {' '}In this class the grade comes from skills, not from averaging points: {cfg.grading.mode === 'share'
                ? <>a grade of {cfg.grading.rules[0].letter} means at least {Math.round(cfg.grading.rules[0].minShare * 100)}% of skills at {prof.toLowerCase()} or better{cfg.grading.rules[0].floor ? <>, with no skill below level {cfg.grading.rules[0].floor}</> : null}.</>
                : <>the letter comes from the average level across skills.</>}
              {' '}Each skill&rsquo;s level is worked out from all of {displayName(s).split(' ')[0]}&rsquo;s scores on it ({methodLabel(cfg.method, cfg).toLowerCase()}){cfg.reassess === 'replace' ? ', and a reassessment replaces the earlier score' : ''}, so recent learning counts.</p>
            {x.next && <p className="fr-next"><b>What would raise the grade:</b> {x.next.replace(/^To reach/, 'to reach').replace(/^to/, 'To')}</p>}
          </section>
          <table className="fr-table">
            <thead><tr><th>Skill</th><th>Where things stand</th><th>Progress</th></tr></thead>
            <tbody>{x.standards.map(st => {
              const info = levelInfo(st.cell.level, cfg.scale)
              const series = growthSeries(a!.ev.get(s.id)?.get(st.code), cfg).map(g => g.value)
              return (
                <tr key={st.code}>
                  <td><b>{stdDesc(st.code, ds) || st.code}</b><div className="muted tiny">{st.code}</div></td>
                  <td><span className={`level-pill t-${tone(st.cell.level, cfg)}`}>{info.label}</span><div className="small">{displayName(s).split(' ')[0]} {info.plain}.</div>
                    {st.cell.level < cfg.scale.proficient && <div className="tiny fr-practice">Practice at home: <a href={khanSearch(st.code, stdQuery(st.code, ds))}>Khan Academy, &ldquo;{stdQuery(st.code, ds)}&rdquo;</a></div>}</td>
                  <td><Sparkline values={series} min={scaleMin(cfg.scale)} max={scaleMax(cfg.scale)} proficient={cfg.scale.proficient} w={110} h={32} label={`${series.length} assessments`} /><div className="tiny muted">{series.length} assessment{series.length === 1 ? '' : 's'}</div></td>
                </tr>
              )
            })}</tbody>
          </table>
          <footer className="fr-foot">
            <p className="tiny muted">Levels: {[...cfg.scale.levels].sort((p, q) => p.value - q.value).map(l => `${l.value} ${l.label}`).join(' · ')}. The dashed line in each progress chart is the {prof.toLowerCase()} level. {x.missing.length ? `Not yet assessed: ${x.missing.length} skill${x.missing.length > 1 ? 's' : ''}.` : ''} Questions? Please reach out; reassessments are available for every skill.</p>
            {project.sampleId && <p className="tiny muted">Synthetic sample: this student and these scores are generated, not real.</p>}
          </footer>
        </article>
      ))}
    </div>
  )
}
