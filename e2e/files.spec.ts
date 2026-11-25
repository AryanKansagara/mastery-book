import { choose, classWith, expect, handClass, importFile, kind, levels, newClass, pending, points, saved, SCORES, tab, test } from './fixtures'

const formats: { name: string; text: string; detected: string; summary: string; max: [string, string][] }[] = [
  { name: 'classroom.csv', detected: 'Google Classroom grades export', summary: '2 students, 2 assessments, 3 scores', max: [['Quiz 1', '10'], ['Quiz 2', '20']],
    text: 'Last Name,First Name,Email Address,Overall grade,Quiz 1,Quiz 2\nDate,,,,"Sep 5, 2026",9/12/2026\nPoints,,,,10,20\nOkafor,Ada,ada@example.edu,85%,9,15\nNg,Bo,bo@example.edu,,7,Missing\n' },
  { name: 'canvas.csv', detected: 'Canvas gradebook export', summary: '2 students, 2 assessments, 3 scores', max: [['Unit 1 Quiz', '10'], ['Unit 1 Test', '40']],
    text: 'Student,ID,SIS User ID,SIS Login ID,Section,Unit 1 Quiz (48213),Unit 1 Test (48214),Current Score,Final Score\n,,,,,Manual Posting,,,\n    Points Possible,,,,,10.00,40.00,(read only),(read only)\n"Okafor, Ada",3011,S1,ada,P3,8.50,31.00,79,79\n"Ng, Bo",3012,S2,bo,P3,EX,22.00,61,61\n"Student, Test",3099,,x,P3,,,,\n' },
  { name: 'khan.csv', detected: 'Gradebook (one column per assessment)', summary: '2 students, 2 assessments, 3 scores', max: [['Unit rates (Exercise)', '8'], ['Proportional relationships (Quiz)', '100']],
    text: 'Student,Average score,Unit rates (Exercise),Proportional relationships (Quiz),Intro to ratios (Video)\nAda Okafor,81%,7/8,75%,Completed\nBo Ng,60%,--,60%,Not Started\n' },
  { name: 'powerschool.csv', detected: 'PowerSchool-style assignment scores', summary: '2 students, 1 assessments, 2 scores', max: [['Quiz 1', '10']],
    text: 'Student Number,Student Name,Assignment,Due Date,Score,Points Possible\n1,"Okafor, Ada",Quiz 1,9/1/2026,8,10\n2,"Ng, Bo",Quiz 1,9/1/2026,6,10\n' },
  { name: 'wide.csv', detected: 'Gradebook (one column per assessment)', summary: '2 students, 2 assessments, 4 scores', max: [['Quiz 1', '10'], ['Quiz 2', '20']],
    text: '﻿Name,Quiz 1,Quiz 2\r\nPoints Possible,10,20\r\n"Ada ""A"" Okafor",9,18\r\nBo Ng,7,14\r\n' },
  { name: 'list.csv', detected: 'Scores list (one row per score)', summary: '2 students, 1 assessments, 2 scores', max: [['Quiz 1', '10']],
    text: 'student id,student name,assessment,date,score,points possible\n1,Ada,Quiz 1,2026-09-01,8,10\n2,Bo,Quiz 1,2026-09-01,6,10\n' },
  { name: 'semicolon.csv', detected: 'Canvas gradebook export', summary: '1 students, 1 assessments, 1 scores', max: [['Quiz 1', '10']],
    text: 'Student;ID;SIS Login ID;Section;Quiz 1 (501);Current Score\n    Points Possible;;;;10,00;(read only)\n"Okafor, Ada";3011;ada;P3;8,50;85,0\n' },
]
for (const f of formats) test(`import ${f.name}`, async ({ page }) => {
  await newClass(page)
  await choose(page, f)
  await expect(kind(page, f.name)).toHaveText(f.detected)
  await expect(pending(page, f.name)).toContainText(f.summary)
  await pending(page, f.name).getByRole('button', { name: 'Import', exact: true }).click()
  for (const [a, m] of f.max) await expect(points(page, a)).toHaveValue(m)
})

