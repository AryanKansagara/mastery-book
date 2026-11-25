import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, mergeDataset, parseCsv, validate, withMax } from './csv.ts'
import { defaultConfig, evidenceFor } from './mastery.ts'
import type { Dataset } from './types.ts'

const imp = (text: string, ds: Dataset = { students: [], assessments: [], scores: [], itemScores: [] }) => {
  const csv = parseCsv(text)
  const kind = detectKind(csv.rows[0], csv.rows)
  return mergeDataset(ds, validate(csv, kind, autoMap(csv.rows[0], kind)).part)
}
const MAP = 'assessment,standard\nQuiz,x\n'
const read = (ds: Dataset) => Object.fromEntries(ds.students.map(s => [s.name, evidenceFor(ds, defaultConfig()).get(s.id)?.get('x')?.[0].value]))
const edit = (ds: Dataset, max: number): Dataset => ({ ...ds, assessments: ds.assessments.map(a => ({ ...a, ...withMax(a, max) })) })
const LIST = 'student,assessment,score,max\n'

test('rows out of different totals', () => {
  assert.deepEqual(read(imp(MAP, imp(LIST + 'Ada,Quiz,8,10\nBo,Quiz,16,20\n'))), { Ada: 3, Bo: 3 })
  assert.deepEqual(read(imp(MAP, imp('student,assessment,score\nAda,Quiz,8/10\nBo,Quiz,80%\n'))), { Ada: 3, Bo: 3 })
  assert.deepEqual(read(imp(MAP, imp(LIST + 'Ada,Quiz,8/10,20\nBo,Quiz,16,20\n'))), { Ada: 3, Bo: 3 })
})

test('a percent or fraction does not depend on points possible stated later', () => {
  const mapping = 'assessment,standard,points possible\nQuiz,x,40\n'
  for (const s of ['80%', '8/10']) {
    const ds = imp('Student,Quiz\nAda,' + s + '\n')
    assert.deepEqual(read(imp(mapping, ds)), { Ada: 3 })
    assert.deepEqual(read(imp('Student,Quiz\nAda,' + s + '\n', imp(mapping))), { Ada: 3 })
    assert.deepEqual(read(edit(imp(MAP, ds), 400)), { Ada: 3 })
  }
  // Khan Academy: a fraction first, then a percent in the same column.
  assert.deepEqual(read(imp('Student,Quiz\nAda,80%\nBo,7/8\n', imp(MAP, imp('Student,Quiz\nAda,7/8\n')))), { Ada: 3, Bo: 3 })
})

test('a re-import out of a new total', () => {
  const first = imp(MAP, imp(LIST + 'Ada,Quiz,8,10\nBo,Quiz,8,10\n'))
  const again = imp(LIST + 'Ada,Quiz,16,20\n', first)
  assert.equal(again.assessments[0].max, 20)
  assert.deepEqual(read(again), { Ada: 3, Bo: 3 })
  assert.deepEqual(imp(LIST + 'Ada,Quiz,16,20\n', again), again)
})

test('a total changed by the teacher stands when the same file comes back', () => {
  const wide = 'Student,Quiz\nPoints Possible,10\nAda,8\n'
  const edited = edit(imp(MAP, imp(wide)), 20)
  assert.deepEqual(read(edited), { Ada: 1 })
  assert.equal(imp(wide, edited).assessments[0].max, 20)
  // ...but a new total in the file is used, because its points are out of it.
  const raised = imp('Student,Quiz\nPoints Possible,40\nAda,32\n', edited)
  assert.equal(raised.assessments[0].max, 40)
  assert.deepEqual(read(raised), { Ada: 3 })
})

test('an assumed total gives way to a stated one and never replaces it', () => {
  const guess = 'Student,Quiz\nAda,8\nBo,5\n'
  const ds = imp('Student,Quiz\nPoints Possible,20\nAda,16\n', imp(MAP, imp(guess)))
  assert.equal(ds.assessments[0].max, 20)
  assert.deepEqual(read(ds), { Ada: 3, Bo: 1 })
  assert.equal(imp(guess, ds).assessments[0].max, 20)
})

test('plain points follow an edited total; an unknown total is no evidence', () => {
  const ds = imp(MAP, imp(LIST + 'Ada,Quiz,8,10\n'))
  assert.deepEqual(read(edit(ds, 8)), { Ada: 4 })
  assert.deepEqual(read(edit(ds, 0)), { Ada: undefined })
})

test('classes saved before scores had their own total still read the same', () => {
  const old: Dataset = { students: [{ id: 's', name: 'Ada' }], assessments: [{ id: 'a', name: 'Quiz', date: '', order: 0, max: 10, standards: ['x'] }], scores: [{ s: 's', a: 'a', pts: 8 }], itemScores: [] }
  assert.deepEqual(read(old), { Ada: 3 })
})
