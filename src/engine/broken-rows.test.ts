import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, parseCsv, validate } from './csv.ts'

const run = (text: string) => {
  const csv = parseCsv(text)
  const kind = detectKind(csv.rows[0], csv.rows)
  const v = validate(csv, kind, autoMap(csv.rows[0], kind))
  return { v, names: v.part.students?.map(s => s.name) ?? [], errors: v.issues.filter(i => i.level === 'error').map(i => i.line) }
}

test('a quote left open stops the import and names its line', () => {
  for (const [text, line] of [
    ['Student Name,Quiz 1\nBo,7\n"Okafor, Ada,8\nCy,5\n', 3],
    ['Student Name,Quiz 1\n"Okafor, Ada,8\n"Ng, Bo",7\nCy,5\n', 2],
    ['Student Name,Quiz 1\nBo,"7', 2],
    ['Student Name,"Quiz 1\nBo,7\n', 1],
  ] as const) {
    const { v, errors } = run(text)
    assert.deepEqual(errors, [line], text)
    assert.equal(v.used, 0)
    assert.deepEqual(v.part, {})
  }
})

test('proper quotes are unaffected', () => {
  assert.deepEqual(run('Student Name,Quiz 1\n"Ada ""A"" Okafor",8\n"Line\nbreak",7\n"Bo" Ng,6\n"Cy"\n').names, ['Ada "A" Okafor', 'Line\nbreak', 'Bo Ng', 'Cy'])
})

test('rows with more values than columns are skipped, trailing empty cells are not', () => {
  const { names, errors, v } = run('Student Name,Quiz 1,Quiz 2\nOkafor, Ada,8,9\nBo,7,6,,\nCy,8,5,9\n')
  assert.deepEqual(names, ['Bo'])
  assert.deepEqual(errors, [2, 4])
  assert.equal(v.skipped, 2)
  assert.deepEqual(run('assessment,standard\nQuiz 1,7.EE.A.1\nQuiz, 2,7.EE.A.1\n').errors, [3])
})

test('a file that stops inside its last row does not score it', () => {
  assert.deepEqual(run('Student Name,Quiz 1,Quiz 2\nAda,85,90\nBo,8').names, ['Ada'])
  assert.deepEqual(run('student id,student name,assessment,score,points possible\n1,Ada,Quiz,85,100\n2,Bo,Quiz,8').errors, [3])
  // Complete last rows, short rows that end normally, and files that leave out trailing blanks are fine.
  assert.deepEqual(run('Student Name,Quiz 1,Quiz 2\nAda,85,90\nBo,8,7').names, ['Ada', 'Bo'])
  assert.deepEqual(run('Student Name,Quiz 1,Quiz 2\nAda,85,90\nBo,8\n').names, ['Ada', 'Bo'])
  assert.deepEqual(run('Student Name,Quiz 1,Quiz 2\nAda,85\nBo,8').names, ['Ada', 'Bo'])
})
