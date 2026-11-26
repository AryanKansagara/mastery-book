import { choose, classWith, expect, importFile, kpi, levels, method, newClass, pending, points, row, saved, tab, test } from './fixtures'

// Each test states the right behaviour. `test.fail` pins an open issue; its fix turns the line into a normal test.

test('#2 a student named Max is a student', async ({ page }) => {
  await newClass(page)
  await choose(page, { name: 'max.csv', text: 'Last Name,First Name,Email Address,Quiz 1,Quiz 2\nPoints,,,10,20\nOkafor,Ada,a@x.org,9,18\nRuiz,Max,m@x.org,4,6\n' })
  await expect(pending(page, 'max.csv')).toContainText('2 students, 2 assessments, 4 scores')
  await pending(page, 'max.csv').getByRole('button', { name: 'Import', exact: true }).click()
  await expect(points(page, 'Quiz 1')).toHaveValue('10')
})

test.fail('#3 an unclosed quote stops the import', async ({ page }) => {
  await newClass(page)
  await choose(page, { name: 'q.csv', text: 'Student Name,Quiz 1,Quiz 2\nBo,7,6\n"Okafor, Ada,8,9\nCy,5,4\n' })
  await expect(pending(page, 'q.csv')).toContainText('line 3')
  await expect(pending(page, 'q.csv').getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
})

test.fail('#3 rows with extra values or a cut-off end are reported, not scored', async ({ page }) => {
  await newClass(page)
  await choose(page, { name: 'w.csv', text: 'Student Name,Quiz 1,Quiz 2\nOkafor, Ada,8,9\nBo,7,6\nCy,8' })
  await expect(pending(page, 'w.csv')).toContainText('1 students, 2 assessments, 2 scores')
  await expect(pending(page, 'w.csv')).toContainText('2 skipped')
})

test.fail('#4 same-named Canvas assignments stay separate', async ({ page }) => {
  await newClass(page)
  await choose(page, { name: 'd.csv', text: 'Student,ID,SIS User ID,SIS Login ID,Section,Exit ticket (501),Exit ticket (502)\n    Points Possible,,,,,5,10\n"Okafor, Ada",1,S1,ada,P3,5,2\n' })
  await expect(pending(page, 'd.csv')).toContainText('1 students, 2 assessments, 2 scores')
  await pending(page, 'd.csv').getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.locator('.assess-table tbody tr')).toHaveCount(2)
})

test.fail('#4 a repeated student and assessment in a list is reported', async ({ page }) => {
  await newClass(page)
  await choose(page, { name: 'l.csv', text: 'student id,student name,assessment,date,score,points possible\n1,Ada,Exit ticket,2026-09-01,2,10\n1,Ada,Exit ticket,2026-09-08,9,10\n' })
  await expect(pending(page, 'l.csv')).toContainText('line 2')
})

test.fail('#5 each score keeps its own points possible', async ({ page }) => {
  await classWith(page, 'student id,student name,assessment,score,points possible\n1,Ada,Quiz,8,10\n2,Bo,Quiz,16,20\n', 'assessment,standard\nQuiz,7.EE.A.1\n')
  // 8/10 and 16/20 are both 80%.
  expect((await levels(page, 'Ada'))[0]).toBe('3')
  expect((await levels(page, 'Bo'))[0]).toBe('3')
})

test.fail('#5 a percent stays a percent when points possible arrive later', async ({ page }) => {
  await classWith(page, 'Student,Quiz\nAda,80%\n', 'assessment,standard,points possible\nQuiz,7.EE.A.1,40\n')
  expect((await levels(page, 'Ada'))[0]).toBe('3')
})

test.fail('#6 importing the mapping first does not change level scores', async ({ page }) => {
  await newClass(page)
  await importFile(page, 'mapping.csv', 'assessment,standard\nCheck 1,F-IF.A.1\n')
  await importFile(page, 'scores.csv', 'Student,Check 1\nPoints Possible,4\nAda,3\nBo,2\n')
  await tab(page, 'Gradebook')
  expect((await levels(page, 'Bo'))[0]).toBe('2')
})

test.fail('#7 undated work keeps its column place', async ({ page }) => {
  await classWith(page, 'Student,Quiz 1,Quiz 2,Quiz 3\nPoints Possible,10,10,10\nDate,,,9/30/2026\nAda,5,5,10\n', 'assessment,standard\nQuiz 1,7.EE.A.1\nQuiz 2,7.EE.A.1\nQuiz 3,7.EE.A.1\n')
  await method(page, 'recent')
  await expect.poll(async () => (await levels(page, 'Ada'))[0]).toBe('4')
})

