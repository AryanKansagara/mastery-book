import type { Assessment, Config, Dataset, Evidence, GradeRule, Method, ReassessRule, Scale } from './types.ts'

// ---------- Scales ----------

export const SCALES: Scale[] = [
  {
    id: '4pt', name: '4-point (1 to 4)', proficient: 3, levels: [
      { value: 1, label: 'Beginning', minPct: 0, plain: 'is just starting to work with this skill and needs a lot of support' },
      { value: 2, label: 'Developing', minPct: 0.6, plain: 'understands parts of this skill and is still making some key mistakes' },
      { value: 3, label: 'Proficient', minPct: 0.75, plain: 'can do this skill on their own, which is the goal for the year' },
      { value: 4, label: 'Advanced', minPct: 0.9, plain: 'can do this skill and apply it to new or harder problems' },
    ],
  },
  {
    id: '5pt', name: '5-point (0 to 4)', proficient: 3, levels: [
      { value: 0, label: 'No evidence', minPct: 0, plain: 'has not shown work on this skill yet' },
      { value: 1, label: 'Beginning', minPct: 0.4, plain: 'is just starting to work with this skill and needs a lot of support' },
      { value: 2, label: 'Developing', minPct: 0.6, plain: 'understands parts of this skill and is still making some key mistakes' },
      { value: 3, label: 'Proficient', minPct: 0.75, plain: 'can do this skill on their own, which is the goal for the year' },
      { value: 4, label: 'Advanced', minPct: 0.9, plain: 'can do this skill and apply it to new or harder problems' },
    ],
  },
  {
    id: '3pt', name: '3-point (1 to 3)', proficient: 2, levels: [
      { value: 1, label: 'Not yet', minPct: 0, plain: 'has not met this skill yet and is still learning it' },
      { value: 2, label: 'Meets', minPct: 0.7, plain: 'can do this skill on their own, which is the goal for the year' },
      { value: 3, label: 'Exceeds', minPct: 0.9, plain: 'can do this skill and apply it to new or harder problems' },
    ],
  },
]

export const DEFAULT_RULES: GradeRule[] = [
  { letter: 'A', minShare: 0.9, floor: 2, minAvg: 3.5 },
  { letter: 'B', minShare: 0.75, floor: 2, minAvg: 3.0 },
  { letter: 'C', minShare: 0.6, floor: 0, minAvg: 2.5 },
  { letter: 'D', minShare: 0.4, floor: 0, minAvg: 2.0 },
  { letter: 'F', minShare: 0, floor: 0, minAvg: 0 },
]

export const defaultConfig = (): Config => ({
  scale: structuredClone(SCALES[0]), scoreMode: 'percent', method: 'decaying', decay: 0.65, recentN: 3, reassess: 'replace', rounding: 'nearest',
  grading: { mode: 'share', rules: structuredClone(DEFAULT_RULES) }, groups: { k: 4, maxSize: 6 },
})

export const METHODS: { id: Method; label: string; short: string; how: string }[] = [
  { id: 'recent', label: 'Most recent', short: 'Recent', how: 'The latest score stands. Early struggles do not count against a student once they have learned the skill.' },
  { id: 'decaying', label: 'Decaying average', short: 'Decaying', how: 'Each new score gets a fixed weight and older scores fade. PowerSchool and Infinite Campus offer this; 65% on the newest score is a common setting.' },
  { id: 'powerlaw', label: 'Power law', short: 'Power law', how: 'Fits a learning curve (least squares on log scores) through every score and reads it at the latest assessment. Marzano’s method; one bad day moves it less than "most recent".' },
  { id: 'mean', label: 'Mean', short: 'Mean', how: 'A plain average of every score. Simple, but early attempts drag the result down after the student has learned the skill.' },
  { id: 'highest', label: 'Highest', short: 'Highest', how: 'The best score ever shown. Generous; a single lucky day can stand all term.' },
  { id: 'mode', label: 'Mode', short: 'Mode', how: 'The most common level. Ties go to the most recent of the tied levels.' },
  { id: 'recentN', label: 'Most recent N', short: 'Recent N', how: 'The average of the last N scores, so the current level is backed by more than one assessment.' },
]
export const methodLabel = (m: Method, cfg?: Pick<Config, 'recentN' | 'decay'>) =>
  m === 'recentN' && cfg ? `Most recent ${cfg.recentN}` : m === 'decaying' && cfg ? `Decaying average (${Math.round(cfg.decay * 100)}%)` : METHODS.find(x => x.id === m)!.label

