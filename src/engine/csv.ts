import { itemCodes, normalizeCode } from './standards.ts'
import type { Assessment, Dataset, ItemScore, Score, Student } from './types.ts'

export interface Csv {
  rows: string[][]
  lines: number[]
  /** Separated by semicolons, as spreadsheets do where the comma is the decimal mark */
  decimalComma?: boolean
  /** Line where a quote starts that is never closed properly */
  badQuote?: number
  /** The last row ends without a line end */
  openEnd?: boolean
}

export function parseCsv(text: string): Csv {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const delim = sniffDelimiter(text)
  const rows: string[][] = []
  const lines: number[] = []
  let row: string[] = [], field = '', quoted = false, line = 1, rowLine = 1, quoteLine = 0, badQuote = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else {
        quoted = false
        // Text right after a quote that spanned lines means an earlier quote was left open and this one opened a field.
        if (line > quoteLine && /[^\s,;\t]/.test(text[i + 1] ?? '')) badQuote ||= quoteLine
      } }
      else { if (c === '\n') line++; field += c }
      continue
    }
    if (c === '"' && field.trim() === '') { quoted = true; field = ''; quoteLine = line }
    else if (c === delim) { row.push(field.trim()); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field.trim()); field = ''
      if (row.some(x => x !== '')) { rows.push(row); lines.push(rowLine) }
      row = []; line++; rowLine = line
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field.trim()); if (row.some(x => x !== '')) { rows.push(row); lines.push(rowLine) } }
  if (quoted) badQuote ||= quoteLine
  return { rows, lines, ...(delim === ';' ? { decimalComma: true } : {}), ...(badQuote ? { badQuote } : {}), ...(text && !/[\r\n]$/.test(text) ? { openEnd: true } : {}) }
}

