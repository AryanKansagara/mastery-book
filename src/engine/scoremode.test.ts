import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCALES } from './mastery.ts'
import { detectScoreMode, notLevels } from './scoremode.ts'
import { generate } from './sample.ts'
import type { Dataset } from './types.ts'

const ds = (...max: number[]): Dataset => ({
  students: [{ id: 's', name: 'S' }],
  assessments: max.map((m, i) => ({ id: `a${i}`, name: `A${i}`, date: '', order: i, max: m, standards: [] })),
  scores: max.map((_, i) => ({ s: 's', a: `a${i}`, pts: 1 })), itemScores: [],
})
const [four, , three] = SCALES

test('levels are out of 4, 5 or the top of the scale', () => {
  assert.equal(detectScoreMode(ds(4, 4), four), 'level')
  assert.equal(detectScoreMode(ds(4, 5), four), 'level')
  assert.equal(detectScoreMode(ds(3), three), 'level')
  for (const m of [1, 2, 3, 10]) assert.equal(detectScoreMode(ds(4, m), four), 'percent')
})

test('only assessments with scores are judged', () => {
  const d = ds(4)
  d.assessments.push({ id: 'm', name: 'From a mapping', date: '', order: 9, max: 0, standards: ['x'] })
  assert.equal(detectScoreMode(d, four), 'level')
  assert.equal(detectScoreMode({ ...d, scores: [] }, four), null)
  assert.deepEqual(notLevels({ ...d, itemScores: [{ s: 's', a: 'a0', std: 'x', pts: 7, max: 10 }] }, four), ['A0'])
})

test('samples keep their modes', () => {
  assert.equal(detectScoreMode(generate('alg1'), four), 'level')
  assert.equal(detectScoreMode(generate('grade7'), four), 'percent')
})