export const scaleMin = (s: Scale) => Math.min(...s.levels.map(l => l.value))
export const scaleMax = (s: Scale) => Math.max(...s.levels.map(l => l.value))
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Converts a percent (0..1) to a level with the scale's cut-offs. */
export function levelForPct(pct: number, s: Scale): number {
  const sorted = [...s.levels].sort((a, b) => a.value - b.value)
  let v = sorted[0].value
  for (const l of sorted) if (pct + 1e-9 >= l.minPct) v = l.value
  return v
}

/** Rounds a calculated mastery value to a level on the scale. */
export function toLevel(x: number, s: Scale, rounding: Config['rounding'] = 'nearest'): number {
  const v = rounding === 'down' ? Math.floor(x + 1e-9) : Math.floor(x + 0.5 + 1e-9)
  const values = s.levels.map(l => l.value)
  // Snap to the closest defined level at or below v (scales may skip values).
  const below = values.filter(y => y <= v)
  return below.length ? Math.max(...below) : Math.min(...values)
}
export const levelInfo = (v: number, s: Scale) => s.levels.find(l => l.value === v) ?? s.levels[0]

// ---------- Methods ----------

/** values are chronological (oldest first). */
export function calc(values: number[], method: Method, opts: { decay?: number; recentN?: number; min?: number; max?: number } = {}): number | null {
  const n = values.length
  if (!n) return null
  const min = opts.min ?? 0, max = opts.max ?? 4
  switch (method) {
    case 'recent': return values[n - 1]
    case 'highest': return Math.max(...values)
    case 'mean': return values.reduce((a, b) => a + b, 0) / n
    case 'decaying': {
      const w = clamp(opts.decay ?? 0.65, 0, 1)
      let r = values[0]
      for (let i = 1; i < n; i++) r = r * (1 - w) + values[i] * w
      return r
    }
    case 'recentN': {
      const k = Math.max(1, Math.round(opts.recentN ?? 3))
      const tail = values.slice(-k)
      return tail.reduce((a, b) => a + b, 0) / tail.length
    }
    case 'mode': {
      const counts = new Map<number, number>()
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
      const best = Math.max(...counts.values())
      for (let i = n - 1; i >= 0; i--) if (counts.get(values[i]) === best) return values[i]
      return values[n - 1]
    }
    case 'powerlaw': return powerLaw(values, min, max)
  }
}

/** Marzano power law: least squares fit of ln(y) = ln(a) + b ln(x), x = 1..n, read at x = n. Scores are shifted so the scale minimum maps to 1. */
export function powerLaw(values: number[], min = 0, max = 4): number {
  const n = values.length
  if (n === 1) return values[0]
  const shift = 1 - min
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    const x = Math.log(i + 1), y = Math.log(values[i] + shift)
    sx += x; sy += y; sxx += x * x; sxy += x * y
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const a = (sy - b * sx) / n
  return clamp(Math.exp(a + b * Math.log(n)) - shift, min, max)
}

// ---------- Evidence ----------

const byTime = (x: { date: string; order: number }, y: { date: string; order: number }) => (x.date || '9999').localeCompare(y.date || '9999') || x.order - y.order

