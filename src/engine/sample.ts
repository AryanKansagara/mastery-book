// Two synthetic classes. Every name and score here is generated; none of it is real student data.
import { defaultConfig } from './mastery.ts'
import { assessmentId, studentId } from './csv.ts'
import type { Assessment, Config, Dataset, ItemScore, Score } from './types.ts'

export interface SampleDef { id: string; name: string; blurb: string; seed: number }
export const SAMPLES: SampleDef[] = [
  { id: 'grade7', name: 'Grade 7 Math, Period 3', blurb: '28 students, 10 standards, 15 assessments including 3 reassessments (points, item-level unit tests)', seed: 7 },
  { id: 'alg1', name: 'Algebra 1, Block B', blurb: '24 students, 8 high school standards, scored directly on the 1 to 4 scale', seed: 11 },
]

function rng(seed: number) {
  let a = seed >>> 0
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const normal = () => { const u = Math.max(1e-9, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  return { next, normal, pick: <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)] }
}

const FIRST = ['Amara', 'Bennett', 'Camila', 'Dario', 'Elif', 'Felix', 'Greta', 'Hiro', 'Imani', 'Jonah', 'Kaia', 'Luca', 'Mireya', 'Nikhil', 'Odessa', 'Pavel', 'Quinn', 'Rosalind', 'Soren', 'Talia', 'Umar', 'Vera', 'Wesley', 'Xiomara', 'Yusuf', 'Zinnia', 'Ansel', 'Bea', 'Cyrus', 'Delphine', 'Emeka', 'Fern']
const LAST = ['Abernathy', 'Bramwell', 'Castellano', 'Delacroix', 'Eriksen', 'Fairweather', 'Galloway', 'Halvorsen', 'Ibarra', 'Jablonski', 'Kettering', 'Lindqvist', 'Marchetti', 'Nakashima', 'Okonkwo', 'Pennington', 'Quintero', 'Rasmussen', 'Sorensen', 'Thornbury', 'Underhill', 'Valdivia', 'Whitlock', 'Yamaguchi', 'Zeller', 'Ashdown', 'Brightwater', 'Cormier']

interface Plan { name: string; date: string; stds: string[]; reassessOf?: string; max?: number }

// Archetypes make the calculation methods disagree the way real classes do.
type Arc = 'steady' | 'bloomer' | 'slipping' | 'badday' | 'struggling' | 'strong'
const ARCS: Arc[] = ['steady', 'steady', 'bloomer', 'bloomer', 'slipping', 'badday', 'struggling', 'strong', 'steady', 'bloomer']

function latent(arc: Arc, base: number, k: number, n: number, r: ReturnType<typeof rng>, badIdx: number) {
  const t = n > 1 ? k / (n - 1) : 1
  let v = base
  if (arc === 'bloomer') v = base - 1.1 + 1.9 * t
  else if (arc === 'slipping') v = base + 0.6 - 1.3 * t
  else if (arc === 'struggling') v = base - 0.9 + 0.5 * t
  else if (arc === 'strong') v = base + 0.7 + 0.2 * t
  else v = base + 0.3 * t
  if (arc === 'badday' && k === badIdx) v -= 1.8
  return v + r.normal() * 0.38
}
// Latent level (about 0.5 to 4.5) to a percent that lands on the 4-point cut-offs (60 / 75 / 90).
const pctFor = (v: number) => Math.min(1, Math.max(0.2, 0.45 + (v - 1) * 0.16))

