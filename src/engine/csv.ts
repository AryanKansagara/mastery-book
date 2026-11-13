import { normalizeCode } from './standards.ts'
import type { Assessment, Dataset, ItemScore, Score, Student } from './types.ts'

export interface Csv { rows: string[][]; lines: number[] }

export function parseCsv(text: string): Csv {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const delim = sniffDelimiter(text)
  const rows: string[][] = []
  const lines: number[] = []
  let row: string[] = [], field = '', quoted = false, line = 1, rowLine = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else { if (c === '\n') line++; field += c }
      continue
    }
    if (c === '"' && field.trim() === '') { quoted = true; field = '' }
    else if (c === delim) { row.push(field.trim()); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field.trim()); field = ''
      if (row.some(x => x !== '')) { rows.push(row); lines.push(rowLine) }
      row = []; line++; rowLine = line
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field.trim()); if (row.some(x => x !== '')) { rows.push(row); lines.push(rowLine) } }
  return { rows, lines }
}

function sniffDelimiter(text: string): string {
  const head = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  return [',', '\t', ';'].map(d => [d, head.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
}

export const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
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

// ---------- Values ----------

export type Parsed = { kind: 'pts'; pts: number; max?: number } | { kind: 'pct'; pct: number } | { kind: 'blank' } | { kind: 'missing' } | { kind: 'excused' } | { kind: 'bad' }

export function parseScore(raw: string): Parsed {
  const s = raw.trim()
  if (!s || s === '-' || s === '—') return { kind: 'blank' }
  if (/^(missing|m|mi|absent|abs|incomplete|inc|not submitted|0\*)$/i.test(s)) return { kind: 'missing' }
  if (/^(ex|exc|excused|n\/?a)$/i.test(s)) return { kind: 'excused' }
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (frac) return { kind: 'pts', pts: +frac[1], max: +frac[2] }
  const pct = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/)
  if (pct) return { kind: 'pct', pct: +pct[1] / 100 }
  // "8,5" and "8,50" are decimal commas (Canvas in European locales); "1,250" is a thousands separator.
  const n = /^-?\d+,\d{1,2}$/.test(s) ? Number(s.replace(',', '.')) : Number(s.replace(/,/g, ''))
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
const NOT_ASSESSMENT = /^(last ?name|first ?name|email( address)?|student|id|sis (user|login) id|integration id|root account|section|student name|name|student id|student number|overall( grade)?|total|average|status|.*\b(current|final|unposted) (score|grade|points)\b.*|override (score|grade|status)\b.*|grade|period|class)$/i
const META_ROW = /^(points possible|points|out of|max(imum)?|date|due( date)?|class average|average|manual posting|read only)$/i

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
export interface Validation { part: Partial<Dataset> & { mapping?: MappingRow[] }; issues: Issue[]; rows: number; used: number; skipped: number; summary: string }
export interface MappingRow { assessment: string; standards: string[]; items: Record<string, string>; date?: string; max?: number; reassessOf?: string }

const cell = (r: string[], i: number | undefined) => i === undefined || i < 0 ? '' : (r[i] ?? '').trim()

function studentFrom(r: string[], map: Mapping, kind: Kind): { id: string; name: string; section?: string } | null {
  let name = cell(r, map.name)
  if (!name && (map.first !== undefined || map.last !== undefined)) name = [cell(r, map.first), cell(r, map.last)].filter(Boolean).join(' ')
  // "Last, First" (Canvas, PowerSchool) reads better as "First Last".
  if ((kind === 'canvas' || kind === 'powerschool' || /,/.test(name)) && /^[^,]+,\s*[^,]+$/.test(name)) { const [l, f] = name.split(/,\s*/); name = `${f} ${l}` }
  const key = cell(r, map.sid) || name
  if (!key) return null
  const section = cell(r, map.section) || undefined
  return { id: studentId(key), name: name || key, ...(section ? { section } : {}) }
}

/** Validates and converts one parsed file. Line numbers are 1-based lines in the original file. */
export function validate(csv: Csv, kind: Kind, map: Mapping, assessCols?: number[]): Validation {
  const issues: Issue[] = []
  const head = csv.rows[0] ?? []
  const body = csv.rows.slice(1).map((r, i) => ({ r, line: csv.lines[i + 1] }))
  for (const { f, req } of FIELDS_FOR[kind]) if (req && (map[f] === undefined || map[f]! < 0)) issues.push({ line: csv.lines[0] ?? 1, level: 'error', message: `Map a column to "${FIELD_LABEL[f]}" to continue.` })
  if (issues.length) return { part: {}, issues, rows: body.length, used: 0, skipped: body.length, summary: 'Column mapping incomplete' }

  if (kind === 'standards') {
    const out: { code: string; desc: string }[] = []
    for (const { r, line } of body) {
      const code = normalizeCode(cell(r, map.standard)), desc = cell(r, map.desc)
      if (!code) { issues.push({ line, level: 'error', message: 'No standard code; row skipped.' }); continue }
      out.push({ code, desc: desc || code })
    }
    return { part: { customStandards: out }, issues, rows: body.length, used: out.length, skipped: body.length - out.length, summary: `${out.length} standards` }
  }

  if (kind === 'mapping') {
    const rows = new Map<string, MappingRow>()
    let used = 0
    for (const { r, line } of body) {
      const name = cleanAssessmentName(cell(r, map.assessment))
      if (!name) { issues.push({ line, level: 'error', message: 'No assessment name; row skipped.' }); continue }
      const codes = cell(r, map.standard).split(/[;|]+|\s{2,}|,\s*(?=[0-9A-Z])/i).map(x => x.trim()).filter(Boolean).map(normalizeCode)
      const item = cell(r, map.item)
      const m = rows.get(name.toLowerCase()) ?? { assessment: name, standards: [], items: {} }
      for (const c of codes) if (!m.standards.includes(c)) m.standards.push(c)
      if (item && codes[0]) m.items[item] = codes[0]
      if (item && !codes.length) issues.push({ line, level: 'warn', message: `Item "${item}" has no standard tag.` })
      const d = cell(r, map.date)
      if (d) { const p = parseDate(d); if (p) m.date = p; else issues.push({ line, level: 'warn', message: `Could not read the date "${d}". Use YYYY-MM-DD.` }) }
      const mx = cell(r, map.max)
      if (mx) { const n = Number(mx); if (n > 0) m.max = n; else issues.push({ line, level: 'warn', message: `Points possible "${mx}" is not a positive number.` }) }
      const re = cleanAssessmentName(cell(r, map.reassessOf))
      if (re) m.reassessOf = re
      if (!codes.length && !item && !re && !d) issues.push({ line, level: 'warn', message: `"${name}" has no standards listed.` })
      rows.set(name.toLowerCase(), m)
      used++
    }
    for (const m of rows.values()) if (m.reassessOf && !rows.has(m.reassessOf.toLowerCase())) issues.push({ line: 0, level: 'warn', message: `"${m.assessment}" is a reassessment of "${m.reassessOf}", which is not in this file. It will link if that assessment is already imported.` })
    return { part: { mapping: [...rows.values()] }, issues, rows: body.length, used, skipped: body.length - used, summary: `${rows.size} assessments, ${new Set([...rows.values()].flatMap(m => m.standards)).size} standards` }
  }

  const students = new Map<string, Student>()
  const assessments = new Map<string, Assessment>()
  const scores: Score[] = []
  const itemScores: ItemScore[] = []
  let used = 0, missing = 0, excused = 0

  if (isWide(kind)) {
    const cols = assessCols ?? assessmentColumns(csv, map)
    if (!cols.length) issues.push({ line: csv.lines[0] ?? 1, level: 'error', message: 'No assessment columns found. Choose them below.' })
    // Meta rows (Points Possible, Date, Class average) come right after the header in Canvas and Google Classroom exports.
    const metaPoints = new Map<number, number>(), metaDates = new Map<number, string>()
    const students_ = body.filter(({ r }) => {
      if (r.some(x => /^manual posting/i.test(x.trim()))) return false
      const first = (r[0] ?? '').trim(), probe = r.slice(0, 4).map(x => x.trim()).find(x => META_ROW.test(x)) ?? (META_ROW.test(first) ? first : '')
      if (!probe) return true
      for (const c of cols) {
        const v = cell(r, c)
        if (/points|out of|max/i.test(probe)) { const p = parseScore(v); if (p.kind === 'pts' && p.pts > 0) metaPoints.set(c, p.pts) }
        if (/date|due/i.test(probe)) { const d = parseDate(v); if (d) metaDates.set(c, d) }
      }
      return false
    })
    cols.forEach((c, k) => {
      const name = cleanAssessmentName(head[c] ?? `Column ${c + 1}`)
      const inlineMax = name.match(/\[(\d+(?:\.\d+)?)\s*(?:pts?|points)?\]|\((\d+(?:\.\d+)?)\s*(?:pts?|points)\)$/i)
      assessments.set(assessmentId(name), { id: assessmentId(name), name, date: metaDates.get(c) ?? '', order: k, max: metaPoints.get(c) ?? (inlineMax ? +(inlineMax[1] ?? inlineMax[2]) : 0), standards: [] })
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
        const a = assessments.get(assessmentId(head[c]))!
        const p = parseScore(cell(r, c))
        if (p.kind === 'blank') continue
        if (p.kind === 'missing') { missing++; continue }
        if (p.kind === 'excused') { excused++; continue }
        if (p.kind === 'bad') { issues.push({ line, level: 'warn', message: `"${cell(r, c)}" under "${a.name}" is not a score; ignored.` }); continue }
        if (p.kind === 'pct') { scores.push({ s: st.id, a: a.id, pts: p.pct * (a.max || 100) }); if (!a.max) a.max = 100 }
        else { if (p.max && !a.max) a.max = p.max; scores.push({ s: st.id, a: a.id, pts: p.pts }) }
        any = true
      }
      if (any) used++
      else issues.push({ line, level: 'warn', message: `${st.name} has no scores.` })
    }
    for (const a of assessments.values()) if (!a.max) {
      const top = Math.max(0, ...scores.filter(s => s.a === a.id).map(s => s.pts))
      a.max = top <= 4 ? 4 : top <= 10 ? 10 : 100
      issues.push({ line: csv.lines[0] ?? 1, level: 'warn', message: `No points possible for "${a.name}"; assumed ${a.max}. Edit it on the Assessments panel if that is wrong.` })
    }
    if (!metaDates.size && cols.length) issues.push({ line: csv.lines[0] ?? 1, level: 'warn', message: 'The export has no dates, so column order is used as time order. Add dates on the Assessments panel or with a mapping file.' })
  } else {
    let order = 0
    for (const { r, line } of body) {
      const st = studentFrom(r, map, kind)
      if (!st) { issues.push({ line, level: 'error', message: 'No student name or ID; row skipped.' }); continue }
      const name = cleanAssessmentName(cell(r, map.assessment))
      if (!name) { issues.push({ line, level: 'error', message: 'No assessment name; row skipped.' }); continue }
      const p = parseScore(cell(r, map.score))
      if (p.kind === 'blank') { issues.push({ line, level: 'warn', message: `Empty score for ${st.name} on "${name}".` }); continue }
      if (p.kind === 'missing') { missing++; continue }
      if (p.kind === 'excused') { excused++; continue }
      if (p.kind === 'bad') { issues.push({ line, level: 'error', message: `"${cell(r, map.score)}" is not a score; row skipped.` }); continue }
      const mxRaw = cell(r, map.max)
      const mx = mxRaw ? Number(mxRaw) : p.kind === 'pts' ? p.max ?? NaN : 100
      if (mxRaw && !(mx > 0)) { issues.push({ line, level: 'error', message: `Points possible "${mxRaw}" is not a positive number; row skipped.` }); continue }
      const id = assessmentId(name)
      const dRaw = cell(r, map.date), d = dRaw ? parseDate(dRaw) : ''
      if (dRaw && !d) issues.push({ line, level: 'warn', message: `Could not read the date "${dRaw}". Use YYYY-MM-DD.` })
      const a = assessments.get(id) ?? { id, name, date: '', order: order++, max: 0, standards: [] }
      if (d && !a.date) a.date = d
      if (mx > 0 && kind !== 'items') a.max = Math.max(a.max, mx)
      assessments.set(id, a)
      students.set(st.id, students.get(st.id)?.name ? { ...students.get(st.id)!, ...st } : st)
      const pts = p.kind === 'pct' ? p.pct * (mx > 0 ? mx : 100) : p.pts
      if (kind === 'items') {
        const codes = cell(r, map.standard).split(/[;|]+/).map(x => x.trim()).filter(Boolean).map(normalizeCode)
        const item = cell(r, map.item)
        if (!codes.length && !item) { issues.push({ line, level: 'error', message: 'No standard or item on this row; skipped.' }); continue }
        const max = mx > 0 ? mx : NaN
        if (!(max > 0)) { issues.push({ line, level: 'error', message: 'Item scores need points possible; row skipped.' }); continue }
        if (codes.length) for (const c of codes) { itemScores.push({ s: st.id, a: id, std: c, pts, max, ...(item ? { item: codes.length > 1 ? `${item}:${c}` : item } : {}) }); if (!a.standards.includes(c)) a.standards.push(c) }
        else itemScores.push({ s: st.id, a: id, std: '', pts, max, item })
      } else scores.push({ s: st.id, a: id, pts })
      used++
    }
    for (const a of assessments.values()) if (!a.max && kind !== 'items') { a.max = 100; issues.push({ line: 0, level: 'warn', message: `No points possible for "${a.name}"; assumed 100.` }) }
  }
  if (missing) issues.push({ line: 0, level: 'warn', message: `${missing} "missing" marks are not counted as evidence (a missing assessment is not a 0 on a standard). Chase those separately.` })
  if (excused) issues.push({ line: 0, level: 'warn', message: `${excused} excused marks ignored.` })
  const nRows = isWide(kind) ? students.size + issues.filter(i => i.level === 'error' && i.line > 0).length : body.length
  return {
    part: { students: [...students.values()], assessments: [...assessments.values()], scores, itemScores },
    issues, rows: nRows, used, skipped: issues.filter(i => i.level === 'error').length,
    summary: `${students.size} students, ${assessments.size} assessments, ${(scores.length + itemScores.length).toLocaleString()} scores`,
  }
}

// ---------- Merging ----------

/** Merges an imported part into a dataset. Re-importing the same file updates scores instead of duplicating them. */
export function mergeDataset(base: Dataset, part: Validation['part']): Dataset {
  const students = new Map(base.students.map(s => [s.id, s]))
  for (const s of part.students ?? []) students.set(s.id, { ...students.get(s.id), ...s, name: s.name || students.get(s.id)?.name || s.id })
  const assessments = new Map(base.assessments.map(a => [a.id, { ...a }]))
  let order = Math.max(-1, ...base.assessments.map(a => a.order)) + 1
  for (const a of part.assessments ?? []) {
    const cur = assessments.get(a.id)
    if (cur) assessments.set(a.id, { ...cur, date: a.date || cur.date, max: cur.max || a.max, standards: [...new Set([...cur.standards, ...a.standards])] })
    else assessments.set(a.id, { ...a, order: order++ })
  }
  for (const m of part.mapping ?? []) {
    const id = assessmentId(m.assessment)
    const cur = assessments.get(id) ?? { id, name: m.assessment, date: '', order: order++, max: 0, standards: [] }
    const re = m.reassessOf ? assessmentId(m.reassessOf) : cur.reassessOf
    assessments.set(id, { ...cur, standards: [...new Set([...cur.standards, ...m.standards])], items: { ...cur.items, ...m.items }, date: m.date ?? cur.date, max: m.max ?? cur.max, ...(re ? { reassessOf: re } : {}) })
  }
  const key = (s: Score) => `${s.s}|${s.a}`
  const scores = new Map(base.scores.map(s => [key(s), s]))
  for (const s of part.scores ?? []) scores.set(key(s), s)
  // Item rows are keyed by item label when there is one, so re-importing the same file replaces instead of adding.
  const ikey = (s: ItemScore) => `${s.s}|${s.a}|${s.item ? '#' + s.item : s.std}`
  const items = new Map<string, ItemScore>(base.itemScores.map(s => [ikey(s), s]))
  const fresh = new Map<string, ItemScore>()
  for (const s of part.itemScores ?? []) { const k = ikey(s); const f = fresh.get(k); fresh.set(k, f ? { ...f, pts: f.pts + s.pts, max: f.max + s.max } : s) }
  for (const [k, s] of fresh) items.set(k, s)
  const custom = new Map((base.customStandards ?? []).map(c => [c.code, c]))
  for (const c of part.customStandards ?? []) custom.set(c.code, c)
  return { students: [...students.values()], assessments: [...assessments.values()], scores: [...scores.values()], itemScores: [...items.values()], ...(custom.size ? { customStandards: [...custom.values()] } : {}) }
}
