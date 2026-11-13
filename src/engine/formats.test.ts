// Fixtures follow the column and row layout written by Canvas's GradebookExporter
// (instructure/canvas-lms lib/gradebook_exporter.rb, AGPL; layout only, no code copied).
// Student names and ids are invented.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, parseCsv, parseScore, validate } from './csv.ts'
import { findStandard, normalizeCode } from './standards.ts'

const run = (text: string) => {
  const csv = parseCsv(text)
  const kind = detectKind(csv.rows[0], csv.rows)
  const v = validate(csv, kind, autoMap(csv.rows[0], kind))
  return { kind, v, names: v.part.assessments?.map(a => a.name) ?? [] }
}

// SIS ids on, a "Notes" custom column, a "Manual Posting" row, assignment-group and grading-period totals.
const CANVAS_FULL = [
  'Student,ID,SIS User ID,SIS Login ID,Section,Notes,Unit 1 Quiz (48213),Unit 1 Test (48214),Exit ticket 3 (48220),Assignments Current Score (Q1 2026),Assignments Final Score (Q1 2026),Current Score (Q1 2026),Unposted Current Score (Q1 2026),Final Score (Q1 2026),Unposted Final Score (Q1 2026),Current Grade (Q1 2026),Unposted Current Grade (Q1 2026),Final Grade (Q1 2026),Unposted Final Grade (Q1 2026),Override Score (Q1 2026),Override Grade (Q1 2026)',
  ',,,,,,,Manual Posting,,,,,,,,,,,,,',
  '    Points Possible,,,,,(read only),10.00,40.00,4.00,(read only),(read only),(read only),(read only),(read only),(read only),(read only),(read only),(read only),(read only),,(read only)',
  '"Okafor, Ada",3011,S1001,ada.okafor,Period 3,extra time,8.50,31.00,EX,79.6,79.6,79.6,79.6,79.6,79.6,C+,C+,C+,C+,,',
  '"Ng, Bo",3012,S1002,bo.ng,Period 3,,N/A,22.00,3.00,61.1,61.1,61.1,61.1,61.1,61.1,D-,D-,D-,D-,,',
  '"Student, Test",3099,,b3c1d2,Period 3,,,,,,,,,,,,,,,,',
].join('\n')

test('Canvas export with SIS ids, custom column, Manual Posting row and grading-period totals', () => {
  const { kind, v, names } = run(CANVAS_FULL)
  assert.equal(kind, 'canvas')
  assert.deepEqual(names, ['Unit 1 Quiz', 'Unit 1 Test', 'Exit ticket 3'])
  assert.deepEqual(v.part.assessments!.map(a => a.max), [10, 40, 4])
  assert.deepEqual(v.part.students!.map(s => s.name), ['Ada Okafor', 'Bo Ng'])
  assert.equal(v.part.scores!.length, 4)
  assert.ok(!v.issues.some(i => i.level === 'error'), JSON.stringify(v.issues))
})

test('Canvas export with separate LastName and FirstName columns', () => {
  const text = 'LastName,FirstName,ID,SIS Login ID,Section,Quiz 1 (501),Current Score,Final Score\n    Points Possible,,,,,5.00,(read only),(read only)\nOkafor,Ada,3011,ada.okafor,Period 3,4.00,80,80\n'
  const { kind, v, names } = run(text)
  assert.equal(kind, 'canvas')
  assert.deepEqual(names, ['Quiz 1'])
  assert.deepEqual(v.part.students!.map(s => s.name), ['Ada Okafor'])
  assert.equal(v.part.assessments![0].max, 5)
})

test('Canvas semicolon export with decimal commas (European locale)', () => {
  const text = 'Student;ID;SIS Login ID;Section;Quiz 1 (501);Current Score\n    Points Possible;;;;10,00;(read only)\n"Okafor, Ada";3011;ada;P3;8,50;85,0\n'
  const { v } = run(text)
  assert.equal(v.part.scores![0].pts, 8.5)
  assert.equal(v.part.assessments![0].max, 10)
})

test('Google Classroom export ignores the overall grade and status columns', () => {
  const text = 'Last Name,First Name,Email Address,Overall grade,Quiz 1,Exit ticket\nDate,,,,"Sep 5, 2026","Sep 9, 2026"\nPoints,,,,10,4\nOkafor,Ada,ada@example.edu,85%,9,3\n'
  const { kind, names } = run(text)
  assert.equal(kind, 'google-classroom')
  assert.deepEqual(names, ['Quiz 1', 'Exit ticket'])
})

test('score parsing: decimal comma, thousands separator, Canvas N/A and EX', () => {
  assert.deepEqual(parseScore('8,5'), { kind: 'pts', pts: 8.5 })
  assert.deepEqual(parseScore('1,250'), { kind: 'pts', pts: 1250 })
  assert.equal(parseScore('N/A').kind, 'excused')
  assert.equal(parseScore('EX').kind, 'excused')
})

test('sub-standard codes keep their letter and read the parent description', () => {
  assert.equal(normalizeCode('7.EE.B.4a'), '7.EE.B.4a')
  assert.equal(normalizeCode('7.ee.b.4A'), '7.EE.B.4a')
  assert.equal(normalizeCode('CCSS.MATH.CONTENT.7.EE.B.4.A'), '7.EE.B.4a')
  assert.equal(normalizeCode('CCSS.Math.Content.HSF.IF.C.7.B'), 'F-IF.C.7b')
  assert.equal(normalizeCode('7.EE.4a'), '7.EE.B.4a')
  assert.equal(findStandard('7.EE.B.4a')?.desc, findStandard('7.EE.B.4')?.desc)
  assert.equal(normalizeCode('Fractions target 2'), 'Fractions target 2')
})

// Layout as described in Khan Academy's help center ("How do I download my students' assignment scores"):
// one row per student, one column per assignment, best score for practice, Completed / Not Started for
// videos and articles, "--" when not assigned, optional "Average score" column.
test('Khan Academy assignment scores export', () => {
  const text = 'Student,Average score,Unit rates (Exercise),Proportional relationships (Quiz),Intro to ratios (Video)\nAda Okafor,81%,7/8,75%,Completed\nBo Ng,60%,--,60%,Not Started\n'
  const { kind, v, names } = run(text)
  assert.equal(kind, 'generic-wide')
  assert.deepEqual(names, ['Unit rates (Exercise)', 'Proportional relationships (Quiz)'])
  const a = v.part.assessments!
  assert.equal(a[0].max, 8)
  assert.deepEqual(v.part.scores!.map(s => s.pts), [7, 75, 60])
  assert.ok(!v.issues.some(i => /not a score/.test(i.message)), JSON.stringify(v.issues))
  assert.ok(v.issues.some(i => /Intro to ratios \(Video\)" has no scores/.test(i.message)))
})

test('a column mixing percents and fractions keeps one scale', () => {
  const { v } = run('Student,Quiz\nAda,75%\nBo,7/8\n')
  assert.equal(v.part.assessments![0].max, 100)
  assert.deepEqual(v.part.scores!.map(s => s.pts), [75, 87.5])
})

test('long scores with decimal commas in score and points possible', () => {
  const { kind, v } = run('Student Number;Student Name;Assignment;Due Date;Score;Points Possible\n1001;Okafor, Ada;Quiz 1;05/09/2026;8,5;10,0\n')
  assert.equal(kind, 'powerschool')
  assert.equal(v.part.scores![0].pts, 8.5)
  assert.equal(v.part.assessments![0].max, 10)
  assert.equal(v.part.students![0].name, 'Ada Okafor')
})