/** Score -> level for one student, one assessment, one standard. Item scores tagged to the standard win over the whole-assessment score. */
export function evidenceFor(ds: Dataset, cfg: Config): Map<string, Map<string, Evidence[]>> {
  const out = new Map<string, Map<string, Evidence[]>>()
  const aById = new Map(ds.assessments.map(a => [a.id, a]))
  const items = new Map<string, { pts: number; max: number }>()
  for (const it of ds.itemScores) {
    const std = it.std || (it.item ? aById.get(it.a)?.items?.[it.item] : undefined)
    if (!std) continue
    const k = `${it.s}|${it.a}|${std}`
    const cur = items.get(k) ?? { pts: 0, max: 0 }
    items.set(k, { pts: cur.pts + it.pts, max: cur.max + it.max })
  }
  const lo = scaleMin(cfg.scale), hi = scaleMax(cfg.scale)
  // Level mode: a score of 3 out of 4 is level 3; summed item levels (7 of 8) average out to 3.5.
  const toValue = (pts: number, max: number) => cfg.scoreMode === 'level' ? clamp(max > 0 ? pts / max * hi : pts, lo, hi) : levelForPct(max > 0 ? pts / max : 0, cfg.scale)
  const push = (s: string, std: string, a: Assessment, value: number) => {
    let m = out.get(s)
    if (!m) out.set(s, m = new Map())
    const l = m.get(std) ?? []
    l.push({ a: a.id, name: a.name, date: a.date, order: a.order, value, reassessOf: a.reassessOf })
    m.set(std, l)
  }
  const seen = new Set<string>()
  for (const sc of ds.scores) {
    const a = aById.get(sc.a)
    if (!a || !Number.isFinite(sc.pts)) continue
    for (const std of a.standards) {
      const k = `${sc.s}|${a.id}|${std}`
      const it = items.get(k)
      push(sc.s, std, a, it ? toValue(it.pts, it.max) : toValue(sc.pts, a.max))
      seen.add(k)
    }
  }
  // Item scores for standards the assessment-level score did not cover (or with no assessment-level score at all).
  for (const [k, it] of items) {
    if (seen.has(k)) continue
    const [s, aid, std] = k.split('|')
    const a = aById.get(aid)
    if (a) push(s, std, a, toValue(it.pts, it.max))
  }
  for (const m of out.values()) for (const l of m.values()) l.sort(byTime)
  return out
}

/** Applies the reassessment rule to one student's evidence on one standard (chronological in, chronological out). */
export function applyReassess(list: Evidence[], rule: ReassessRule): Evidence[] {
  if (rule === 'keep') return list
  let cur: Evidence[] = []
  for (const e of list) {
    const target = e.reassessOf ? cur.findIndex(x => x.a === e.reassessOf || x.replaced?.includes(e.reassessOf!)) : -1
    if (target < 0) { cur.push(e); continue }
    const o = cur[target]
    const value = rule === 'replace' ? e.value : rule === 'highest' ? Math.max(o.value, e.value) : (o.value + e.value) / 2
    const note = rule === 'replace' ? `replaces ${o.name}` : rule === 'highest' ? `higher of this and ${o.name}` : `averaged with ${o.name}`
    cur = cur.filter((_, i) => i !== target)
    cur.push({ ...e, value, replaced: [...(o.replaced ?? []), o.a], note })
  }
  return cur.sort(byTime)
}

export interface Cell { value: number; level: number; n: number; evidence: Evidence[]; dropped: Evidence[] }

export function cellFor(raw: Evidence[] | undefined, cfg: Config, method: Method = cfg.method): Cell | null {
  if (!raw?.length) return null
  const evidence = applyReassess(raw, cfg.reassess)
  const kept = new Set(evidence.map(e => e.a))
  const dropped = raw.filter(e => !kept.has(e.a))
  const value = calc(evidence.map(e => e.value), method, { decay: cfg.decay, recentN: cfg.recentN, min: scaleMin(cfg.scale), max: scaleMax(cfg.scale) })!
  return { value, level: toLevel(value, cfg.scale, cfg.rounding), n: evidence.length, evidence, dropped }
}

/** Standards in use, in the order they first appear by assessment date. */
export function standardsInUse(ds: Dataset): string[] {
  const seen: string[] = []
  for (const a of [...ds.assessments].sort(byTime)) for (const s of a.standards) if (!seen.includes(s)) seen.push(s)
  return seen
}

export interface Matrix { students: { id: string; name: string }[]; standards: string[]; cells: (Cell | null)[][] }

export function matrix(ds: Dataset, cfg: Config, method: Method = cfg.method, ev = evidenceFor(ds, cfg)): Matrix {
  const standards = standardsInUse(ds)
  const students = [...ds.students].sort((a, b) => a.name.localeCompare(b.name))
  return { students, standards, cells: students.map(s => standards.map(std => cellFor(ev.get(s.id)?.get(std), cfg, method))) }
}

// ---------- Letter grades ----------

export interface Grade { letter: string; rule: GradeRule; share: number; avg: number; nMet: number; nAssessed: number; lowest: number | null }

export function letterGrade(levels: number[], cfg: Config): Grade {
  const rules = cfg.grading.rules
  const n = levels.length
  const nMet = levels.filter(l => l >= cfg.scale.proficient).length
  const share = n ? nMet / n : 0
  const avg = n ? levels.reduce((a, b) => a + b, 0) / n : 0
  const lowest = n ? Math.min(...levels) : null
  for (const r of rules) {
    const ok = cfg.grading.mode === 'share'
      ? share + 1e-9 >= r.minShare && (lowest === null || !r.floor || lowest >= r.floor)
      : avg + 1e-9 >= r.minAvg
    if (ok && n) return { letter: r.letter, rule: r, share, avg, nMet, nAssessed: n, lowest }
  }
  const last = rules[rules.length - 1]
  return { letter: n ? last.letter : '—', rule: last, share, avg, nMet, nAssessed: n, lowest }
}

