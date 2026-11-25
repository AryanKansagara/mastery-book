import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, importEffects, mergeDataset, parseCsv, validate } from './csv.ts'
import type { Dataset } from './types.ts'

const EMPTY: Dataset = { students: [], assessments: [], scores: [], itemScores: [] }
const read = (text: string) => { const csv = parseCsv(text); const kind = detectKind(csv.rows[0], csv.rows); return validate(csv, kind, autoMap(csv.rows[0], kind)) }
const imp = (text: string, ds = EMPTY) => mergeDataset(ds, read(text).part)
const show = (ds: Dataset) => ds.scores.map(s => `${ds.students.find(x => x.id === s.s)!.name} ${s.pts}`)
const wide = (ada: string, bo = '9') => `Student,Quiz\nPoints Possible,10\nAda,${ada}\nBo,${bo}\n`
const list = (ada: string) => `student,assessment,score,max\nAda,Quiz,${ada},10\n`

test('excused and missing remove the earlier score; empty and unreadable cells keep it', () => {
  const ds = imp(wide('2'))
  for (const f of [wide, list]) {
    for (const m of ['EX', 'Missing', 'N/A', '0*']) {
      assert.deepEqual(show(imp(f(m), ds)), ['Bo 9'], m)
      assert.deepEqual(importEffects(ds, read(f(m)).part), { removed: 1, kept: 0, items: 0 })
    }
    for (const m of ['', '--', 'Turned in', 'abc', '-3']) {
      assert.deepEqual(show(imp(f(m), ds)), ['Ada 2', 'Bo 9'], m)
      assert.deepEqual(importEffects(ds, read(f(m)).part), { removed: 0, kept: 1, items: 0 })
    }
  }
})

test('a fully excused column can be imported and removes its scores', () => {
  const ds = imp(wide('2')), v = read(wide('EX', 'Missing'))
  assert.deepEqual([show(mergeDataset(ds, v.part)), mergeDataset(ds, v.part).assessments.length], [[], 1])
  const canvas = (a: string, b: string) => `Student,ID,SIS User ID,SIS Login ID,Section,Quiz (501),Quiz (502)\n    Points Possible,,,,,10,10\n"Okafor, Ada",1,S1,ada,P3,${a},${b}\n`
  assert.deepEqual(show(imp(canvas('EX', '4'), imp(canvas('3', '4')))), ['Ada Okafor 4'])
})

test('the last row wins inside one file', () => {
  const head = 'student,assessment,score,max\n'
  assert.deepEqual(show(imp(head + 'Ada,Quiz,5,10\nAda,Quiz,EX,10\nBo,Quiz,1,10\n')), ['Bo 1'])
  assert.deepEqual(show(imp(head + 'Ada,Quiz,EX,10\nAda,Quiz,5,10\n', imp(list('2')))), ['Ada 5'])
  assert.deepEqual(show(imp('Student,Quiz\nPoints Possible,10\nAda,5\nAda,EX\nBo,1\n')), ['Bo 1'])
})

test('item marks touch their own item; a gradebook mark leaves item scores and says so', () => {
  const items = (q: string, std = '') => `student,assessment,standard,item,score,max\nAda,Quiz,${std},${q},10\n`
  const ds = imp(items('Q1,4') + 'Ada,Quiz,,Q2,5,10\nAda,Quiz,x;y,Q3,6,10\nAda,Quiz,z,,7,10\n')
  const left = (text: string) => imp(text, ds).itemScores.map(i => i.item ?? i.std)
  assert.deepEqual(left(items('Q1,EX')), ['Q2', 'Q3:x', 'Q3:y', 'z'])
  assert.deepEqual(left(items('Q3,EX')), ['Q1', 'Q2', 'z'])
  assert.deepEqual(left(items(',EX', 'z')), ['Q1', 'Q2', 'Q3:x', 'Q3:y'])
  assert.deepEqual(left(wide('EX')), ['Q1', 'Q2', 'Q3:x', 'Q3:y', 'z'])
  assert.deepEqual(importEffects(ds, read(wide('EX')).part), { removed: 0, kept: 0, items: 5 })
})
