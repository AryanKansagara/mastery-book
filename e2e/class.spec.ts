import { expect, handClass, kpi, levels, method, points, row, saved, tab, test } from './fixtures'

test('hand-worked class: levels, letters and totals', async ({ page }) => {
  await handClass(page)
  expect(await levels(page, 'Ada Okafor')).toEqual(['3', '3', 'A'])
  expect(await levels(page, 'Bo Ng')).toEqual(['2', '1', 'F'])
  await expect(kpi(page, 'Student-standards at Proficient')).toHaveText('50%')
  await expect(kpi(page, 'Standards under 60% proficient')).toHaveText('2')
  await expect(kpi(page, 'replaced score')).toHaveText('1')
  await expect(row(page, 'Ada Okafor').locator('td').first()).toHaveAttribute('title', /Proficient \(3\.4\d? from 3 scores\)/)
  await expect(row(page, 'Bo Ng').locator('td').first()).toHaveAttribute('title', /Developing \(1\.6 from 3 scores\)|Developing \(1\.59 from 3 scores\)/)
})

test('cell evidence lists every score, the replaced one and what each method says', async ({ page }) => {
  await handClass(page)
  await row(page, 'Ada Okafor').locator('td').nth(0).click()
  const d = page.getByRole('dialog')
  await expect(d.locator('.method-chips .chip')).toHaveText(['Recent 4', 'Decaying 3', 'Power law 4', 'Mean 3', 'Highest 4', 'Mode 4', 'Recent N 3'])
  await expect(d).toContainText('Start at 1, then each new score counts 65% and the running value 35%: 3 → 4 gives 3.4')
  await expect(d.getByRole('link', { name: /Khan Academy/ })).toHaveAttribute('href', /^https:\/\/www\.khanacademy\.org\/search\?page_search_query=7\.EE\.A\.1/)
  await d.getByRole('button', { name: 'Close' }).click()
  await row(page, 'Ada Okafor').locator('td').nth(1).click()
  await expect(d.getByRole('row', { name: /^Unit test/ })).toContainText('Replaced by a reassessment')
  await expect(d.getByRole('row', { name: /Retake/ })).toContainText('Yes, replaces Unit test')
})

test('changing method, rounding and reassessment rule changes the results, and they survive a reload', async ({ page }) => {
  await handClass(page)
  await method(page, 'recent')
  await expect.poll(() => levels(page, 'Bo Ng')).toEqual(['1', '1', 'F'])
  await method(page, 'highest')
  // Bo: 4 and 1, one of two met = 50%: D.
  await expect.poll(() => levels(page, 'Bo Ng')).toEqual(['4', '1', 'D'])
  await method(page, 'decaying')
  await tab(page, 'Compare methods')
  await page.getByLabel('Rounding to a level').selectOption('down')
  await page.getByLabel('Reassessments').selectOption('keep')
  await tab(page, 'Gradebook')
  // 1.595 rounds down to 1; Ada keeps 2 then 3: 2 x 0.35 + 3 x 0.65 = 2.65, down to 2, one of two met: D.
  await expect.poll(() => levels(page, 'Bo Ng')).toEqual(['1', '1', 'F'])
  await expect.poll(() => levels(page, 'Ada Okafor')).toEqual(['3', '2', 'D'])
  await page.reload()
  await expect.poll(() => levels(page, 'Ada Okafor')).toEqual(['3', '2', 'D'])
})

