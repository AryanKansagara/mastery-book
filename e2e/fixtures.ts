import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/** Every test blocks requests outside the app's own origin and fails on an uncaught page error. */
export const test = base.extend<{ guard: void }>({
  guard: [async ({ page, baseURL }, use) => {
    const errors: string[] = []
    const blocked: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route(url => /^https?:$/.test(url.protocol) && url.origin !== baseURL, route => {
      blocked.push(route.request().url())
      return route.abort()
    })
    await use()
    expect(errors).toEqual([])
    // Only the Google Fonts stylesheet is ever asked for; no gradebook data or sync host is contacted while signed out.
    expect(blocked.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u))).toEqual([])
  }, { auto: true }],
})
export { expect }

export type File = { name: string; text?: string; buffer?: Buffer }

export async function newClass(page: Page) {
  await page.goto('/app')
  await page.getByRole('button', { name: /^(New class|Import your data)$/ }).click()
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible()
}

export async function choose(page: Page, ...files: File[]) {
  await page.locator('.drop input[type=file]').setInputFiles(files.map(f => ({ name: f.name, mimeType: 'text/csv', buffer: f.buffer ?? Buffer.from(f.text!) })))
}

export const pending = (page: Page, name: string): Locator => page.locator('.panel').filter({ has: page.getByRole('heading', { name, exact: true }) })

export const kind = (page: Page, name: string) => pending(page, name).locator('select').first().locator('option:checked')

export async function importFile(page: Page, name: string, text: string) {
  await choose(page, { name, text })
  await pending(page, name).getByRole('button', { name: 'Import', exact: true }).click()
  await expect(pending(page, name)).toHaveCount(0)
  await expect(page.getByText(`Imported ${name}`)).toBeVisible()
  // The next import starts from what is on screen, so start again from what was stored.
  const id = page.url().match(/\/p\/([\w-]+)/)![1]
  await page.goto(`/app/p/${id}/data`)
  await expect(page.getByRole('rowheader', { name, exact: true })).toBeVisible()
}

export const tab = async (page: Page, name: string) => {
  const link = page.getByRole('navigation', { name: 'Class sections' }).getByRole('link', { name })
  await link.click()
  await expect(link).toHaveAttribute('aria-current', 'page')
}

export const row = (page: Page, student: string) => page.locator('table.heatmap tbody tr').filter({ has: page.locator('th.hm-name', { hasText: new RegExp(`^${student}$`) }) })

/** A student's heatmap row: one entry per standard, then the letter. */
export async function levels(page: Page, student: string) {
  await expect(row(page, student)).toBeVisible()
  return (await row(page, student).locator('td').allTextContents()).map(t => t.trim())
}

export const kpi = (page: Page, label: string | RegExp) => page.locator('.kpi').filter({ has: page.locator('small', { hasText: label }) }).locator('b')

export const points = (page: Page, assessment: string) => page.getByRole('spinbutton', { name: `Points possible for ${assessment}`, exact: true })

export const method = async (page: Page, id: string) => {
  const s = page.getByRole('combobox', { name: 'Calculation method' })
  await s.selectOption(id)
  await expect(s).toHaveValue(id)
}

export async function saved(page: Page, click: () => Promise<void>) {
  const wait = page.waitForEvent('download')
  await click()
  const d = await wait
  const buffer = readFileSync(await d.path())
  return { name: d.suggestedFilename(), buffer, text: buffer.toString('utf8') }
}

/**
 * Worked on paper: 4-point scale (60 / 75 / 90%), decaying average 65%, a reassessment replaces the original.
 * Ada, 7.EE.A.1: 5/10 = 50% = 1, 8/10 = 80% = 3, 9/10 = 90% = 4.
 *   1 x 0.35 + 3 x 0.65 = 2.30, then 2.30 x 0.35 + 4 x 0.65 = 3.405 -> 3. Mean 8/3 = 2.67 -> 3. Recent, highest 4.
 *   Mode: all once, the latest stands = 4. Power law on 1, 3, 4: b = 1.297, ln a = 0.054, at x = 3 that is 4.39, held at 4.
 * Ada, 7.EE.B.4: 12/20 = 60% = 2, replaced by the retake 16/20 = 80% = 3. Two of two met, none below 2: A.
 * Bo, 7.EE.A.1: 9/10 = 4, 6/10 = 2, 5/10 = 1. 4 x 0.35 + 2 x 0.65 = 2.70, 2.70 x 0.35 + 1 x 0.65 = 1.595 -> 2 (1 rounded down).
 * Bo, 7.EE.B.4: 10/20 = 50% = 1. None of two met: F. Class: 2 of 4 = 50%, and 50% on each standard.
 */
export const SCORES = `Student ID,Student Name,Quiz 1,Quiz 2,Quiz 3,Unit test,Retake
Date,,2026-09-01,2026-09-08,2026-09-15,2026-09-20,2026-09-27
Points Possible,,10,10,10,20,20
S1,Ada Okafor,5,8,9,12,16
S2,Bo Ng,9,6,5,10,
`
export const MAPPING = `assessment,standard,reassessment of
Quiz 1,7.EE.A.1,
Quiz 2,7.EE.1,
Quiz 3,CCSS.MATH.CONTENT.7.EE.A.1,
Unit test,7.EE.B.4,
Retake,7.EE.B.4,Unit test
`
export async function handClass(page: Page) {
  await newClass(page)
  await importFile(page, 'scores.csv', SCORES)
  await importFile(page, 'mapping.csv', MAPPING)
  await tab(page, 'Gradebook')
}

/** Imports a gradebook, tags its assessments and opens the heatmap. */
export async function classWith(page: Page, scores: string, mapping: string) {
  await newClass(page)
  await importFile(page, 'scores.csv', scores)
  await importFile(page, 'mapping.csv', mapping)
  await tab(page, 'Gradebook')
}
