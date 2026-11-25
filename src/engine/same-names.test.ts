import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessmentId, autoMap, detectKind, mergeDataset, parseCsv, validate } from './csv.ts'
import type { Dataset } from './types.ts'

const EMPTY: Dataset = { students: [], assessments: [], scores: [], itemScores: [] }
const read = (text: string) => { const csv = parseCsv(text); const kind = detectKind(csv.rows[0], csv.rows); return validate(csv, kind, autoMap(csv.rows[0], kind)) }
const imp = (text: string, ds = EMPTY) => mergeDataset(ds, read(text).part)
const show = (ds: Dataset) => Object.fromEntries(ds.assessments.map(a => [a.name, ds.scores.filter(s => s.a === a.id).map(s => `${s.pts}/${s.max ?? a.max}`).join(' ')]))

const canvas = (cols: [string, number][], scores: (number | string)[]) => `Student,ID,SIS User ID,SIS Login ID,Section,${cols.map(c => c[0]).join()}\n    Points Possible,,,,,${cols.map(c => c[1]).join()}\n"Okafor, Ada",1,S1,ada,P3,${scores.join()}\n`
const A: [string, number] = ['Exit ticket (501)', 5], B: [string, number] = ['Exit ticket (502)', 10]

test('same-named Canvas assignments stay separate, with stable ids in any column order', () => {
  const ds = imp(canvas([A, B], [5, 2]))
  assert.deepEqual(show(ds), { 'Exit ticket (501)': '5/5', 'Exit ticket (502)': '2/10' })
  assert.deepEqual(imp(canvas([B, A], [2, 5]), ds), ds)
})

test('one assignment first, its namesake later', () => {
  const one = imp(canvas([A], [4]))
  assert.deepEqual(show(one), { 'Exit ticket': '4/5' })
  assert.equal(one.assessments[0].id, assessmentId('Exit ticket'))
  const two = imp(canvas([B, A], [2, 5]), one)
  assert.deepEqual(show(two), { 'Exit ticket (501)': '5/5', 'Exit ticket (502)': '2/10' })
  assert.deepEqual(imp(canvas([A, B], [5, 2]), two), two)
  // Both were known, then a file holds only one.
  assert.deepEqual(show(imp(canvas([B], [7]), two)), { 'Exit ticket (501)': '5/5', 'Exit ticket (502)': '7/10' })
  assert.deepEqual(show(imp(canvas([A], [3]), imp(canvas([A, B], [5, 2])))), { 'Exit ticket (501)': '3/5', 'Exit ticket (502)': '2/10' })
})

test('a class stored before Canvas ids were kept does not count a column twice', () => {
  const old: Dataset = { ...imp(canvas([['Exit ticket', 10]], [2])) }
  // The second is ungraded, so it is not an assessment yet and the first takes the old place.
  assert.deepEqual(show(imp(canvas([A, B], [5, '']), old)), { 'Exit ticket': '5/5' })
  assert.deepEqual(show(imp(canvas([A, B], [5, 3]), old)), { 'Exit ticket (501)': '5/5', 'Exit ticket (502)': '3/10' })
})

test('mapping rows and reassessment links find the right namesake, before or after the scores', () => {
  const map = 'assessment,standard,reassessment of\nExit ticket (501),x,\nExit ticket (502),y,Exit ticket (501)\n'
  for (const ds of [imp(map, imp(canvas([A, B], [5, 2]))), imp(canvas([A, B], [5, 2]), imp(map)), imp(map, imp(canvas([A, B], [5, 2]), imp(canvas([A], [5]))))]) {
    const [a, b] = ['Exit ticket (501)', 'Exit ticket (502)'].map(n => ds.assessments.find(x => x.name === n)!)
    assert.deepEqual([ds.assessments.length, a.standards, b.standards, b.reassessOf], [2, ['x'], ['y'], a.id])
  }
})

test('columns with nothing but a name in common', () => {
  const text = (d: string[], s: string[]) => `Student,Quiz,Quiz,Quiz (2)\nDate,${d.join()},\nPoints Possible,10,10,10\nAda,${s.join()},1\n`
  const ds = imp(text(['2026-09-08', '2026-09-01'], ['9', '2']))
  assert.deepEqual(show(ds), { 'Quiz (3)': '9/10', Quiz: '2/10', 'Quiz (2)': '1/10' })
  assert.deepEqual(show(imp(text(['2026-09-01', '2026-09-08'], ['2', '9']), ds)), show(ds))
  assert.ok(read('Student,Quiz,Quiz\nAda,1,2\n').issues.some(i => i.line === 1 && /in column order as "Quiz", "Quiz \(2\)"/.test(i.message)))
})

test('a name with and without its Canvas id in one file is one assessment', () => {
  const ds = imp('assessment,standard,reassessment of\nQ,x,\nR,x,Q (12345)\n')
  assert.equal(ds.assessments[1].reassessOf, ds.assessments[0].id)
})

test('unique names keep the ids they have', () => {
  assert.deepEqual(read(canvas([A, ['Quiz (9001)', 4]], [1, 2])).part.assessments!.map(a => a.id), [assessmentId('Exit ticket'), assessmentId('Quiz')])
})

test('a repeated student and assessment in a list names the replaced line', () => {
  const v = read('student id,student name,assessment,date,score,points possible\n1,Ada,Exit,2026-09-01,2,10\n2,Bo,Exit,2026-09-01,5,10\n1,Ada,Exit,2026-09-08,9,10\n')
  assert.deepEqual(v.issues.filter(i => /replaced/.test(i.message)).map(i => [i.line, i.message]), [[2, 'The score for Ada on "Exit" is replaced by the one on line 4. To keep both, give them different assessment names.']])
  assert.equal(v.summary, '2 students, 1 assessments, 2 scores')
  assert.deepEqual(read('student,assessment,score,max\nAda,T (501),5,5\nAda,T (502),2,10\n').part.scores!.length, 2)
})
