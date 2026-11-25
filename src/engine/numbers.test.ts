import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, parseCsv, parseScore, validate } from './csv.ts'

const read = (text: string) => { const csv = parseCsv(text); const kind = detectKind(csv.rows[0], csv.rows); return validate(csv, kind, autoMap(csv.rows[0], kind)) }
const pts = (raw: string, semi = false) => { const p = parseScore(raw, semi); return p.kind === 'pts' ? p.max ? `${p.pts}/${p.max}` : p.pts : p.kind === 'pct' ? `${p.pct}` : p.kind }

test('numbers that are not scores', () => {
  for (const s of ['1,2,3', '12,345,6', '0x10', '1e2', '-3', '8/0', '0/0', '-1/5', '-5%', '1.2.3', '1,25,000', '0b1', '(3)', '1/2/3', '/5', '%', ',5']) assert.equal(pts(s), 'bad', s)
})

test('commas and points', () => {
  for (const [s, n] of [['8,5', 8.5], ['1,250', 1250], ['1,250.5', 1250.5], ['1,250,000', 1250000], ['1.250,5', 1250.5], ['0,333', 0.333], ['1234,567', 1234.567], ['8.', 8], ['.5', 0.5], ['+5', 5], ['8/10', '8/10'], ['8,5 / 10', '8.5/10'], ['85,5%', '0.855']] as const) assert.equal(pts(s), n, s)
  for (const [s, n] of [['8,333', 8.333], ['1,250', 1.25], ['1.250,5', 1250.5], ['1.250', 1.25], ['1,250.5', 1250.5], ['6,333/10', '6.333/10']] as const) assert.equal(pts(s, true), n, s)
})

test('a semicolon file uses decimal commas for scores and points', () => {
  const v = read('Student;Quiz\nPoints Possible;10,000\nAda;8,333\n')
  assert.deepEqual([v.part.scores![0].pts, v.part.assessments![0].max], [8.333, 10])
})

test('a score far above the points possible names its line', () => {
  const far = (t: string) => read(t).issues.filter(i => /far above/.test(i.message)).map(i => i.line)
  assert.deepEqual(far('Student,Quiz\nPoints Possible,10\nAda,95\nBo,15\nCy,16/10\n'), [3, 5])
  assert.deepEqual(far('student,assessment,score,max\nAda,Quiz,15,10\nBo,Quiz,16,10\n'), [3])
  assert.deepEqual(far('student,assessment,item,score,max\nAda,Quiz,Q1,9,5\n'), [2])
})