export const rowGrade = (cells: (Cell | null)[], cfg: Config) => letterGrade(cells.filter((c): c is Cell => !!c).map(c => c.level), cfg)

/** What it takes to reach the next letter up, in plain words. */
export function nextStep(levels: number[], cfg: Config): string | null {
  const g = letterGrade(levels, cfg)
  const rules = cfg.grading.rules
  const i = rules.findIndex(r => r.letter === g.letter)
  if (i <= 0 || !levels.length) return null
  const up = rules[i - 1]
  const n = levels.length
  if (cfg.grading.mode === 'average') {
    const needed = Math.ceil((up.minAvg * n - levels.reduce((a, b) => a + b, 0)) - 1e-9)
    return `Raise the total by ${needed} level${needed === 1 ? '' : 's'} across standards (for example ${needed} standard${needed === 1 ? '' : 's'} up one level) to reach ${up.letter}.`
  }
  const parts: string[] = []
  const more = Math.max(0, Math.ceil(up.minShare * n - 1e-9) - g.nMet)
  if (more) parts.push(`${more} more standard${more === 1 ? '' : 's'} at ${levelInfo(cfg.scale.proficient, cfg.scale).label} or above`)
  const low = up.floor ? levels.filter(l => l < up.floor).length : 0
  if (low) parts.push(`${low} standard${low === 1 ? '' : 's'} raised to at least ${up.floor}`)
  return parts.length ? `To reach ${up.letter}: ${parts.join(' and ')}.` : null
}

// ---------- Method comparison (the department-meeting table) ----------

export interface MethodRow { id: string; name: string; letters: Record<string, string>; avg: Record<string, number>; spread: number }
const LETTER_RANK = (cfg: Config, l: string) => { const i = cfg.grading.rules.findIndex(r => r.letter === l); return i < 0 ? 99 : i }

export function compareMethods(ds: Dataset, cfg: Config, methods: Method[] = METHODS.map(m => m.id)) {
  const ev = evidenceFor(ds, cfg)
  const mats = Object.fromEntries(methods.map(m => [m, matrix(ds, cfg, m, ev)])) as Record<Method, Matrix>
  const base = mats[methods[0]]
  const rows: MethodRow[] = base.students.map((s, i) => {
    const letters: Record<string, string> = {}, avg: Record<string, number> = {}
    for (const m of methods) {
      const g = rowGrade(mats[m].cells[i], cfg)
      letters[m] = g.letter
      avg[m] = g.avg
    }
    const ranks = methods.map(m => LETTER_RANK(cfg, letters[m])).filter(r => r < 99)
    return { id: s.id, name: s.name, letters, avg, spread: ranks.length ? Math.max(...ranks) - Math.min(...ranks) : 0 }
  })
  const dist = Object.fromEntries(methods.map(m => [m, Object.fromEntries(cfg.grading.rules.map(r => [r.letter, rows.filter(x => x.letters[m] === r.letter).length]))])) as Record<string, Record<string, number>>
  const changed = (a: Method, b: Method) => rows.filter(r => r.letters[a] !== r.letters[b]).length
  return { rows, dist, changed, methods, mats }
}

// ---------- Growth ----------

/** Mastery after each piece of evidence, so a sparkline shows how the calculated level moved. */
export function growthSeries(raw: Evidence[] | undefined, cfg: Config, method: Method = cfg.method): { date: string; value: number; name: string }[] {
  if (!raw?.length) return []
  const out: { date: string; value: number; name: string }[] = []
  for (let i = 1; i <= raw.length; i++) {
    const c = cellFor(raw.slice(0, i), cfg, method)!
    out.push({ date: raw[i - 1].date, value: c.value, name: raw[i - 1].name })
  }
  return out
}