test('comparison table and meeting summary count the letters that move', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await handClass(page)
  await tab(page, 'Compare methods')
  // Ada is an A under every method. Bo is an F, except under Highest: 4 and 1 = 50% = D.
  await expect(page.locator('.cmp-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.cmp-table tbody tr')).toContainText('Bo Ng')
  expect(await page.locator('.cmp-table tbody .letter').allTextContents()).toEqual(['F', 'F', 'F', 'F', 'D', 'F', 'F'])
  await page.getByLabel('Compare with').selectOption('highest')
  await expect(page.locator('.banner')).toContainText('1 of 2 students')
  await page.getByRole('button', { name: 'Copy summary for the meeting' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Highest: 1 A, 0 B, 0 C, 1 D, 0 F (1 letters differ from Decaying average (65%))')
  expect(text).toContain('1 students would get a different letter')
})

test('reteach groups hold the student below proficient, and the plans download', async ({ page }) => {
  await handClass(page)
  await tab(page, 'Reteach groups')
  await expect(page.locator('.group-card')).toHaveCount(1)
  await expect(page.locator('.group-card')).toContainText('Bo Ng')
  await expect(page.locator('.group-card li')).toHaveCount(2)
  await expect(page.locator('.panel.tint')).toContainText('On track (1)')
  await expect(page.locator('.panel.tint')).toContainText('Ada Okafor')
  const f = await saved(page, () => page.getByRole('button', { name: 'Download plans' }).click())
  expect(f.text).toContain('Reteach group 1 (1 students): Bo Ng')
  expect(f.text).toContain('7.EE.B.4')
})

test('student explainer says why and what comes next', async ({ page }) => {
  await handClass(page)
  await row(page, 'Bo Ng').getByRole('button', { name: 'Bo Ng' }).click()
  await expect(page.locator('.big-letter')).toHaveText('F')
  await expect(page.locator('.explainer')).toContainText('0 of 2 standards are at Proficient or above (0%); the lowest is level 1')
  // D needs 40% of 2 = 0.8, so one standard.
  await expect(page.locator('.banner.good')).toContainText('To reach D: 1 more standard at Proficient or above.')
  await page.getByLabel('Find a student').fill('ada')
  await page.locator('.student-list').getByRole('button', { name: /Ada Okafor/ }).click()
  await expect(page.locator('.big-letter')).toHaveText('A')
  await expect(page.locator('.ev.dropped')).toHaveCount(1)
})

test('family reports: one page per student in plain words', async ({ page }) => {
  await handClass(page)
  await page.getByRole('link', { name: 'Family reports' }).click()
  await expect(page.locator('.family-report')).toHaveCount(2)
  const bo = page.locator('.family-report').filter({ has: page.getByRole('heading', { name: 'Bo Ng' }) })
  await expect(bo.locator('.fr-grade')).toContainText('F')
  await expect(bo.locator('.fr-summary')).toContainText('Bo has shown proficient work or better on 0 of 2 skills')
  await expect(bo).toContainText('is just starting to work with this skill')
  await expect(page.locator('.family-report').first().locator('.fr-summary')).toContainText('2 of 2 skills')
})

test('snapshots freeze a date and compare', async ({ page }) => {
  await handClass(page)
  const save = async (label: string, date: string) => {
    await page.getByRole('button', { name: 'Save snapshot' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Label').fill(label)
    await d.getByLabel('Evidence up to').fill(date)
    await d.getByRole('button', { name: 'Save snapshot' }).click()
    await expect(page.getByText(`Saved “${label}”`)).toBeVisible()
  }
  // Up to 8 Sept: Ada 1 then 3 = 2.30 -> 2 (F); Bo 4 then 2 = 2.70 -> 3 (one of one, A).
  await save('Early', '2026-09-08')
  await save('Late', '2026-09-30')
  await tab(page, 'History')
  await expect(page.getByRole('row', { name: /^Early/ })).toContainText('50%')
  await expect(kpi(page, 'Letters up')).toHaveText('1')
  await expect(kpi(page, 'Letters down')).toHaveText('1')
  await expect(kpi(page, 'Unchanged')).toHaveText('0')
  await page.getByRole('row', { name: /^Late/ }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Save a second snapshot to compare terms.')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).last().click()
  await expect(kpi(page, 'Letters up')).toHaveText('1')
})

test('letter rule: average level', async ({ page }) => {
  await handClass(page)
  await tab(page, 'Data & setup')
  await page.getByRole('radio', { name: 'Average level' }).click()
  await tab(page, 'Gradebook')
  // Ada (3 + 3) / 2 = 3.0: B. Bo (2 + 1) / 2 = 1.5: F.
  await expect.poll(() => levels(page, 'Ada Okafor')).toEqual(['3', '3', 'B'])
  await expect.poll(() => levels(page, 'Bo Ng')).toEqual(['2', '1', 'F'])
})

test('edits on the Assessments panel change the result and persist', async ({ page }) => {
  await handClass(page)
  await tab(page, 'Data & setup')
  // Quiz 3 out of 12: Ada 9/12 = 75% = 3. 2.30 x 0.35 + 3 x 0.65 = 2.755 -> 3. Bo 5/12 = 42% = 1.
  await points(page, 'Quiz 3').fill('12')
  await expect(points(page, 'Quiz 3')).toHaveValue('12')
  await page.getByRole('button', { name: 'Remove 7.EE.B.4 from Retake' }).click()
  await expect(page.getByRole('button', { name: 'Remove 7.EE.B.4 from Retake' })).toHaveCount(0)
  await page.reload()
  await expect(points(page, 'Quiz 3')).toHaveValue('12')
  await tab(page, 'Gradebook')
  // Without the retake Ada is back to 12/20 = 2 on B.4: one of two, D.
  expect(await levels(page, 'Ada Okafor')).toEqual(['3', '2', 'D'])
  await expect(row(page, 'Ada Okafor').locator('td').first()).toHaveAttribute('title', /\(2\.7[56] from/)
})