function build(def: SampleDef, stds: string[], plans: Plan[], nStudents: number, mode: Config['scoreMode']): Dataset {
  const r = rng(def.seed)
  const used = new Set<string>()
  const students = Array.from({ length: nStudents }, (_, i) => {
    let name = ''
    do name = `${r.pick(FIRST)} ${r.pick(LAST)}`; while (used.has(name))
    used.add(name)
    return { id: studentId(`${def.id}-${i + 1}@example.edu`), name, arc: ARCS[(i * 7 + def.seed) % ARCS.length], base: 2.6 + r.normal() * 0.45, offs: Object.fromEntries(stds.map(s => [s, r.normal() * 0.35])) as Record<string, number> }
  })
  const assessments: Assessment[] = plans.map((p, i) => ({ id: assessmentId(p.name), name: p.name, date: p.date, order: i, max: p.max ?? (mode === 'level' ? 4 : p.stds.length > 1 ? 8 * p.stds.length : 10), standards: p.stds, ...(p.reassessOf ? { reassessOf: assessmentId(p.reassessOf) } : {}) }))
  const scores: Score[] = [], itemScores: ItemScore[] = []
  // Count how many times each standard is assessed so trajectories are per standard.
  const occurrences = Object.fromEntries(stds.map(s => [s, plans.filter(p => p.stds.includes(s) && !p.reassessOf).length])) as Record<string, number>
  const seen: Record<string, Record<string, number>> = {}
  const lastLevel: Record<string, number> = {}
  for (const st of students) {
    seen[st.id] = {}
    const badIdx = Math.floor(r.next() * 3)
    for (const [i, p] of plans.entries()) {
      const a = assessments[i]
      // Reassessments are opt-in: only students below proficient on the original take them.
      if (p.reassessOf) {
        const orig = assessmentId(p.reassessOf)
        const below = p.stds.some(s => (lastLevel[`${st.id}|${orig}|${s}`] ?? 4) < 3)
        if (!below || r.next() < 0.15) continue
      }
      if (r.next() < 0.03) continue // absent, no evidence
      const parts = p.stds.map(s => {
        const k = p.reassessOf ? Math.max(0, (seen[st.id][s] ?? 1) - 1) + 0.6 : (seen[st.id][s] ?? 0)
        const v = latent(st.arc, st.base + st.offs[s] + (p.reassessOf ? 0.5 : 0), k, occurrences[s], r, p.reassessOf ? -1 : badIdx)
        if (!p.reassessOf) seen[st.id][s] = (seen[st.id][s] ?? 0) + 1
        return { s, v }
      })
      if (mode === 'level') {
        const lv = parts.map(x => Math.min(4, Math.max(1, Math.round(x.v))))
        parts.forEach((x, j) => { lastLevel[`${st.id}|${a.id}|${x.s}`] = lv[j] })
        if (parts.length === 1) scores.push({ s: st.id, a: a.id, pts: lv[0] })
        else {
          parts.forEach((x, j) => itemScores.push({ s: st.id, a: a.id, std: x.s, pts: lv[j], max: 4 }))
          scores.push({ s: st.id, a: a.id, pts: Math.round(lv.reduce((x, y) => x + y, 0) / lv.length * 10) / 10 })
        }
      } else {
        const per = a.max / parts.length
        const pts = parts.map(x => Math.round(pctFor(x.v) * per))
        parts.forEach((x, j) => { lastLevel[`${st.id}|${a.id}|${x.s}`] = pts[j] / per >= 0.75 ? 3 : 2 })
        if (parts.length > 1) parts.forEach((x, j) => itemScores.push({ s: st.id, a: a.id, std: x.s, pts: pts[j], max: per }))
        scores.push({ s: st.id, a: a.id, pts: pts.reduce((x, y) => x + y, 0) })
      }
    }
  }
  return { students: students.map(({ id, name }) => ({ id, name, section: def.id === 'grade7' ? 'Period 3' : 'Block B' })), assessments, scores, itemScores }
}

