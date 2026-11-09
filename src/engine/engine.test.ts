import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyReassess, calc, cellFor, classGrowth, compareMethods, defaultConfig, evidenceFor, explain, growthSeries, letterGrade, levelForPct, matrix, nextStep, powerLaw, SCALES, toLevel, upTo } from './mastery.ts'
import { reteachGroups } from './groups.ts'
import { assessmentColumns, autoMap, detectKind, mergeDataset, parseCsv, parseDate, parseScore, studentId, validate } from './csv.ts'
import { normalizeCode, CCSS } from './standards.ts'
import { compareSnapshots, heatmapRows, snapshot } from './report.ts'
import { crc32, xlsx } from './xlsx.ts'
import { generate, sampleConfig } from './sample.ts'
import type { Dataset, Evidence } from './types.ts'

const near = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} != ${b}`)
const ev = (a: string, value: number, date: string, reassessOf?: string): Evidence => ({ a, name: a, date, order: 0, value, reassessOf })

test('most recent, highest, mean and mode', () => {
  assert.equal(calc([1, 2, 4, 3], 'recent'), 3)
  assert.equal(calc([1, 2, 4, 3], 'highest'), 4)
  near(calc([1, 2, 4, 3], 'mean'), 2.5)
  assert.equal(calc([], 'mean'), null)
  // Mode ties go to the most recent of the tied levels.
  assert.equal(calc([2, 3, 2, 3], 'mode'), 3)
  assert.equal(calc([3, 3, 2, 2, 4], 'mode'), 2)
})

test('decaying average weights the newest score', () => {
  // 2 then 4 at 65%: 2*0.35 + 4*0.65 = 3.3; then 3: 3.3*0.35 + 3*0.65 = 3.105
  near(calc([2, 4], 'decaying', { decay: 0.65 }), 3.3)
  near(calc([2, 4, 3], 'decaying', { decay: 0.65 }), 3.105)
  // Weight 1 is "most recent", weight 0 is "first score".
  near(calc([1, 2, 3], 'decaying', { decay: 1 }), 3)
  near(calc([1, 2, 3], 'decaying', { decay: 0 }), 1)
})

test('most recent N averages the tail', () => {
  near(calc([1, 4, 2, 3], 'recentN', { recentN: 2 }), 2.5)
  near(calc([4], 'recentN', { recentN: 3 }), 4)
})

test('power law fits an exact power curve and reads it at the latest point', () => {
  // y = 1.5 * x^0.5 on a 0-based scale (shifted by +1 internally): build values from the curve.
  const vals = [1, 2, 3, 4].map(x => 1.5 * Math.pow(x, 0.5) - 1)
  near(powerLaw(vals, 0, 4), vals[3], 1e-9)
  // Growth trajectories read higher than the mean and lower than a single lucky max.
  const g = [1, 2, 2, 3, 3]
  const p = powerLaw(g, 1, 4)
  assert.ok(p > calc(g, 'mean')! && p <= 4)
  // Single score: itself. Result stays inside the scale.
  assert.equal(powerLaw([3], 1, 4), 3)
  assert.ok(powerLaw([1, 4, 4, 4, 4], 1, 4) <= 4)
})

test('scale cut-offs and rounding to levels', () => {
  const s = SCALES[0]
  assert.equal(levelForPct(0.59, s), 1)
  assert.equal(levelForPct(0.6, s), 2)
  assert.equal(levelForPct(0.75, s), 3)
  assert.equal(levelForPct(0.9, s), 4)
  assert.equal(toLevel(2.5, s), 3)
  assert.equal(toLevel(2.49, s), 2)
  assert.equal(toLevel(2.9, s, 'down'), 2)
  assert.equal(toLevel(0.2, s), 1) // never below the scale
})

test('reassessment rules: replace, highest, average, keep', () => {
  const list = [ev('q1', 2, '2026-09-01'), ev('q2', 3, '2026-09-05'), ev('r1', 4, '2026-09-10', 'q1')]
  const rep = applyReassess(list, 'replace')
  assert.deepEqual(rep.map(e => [e.a, e.value]), [['q2', 3], ['r1', 4]])
  assert.deepEqual(rep[1].replaced, ['q1'])
  const low = [ev('q1', 3, '2026-09-01'), ev('r1', 2, '2026-09-10', 'q1')]
  assert.equal(applyReassess(low, 'highest')[0].value, 3)
  assert.equal(applyReassess(low, 'average')[0].value, 2.5)
  assert.equal(applyReassess(low, 'keep').length, 2)
})

test('chained reassessments replace the whole chain', () => {
  const list = [ev('q1', 1, '2026-09-01'), ev('r1', 2, '2026-09-10', 'q1'), ev('r2', 3, '2026-09-20', 'q1')]
  const out = applyReassess(list, 'replace')
  assert.equal(out.length, 1)
  assert.equal(out[0].value, 3)
  assert.deepEqual(out[0].replaced, ['q1', 'r1'])
})

test('letter grade by share of standards met, with a floor', () => {
  const cfg = defaultConfig()
  assert.equal(letterGrade([3, 3, 4, 3, 3, 3, 3, 4, 3, 3], cfg).letter, 'A')
  // 90% met but one standard at 1 breaks the A and B floors.
  assert.equal(letterGrade([3, 3, 4, 3, 3, 3, 3, 4, 3, 1], cfg).letter, 'C')
  assert.equal(letterGrade([3, 3, 3, 2, 2], cfg).letter, 'C') // 60%
  assert.equal(letterGrade([3, 2, 2, 2, 2], cfg).letter, 'F') // 20%
  assert.equal(letterGrade([], cfg).letter, '—')
})

test('letter grade by average level', () => {
  const cfg = defaultConfig()
  cfg.grading.mode = 'average'
  assert.equal(letterGrade([4, 3, 4, 3], cfg).letter, 'A') // 3.5
  assert.equal(letterGrade([3, 3, 3, 2], cfg).letter, 'C') // 2.75
})

test('next step names what it takes to move up', () => {
  const cfg = defaultConfig()
  // 7 of 10 met (C); B needs 75% -> 8 of 10.
  assert.equal(nextStep([3, 3, 3, 3, 3, 3, 3, 2, 2, 2], cfg), 'To reach B: 1 more standard at Proficient or above.')
  assert.match(nextStep([3, 3, 3, 3, 1], cfg)!, /raised to at least 2/)
  assert.equal(nextStep([4, 4, 4], cfg), null)
})

const tiny = (): Dataset => ({
  students: [{ id: 's1', name: 'Ada' }, { id: 's2', name: 'Bo' }],
  assessments: [
    { id: 'a1', name: 'Quiz 1', date: '2026-09-01', order: 0, max: 10, standards: ['7.EE.A.1'] },
    { id: 'a2', name: 'Test', date: '2026-09-10', order: 1, max: 20, standards: ['7.EE.A.1', '7.EE.B.4'] },
    { id: 'a3', name: 'Retake', date: '2026-09-20', order: 2, max: 10, standards: ['7.EE.A.1'], reassessOf: 'a1' },
  ],
  scores: [{ s: 's1', a: 'a1', pts: 5 }, { s: 's1', a: 'a2', pts: 17 }, { s: 's1', a: 'a3', pts: 9 }, { s: 's2', a: 'a1', pts: 9.5 }, { s: 's2', a: 'a2', pts: 10 }],
  itemScores: [{ s: 's1', a: 'a2', std: '7.EE.A.1', pts: 10, max: 10 }, { s: 's1', a: 'a2', std: '7.EE.B.4', pts: 7, max: 10 }],
})

test('item scores per standard beat the whole-assessment score', () => {
  const e = evidenceFor(tiny(), defaultConfig())
  // Ada: test item scores 10/10 on EE.A.1 (level 4) and 7/10 on EE.B.4 (level 2); whole test was 85%.
  assert.deepEqual(e.get('s1')!.get('7.EE.A.1')!.map(x => x.value), [1, 4, 4])
  assert.deepEqual(e.get('s1')!.get('7.EE.B.4')!.map(x => x.value), [2])
  // Bo has no item scores, so 10/20 = 50% applies to both standards.
  assert.deepEqual(e.get('s2')!.get('7.EE.B.4')!.map(x => x.value), [1])
})

test('level mode reads scores as proficiency levels', () => {
  const cfg = defaultConfig(); cfg.scoreMode = 'level'
  const ds: Dataset = { students: [{ id: 's', name: 'S' }], assessments: [{ id: 'a', name: 'A', date: '2026-01-01', order: 0, max: 4, standards: ['x'] }], scores: [{ s: 's', a: 'a', pts: 3 }], itemScores: [] }
  assert.equal(cellFor(evidenceFor(ds, cfg).get('s')!.get('x'), cfg)!.level, 3)
})

test('matrix and explainer agree, and the explainer shows the steps', () => {
  const cfg = defaultConfig(); cfg.method = 'recent'
  const ds = tiny()
  const m = matrix(ds, cfg)
  const i = m.students.findIndex(s => s.id === 's1')
  const x = explain(ds, cfg, 's1')
  assert.deepEqual(x.standards.map(s => s.cell.level), m.cells[i].filter(Boolean).map(c => c!.level))
  // The retake replaced Quiz 1, so the dropped evidence is reported.
  assert.equal(x.standards[0].cell.dropped[0].a, 'a1')
  assert.match(x.standards[0].steps, /Most recent score is 4/)
  assert.match(x.ruleText, /A: 90% of standards at Proficient or above, none below 2/)
})

test('method choice changes letter grades on the sample class', () => {
  const ds = generate('grade7'), cfg = sampleConfig('grade7')
  const c = compareMethods(ds, cfg, ['recent', 'mean', 'decaying', 'powerlaw', 'highest'])
  assert.equal(c.rows.length, 28)
  assert.ok(c.changed('recent', 'mean') > 0, 'most recent vs mean should move someone')
  // Highest can never give a lower letter than mean, student by student.
  const rank = (l: string) => cfg.grading.rules.findIndex(r => r.letter === l)
  for (const r of c.rows) assert.ok(rank(r.letters.highest) <= rank(r.letters.mean), r.name)
  const total = Object.values(c.dist.recent).reduce((a, b) => a + b, 0)
  assert.equal(total, 28)
})

test('growth series ends at the current mastery value', () => {
  const ds = generate('grade7'), cfg = sampleConfig('grade7')
  const e = evidenceFor(ds, cfg)
  const sid = ds.students[0].id
  const raw = e.get(sid)!.get('7.RP.A.2')!
  const series = growthSeries(raw, cfg)
  assert.equal(series.length, raw.length)
  near(series.at(-1)!.value, cellFor(raw, cfg)!.value)
  const cg = classGrowth(ds, cfg)
  assert.ok(cg.length >= 10 && cg.every(p => p.share >= 0 && p.share <= 1))
})

test('reteach groups respect max size and cover everyone below proficient', () => {
  const ds = generate('grade7'), cfg = sampleConfig('grade7')
  cfg.groups = { k: 3, maxSize: 5 }
  const m = matrix(ds, cfg)
  const g = reteachGroups(m, cfg)
  const placed = g.groups.flatMap(x => x.students.map(s => s.id))
  assert.equal(new Set(placed).size, placed.length, 'nobody in two groups')
  assert.equal(placed.length + g.onTrack.length, 28)
  assert.ok(g.groups.every(x => x.students.length <= 5))
  assert.ok(g.k >= Math.ceil(placed.length / 5), 'k grows when the size cap needs it')
  assert.ok(g.groups.every(x => x.focus.length > 0))
})

test('reteach groups separate students with different gaps', () => {
  const cfg = defaultConfig(); cfg.groups = { k: 2, maxSize: 10 }
  const cell = (level: number) => ({ value: level, level, n: 1, evidence: [], dropped: [] })
  const m = {
    standards: ['A', 'B'],
    students: ['p', 'q', 'r', 's'].map(id => ({ id, name: id })),
    cells: [[cell(1), cell(4)], [cell(2), cell(4)], [cell(4), cell(1)], [cell(4), cell(2)]],
  }
  const g = reteachGroups(m, cfg)
  const sets = g.groups.map(x => x.students.map(s => s.id).sort().join(''))
  assert.deepEqual(sets.sort(), ['pq', 'rs'])
  assert.deepEqual(g.groups.map(x => x.focus[0].code).sort(), ['A', 'B'])
})

test('format detection for Google Classroom, Canvas, long, items and mapping files', () => {
  assert.equal(detectKind(['Last Name', 'First Name', 'Email Address', 'Quiz 1']), 'google-classroom')
  assert.equal(detectKind(['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', 'Quiz 1 (1234)']), 'canvas')
  assert.equal(detectKind(['Student Number', 'Student Name', 'Assignment', 'Due Date', 'Score', 'Points Possible']), 'powerschool')
  assert.equal(detectKind(['student', 'assessment', 'standard', 'score', 'max']), 'items')
  assert.equal(detectKind(['assessment', 'standards', 'date']), 'mapping')
  assert.equal(detectKind(['code', 'description']), 'standards')
  assert.equal(detectKind(['Name', 'Quiz 1', 'Quiz 2']), 'generic-wide')
})

test('Canvas export: points possible row, id suffixes, last-first names, line numbers', () => {
  const text = [
    'Student,ID,SIS User ID,SIS Login ID,Section,Unit 1 Quiz (4410),Unit 1 Test (4411),Current Score,Final Score',
    '    Points Possible,,,,,10,40,,',
    '"Okafor, Ada",101,A101,ada,P3,8,36,88,88',
    '"Ng, Bo",102,A102,bo,P3,abc,EX,70,70',
    ',,,,,,,,',
    '"Ruiz, Cy",,,,P3,,,,',
  ].join('\n')
  const csv = parseCsv(text)
  const kind = detectKind(csv.rows[0], csv.rows)
  assert.equal(kind, 'canvas')
  const map = autoMap(csv.rows[0], kind)
  assert.deepEqual(assessmentColumns(csv, map).map(i => csv.rows[0][i]), ['Unit 1 Quiz (4410)', 'Unit 1 Test (4411)'])
  const v = validate(csv, kind, map)
  assert.deepEqual(v.part.assessments!.map(a => [a.name, a.max]), [['Unit 1 Quiz', 10], ['Unit 1 Test', 40]])
  assert.equal(v.part.students![0].name, 'Ada Okafor')
  assert.equal(v.part.students![0].id, studentId('101'))
  assert.ok(v.issues.some(i => i.line === 4 && /"abc"/.test(i.message)))
  assert.ok(v.issues.some(i => i.line === 6 && /no scores/.test(i.message)))
  assert.ok(v.issues.some(i => /no dates/.test(i.message)))
})

test('Google Classroom export: date and points rows, emails become pseudonymous ids', () => {
  const text = 'Last Name,First Name,Email Address,Quiz 1,Quiz 2\nDate,,,"Sep 5, 2026",9/12/2026\nPoints,,,10,20\nOkafor,Ada,ada@school.org,9,15\n'
  const csv = parseCsv(text)
  const kind = detectKind(csv.rows[0], csv.rows)
  const v = validate(csv, kind, autoMap(csv.rows[0], kind))
  assert.deepEqual(v.part.assessments!.map(a => [a.date, a.max]), [['2026-09-05', 10], ['2026-09-12', 20]])
  assert.equal(v.part.students![0].id, studentId('ada@school.org'))
  assert.ok(!v.part.students![0].id.includes('ada'))
  assert.equal(v.part.scores!.length, 2)
})

test('long scores, mapping file and item tags merge into one dataset; re-import does not duplicate', () => {
  const scores = parseCsv('Student Number,Student Name,Assignment,Due Date,Score,Points Possible\n1,"Okafor, Ada",Quiz 1,2026-09-01,8,10\n1,"Okafor, Ada",Retake 1,2026-09-09,10,10\n2,Bo Ng,Quiz 1,2026-09-01,Missing,10\n')
  const k1 = detectKind(scores.rows[0])
  const v1 = validate(scores, k1, autoMap(scores.rows[0], k1))
  assert.equal(v1.used, 2)
  assert.ok(v1.issues.some(i => /1 "missing" marks/.test(i.message)))
  const mapping = parseCsv('assessment,standard,item,reassessment of\nQuiz 1,7.EE.1,Q1,\nQuiz 1,7.EE.B.4,Q2,\nRetake 1,7.EE.A.1,,Quiz 1\n')
  const k2 = detectKind(mapping.rows[0])
  assert.equal(k2, 'mapping')
  const v2 = validate(mapping, k2, autoMap(mapping.rows[0], k2))
  const items = parseCsv('student number,assessment,item,score,max\n1,Quiz 1,Q1,4,4\n1,Quiz 1,Q2,4,6\n')
  const k3 = detectKind(items.rows[0])
  assert.equal(k3, 'items')
  const v3 = validate(items, k3, autoMap(items.rows[0], k3))
  let ds = mergeDataset(mergeDataset(mergeDataset({ students: [], assessments: [], scores: [], itemScores: [] }, v1.part), v2.part), v3.part)
  ds = mergeDataset(ds, v3.part)
  ds = mergeDataset(ds, v1.part)
  assert.equal(ds.scores.length, 2)
  assert.equal(ds.itemScores.length, 2)
  const quiz = ds.assessments.find(a => a.name === 'Quiz 1')!
  assert.deepEqual(quiz.standards, ['7.EE.A.1', '7.EE.B.4'])
  assert.equal(ds.assessments.find(a => a.name === 'Retake 1')!.reassessOf, quiz.id)
  const e = evidenceFor(ds, defaultConfig()).get(studentId('1'))!
  // Item Q1 (4/4) -> level 4 on EE.A.1, then the retake replaces it; Q2 (4/6 = 67%) -> level 2 on EE.B.4.
  assert.deepEqual(e.get('7.EE.A.1')!.map(x => x.value), [4, 4])
  assert.deepEqual(e.get('7.EE.B.4')!.map(x => x.value), [2])
})

test('score and date parsing', () => {
  assert.deepEqual(parseScore('8/10'), { kind: 'pts', pts: 8, max: 10 })
  assert.deepEqual(parseScore('85%'), { kind: 'pct', pct: 0.85 })
  assert.equal(parseScore('Missing').kind, 'missing')
  assert.equal(parseScore('EX').kind, 'excused')
  assert.equal(parseScore('').kind, 'blank')
  assert.equal(parseDate('Sep 5, 2026'), '2026-09-05')
  assert.equal(parseDate('9/12/2026'), '2026-09-12')
  assert.equal(parseDate('2026-09-12T10:00:00Z'), '2026-09-12')
  assert.equal(parseDate('13/45/2026'), '')
})

test('standard codes normalize and the bundled list is complete', () => {
  assert.equal(normalizeCode('7.ee.1'), '7.EE.A.1')
  assert.equal(normalizeCode('CCSS.MATH.CONTENT.HSA.REI.B.3'), 'A-REI.B.3')
  assert.equal(normalizeCode('HSF-IF.B.4'), 'F-IF.B.4')
  assert.equal(normalizeCode('MY.CUSTOM.1'), 'MY.CUSTOM.1')
  for (const g of ['6', '7', '8']) assert.ok(CCSS.filter(s => s.grade === g).length >= 24, g)
  assert.equal(new Set(CCSS.map(s => s.code)).size, CCSS.length)
})

test('snapshots compare terms by pseudonymous id and show growth', () => {
  const ds = generate('grade7'), cfg = sampleConfig('grade7')
  const a = snapshot(ds, cfg, 'x', 'Sep', '2026-09-30'), b = snapshot(ds, cfg, 'y', 'Dec', '2026-12-31')
  assert.ok(b.standards.length > a.standards.length)
  assert.ok(a.rows.every(r => !('name' in r)))
  const d = compareSnapshots(a, b, cfg)
  assert.equal(d.up + d.down + d.same, 28)
  assert.equal(upTo(ds, '2026-09-30').assessments.length, 5)
})

test('heatmap rows and XLSX output are well formed', () => {
  const ds = tiny(), cfg = defaultConfig()
  const rows = heatmapRows(matrix(ds, cfg), cfg)
  assert.deepEqual(rows[0], ['Student', '7.EE.A.1', '7.EE.B.4', 'Standards met', 'Letter'])
  assert.equal(rows.length, 4)
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const bytes = xlsx([{ name: 'Heatmap', rows: [[{ v: 'a', bold: true }, { v: 3, fill: '#D5F3D5' }]] }])
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50)
  const text = new TextDecoder().decode(bytes)
  assert.match(text, /<c r="B1" s="2"><v>3<\/v><\/c>/)
  assert.match(text, /FFD5F3D5/)
})

test('samples are deterministic and labelled', () => {
  const a = generate('grade7'), b = generate('grade7')
  assert.deepEqual(a, b)
  assert.equal(a.students.length, 28)
  assert.equal(new Set(a.assessments.flatMap(x => x.standards)).size, 10)
  assert.ok(a.assessments.filter(x => x.reassessOf).length >= 3)
  assert.ok(a.scores.some(s => s.a === a.assessments.find(x => x.reassessOf)!.id))
  const h = generate('alg1')
  assert.equal(h.students.length, 24)
})