test('item scores, item tags and custom standards', async ({ page }) => {
  await newClass(page)
  await importFile(page, 'scores.csv', 'student id,student name,assessment,date,score,points possible\n1,Ada,Unit 1,2026-09-01,14,20\n')
  await importFile(page, 'mapping.csv', 'assessment,standard,item\nUnit 1,ALG.1,Q1\nUnit 1,ALG.2,Q2\n')
  await importFile(page, 'standards.csv', 'code,description\nALG.1,Writes equations\nALG.2,Reads slope\n')
  await choose(page, { name: 'items.csv', text: 'student id,student name,assessment,item,score,max\n1,Ada,Unit 1,Q1,9,10\n1,Ada,Unit 1,Q2,5,10\n' })
  await expect(kind(page, 'items.csv')).toHaveText('Item scores per standard')
  await pending(page, 'items.csv').getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByRole('rowheader', { name: 'items.csv' })).toBeVisible()
  await tab(page, 'Gradebook')
  // 9/10 = 90% = 4 and 5/10 = 50% = 1; the whole test was 70%. One of two met, D.
  await expect.poll(() => levels(page, 'Ada')).toEqual(['4', '1', 'D'])
  await expect(page.locator('.std-list')).toContainText('Reads slope')
})

test('re-importing the same files changes nothing', async ({ page }) => {
  await handClass(page)
  await tab(page, 'Data & setup')
  await expect(page.locator('.panel', { hasText: 'Imported data' })).toContainText('2 students · 9 scores')
  await importFile(page, 'scores2.csv', SCORES)
  await expect(page.locator('.panel', { hasText: 'Imported data' })).toContainText('2 students · 9 scores')
  await tab(page, 'Gradebook')
  expect(await levels(page, 'Bo Ng')).toEqual(['2', '1', 'F'])
})

test('excused and missing are not zeros, and bad scores are reported by line', async ({ page }) => {
  await newClass(page)
  await choose(page, { name: 'x.csv', text: 'Student,Quiz 1\nPoints Possible,10\nAda,9\nBo,EX\nCy,Missing\nDi,banana\n' })
  const p = pending(page, 'x.csv')
  await expect(p).toContainText('line 6')
  await expect(p).toContainText('"banana" under "Quiz 1" is not a score; ignored.')
  await expect(p).toContainText('1 "missing" marks are not counted as evidence')
  await expect(p).toContainText('1 excused marks ignored.')
  await p.getByRole('button', { name: 'Cancel' }).click()
  await importFile(page, 'x.csv', 'Student,Quiz 1\nPoints Possible,10\nAda,9\nBo,EX\n')
  await importFile(page, 'm.csv', 'assessment,standard\nQuiz 1,7.EE.A.1\n')
  await tab(page, 'Gradebook')
  expect(await levels(page, 'Bo')).toEqual(['·', '—'])
})