const G7 = ['7.RP.A.1', '7.RP.A.2', '7.RP.A.3', '7.NS.A.1', '7.NS.A.2', '7.NS.A.3', '7.EE.A.1', '7.EE.B.4', '7.G.B.4', '7.G.B.5']
const G7_PLAN: Plan[] = [
  { name: 'Quiz 1.1 Unit rates', date: '2026-08-28', stds: ['7.RP.A.1'] },
  { name: 'Quiz 1.2 Proportional relationships', date: '2026-09-04', stds: ['7.RP.A.2'] },
  { name: 'Unit 1 Test', date: '2026-09-15', stds: ['7.RP.A.1', '7.RP.A.2', '7.RP.A.3'] },
  { name: 'Reassessment: Proportional relationships', date: '2026-09-24', stds: ['7.RP.A.2'], reassessOf: 'Quiz 1.2 Proportional relationships' },
  { name: 'Quiz 2.1 Adding integers', date: '2026-09-30', stds: ['7.NS.A.1'] },
  { name: 'Quiz 2.2 Multiplying integers', date: '2026-10-08', stds: ['7.NS.A.2'] },
  { name: 'Unit 2 Test', date: '2026-10-20', stds: ['7.NS.A.1', '7.NS.A.2', '7.NS.A.3'] },
  { name: 'Reassessment: Unit 2 Test', date: '2026-10-29', stds: ['7.NS.A.1', '7.NS.A.2', '7.NS.A.3'], reassessOf: 'Unit 2 Test' },
  { name: 'Quiz 3.1 Expressions', date: '2026-11-05', stds: ['7.EE.A.1'] },
  { name: 'Quiz 3.2 Equations', date: '2026-11-12', stds: ['7.EE.B.4'] },
  { name: 'Unit 3 Test', date: '2026-11-24', stds: ['7.EE.A.1', '7.EE.B.4', '7.RP.A.3'] },
  { name: 'Quiz 4.1 Circles', date: '2026-12-03', stds: ['7.G.B.4'] },
  { name: 'Reassessment: Equations', date: '2026-12-08', stds: ['7.EE.B.4'], reassessOf: 'Quiz 3.2 Equations' },
  { name: 'Quiz 4.2 Angle relationships', date: '2026-12-10', stds: ['7.G.B.5'] },
  { name: 'Cumulative check', date: '2026-12-15', stds: ['7.RP.A.3', '7.NS.A.2', '7.G.B.4', '7.G.B.5'] },
]
const ALG = ['A-SSE.A.1', 'A-CED.A.1', 'A-REI.B.3', 'A-REI.C.6', 'F-IF.A.1', 'F-IF.B.4', 'F-LE.A.1', 'S-ID.C.7']
const ALG_PLAN: Plan[] = [
  { name: 'Skill check: Interpreting expressions', date: '2026-08-26', stds: ['A-SSE.A.1'] },
  { name: 'Skill check: Solving linear equations', date: '2026-09-02', stds: ['A-REI.B.3'] },
  { name: 'Skill check: Writing equations', date: '2026-09-10', stds: ['A-CED.A.1'] },
  { name: 'Unit 1 Assessment', date: '2026-09-18', stds: ['A-SSE.A.1', 'A-CED.A.1', 'A-REI.B.3'] },
  { name: 'Reassessment: Unit 1', date: '2026-09-29', stds: ['A-SSE.A.1', 'A-CED.A.1', 'A-REI.B.3'], reassessOf: 'Unit 1 Assessment' },
  { name: 'Skill check: Function notation', date: '2026-10-06', stds: ['F-IF.A.1'] },
  { name: 'Skill check: Key features of graphs', date: '2026-10-14', stds: ['F-IF.B.4'] },
  { name: 'Unit 2 Assessment', date: '2026-10-23', stds: ['F-IF.A.1', 'F-IF.B.4', 'S-ID.C.7'] },
  { name: 'Skill check: Systems of equations', date: '2026-11-04', stds: ['A-REI.C.6'] },
  { name: 'Skill check: Slope and intercept in context', date: '2026-11-11', stds: ['S-ID.C.7'] },
  { name: 'Reassessment: Systems of equations', date: '2026-11-18', stds: ['A-REI.C.6'], reassessOf: 'Skill check: Systems of equations' },
  { name: 'Skill check: Linear vs exponential', date: '2026-12-02', stds: ['F-LE.A.1'] },
  { name: 'Unit 3 Assessment', date: '2026-12-11', stds: ['A-REI.C.6', 'F-LE.A.1', 'F-IF.B.4', 'A-REI.B.3'] },
]

export function generate(id: string): Dataset {
  const def = SAMPLES.find(s => s.id === id)!
  return id === 'alg1' ? build(def, ALG, ALG_PLAN, 24, 'level') : build(def, G7, G7_PLAN, 28, 'percent')
}

export function sampleConfig(id: string): Config {
  const c = defaultConfig()
  if (id === 'alg1') { c.scoreMode = 'level'; c.method = 'powerlaw' }
  return c
}

/** Term snapshot cut-offs for the samples' History tab. */
export const SAMPLE_TERMS: Record<string, { label: string; date: string }[]> = {
  grade7: [{ label: 'Progress report 1 (Sep 30)', date: '2026-09-30' }, { label: 'Quarter 1 (Oct 31)', date: '2026-10-31' }],
  alg1: [{ label: 'Progress report 1 (Sep 30)', date: '2026-09-30' }, { label: 'Quarter 1 (Oct 31)', date: '2026-10-31' }],
}