/** Share of assessed student-standard pairs at proficient or above, after each assessment date. */
export function classGrowth(ds: Dataset, cfg: Config, method: Method = cfg.method) {
  const ev = evidenceFor(ds, cfg)
  const dates = [...new Set(ds.assessments.filter(a => ds.scores.some(s => s.a === a.id) || ds.itemScores.some(s => s.a === a.id)).map(a => a.date).filter(Boolean))].sort()
  return dates.map(d => {
    let met = 0, n = 0
    for (const m of ev.values()) for (const l of m.values()) {
      const c = cellFor(l.filter(e => e.date && e.date <= d), cfg, method)
      if (!c) continue
      n++
      if (c.level >= cfg.scale.proficient) met++
    }
    return { date: d, share: n ? met / n : 0, n }
  })
}

/** Restricts a dataset to assessments on or before a date (for term snapshots). */
export function upTo(ds: Dataset, date: string): Dataset {
  const keep = new Set(ds.assessments.filter(a => !a.date || a.date <= date).map(a => a.id))
  return { ...ds, assessments: ds.assessments.filter(a => keep.has(a.id)), scores: ds.scores.filter(s => keep.has(s.a)), itemScores: ds.itemScores.filter(s => keep.has(s.a)) }
}

// ---------- Explainer ----------

export interface Explanation {
  grade: Grade
  next: string | null
  standards: { code: string; cell: Cell; steps: string }[]
  missing: string[]
  ruleText: string
}

const f1 = (x: number) => (Math.round(x * 100) / 100).toString()

export function explainCell(c: Cell, cfg: Config, method: Method = cfg.method): string {
  const v = c.evidence.map(e => e.value)
  const lv = `level ${c.level} (${levelInfo(c.level, cfg.scale).label})`
  switch (method) {
    case 'recent': return `Most recent score is ${f1(v[v.length - 1])}, so ${lv}.`
    case 'highest': return `Highest of ${v.map(f1).join(', ')} is ${f1(c.value)}, so ${lv}.`
    case 'mean': return `Average of ${v.map(f1).join(', ')} is ${f1(c.value)}, rounded to ${lv}.`
    case 'recentN': return `Average of the last ${Math.min(cfg.recentN, v.length)} (${v.slice(-cfg.recentN).map(f1).join(', ')}) is ${f1(c.value)}, rounded to ${lv}.`
    case 'mode': return `Most common level among ${v.map(f1).join(', ')} is ${f1(c.value)}, so ${lv}.`
    case 'decaying': {
      if (v.length === 1) return `One score so far: ${f1(v[0])}, so ${lv}.`
      const w = Math.round(cfg.decay * 100)
      return `Start at ${f1(v[0])}, then each new score counts ${w}% and the running value ${100 - w}%: ${v.slice(1).map(f1).join(' → ')} gives ${f1(c.value)}, rounded to ${lv}.`
    }
    case 'powerlaw': return v.length === 1 ? `One score so far: ${f1(v[0])}, so ${lv}.` : `A learning curve fitted through ${v.map(f1).join(', ')} reads ${f1(c.value)} at the latest assessment, rounded to ${lv}.`
  }
}

export function ruleText(cfg: Config): string {
  const prof = levelInfo(cfg.scale.proficient, cfg.scale).label
  return cfg.grading.rules.map(r => cfg.grading.mode === 'average'
    ? r.minAvg ? `${r.letter}: average level ${r.minAvg} or higher` : `${r.letter}: otherwise`
    : r.minShare ? `${r.letter}: ${Math.round(r.minShare * 100)}% of standards at ${prof} or above${r.floor ? `, none below ${r.floor}` : ''}` : `${r.letter}: otherwise`).join('; ')
}

export function explain(ds: Dataset, cfg: Config, studentId: string, method: Method = cfg.method, ev = evidenceFor(ds, cfg)): Explanation {
  const stds = standardsInUse(ds)
  const m = ev.get(studentId)
  const standards: Explanation['standards'] = []
  const missing: string[] = []
  for (const code of stds) {
    const c = cellFor(m?.get(code), cfg, method)
    if (c) standards.push({ code, cell: c, steps: explainCell(c, cfg, method) })
    else missing.push(code)
  }
  const levels = standards.map(s => s.cell.level)
  return { grade: letterGrade(levels, cfg), next: nextStep(levels, cfg), standards, missing, ruleText: ruleText(cfg) }
}

/** Khan Academy search link for practice on a standard (a search URL, never scraped). */
export const khanSearch = (code: string, desc?: string) =>
  `https://www.khanacademy.org/search?page_search_query=${encodeURIComponent(desc ? `${code} ${desc}` : code)}`
