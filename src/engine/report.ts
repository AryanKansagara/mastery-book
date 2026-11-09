import { compareMethods, levelInfo, matrix, methodLabel, rowGrade, upTo, type Matrix } from './mastery.ts'
import { toCsv } from './csv.ts'
import { xlsx, type XCell } from './xlsx.ts'
import type { Config, Dataset, Method } from './types.ts'

// ---------- Term snapshots ----------

export interface Snapshot {
  id: string
  label: string
  /** Evidence on or before this date (YYYY-MM-DD) */
  date: string
  at: number
  method: Method
  standards: string[]
  /** Pseudonymous student ids only; names stay on the device. */
  rows: { sid: string; letter: string; levels: Record<string, number> }[]
  share: number
}

export function snapshot(ds: Dataset, cfg: Config, id: string, label: string, date: string): Snapshot {
  const m = matrix(upTo(ds, date), cfg)
  let met = 0, n = 0
  const rows = m.students.map((s, i) => {
    const levels: Record<string, number> = {}
    m.cells[i].forEach((c, j) => { if (c) { levels[m.standards[j]] = c.level; n++; if (c.level >= cfg.scale.proficient) met++ } })
    return { sid: s.id, letter: rowGrade(m.cells[i], cfg).letter, levels }
  })
  return { id, label, date, at: Date.now(), method: cfg.method, standards: m.standards, rows, share: n ? met / n : 0 }
}

export interface SnapshotDiff {
  share: { before: number; after: number }
  students: { sid: string; before: string | null; after: string | null; move: number }[]
  standards: { code: string; before: number | null; after: number | null }[]
  up: number; down: number; same: number
}

export function compareSnapshots(a: Snapshot, b: Snapshot, cfg: Config): SnapshotDiff {
  const rank = (l: string | null) => { if (!l) return null; const i = cfg.grading.rules.findIndex(r => r.letter === l); return i < 0 ? null : i }
  const ids = [...new Set([...a.rows.map(r => r.sid), ...b.rows.map(r => r.sid)])]
  const students = ids.map(sid => {
    const before = a.rows.find(r => r.sid === sid)?.letter ?? null, after = b.rows.find(r => r.sid === sid)?.letter ?? null
    const rb = rank(before), ra = rank(after)
    return { sid, before, after, move: rb !== null && ra !== null ? rb - ra : 0 }
  })
  const shareOf = (s: Snapshot, code: string) => {
    const ls = s.rows.map(r => r.levels[code]).filter((x): x is number => x !== undefined)
    return ls.length ? ls.filter(l => l >= cfg.scale.proficient).length / ls.length : null
  }
  const codes = [...new Set([...a.standards, ...b.standards])]
  return {
    share: { before: a.share, after: b.share },
    students,
    standards: codes.map(code => ({ code, before: shareOf(a, code), after: shareOf(b, code) })),
    up: students.filter(s => s.move > 0).length, down: students.filter(s => s.move < 0).length, same: students.filter(s => s.move === 0).length,
  }
}

// ---------- Heatmap export ----------

/** Fill colors per level, low to high, matching the on-screen heatmap. */
export const LEVEL_FILLS = ['#FDDFDF', '#FEF1D0', '#D5F3D5', '#BFCAFF', '#DFEAFF']
export function fillFor(level: number, cfg: Config): string {
  const values = cfg.scale.levels.map(l => l.value).sort((a, b) => a - b)
  const i = values.indexOf(level)
  const palette = values.length <= 3 ? ['#FDDFDF', '#D5F3D5', '#BFCAFF'] : values.length === 4 ? ['#FDDFDF', '#FEF1D0', '#D5F3D5', '#BFCAFF'] : ['#EDEDEE', '#FDDFDF', '#FEF1D0', '#D5F3D5', '#BFCAFF']
  return palette[Math.max(0, i)] ?? palette[palette.length - 1]
}

export function heatmapRows(m: Matrix, cfg: Config, names = true): (string | number)[][] {
  const head = ['Student', ...m.standards, 'Standards met', 'Letter']
  const body = m.students.map((s, i) => {
    const g = rowGrade(m.cells[i], cfg)
    return [names ? s.name : s.id, ...m.cells[i].map(c => c ? c.level : ''), `${g.nMet}/${g.nAssessed}`, g.letter]
  })
  const met = m.standards.map((_, j) => {
    const cs = m.cells.map(r => r[j]).filter(Boolean)
    return cs.length ? `${Math.round(cs.filter(c => c!.level >= cfg.scale.proficient).length / cs.length * 100)}%` : ''
  })
  return [head, ...body, ['Class: % proficient', ...met, '', '']]
}

export const heatmapCsv = (m: Matrix, cfg: Config) => toCsv(heatmapRows(m, cfg))

export function heatmapXlsx(ds: Dataset, cfg: Config, descs: Record<string, string>): Uint8Array {
  const m = matrix(ds, cfg)
  const rows = heatmapRows(m, cfg)
  const sheet1: XCell[][] = rows.map((r, ri) => r.map((v, ci) => {
    const isLevel = ri > 0 && ri < rows.length - 1 && ci > 0 && ci <= m.standards.length && typeof v === 'number'
    return { v, bold: ri === 0 || ri === rows.length - 1 || ci === 0, ...(isLevel ? { fill: fillFor(v as number, cfg) } : {}) }
  }))
  const cmp = compareMethods(ds, cfg)
  const sheet2: XCell[][] = [
    ['Student', ...cmp.methods.map(x => methodLabel(x, cfg)), 'Letters differ by'].map(v => ({ v, bold: true })),
    ...cmp.rows.map(r => [{ v: r.name, bold: true }, ...cmp.methods.map(x => ({ v: r.letters[x] })), { v: r.spread }]),
  ]
  const sheet3: XCell[][] = [
    [{ v: 'Standard', bold: true }, { v: 'Description', bold: true }],
    ...m.standards.map(c => [{ v: c }, { v: descs[c] ?? '' }]),
    [],
    [{ v: 'Scale', bold: true }],
    ...cfg.scale.levels.map(l => [{ v: l.value, fill: fillFor(l.value, cfg) }, { v: levelInfo(l.value, cfg.scale).label }]),
    [],
    [{ v: `Method: ${methodLabel(cfg.method, cfg)}. Reassessments: ${cfg.reassess}.` }],
  ]
  return xlsx([
    { name: 'Heatmap', rows: sheet1, widths: [24, ...m.standards.map(() => 11), 14, 8] },
    { name: 'Method comparison', rows: sheet2, widths: [24, ...cmp.methods.map(() => 16), 16] },
    { name: 'Standards', rows: sheet3, widths: [14, 80] },
  ])
}