test.describe('files that hold no gradebook', () => {
  for (const [name, buffer, message] of [
    ['empty.csv', Buffer.from(''), 'empty.csv has no data rows.'],
    ['blank.csv', Buffer.from('\n\n  \n'), 'blank.csv has no data rows.'],
    ['header.csv', Buffer.from('Student,Quiz 1\n'), 'header.csv has no data rows.'],
    ['book.xlsx', Buffer.from('PK\u0003\u0004'), 'book.xlsx: save the sheet as CSV first'],
  ] as const) test(name, async ({ page }) => {
    await newClass(page)
    await choose(page, { name, buffer })
    await expect(page.getByText(message)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
  })
  for (const [name, text, message] of [
    ['html.csv', '<!doctype html>\n<html><body>Sign in</body></html>\n', 'No student name or ID; row skipped.'],
    ['binary.csv', '\x89PNG\r\n\x1a\n\0\0IHDR\n,3,4\n', 'No student name or ID; row skipped.'],
    ['unrelated.csv', 'sku,price\nA1,4.50\nA2,9.99\n', 'No student name or ID; row skipped.'],
    ['allbad.csv', 'student id,assessment,score,points possible\n1,Quiz,banana,10\n2,Quiz,8,zero\n', '"banana" is not a score; row skipped.'],
    ['nocolumns.csv', 'Student,Email\nAda,a@x.org\n', 'No assessment columns found.'],
    ['noscores.csv', 'Student,Quiz 1\nAda,\nBo,\n', 'has no scores'],
  ] as const) test(name, async ({ page }) => {
    await newClass(page)
    await choose(page, { name, text })
    await expect(pending(page, name)).toContainText(message)
    await expect(pending(page, name).getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
  })
})

test('heatmap CSV and XLSX', async ({ page }) => {
  await handClass(page)
  const csv = await saved(page, () => page.getByRole('button', { name: 'Download CSV' }).click())
  expect(csv.name).toBe('class-1-heatmap.csv')
  expect(csv.text).toBe('﻿Student,7.EE.A.1,7.EE.B.4,Standards met,Letter\nAda Okafor,3,3,2/2,A\nBo Ng,2,1,0/2,F\nClass: % proficient,50%,50%,,\n')
  const x = await saved(page, () => page.getByRole('button', { name: 'Download XLSX' }).click())
  expect(x.buffer.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004')
  expect(x.text).toMatch(/<c r="A3"[^>]*><is><t[^>]*>Bo Ng<\/t>/)
  expect(x.text).toMatch(/<c r="B3" s="\d+"><v>2<\/v>/)
  expect(x.text).toContain('Method comparison')
})

test('mapping and normalized score downloads', async ({ page }) => {
  await handClass(page)
  await tab(page, 'Data & setup')
  const m = await saved(page, () => page.getByRole('button', { name: 'Download mapping CSV' }).click())
  expect(m.text).toContain('Retake,7.EE.B.4,2026-09-27,20,Unit test\n')
  const s = await saved(page, () => page.getByRole('button', { name: 'Download normalized scores' }).click())
  expect(s.text.trim().split('\n')).toHaveLength(10)
  expect(s.text).toContain('Ada Okafor,Quiz 1,2026-09-01,,5,10')
})

test('templates are accepted by the importer', async ({ page }) => {
  await newClass(page)
  for (const [name, detected] of [['mapping-template.csv', 'Assessment to standard mapping'], ['item-scores-template.csv', 'Item scores per standard'], ['scores-template.csv', 'Scores list (one row per score)']] as const) {
    const f = await saved(page, () => page.getByRole('button', { name, exact: true }).click())
    await choose(page, { name, text: f.text })
    await expect(kind(page, name)).toHaveText(detected)
    await expect(pending(page, name).getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
  }
})

test('the sample gradebook and mapping can be dropped back in', async ({ page }) => {
  await page.goto('/app?sample=alg1')
  await tab(page, 'Data & setup')
  const g = await saved(page, () => page.getByRole('button', { name: 'Download the sample gradebook' }).click())
  const m = await saved(page, () => page.getByRole('button', { name: 'its mapping' }).click())
  await importFile(page, 'g.csv', g.text)
  await importFile(page, 'm.csv', m.text)
  await tab(page, 'Gradebook')
  await expect(page.locator('table.heatmap tbody tr')).toHaveCount(24)
  await expect(page.locator('th.hm-std')).toHaveCount(8)
})

test('JSON export holds the class', async ({ page }) => {
  await handClass(page)
  await page.goto('/settings')
  const f = await saved(page, () => page.getByRole('button', { name: 'Export all my data (JSON)' }).click())
  const j = JSON.parse(f.text)
  expect(j.app).toBe('mastery-book')
  expect(j.projects[0].dataset.students.map((s: { name: string }) => s.name)).toEqual(['Ada Okafor', 'Bo Ng'])
  expect(j.projects[0].dataset.scores).toHaveLength(9)
})

test('level-scored class is read as levels', async ({ page }) => {
  await classWith(page, 'Student,Check 1\nPoints Possible,4\nAda,3\nBo,2\n', 'assessment,standard\nCheck 1,F-IF.A.1\n')
  expect((await levels(page, 'Ada'))[0]).toBe('3')
  expect((await levels(page, 'Bo'))[0]).toBe('2')
})
