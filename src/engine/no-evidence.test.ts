import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reteachGroups } from './groups.ts'
import { defaultConfig, matrix } from './mastery.ts'
import type { Dataset } from './types.ts'

const ds = (scores: Dataset['scores']): Dataset => ({
  students: ['Ada', 'Bo', 'Cy'].map(n => ({ id: n, name: n })),
  assessments: [{ id: 'q', name: 'Quiz', date: '', order: 0, max: 10, standards: ['x'] }, { id: 'r', name: 'Ungraded', date: '', order: 1, max: 10, standards: ['y'] }],
  scores, itemScores: [],
})
const names = (l: { name: string }[]) => l.map(x => x.name)
const groups = (scores: Dataset['scores']) => { const g = reteachGroups(matrix(ds(scores), defaultConfig()), defaultConfig()); return { need: g.groups.flatMap(x => names(x.students)), onTrack: names(g.onTrack), none: names(g.noEvidence) } }

test('students without evidence are listed on their own', () => {
  assert.deepEqual(groups([{ s: 'Ada', a: 'q', pts: 9 }]), { need: [], onTrack: ['Ada'], none: ['Bo', 'Cy'] })
  assert.deepEqual(groups([{ s: 'Ada', a: 'q', pts: 9 }, { s: 'Bo', a: 'q', pts: 2 }]), { need: ['Bo'], onTrack: ['Ada'], none: ['Cy'] })
  assert.deepEqual(groups([]), { need: [], onTrack: [], none: ['Ada', 'Bo', 'Cy'] })
})
