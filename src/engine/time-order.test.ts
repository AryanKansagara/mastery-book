import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyReassess, calc, cellFor, chronological, defaultConfig, evidenceFor } from './mastery.ts'
import { generate } from './sample.ts'
import type { Dataset, Evidence } from './types.ts'

const cols = (...dates: string[]) => dates.map((date, i) => ({ n: i + 1, date, order: i }))
const seq = (...dates: string[]) => chronological(cols(...dates)).map(x => x.n).join('')

test('undated assessments keep their column place among dated ones', () => {
  assert.equal(seq('', '', '2026-09-30'), '123')
  assert.equal(seq('2026-09-01', '', '2026-09-30'), '123')
  assert.equal(seq('2026-09-30', '', '2026-09-01'), '312')
  assert.equal(seq('2026-09-01', '', ''), '123')
  assert.equal(seq('', '', ''), '123')
  assert.equal(seq('2026-09-03', '2026-09-01', '2026-09-02'), '231')
})

test('evidence follows that order, so the newest score is the last column', () => {
  const ds: Dataset = {
    students: [{ id: 's', name: 'Ada' }],
    assessments: cols('', '', '2026-09-30').map(c => ({ id: `q${c.n}`, name: `Quiz ${c.n}`, date: c.date, order: c.order, max: 10, standards: ['x'] })),
    scores: [5, 5, 10].map((pts, i) => ({ s: 's', a: `q${i + 1}`, pts })), itemScores: [],
  }
  const e = evidenceFor(ds, defaultConfig()).get('s')!.get('x')!
  assert.deepEqual(e.map(x => x.value), [1, 1, 4])
  assert.equal(calc(e.map(x => x.value), 'recent'), 4)
})

const ev = (a: string, value: number, order: number, reassessOf?: string): Evidence => ({ a, name: a, date: '', order, value, reassessOf })

test('a reassessment link holds when the retake sorts first', () => {
  const list = [ev('r', 4, 0, 'q'), ev('q', 1, 1)]
  assert.deepEqual(applyReassess(list, 'replace').map(e => [e.a, e.value]), [['r', 4]])
  assert.equal(applyReassess(list, 'average')[0].value, 2.5)
  assert.equal(applyReassess(list, 'highest')[0].value, 4)
  assert.equal(applyReassess(list, 'keep').length, 2)
  assert.deepEqual(applyReassess([ev('r2', 3, 0, 'r1'), ev('r1', 2, 1, 'q'), ev('q', 1, 2)], 'replace').map(e => e.value), [3])
})

test('links that go in a circle or point at themselves or nowhere behave as before', () => {
  assert.equal(applyReassess([ev('a', 1, 0, 'a')], 'replace').length, 1)
  assert.equal(applyReassess([ev('a', 1, 0, 'gone')], 'replace').length, 1)
  assert.deepEqual(applyReassess([ev('a', 1, 0, 'b'), ev('b', 2, 1, 'a')], 'replace').map(e => e.value), [2])
})

test('fully dated classes are unchanged', () => {
  const ds = generate('grade7'), cfg = defaultConfig()
  for (const m of evidenceFor(ds, cfg).values()) for (const l of m.values()) {
    assert.deepEqual(l.map(e => e.date), l.map(e => e.date).sort())
    assert.ok(cellFor(l, cfg))
  }
})