test.fail('#7 a retake listed before its original still replaces it', async ({ page }) => {
  await classWith(page, 'Student,Retake,Quiz\nPoints Possible,10,10\nAda,10,5\n', 'assessment,standard,reassessment of\nQuiz,7.EE.A.1,\nRetake,7.EE.A.1,Quiz\n')
  expect((await levels(page, 'Ada'))[0]).toBe('4')
})

test.fail('#8 no evidence is neither on track nor 0%', async ({ page }) => {
  await classWith(page, 'Student,Quiz 1\nPoints Possible,10\nAda,9\nBo,\n', 'assessment,standard\nQuiz 1,7.EE.A.1\nQuiz 9,7.EE.B.4\n')
  await expect(kpi(page, 'Standards under 60% proficient')).toHaveText('0')
  await tab(page, 'Reteach groups')
  await expect(page.locator('.panel.tint')).toContainText('On track (1)')
})

test.fail('#9 a comma in a semicolon file is a decimal mark', async ({ page }) => {
  await classWith(page, 'Student;Quiz 1\nPoints Possible;10\nAda;6,333\n', 'assessment,standard\nQuiz 1,7.EE.A.1\n')
  // 6.333 of 10 = 63% = 2
  expect((await levels(page, 'Ada'))[0]).toBe('2')
})

test.fail('#9 a negative score is not evidence', async ({ page }) => {
  await newClass(page)
  await choose(page, { name: 'n.csv', text: 'Student,Quiz 1\nPoints Possible,10\nAda,9\nBo,-3\n' })
  await expect(pending(page, 'n.csv')).toContainText('1 scores')
})

test.fail('#10 a name that looks like a formula is exported as text', async ({ page }) => {
  await classWith(page, 'Student,Quiz 1\nPoints Possible,10\n=1+1,9\n', 'assessment,standard\nQuiz 1,7.EE.A.1\n')
  const f = await saved(page, () => page.getByRole('button', { name: 'Download CSV' }).click())
  expect(f.text).not.toMatch(/^=/m)
})

test.fail('#11 a score that became excused is removed on re-import', async ({ page }) => {
  await classWith(page, 'Student,Quiz 1\nPoints Possible,10\nAda,2\nBo,9\n', 'assessment,standard\nQuiz 1,7.EE.A.1\n')
  expect((await levels(page, 'Ada'))[0]).toBe('1')
  await tab(page, 'Data & setup')
  await importFile(page, 'again.csv', 'Student,Quiz 1\nPoints Possible,10\nAda,EX\nBo,9\n')
  await tab(page, 'Gradebook')
  expect((await levels(page, 'Ada'))[0]).toBe('·')
})

test.fail('#12 a new student is not "unchanged"', async ({ page }) => {
  await classWith(page, 'Student,Quiz 1\nPoints Possible,10\nAda,9\n', 'assessment,standard\nQuiz 1,7.EE.A.1\n')
  const save = async (label: string) => {
    await page.getByRole('button', { name: 'Save snapshot' }).click()
    await page.getByRole('dialog').getByLabel('Label').fill(label)
    await page.getByRole('dialog').getByRole('button', { name: 'Save snapshot' }).click()
    await expect(page.getByText(`Saved “${label}”`)).toBeVisible()
  }
  await save('One')
  await tab(page, 'Data & setup')
  await importFile(page, 'new.csv', 'Student,Quiz 1\nPoints Possible,10\nBo,9\n')
  await tab(page, 'Gradebook')
  await expect(row(page, 'Bo')).toBeVisible()
  await save('Two')
  await tab(page, 'History')
  await expect(kpi(page, 'Unchanged')).toHaveText('1', { timeout: 5_000 })
})

test.fail('#13 the mapping download keeps item tags', async ({ page }) => {
  await newClass(page)
  await importFile(page, 'scores.csv', 'Student,Unit 1\nPoints Possible,20\nAda,14\n')
  await importFile(page, 'mapping.csv', 'assessment,standard,item\nUnit 1,7.EE.A.1,Q1\nUnit 1,7.EE.B.4,Q2\n')
  const f = await saved(page, () => page.getByRole('button', { name: 'Download mapping CSV' }).click())
  expect(f.text).toMatch(/Q1/)
})

test.fail('#14 an ID-only item file keeps student names', async ({ page }) => {
  await classWith(page, 'student id,student name,assessment,score,points possible\nS1,Ada Okafor,Unit 1,14,20\n', 'assessment,standard,item\nUnit 1,7.EE.A.1,Q1\n')
  await tab(page, 'Data & setup')
  await importFile(page, 'items.csv', 'student id,assessment,item,score,max\nS1,Unit 1,Q1,9,10\n')
  await tab(page, 'Gradebook')
  await expect(row(page, 'Ada Okafor')).toBeVisible()
})
