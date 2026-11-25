import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, csvCell, detectKind, mergeDataset, parseCsv, toCsv, validate } from './csv.ts'
import { defaultConfig, matrix } from './mastery.ts'
import { heatmapCsv } from './report.ts'
import type { Dataset } from './types.ts'

const EMPTY: Dataset = { students: [], assessments: [], scores: [], itemScores: [] }
const imp = (text: string) => { const csv = parseCsv(text); const kind = detectKind(csv.rows[0], csv.rows); return mergeDataset(EMPTY, validate(csv, kind, autoMap(csv.rows[0], kind)).part) }
const NAMES = ['=1+1', '+1', '-1+2', '@SUM(1+1)', '=HYPERLINK("https://example.test")', "'=x", "''=x", "O'Brien", "'quoted'", '-', '＝1+1', 'Ada']
const live = (text: string) => parseCsv(text).rows.flat().filter(c => /^[=+\-@\t\r＝＋－＠]/.test(c) && !/^-?\d+(\.\d+)?$/.test(c))

test('text that starts like a formula is neutralised; numbers stay numbers', () => {
  assert.deepEqual(['=1', '+1', '-1', '@a', '\ta', '\ra'].map(csvCell), ["'=1", "'+1", "'-1", "'@a", "'\ta", '"\'\ra"'])
  assert.deepEqual([-3, 2.5, 0, null, undefined, '3/4', 'A-', '—', "O'Brien"].map(csvCell), ['-3', '2.5', '0', '', '', '3/4', 'A-', '—', "O'Brien"])
})

test('names survive a round trip, as students and as assessments', () => {
  const gradebook = toCsv([['Student ID', 'Student Name', ...NAMES], ['Points Possible', '', ...NAMES.map(() => 10)], ...NAMES.map((n, i) => [`S${i}`, n, ...NAMES.map(() => 9)])])
  assert.deepEqual(live(gradebook), [])
  const ds = imp(gradebook)
  assert.deepEqual([ds.students.map(s => s.name), ds.assessments.map(a => a.name)], [NAMES, NAMES])
  const mapping = toCsv([['assessment', 'standard', 'item', 'reassessment of'], ...NAMES.map(n => [n, '-x', n, '=1+1'])])
  assert.deepEqual(live(mapping), [])
  const m = imp(mapping)
  assert.deepEqual([m.assessments.map(a => a.name), m.assessments.map(a => Object.keys(a.items!)[0]), m.assessments[1].reassessOf, m.assessments[0].standards], [NAMES, NAMES, m.assessments[0].id, ['-x']])
  const list = imp(toCsv([['student name', 'assessment', 'score', 'max'], ...NAMES.map(n => [n, n, 9, 10])]))
  assert.deepEqual([list.students.map(s => s.name), list.assessments.map(a => a.name)], [NAMES, NAMES])
  assert.deepEqual(live(heatmapCsv(matrix(ds, defaultConfig()), defaultConfig())), [])
})
