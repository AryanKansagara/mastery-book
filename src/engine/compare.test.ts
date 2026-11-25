import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultConfig } from './mastery.ts'
import { compareSnapshots, type Snapshot } from './report.ts'

const snap = (letters: Record<string, string>): Snapshot => ({ id: 'x', label: '', date: '', at: 0, method: 'recent', standards: [], share: 0, rows: Object.entries(letters).map(([sid, letter]) => ({ sid, letter, levels: {} })) })

test('every student is counted once, and only the same letter in both is unchanged', () => {
  const d = compareSnapshots(
    snap({ same: 'B', up: 'C', down: 'A', gone: 'A', first: '—', renamed: 'B+', none: '—', lost: 'B' }),
    snap({ same: 'B', up: 'B', down: 'D', fresh: 'A', first: 'A', renamed: 'A', none: '—', lost: '—' }), defaultConfig())
  assert.deepEqual([d.same, d.up, d.down, d.other, d.added, d.removed], [2, 1, 1, 3, ['fresh'], ['gone']])
})
