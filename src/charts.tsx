
import { levelInfo, rowGrade, type Matrix } from './engine/mastery.ts'
import { tone } from './engine/report.ts'
import type { Config } from './engine/types.ts'
import { displayName } from './projectData.ts'

const fmt = (x: number) => (Math.round(x * 100) / 100).toString()

export function Heatmap({ m, cfg, prev, onCell, onStudent, descs, limit, caption }: {
  m: Matrix; cfg: Config
  /** Letters under the previous method, to show which grades moved */
  prev?: Record<string, string>
  onCell?(studentId: string, code: string): void
  onStudent?(studentId: string): void
  descs?: Record<string, string>
  limit?: number
  caption?: string
}) {
  const rows = limit ? m.students.slice(0, limit) : m.students
  const rank = (l: string) => cfg.grading.rules.findIndex(r => r.letter === l)
  return (
    <div className="heat-wrap" role="region" aria-label={caption ?? 'Student by standard heatmap'} tabIndex={0}>
      <table className="heatmap">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            <th scope="col" className="hm-name">Student</th>
            {m.standards.map(s => <th key={s} scope="col" className="hm-std" title={descs?.[s] ?? s}><span>{s}</span></th>)}
            <th scope="col" className="hm-grade">Grade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const g = rowGrade(m.cells[i], cfg)
            const before = prev?.[s.id]
            const moved = before && before !== g.letter ? (rank(g.letter) < rank(before) ? 'up' : 'down') : ''
            return (
              <tr key={s.id}>
                <th scope="row" className="hm-name">{onStudent ? <button type="button" className="linkish" onClick={() => onStudent(s.id)}>{displayName(s)}</button> : displayName(s)}</th>
                {m.cells[i].map((c, j) => c ? (
                  <td key={j} className={`hm-c t-${tone(c.level, cfg)}${onCell ? ' click' : ''}`} title={`${displayName(s)} · ${m.standards[j]}: ${levelInfo(c.level, cfg.scale).label} (${fmt(c.value)} from ${c.n} score${c.n === 1 ? '' : 's'})`}
                    onClick={onCell ? () => onCell(s.id, m.standards[j]) : undefined}>
                    <span>{c.level}</span>
                  </td>
                ) : <td key={j} className="hm-c t-none" title="No evidence yet"><span aria-label="no evidence">&middot;</span></td>)}
                <td className={`hm-grade g-${g.letter.replace(/\W/g, '')}`}>
                  <b key={g.letter} className={moved ? `moved ${moved}` : ''}>{g.letter}</b>
                  {moved && <small className={`mv ${moved}`} aria-label={`was ${before}`}>{moved === 'up' ? '▲' : '▼'} {before}</small>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ToneLegend({ cfg }: { cfg: Config }) {
  return (
    <div className="legend" aria-label="Level colours">
      {[...cfg.scale.levels].sort((a, b) => a.value - b.value).map(l => <span key={l.value}><i className={`sw t-${tone(l.value, cfg)}`} />{l.value} {l.label}</span>)}
      <span><i className="sw t-none" />No evidence</span>
    </div>
  )
}

/** Mastery after each assessment, with the proficient line. */
export function Sparkline({ values, min, max, proficient, w = 120, h = 30, label }: { values: number[]; min: number; max: number; proficient: number; w?: number; h?: number; label?: string }) {
  if (!values.length) return <span className="muted small">No evidence</span>
  const x = (i: number) => values.length === 1 ? w / 2 : 3 + i * (w - 6) / (values.length - 1)
  const y = (v: number) => h - 3 - (v - min) / Math.max(1e-9, max - min) * (h - 6)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const last = values[values.length - 1]
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label ?? `Moved from ${fmt(values[0])} to ${fmt(last)}`}>
      <line x1="0" x2={w} y1={y(proficient)} y2={y(proficient)} className="spark-goal" />
      <path d={d} className="spark-line" />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 3 : 1.6} className={i === values.length - 1 ? `spark-end ${last >= proficient ? 'ok' : ''}` : 'spark-dot'} />)}
    </svg>
  )
}

/** Share of student-standard pairs at proficient over time. */
export function GrowthChart({ points }: { points: { date: string; share: number }[] }) {

  if (points.length < 2) return <p className="muted small">Growth appears after two dated assessments.</p>
  const W = 640, H = 180, L = 36, B = 24
  const x = (i: number) => L + i * (W - L - 10) / (points.length - 1)
  const y = (v: number) => 8 + (1 - v) * (H - B - 8)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.share)}`).join('')
  const area = `${d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
  return (
    <svg className="growth" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Share proficient moved from ${Math.round(points[0].share * 100)}% to ${Math.round(points.at(-1)!.share * 100)}%`}>
      {[0, 0.25, 0.5, 0.75, 1].map(t => <g key={t}><line x1={L} x2={W - 10} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end">{t * 100}%</text></g>)}
      <path d={area} className="area" />
      <path d={d} className="line" />
      {points.map((p, i) => <g key={p.date}><circle cx={x(i)} cy={y(p.share)} r="3.5" className="dot"><title>{`${p.date}: ${Math.round(p.share * 100)}% proficient`}</title></circle>
        {(i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0) && <text x={x(i)} y={H - 6} textAnchor="middle">{new Date(p.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</text>}</g>)}
    </svg>
  )
}
