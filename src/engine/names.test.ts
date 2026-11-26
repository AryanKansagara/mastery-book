import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, mergeDataset, parseCsv, validate } from './csv.ts'
import type { Dataset } from './types.ts'

const imp = (text: string, ds: Dataset = { students: [], assessments: [], scores: [], itemScores: [] }) => {
  const csv = parseCsv(text)
  const kind = detectKind(csv.rows[0], csv.rows)
  return mergeDataset(ds, validate(csv, kind, autoMap(csv.rows[0], kind)).part)
}
const names = (ds: Dataset) => ds.students.map(s => s.name)
const SCORES = 'student id,student name,assessment,score,points possible\nS1,Ada Okafor,Unit 1,14,20\n'
const ITEMS = 'student id,assessment,item,score,max\ns1,Unit 1,Q1,9,10\n'

test('an ID-only file keeps known names in either order', () => {
  assert.deepEqual(names(imp(ITEMS, imp(SCORES))), ['Ada Okafor'])
  assert.deepEqual(names(imp(SCORES, imp(ITEMS))), ['Ada Okafor'])
  assert.deepEqual(names(imp('email,Quiz 1\nS1,9\n', imp(SCORES))), ['Ada Okafor'])
})

test('names still update, and an ID is shown when nothing else is known', () => {
  assert.deepEqual(names(imp(SCORES.replace('Okafor', 'Obi'), imp(SCORES))), ['Ada Obi'])
  assert.deepEqual(names(imp(ITEMS)), ['s1'])
  assert.deepEqual(names(imp('Name,Quiz 1\nAda,9\n', imp('Name,Quiz 1\nAda,8\n'))), ['Ada'])
})

test('a later row without the name keeps it inside one file', () => {
  assert.deepEqual(names(imp(SCORES + 'S1,,Unit 2,5,10\n')), ['Ada Okafor'])
})
