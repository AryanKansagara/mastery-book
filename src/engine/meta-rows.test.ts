import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, parseCsv, validate } from './csv.ts'

const run = (text: string) => {
  const csv = parseCsv(text)
  const kind = detectKind(csv.rows[0], csv.rows)
  const { part } = validate(csv, kind, autoMap(csv.rows[0], kind))
  return { names: part.students!.map(s => s.name), max: part.assessments!.map(a => a.max), dates: part.assessments!.map(a => a.date) }
}

test('students named Max or Date are students', () => {
  assert.deepEqual(run('Last Name,First Name,Email Address,Quiz 1,Quiz 2\nPoints,,,10,20\nOkafor,Ada,a@x.org,9,18\nRuiz,Max,m@x.org,4,6\nDate,Aiko,d@x.org,5,7\n'),
    { names: ['Ada Okafor', 'Max Ruiz', 'Aiko Date'], max: [10, 20], dates: ['', ''] })
  assert.deepEqual(run('Name,Quiz 1\nPoints Possible,10\nMax,10\nAda,9\n').names, ['Max', 'Ada'])
  assert.deepEqual(run('Name,Quiz 1\nAda,9\nMax,9.5\n').names, ['Ada', 'Max'])
  assert.deepEqual(run('Name,Quiz 1\nMax,4\nAda,9\n').names, ['Max', 'Ada'])
  assert.deepEqual(run('First Name,Last Name,Email,Quiz 1\nMax,Ruiz,m@x.org,10\nAda,Okafor,a@x.org,9\n').names, ['Max Ruiz', 'Ada Okafor'])
})

test('points and date rows still work in every layout', () => {
  assert.deepEqual(run('Name,Quiz 1\nMax,10\nAda,11\n').max, [10])
  assert.deepEqual(run('Name,Quiz 1\nMax,10\nAda,9\n'), { names: ['Ada'], max: [10], dates: [''] })
  assert.deepEqual(run('Student ID,Student Name,Quiz 1\nDate,,2026-09-01\nMax,,10\nS1,Ada,9\n'), { names: ['Ada'], max: [10], dates: ['2026-09-01'] })
  assert.deepEqual(run('Last Name,First Name,Email Address,Quiz 1\nDate,,,"Sep 5, 2026"\nPoints,,,10\nOkafor,Ada,a@x.org,9\nClass average,,,9\n'), { names: ['Ada Okafor'], max: [10], dates: ['2026-09-05'] })
})