function sniffDelimiter(text: string): string {
  const head = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  return [',', '\t', ';'].map(d => [d, head.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
}

// Spreadsheets run text that starts like a formula (OWASP, CSV injection); an apostrophe in front makes it text again.
const FORMULA = /^'*[=+\-@\t\r\n＝＋－＠]/
export const csvCell = (v: unknown) => { const s = typeof v === 'string' && FORMULA.test(v) ? `'${v}` : String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const toCsv = (rows: unknown[][]) => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n'

/** FNV-1a: stable pseudonymous ids so names never need to leave the device. */
export function hashId(prefix: string, key: string): string {
  let h = 0x811c9dc5
  for (const ch of key.trim().toLowerCase()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0 }
  return prefix + h.toString(36).padStart(7, '0')
}
export const studentId = (key: string) => hashId('s', key)
export const assessmentId = (name: string) => hashId('a', cleanAssessmentName(name))
/** Canvas appends the assignment id: "Unit 2 Quiz (48213)". */
export const cleanAssessmentName = (n: string) => n.replace(/\s*\(\d{3,}\)\s*$/, '').trim()
const canvasId = (n: string) => n.match(/\((\d{3,})\)\s*$/)?.[1]

interface Named { id: string; name: string; src?: string }
/** Name and id for every raw assessment name in one file. Canvas ids stay in the name when the file needs them to tell assessments apart. */
function nameAssessments(raws: string[]): (raw: string) => Named {
  const group = new Map<string, Set<string>>()
  const parts = (raw: string) => { const clean = cleanAssessmentName(raw), src = canvasId(raw); return { clean, src, full: src ? `${clean} (${src})` : clean } }
  for (const raw of raws) { const { clean, src } = parts(raw), k = clean.toLowerCase(); if (src) group.set(k, (group.get(k) ?? new Set()).add(src)) }
  return raw => {
    const { clean, src, full } = parts(raw)
    const name = (group.get(clean.toLowerCase())?.size ?? 0) > 1 ? full : clean
    return { id: hashId('a', name), name, ...(src ? { src } : {}) }
  }
}

/** Ids already in the class for a file's assessments: the same Canvas assignment keeps its id however many of that name a file holds. */
function knownIds(base: Dataset, list: Named[]): Map<string, string> {
  const here = new Map(base.assessments.map(a => [a.id, a]))
  const inFile = new Set(list.map(a => a.id)), taken = new Set<string>(), scored = new Set(base.scores.map(s => s.a))
  const out = new Map<string, string>()
  // Last first: before Canvas ids were kept, the last column of a name is the one that was stored.
  for (const a of [...list].reverse()) {
    if (!a.src) continue
    const clean = cleanAssessmentName(a.name), plain = hashId('a', clean), full = hashId('a', `${clean} (${a.src})`)
    const p = here.get(plain)
    let id = a.id
    if (a.id === plain) { if (here.has(full) && !inFile.has(full) && p?.src !== a.src) id = full }
    else if (p && !here.has(a.id) && !inFile.has(plain) && (p.src ? p.src === a.src : scored.has(plain) && !taken.has(plain))) id = plain
    taken.add(id)
    if (id !== a.id) out.set(a.id, id)
  }
  return out
}

// ---------- Values ----------

export type Parsed = { kind: 'pts'; pts: number; max?: number } | { kind: 'pct'; pct: number } | { kind: 'blank' } | { kind: 'missing' } | { kind: 'excused' } | { kind: 'bad' }

/** A plain number without a sign; NaN for anything else. A lone comma followed by three digits is a thousands separator, except in files separated by semicolons, where it is the decimal mark. */
function plainNumber(raw: string, decimalComma: boolean): number {
  const s = raw.trim().replace(/^\+/, '')
  if (/^(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s)
  const thousands = /^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s)
  if (thousands && !(decimalComma && /^\d+,\d+$/.test(s))) return Number(s.replace(/,/g, ''))
  if (/^\d+,\d+$/.test(s) || /^[1-9]\d{0,2}(\.\d{3})+,\d+$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'))
  return NaN
}

export function parseScore(raw: string, decimalComma = false): Parsed {
  const s = raw.trim()
  // "--" is Khan Academy's "not assigned"; "Completed" is its status for videos and articles; Classroom writes statuses too.
  if (!s || /^[-—–]+$/.test(s) || /^(completed?|turned in|assigned|returned|graded|draft)$/i.test(s)) return { kind: 'blank' }
  if (/^(missing|m|mi|absent|abs|incomplete|inc|not submitted|not started|0\*)$/i.test(s)) return { kind: 'missing' }
  if (/^(ex|exc|excused|n\/?a)$/i.test(s)) return { kind: 'excused' }
  const frac = s.split('/')
  if (frac.length === 2) {
    const pts = plainNumber(frac[0], decimalComma), max = plainNumber(frac[1], decimalComma)
    return pts >= 0 && max > 0 ? { kind: 'pts', pts, max } : { kind: 'bad' }
  }
  if (s.endsWith('%')) { const pct = plainNumber(s.slice(0, -1), decimalComma); return pct >= 0 ? { kind: 'pct', pct: pct / 100 } : { kind: 'bad' } }
  const n = plainNumber(s, decimalComma)
  return Number.isFinite(n) ? { kind: 'pts', pts: n } : { kind: 'bad' }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** Returns YYYY-MM-DD or '' for ISO, US M/D/YYYY and "Sep 5, 2026" style dates. */
export function parseDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const ok = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : ''
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return ok(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) return ok(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  m = s.match(/^(?:[a-z]+,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i)
  if (m && MONTHS.includes(m[1].toLowerCase())) return ok(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])
  return ''
}

// ---------- Formats ----------

export type Kind = 'google-classroom' | 'canvas' | 'powerschool' | 'generic-wide' | 'generic-long' | 'items' | 'mapping' | 'standards'
export const KINDS: Record<Kind, string> = {
  'google-classroom': 'Google Classroom grades export',
  canvas: 'Canvas gradebook export',
  powerschool: 'PowerSchool-style assignment scores',
  'generic-wide': 'Gradebook (one column per assessment)',
  'generic-long': 'Scores list (one row per score)',
  items: 'Item scores per standard',
  mapping: 'Assessment to standard mapping',
  standards: 'Custom standards list',
}

export type Field = 'sid' | 'name' | 'first' | 'last' | 'assessment' | 'date' | 'score' | 'max' | 'standard' | 'item' | 'reassessOf' | 'desc' | 'section'
export const FIELD_LABEL: Record<Field, string> = { sid: 'Student ID or email', name: 'Student name', first: 'First name', last: 'Last name', assessment: 'Assessment', date: 'Date', score: 'Score', max: 'Points possible', standard: 'Standard code(s)', item: 'Item / question', reassessOf: 'Reassessment of', desc: 'Description', section: 'Section' }
export const FIELDS_FOR: Record<Kind, { f: Field; req?: boolean }[]> = {
  'google-classroom': [{ f: 'sid' }, { f: 'first' }, { f: 'last' }],
  canvas: [{ f: 'name' }, { f: 'first' }, { f: 'last' }, { f: 'sid' }, { f: 'section' }],
  'generic-wide': [{ f: 'sid' }, { f: 'name' }, { f: 'first' }, { f: 'last' }, { f: 'section' }],
  powerschool: [{ f: 'sid' }, { f: 'name' }, { f: 'assessment', req: true }, { f: 'date' }, { f: 'score', req: true }, { f: 'max' }, { f: 'section' }],
  'generic-long': [{ f: 'sid' }, { f: 'name' }, { f: 'assessment', req: true }, { f: 'date' }, { f: 'score', req: true }, { f: 'max' }, { f: 'section' }],
  items: [{ f: 'sid' }, { f: 'name' }, { f: 'assessment', req: true }, { f: 'standard' }, { f: 'item' }, { f: 'score', req: true }, { f: 'max' }],
  mapping: [{ f: 'assessment', req: true }, { f: 'standard' }, { f: 'item' }, { f: 'date' }, { f: 'max' }, { f: 'reassessOf' }],
  standards: [{ f: 'standard', req: true }, { f: 'desc', req: true }],
}
export const isWide = (k: Kind) => k === 'google-classroom' || k === 'canvas' || k === 'generic-wide'

const PATTERNS: Record<Field, RegExp> = {
  sid: /^(student ?(id|number|#)|sis ?user ?id|id|email( address)?|student email|user ?id|login)$/i,
  name: /^(student( name)?|name|full name|student full name|learner)$/i,
  first: /^(first( ?name)?|given name)$/i,
  last: /^(last( ?name)?|surname|family name)$/i,
  assessment: /^(assessment|assignment( name)?|test|quiz|task|activity|title)$/i,
  date: /^(date|due( date)?|assessed( on)?|given( on)?|assignment date)$/i,
  score: /^(score|points?( earned)?|mark|raw score|result|level)$/i,
  max: /^(max|points possible|possible|out of|total points|max points|max score)$/i,
  standard: /^(standards?( codes?)?|ccss|skill|learning target|target|code|standard code)$/i,
  item: /^(item|question|q|item ?(id|label)|question ?(number|#))$/i,
  reassessOf: /^(reassess(ment)?( of)?|retake( of)?|replaces|original)$/i,
  desc: /^(desc(ription)?|statement|text|standard description)$/i,
  section: /^(section|period|class|block|course section)$/i,
}

export type Mapping = Partial<Record<Field, number>>
export function autoMap(headers: string[], kind: Kind): Mapping {
  const map: Mapping = {}
  const fields = FIELDS_FOR[kind].map(x => x.f)
  headers.forEach((h, i) => {
    const t = h.trim()
    for (const f of fields) if (map[f] === undefined && PATTERNS[f].test(t)) { map[f] = i; break }
  })
  if (kind === 'canvas') { map.name = headers.findIndex(h => /^student$/i.test(h)); const id = headers.findIndex(h => /^id$/i.test(h)); if (id >= 0) map.sid = id }
  if (kind === 'google-classroom') { const e = headers.findIndex(h => /email/i.test(h)); if (e >= 0) map.sid = e }
  return map
}

export function detectKind(headers: string[], rows: string[][] = []): Kind {
  const h = headers.map(x => x.trim().toLowerCase())
  const has = (re: RegExp) => h.some(x => re.test(x))
  if (has(/^first name$/) && has(/^last name$/) && has(/email/)) return 'google-classroom'
  if ((h[0] === 'student' || (h[0] === 'lastname' && h[1] === 'firstname')) && (has(/^sis (user|login) id$/) || rows.slice(1, 4).some(r => /points possible/i.test(r[0] ?? '')))) return 'canvas'
  const student = has(PATTERNS.sid) || has(PATTERNS.name) || has(PATTERNS.first)
  if (!student && has(PATTERNS.standard) && has(PATTERNS.desc) && !has(PATTERNS.assessment)) return 'standards'
  if (!student && has(PATTERNS.assessment) && (has(PATTERNS.standard) || has(PATTERNS.item))) return 'mapping'
  if (student && has(PATTERNS.assessment) && has(PATTERNS.score) && (has(PATTERNS.standard) || has(PATTERNS.item))) return 'items'
  if (has(/^student number$/) && has(PATTERNS.assessment)) return 'powerschool'
  if (student && has(PATTERNS.assessment) && has(PATTERNS.score)) return 'generic-long'
  return 'generic-wide'
}

// Columns in wide exports that are never assessments.
const NOT_ASSESSMENT = /^(last ?name|first ?name|email( address)?|student|id|sis (user|login) id|integration id|root account|section|student name|name|student id|student number|overall( grade)?|total|average( score)?|status|.*\b(current|final|unposted) (score|grade|points)\b.*|override (score|grade|status)\b.*|grade|period|class)$/i
const META_ROW = /^(points possible|points|out of|max(imum)?|date|due( date)?|class average|average|manual posting|read only)$/i

/** "Max" and "Date" are also people's names, so a row with such a label is a student when anything else in it says so. */
function isStudentRow(rows: string[][], at: number, label: string, map: Mapping, cols: number[], decimalComma?: boolean): boolean {
  if (!/^(max|date)$/i.test(label)) return false
  const r = rows[at]
  const ids = [map.sid, map.name, map.first, map.last].map(i => cell(r, i)).filter(x => /[\p{L}\p{N}]/u.test(x))
  if (ids.some(x => !META_ROW.test(x))) return true
  // "Max" alone in a name column: a points row sits above every student, is the only such row and is not far below other scores (extra credit may pass it).
  if (!/^max$/i.test(label)) return false
  const isPoints = (x: string[]) => /^(points possible|points|out of|maximum)$/i.test((x[0] ?? '').trim())
  if (rows.slice(0, at).some(x => !META_ROW.test((x[0] ?? '').trim())) || rows.some(isPoints)) return true
  return cols.some(c => { const top = num(cell(r, c), decimalComma); return rows.some((x, i) => i > at && num(cell(x, c), decimalComma) > top * 1.25) })
}

export function assessmentColumns(csv: Csv, map: Mapping): number[] {
  const head = csv.rows[0] ?? []
  const used = new Set(Object.values(map))
  const cols = head.map((h, i) => i).filter(i => !used.has(i) && head[i].trim() && !NOT_ASSESSMENT.test(head[i].trim()))
  // Canvas writes every assignment as "Title (id)"; other columns before them are custom gradebook columns such as Notes.
  const canvas = csv.rows.slice(1, 4).some(r => /^points possible$/i.test((r[0] ?? '').trim()))
  const withId = cols.filter(i => /\(\d{3,}\)\s*$/.test(head[i]))
  return canvas && withId.length ? withId : cols
}

export interface Issue { line: number; level: 'error' | 'warn'; message: string }
/** One student's work on one assessment; on one item or standards of it when the file says so. */
export interface Mark { s: string; a: string; item?: string; stds?: string[] }
/** cleared: marked excused or missing. unscored: an empty or unreadable cell. refs: the assessments these name. */
export interface Part extends Partial<Dataset> { mapping?: MappingRow[]; cleared?: Mark[]; unscored?: Mark[]; refs?: Named[] }
export interface Validation { part: Part; issues: Issue[]; rows: number; used: number; skipped: number; summary: string }
export interface MappingRow { assessment: string; id: string; src?: string; standards: string[]; items: Record<string, string>; date?: string; max?: number; reassessOf?: Named }

/** A plain number, accepting decimal commas; NaN otherwise. */
const num = (raw: string, decimalComma?: boolean) => { const p = parseScore(raw, decimalComma); return p.kind === 'pts' && p.max === undefined ? p.pts : NaN }
/** A name as it was before csvCell. */
const plainText = (s: string) => s.startsWith("'") && FORMULA.test(s) ? s.slice(1) : s
const text = (r: string[], i: number | undefined) => plainText(cell(r, i))
const cell = (r: string[], i: number | undefined) => i === undefined || i < 0 ? '' : (r[i] ?? '').trim()

function studentFrom(r: string[], map: Mapping, kind: Kind): { id: string; name: string; section?: string } | null {
  let name = text(r, map.name)
  if (!name && (map.first !== undefined || map.last !== undefined)) name = [text(r, map.first), text(r, map.last)].filter(Boolean).join(' ')
  // "Last, First" (Canvas, PowerSchool) reads better as "First Last".
  if ((kind === 'canvas' || kind === 'powerschool' || /,/.test(name)) && /^[^,]+,\s*[^,]+$/.test(name)) { const [l, f] = name.split(/,\s*/); name = `${f} ${l}` }
  const key = cell(r, map.sid) || name
  if (!key) return null
  const section = cell(r, map.section) || undefined
  return { id: studentId(key), name: name || key, ...(section ? { section } : {}) }
}

/** A student whose file had no name is called by their ID; that never replaces a name already known. */
const namedOnlyById = (s: Student) => studentId(s.name) === s.id
const withKnownName = (cur: Student | undefined, s: Student): Student => cur?.name && namedOnlyById(s) && !namedOnlyById(cur) ? { ...cur, ...s, name: cur.name } : { ...cur, ...s, name: s.name || cur?.name || s.id }

/** Validates and converts one parsed file. Line numbers are 1-based lines in the original file. */
export function validate(csv: Csv, kind: Kind, map: Mapping, assessCols?: number[]): Validation {
  const issues: Issue[] = []
  const head = csv.rows[0] ?? []
  const all = csv.rows.slice(1).map((r, i) => ({ r, line: csv.lines[i + 1] }))
  if (csv.badQuote) return { part: {}, issues: [{ line: csv.badQuote, level: 'error', message: 'The quote that starts on this line is never closed, so the rows after it cannot be told apart. Fix the quote or export the file again.' }], rows: all.length, used: 0, skipped: all.length, summary: 'Broken quoting' }
  for (const { f, req } of FIELDS_FOR[kind]) if (req && (map[f] === undefined || map[f]! < 0)) issues.push({ line: csv.lines[0] ?? 1, level: 'error', message: `Map a column to "${FIELD_LABEL[f]}" to continue.` })
  if (issues.length) return { part: {}, issues, rows: all.length, used: 0, skipped: all.length, summary: 'Column mapping incomplete' }
  const body = all.filter(({ r, line }, i) => {
    if (r.slice(head.length).some(x => x && !/^\(read only\)$/i.test(x))) { issues.push({ line, level: 'error', message: `This row has ${r.length} values but the header has ${head.length} columns, so they cannot be matched up (a comma inside a name or number needs quotes); row skipped.` }); return false }
    // A file that leaves out trailing empty cells elsewhere may do so on its last row too.
    const cut = csv.openEnd && i === all.length - 1 && r.length < head.length && all.slice(0, -1).every(x => x.r.length >= head.length)
    if (cut) issues.push({ line, level: 'error', message: `The file ends in the middle of this row (${r.length} of ${head.length} columns); row skipped. Export it again.` })
    return !cut
  })

  if (kind === 'standards') {
    const out: { code: string; desc: string }[] = []
    for (const { r, line } of body) {
      const code = normalizeCode(text(r, map.standard)), desc = cell(r, map.desc)
      if (!code) { issues.push({ line, level: 'error', message: 'No standard code; row skipped.' }); continue }
      out.push({ code, desc: desc || code })
    }
    return { part: { customStandards: out }, issues, rows: all.length, used: out.length, skipped: all.length - out.length, summary: `${out.length} standards` }
  }

  if (kind === 'mapping') {
    const rows = new Map<string, MappingRow>()
    const named = nameAssessments(body.flatMap(b => [text(b.r, map.assessment), text(b.r, map.reassessOf)]).filter(Boolean))
    let used = 0
    for (const { r, line } of body) {
      const { id, name, src } = named(text(r, map.assessment))
      if (!name) { issues.push({ line, level: 'error', message: 'No assessment name; row skipped.' }); continue }
      const codes = text(r, map.standard).split(/[;|]+|\s{2,}|,\s*(?=[0-9A-Z])/i).map(x => x.trim()).filter(Boolean).map(normalizeCode)
      const item = text(r, map.item)
      const m = rows.get(id) ?? { assessment: name, id, ...(src ? { src } : {}), standards: [], items: {} }
      for (const c of codes) if (!m.standards.includes(c)) m.standards.push(c)
      if (item && codes.length) m.items[item] = [...new Set([...itemCodes(m.items, item), ...codes])].join('; ')
      if (item && !codes.length) issues.push({ line, level: 'warn', message: `Item "${item}" has no standard tag.` })
      const d = cell(r, map.date)
      if (d) { const p = parseDate(d); if (p) m.date = p; else issues.push({ line, level: 'warn', message: `Could not read the date "${d}". Use YYYY-MM-DD.` }) }
      const mx = cell(r, map.max)
      if (mx) { const n = num(mx, csv.decimalComma); if (n > 0) m.max = n; else issues.push({ line, level: 'warn', message: `Points possible "${mx}" is not a positive number.` }) }
      const re = text(r, map.reassessOf)
      if (re) m.reassessOf = named(re)
      if (!codes.length && !item && !re && !d) issues.push({ line, level: 'warn', message: `"${name}" has no standards listed.` })
      rows.set(id, m)
      used++
    }
    for (const m of rows.values()) if (m.reassessOf && !rows.has(m.reassessOf.id)) issues.push({ line: 0, level: 'warn', message: `"${m.assessment}" is a reassessment of "${m.reassessOf.name}", which is not in this file. It will link if that assessment is already imported.` })
    return { part: { mapping: [...rows.values()] }, issues, rows: all.length, used, skipped: all.length - used, summary: `${rows.size} assessments, ${new Set([...rows.values()].flatMap(m => m.standards)).size} standards` }
  }

  const students = new Map<string, Student>()
  const assessments = new Map<string, Assessment>()
  const scores: Score[] = []
  const itemScores: ItemScore[] = []
  const cleared: Mark[] = [], unscored: Mark[] = [], refs = new Map<string, Named>()
  let used = 0, missing = 0, excused = 0
  const checks: { line: number; raw: string; student: string; a: Assessment; pts: number; max?: number }[] = []

  if (isWide(kind)) {
    const cols = assessCols ?? assessmentColumns(csv, map)
    if (!cols.length) issues.push({ line: csv.lines[0] ?? 1, level: 'error', message: 'No assessment columns found. Choose them below.' })
    // Meta rows (Points Possible, Date, Class average) come right after the header in Canvas and Google Classroom exports.
    const metaPoints = new Map<number, number>(), metaDates = new Map<number, string>()
    const students_ = body.filter(({ r }, at) => {
      if (r.some(x => /^manual posting/i.test(x.trim()))) return false
      const first = (r[0] ?? '').trim(), probe = r.slice(0, 4).map(x => x.trim()).find(x => META_ROW.test(x)) ?? (META_ROW.test(first) ? first : '')
      if (!probe || isStudentRow(body.map(b => b.r), at, probe, map, cols, csv.decimalComma)) return true
      for (const c of cols) {
        const v = cell(r, c)
        if (/points|out of|max/i.test(probe)) { const p = parseScore(v, csv.decimalComma); if (p.kind === 'pts' && p.pts > 0) metaPoints.set(c, p.pts) }
        if (/date|due/i.test(probe)) { const d = parseDate(v); if (d) metaDates.set(c, d) }
      }
      return false
    })
    const heading = (c: number) => plainText(head[c] ?? '')
    const named = nameAssessments(cols.map(c => heading(c)))
    const byCol = new Map<number, Named>()
    const groups = new Map<string, number[]>()
    for (const c of cols) { const { id } = named(heading(c)); groups.set(id, [...(groups.get(id) ?? []), c]) }
    const taken = new Set(groups.keys())
    for (const g of groups.values()) {
      // Columns with nothing but the name in common are numbered by date when all have one, or else by place.
      const dated = g.every(c => metaDates.has(c))
      const inOrder = dated ? [...g].sort((x, y) => metaDates.get(x)!.localeCompare(metaDates.get(y)!) || x - y) : g
      const first = named(heading(g[0]))
      let n = 1
      inOrder.forEach((c, i) => {
        let a = named(heading(c))
        while (i && taken.has(a.id)) { const name = `${first.name} (${++n})`; a = { ...a, name, id: hashId('a', name) } }
        taken.add(a.id)
        byCol.set(c, a)
      })
      if (g.length > 1) issues.push({ line: csv.lines[0] ?? 1, level: 'warn', message: `${g.length} columns are named "${first.name}", so they were imported in ${dated ? 'date' : 'column'} order as ${inOrder.map(c => `"${byCol.get(c)!.name}"`).join(', ')}. Give them different names so a later export cannot swap them.` })
    }
    cols.forEach((c, k) => {
      const { id, name, src } = byCol.get(c)!
      const inlineMax = name.match(/\[(\d+(?:\.\d+)?)\s*(?:pts?|points)?\]|\((\d+(?:\.\d+)?)\s*(?:pts?|points)\)$/i)
      assessments.set(id, { id, name, ...(src ? { src } : {}), date: metaDates.get(c) ?? '', order: k, max: metaPoints.get(c) ?? (inlineMax ? +(inlineMax[1] ?? inlineMax[2]) : 0), standards: [] })
    })
    for (const { r, line } of students_) {
      const st = studentFrom(r, map, kind)
      if (!st) { issues.push({ line, level: 'error', message: 'No student name or ID; row skipped.' }); continue }
      // Canvas adds its Student View account to exports.
      if (kind === 'canvas' && /^test student$/i.test(st.name)) continue
      if (students.has(st.id)) issues.push({ line, level: 'warn', message: `${st.name} appears more than once; the later row wins.` })
      students.set(st.id, st)
      let any = false
      for (const c of cols) {
        const a = assessments.get(byCol.get(c)!.id)!
        const p = parseScore(cell(r, c), csv.decimalComma)
        if (p.kind === 'missing' || p.kind === 'excused') {
          if (p.kind === 'missing') missing++
          else excused++
          cleared.push({ s: st.id, a: a.id })
          scores.splice(0, scores.length, ...scores.filter(x => x.s !== st.id || x.a !== a.id))
          continue
        }
        if (p.kind === 'blank' || p.kind === 'bad') unscored.push({ s: st.id, a: a.id })
        if (p.kind === 'blank') continue
        if (p.kind === 'bad') { issues.push({ line, level: 'warn', message: `"${cell(r, c)}" under "${a.name}" is not a score; ignored.` }); continue }
        if (p.kind === 'pct') { if (!a.max) { a.max = 100; a.maxAssumed = true } scores.push({ s: st.id, a: a.id, pts: p.pct * a.max, max: a.max }) }
        else {
          if (p.max && !a.max) a.max = p.max
          // "7/8" in a column whose maximum is already known from another format is rescaled to that maximum.
          scores.push({ s: st.id, a: a.id, pts: p.max && a.max !== p.max ? p.pts / p.max * a.max : p.pts, ...(p.max ? { max: a.max } : {}) })
        }
        checks.push({ line, raw: cell(r, c), student: st.name, a, pts: scores[scores.length - 1].pts, max: scores[scores.length - 1].max })
        any = true
      }
      if (any) used++
      else issues.push({ line, level: 'warn', message: `${st.name} has no scores.` })
    }
    // Columns with no scores at all (ungraded assignments, Khan Academy videos) are not assessments yet.
    for (const a of [...assessments.values()]) if (!scores.some(s => s.a === a.id)) {
      assessments.delete(a.id)
      refs.set(a.id, a)
      issues.push({ line: csv.lines[0] ?? 1, level: 'warn', message: `"${a.name}" has no scores yet, so it was left out. Re-import once it is graded.` })
    }
    for (const a of assessments.values()) if (!a.max) {
      const top = Math.max(0, ...scores.filter(s => s.a === a.id).map(s => s.pts))
      a.max = top <= 4 ? 4 : top <= 10 ? 10 : 100
      a.maxAssumed = true
      issues.push({ line: csv.lines[0] ?? 1, level: 'warn', message: `No points possible for "${a.name}"; assumed ${a.max}. Edit it on the Assessments panel if that is wrong.` })
    }
    if (!metaDates.size && cols.length) issues.push({ line: csv.lines[0] ?? 1, level: 'warn', message: 'The export has no dates, so column order is used as time order. Add dates on the Assessments panel or with a mapping file.' })
  } else {
    let order = 0
    const given = new Set<string>()
    // Per score: plain points, which follow the assessment's points possible when that is what they were out of.
    const raw: boolean[] = []
    const named = nameAssessments(body.map(b => text(b.r, map.assessment)).filter(Boolean))
    const at = new Map<string, { line: number; i: number }>()
    const replaced = new Set<number>()
    for (const { r, line } of body) {
      const st = studentFrom(r, map, kind)
      if (!st) { issues.push({ line, level: 'error', message: 'No student name or ID; row skipped.' }); continue }
      const { id, name, src } = named(text(r, map.assessment))
      if (!name) { issues.push({ line, level: 'error', message: 'No assessment name; row skipped.' }); continue }
      const p = parseScore(cell(r, map.score), csv.decimalComma)
      const codes = kind === 'items' ? text(r, map.standard).split(/[;|]+/).map(x => x.trim()).filter(Boolean).map(normalizeCode) : []
      const item = kind === 'items' ? text(r, map.item) : ''
      const mark: Mark = { s: st.id, a: id, ...(item ? { item } : {}), ...(codes.length ? { stds: codes } : {}) }
      if (p.kind === 'blank' || p.kind === 'bad') { unscored.push(mark); refs.set(id, { id, name, src }) }
      if (p.kind === 'blank') { issues.push({ line, level: 'warn', message: `Empty score for ${st.name} on "${name}".` }); continue }
      if (p.kind === 'missing' || p.kind === 'excused') {
        if (p.kind === 'missing') missing++
        else excused++
        if (kind === 'items' && !codes.length && !item) { issues.push({ line, level: 'error', message: 'No standard or item on this row; skipped.' }); continue }
        cleared.push(mark)
        refs.set(id, { id, name, src })
        const k = `${st.id}|${id}`, was = at.get(k)
        if (was) { replaced.add(was.i); at.delete(k); issues.push({ line: was.line, level: 'warn', message: `The score for ${st.name} on "${name}" is replaced by the ${p.kind} mark on line ${line}.` }) }
        itemScores.splice(0, itemScores.length, ...itemScores.filter(x => kind !== 'items' || !marks(mark, x)))
        continue
      }
      if (p.kind === 'bad') { issues.push({ line, level: 'error', message: `"${cell(r, map.score)}" is not a score; row skipped.` }); continue }
      const mxRaw = cell(r, map.max)
      // A fraction is out of its own total whatever the points column says.
      const own = p.kind === 'pts' && p.max ? p.max : 0
      const mx = own || (mxRaw ? num(mxRaw, csv.decimalComma) : p.kind === 'pts' ? NaN : 100)
      if (mxRaw && !(num(mxRaw, csv.decimalComma) > 0)) { issues.push({ line, level: 'error', message: `Points possible "${mxRaw}" is not a positive number; row skipped.` }); continue }
      const dRaw = cell(r, map.date), d = dRaw ? parseDate(dRaw) : ''
      if (dRaw && !d) issues.push({ line, level: 'warn', message: `Could not read the date "${dRaw}". Use YYYY-MM-DD.` })
      const a = assessments.get(id) ?? { id, name, ...(src ? { src } : {}), date: '', order: order++, max: 0, standards: [] }
      if (d && !a.date) a.date = d
      if (mx > 0 && kind !== 'items') { if (mxRaw || own) given.add(id); a.max = Math.max(a.max, mx) }
      assessments.set(id, a)
      students.set(st.id, withKnownName(students.get(st.id), st))
      const pts = p.kind === 'pct' ? p.pct * (mx > 0 ? mx : 100) : p.pts
      if (!(p.kind === 'pts' && !(mx > 0) && kind === 'items')) checks.push({ line, raw: cell(r, map.score), student: st.name, a, pts, max: mx > 0 ? mx : undefined })
      if (kind === 'items') {
        if (!codes.length && !item) { issues.push({ line, level: 'error', message: 'No standard or item on this row; skipped.' }); continue }
        const max = mx > 0 ? mx : NaN
        if (!(max > 0)) { issues.push({ line, level: 'error', message: 'Item scores need points possible; row skipped.' }); continue }
        if (codes.length) for (const c of codes) { itemScores.push({ s: st.id, a: id, std: c, pts, max, ...(item ? { item: codes.length > 1 ? `${item}:${c}` : item } : {}) }); if (!a.standards.includes(c)) a.standards.push(c) }
        else itemScores.push({ s: st.id, a: id, std: '', pts, max, item })
      } else {
        const k = `${st.id}|${id}`, was = at.get(k)
        if (was) { replaced.add(was.i); issues.push({ line: was.line, level: 'warn', message: `The score for ${st.name} on "${name}" is replaced by the one on line ${line}. To keep both, give them different assessment names.` }) }
        at.set(k, { line, i: scores.length })
        scores.push({ s: st.id, a: id, pts, ...(mx > 0 ? { max: mx } : {}) })
        raw.push(p.kind === 'pts' && !own)
      }
      used++
    }
    scores.forEach((x, i) => { if (raw[i] && x.max === assessments.get(x.a)!.max) delete x.max })
    scores.splice(0, scores.length, ...scores.filter((_, i) => !replaced.has(i)))
    for (const a of assessments.values()) if (a.max && !given.has(a.id)) a.maxAssumed = true
    for (const a of assessments.values()) if (!a.max && kind !== 'items') { a.max = 100; a.maxAssumed = true; issues.push({ line: 0, level: 'warn', message: `No points possible for "${a.name}"; assumed 100.` }) }
  }
  for (const { line, raw, student, a, pts, max = a.max } of checks) if (max > 0 && pts > max * 1.5 + 1e-9) issues.push({ line, level: 'warn', message: `"${raw}" for ${student} on "${a.name}" is far above its ${Math.round(max * 100) / 100} points possible. Check the score and the points.` })
  if (missing) issues.push({ line: 0, level: 'warn', message: `${missing} "missing" marks are not counted as evidence (a missing assessment is not a 0 on a standard). Chase those separately.` })
  if (excused) issues.push({ line: 0, level: 'warn', message: `${excused} excused marks ignored.` })
  const nRows = isWide(kind) ? students.size + issues.filter(i => i.level === 'error' && i.line > 0).length : all.length
  return {
    part: { students: [...students.values()], assessments: [...assessments.values()], scores, itemScores, cleared, unscored, refs: [...refs.values()].map(({ id, name, src }) => ({ id, name, ...(src ? { src } : {}) })) },
    issues, rows: nRows, used, skipped: issues.filter(i => i.level === 'error').length,
    summary: `${students.size} students, ${assessments.size} assessments, ${(scores.length + itemScores.length).toLocaleString()} scores`,
  }
}

// ---------- Merging ----------

/** Points possible stated by the teacher, on the panel or in a mapping file. */
export const withMax = (a: Assessment, max: number): Pick<Assessment, 'max' | 'maxAssumed' | 'fileMax'> => ({ max, maxAssumed: undefined, fileMax: a.fileMax ?? (a.max && !a.maxAssumed && a.max !== max ? a.max : undefined) })

/** Whether a mark on an item or standard is about this item score. */
const marks = (m: Mark, x: ItemScore) => x.s === m.s && x.a === m.a && (m.item ? x.item === m.item || !!x.item?.startsWith(`${m.item}:`) : !x.item && !!m.stds?.includes(x.std))
const onItem = (m: Mark) => !!m.item || !!m.stds

/** What an import does to scores already in the class: how many it removes and keeps, and the item scores left on excused or missing work. */
export function importEffects(base: Dataset, file: Part): { removed: number; kept: number; items: number } {
  const part = withKnownIds(base, file)
  const key = (x: { s: string; a: string }) => `${x.s}|${x.a}`
  const fresh = new Set((part.scores ?? []).map(key))
  const whole = new Set((part.cleared ?? []).filter(m => !onItem(m)).map(key))
  const parts = (part.cleared ?? []).filter(onItem)
  const freshItem = (x: ItemScore) => (part.itemScores ?? []).some(y => key(x) === key(y) && x.item === y.item && x.std === y.std)
  const gone = (x: ItemScore) => parts.some(m => marks(m, x)) && !freshItem(x)
  const empty = new Set((part.unscored ?? []).filter(m => !onItem(m)).map(key)), emptyItems = (part.unscored ?? []).filter(onItem)
  return {
    removed: base.scores.filter(x => whole.has(key(x)) && !fresh.has(key(x))).length + base.itemScores.filter(gone).length,
    kept: base.scores.filter(x => empty.has(key(x)) && !whole.has(key(x)) && !fresh.has(key(x))).length + base.itemScores.filter(x => emptyItems.some(m => marks(m, x)) && !gone(x) && !freshItem(x)).length,
    items: base.itemScores.filter(x => whole.has(key(x)) && !fresh.has(key(x))).length,
  }
}

function withKnownIds(base: Dataset, file: Part): Part {
  const ids = knownIds(base, [...(file.refs ?? []), ...(file.assessments ?? []), ...(file.mapping ?? []).flatMap(m => [{ id: m.id, name: m.assessment, src: m.src }, ...(m.reassessOf ? [m.reassessOf] : [])])])
  if (!ids.size) return file
  const own = <T extends { a: string }>(list?: T[]) => list?.map(x => ({ ...x, a: ids.get(x.a) ?? x.a }))
  const named = <T extends { id: string }>(x: T) => ({ ...x, id: ids.get(x.id) ?? x.id })
  return { ...file, assessments: file.assessments?.map(named), scores: own(file.scores), itemScores: own(file.itemScores), cleared: own(file.cleared), unscored: own(file.unscored), mapping: file.mapping?.map(m => named({ ...m, reassessOf: m.reassessOf && named(m.reassessOf) })) }
}

/** Merges an imported part into a dataset. Re-importing the same file updates scores instead of duplicating them. */
export function mergeDataset(base: Dataset, file: Part): Dataset {
  const part = withKnownIds(base, file)
  // A column stored before Canvas ids were kept may hold another column's scores for students this file lists again.
  const mixed = new Set((file.assessments ?? []).map((a, i) => ({ from: a.id, to: part.assessments![i].id })).filter(x => x.from !== x.to && !base.assessments.find(a => a.id === x.to)?.src).map(x => x.to))
  const listed = new Set((file.students ?? []).map(s => s.id))
  const students = new Map(base.students.map(s => [s.id, s]))
  for (const s of part.students ?? []) students.set(s.id, withKnownName(students.get(s.id), s))
  const assessments = new Map(base.assessments.map(a => [a.id, { ...a }]))
  let order = Math.max(-1, ...base.assessments.map(a => a.order)) + 1
  const oldMax = new Map<string, number>()
  for (const a of part.assessments ?? []) {
    const cur = assessments.get(a.id)
    if (cur) {
      const given = a.max > 0 && !a.maxAssumed
      // The file now states another total. Plain points already here keep the one they were entered against.
      const changed = given && cur.max > 0 && a.max !== cur.max && a.max !== cur.fileMax
      if (changed && !cur.maxAssumed) oldMax.set(a.id, cur.max)
      const { maxAssumed, fileMax, ...rest } = cur
      const src = cur.src ?? a.src
      const points = changed || !cur.max ? { max: a.max, ...(a.maxAssumed ? { maxAssumed: true } : {}) } : { max: cur.max, ...(maxAssumed && !given ? { maxAssumed } : {}), ...(fileMax ? { fileMax } : {}) }
      assessments.set(a.id, { ...rest, ...(src ? { src } : {}), ...points, date: a.date || cur.date, standards: [...new Set([...cur.standards, ...a.standards])] })
    } else assessments.set(a.id, { ...a, order: order++ })
  }
  for (const m of part.mapping ?? []) {
    const id = m.id
    const cur: Assessment = assessments.get(id) ?? { id, name: m.assessment, ...(m.src ? { src: m.src } : {}), date: '', order: order++, max: 0, standards: [] }
    const re = m.reassessOf ? m.reassessOf.id : cur.reassessOf
    assessments.set(id, { ...cur, standards: [...new Set([...cur.standards, ...m.standards])], items: { ...cur.items, ...m.items }, date: m.date ?? cur.date, ...(m.max ? withMax(cur, m.max) : {}), ...(re ? { reassessOf: re } : {}) })
  }
  const namesakes = new Map<string, number>()
  for (const a of assessments.values()) { const k = cleanAssessmentName(a.name).toLowerCase(); namesakes.set(k, (namesakes.get(k) ?? 0) + 1) }
  for (const a of assessments.values()) if (a.src && !canvasId(a.name) && namesakes.get(a.name.toLowerCase())! > 1) assessments.set(a.id, { ...a, name: `${a.name} (${a.src})` })
  const key = (s: Score) => `${s.s}|${s.a}`
  const scores = new Map(base.scores.filter(s => !(mixed.has(s.a) && listed.has(s.s))).map(s => [key(s), !s.max && oldMax.has(s.a) ? { ...s, max: oldMax.get(s.a) } : s]))
  for (const m of part.cleared ?? []) if (!onItem(m)) scores.delete(`${m.s}|${m.a}`)
  for (const s of part.scores ?? []) scores.set(key(s), s)
  const gone = (part.cleared ?? []).filter(onItem)
  // Item rows are keyed by item label when there is one, so re-importing the same file replaces instead of adding.
  const ikey = (s: ItemScore) => `${s.s}|${s.a}|${s.item ? '#' + s.item : s.std}`
  const items = new Map<string, ItemScore>(base.itemScores.filter(x => !gone.some(m => marks(m, x))).map(s => [ikey(s), s]))
  const fresh = new Map<string, ItemScore>()
  for (const s of part.itemScores ?? []) { const k = ikey(s); const f = fresh.get(k); fresh.set(k, f ? { ...f, pts: f.pts + s.pts, max: f.max + s.max } : s) }
  for (const [k, s] of fresh) items.set(k, s)
  const custom = new Map((base.customStandards ?? []).map(c => [c.code, c]))
  for (const c of part.customStandards ?? []) custom.set(c.code, c)
  return { students: [...students.values()], assessments: [...assessments.values()], scores: [...scores.values()], itemScores: [...items.values()], ...(custom.size ? { customStandards: [...custom.values()] } : {}) }
}
