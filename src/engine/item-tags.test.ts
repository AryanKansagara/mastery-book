import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, mergeDataset, parseCsv, validate } from './csv.ts'
import { defaultConfig, evidenceFor } from './mastery.ts'
import type { Dataset } from './types.ts'

const EMPTY: Dataset = { students: [], assessments: [], scores: [], itemScores: [] }
const imp = (text: string, ds = EMPTY) => { const csv = parseCsv(text); const kind = detectKind(csv.rows[0], csv.rows); return mergeDataset(ds, validate(csv, kind, autoMap(csv.rows[0], kind)).part) }
const read = (ds: Dataset) => Object.fromEntries([...evidenceFor(ds, defaultConfig()).values()].flatMap(m => [...m].map(([k, l]) => [k, l[0].value])))
const ITEMS = 'student,assessment,item,score,max\nAda,T,Q1,9,10\nAda,T,Q2,1,10\n'

test('every standard on an item counts, on one row or several, in either import order', () => {
  for (const map of ['assessment,standard,item\nT,x; y,Q1\nT,z,Q2\n', 'assessment,standard,item\nT,x,Q1\nT,y|x,Q1\nT,z,Q2\n']) {
    assert.deepEqual(read(imp(ITEMS, imp(map))), { x: 4, y: 4, z: 1 })
    assert.deepEqual(read(imp(map, imp(ITEMS))), { x: 4, y: 4, z: 1 })
  }
})

test('a later mapping file replaces an item tag, and stored single tags still work', () => {
  const ds = imp('assessment,standard,item\nT,z,Q1\n', imp('assessment,standard,item\nT,x; y,Q1\n'))
  assert.deepEqual(ds.assessments[0].items, { Q1: 'z' })
  assert.deepEqual(read({ ...imp(ITEMS), assessments: [{ id: imp(ITEMS).assessments[0].id, name: 'T', date: '', order: 0, max: 0, standards: ['x'], items: { Q1: 'x' } }] }), { x: 4 })
})

test('item labels that are not tagged resolve to nothing', () => {
  assert.deepEqual(read(imp('student,assessment,item,score,max\nAda,T,constructor,9,10\n', imp('assessment,standard,item\nT,x,Q1\n'))), {})
})
