import data from './ccss-math.json' with { type: 'json' }

export interface StandardDef { code: string; grade: string; desc: string; q: string }
export const CCSS: StandardDef[] = data.standards
export const CCSS_SOURCE = { source: data.source, url: data.url, license: data.license, attribution: data.attribution }
const byCode = new Map(CCSS.map(s => [s.code.toUpperCase(), s]))

/** Accepts "7.EE.A.1", "CCSS.MATH.CONTENT.7.EE.A.1", "7.EE.1" and "HSA-SSE.A.1" style codes. */
export function normalizeCode(raw: string): string {
  let c = raw.trim().toUpperCase().replace(/^CCSS\.MATH\.CONTENT\./, '').replace(/\s+/g, '')
  // Sub-standards: "7.EE.B.4a", "7.EE.4a" and the official "CCSS.MATH.CONTENT.7.EE.B.4.A" all become "7.EE.B.4a".
  const sub = c.match(/^(.*\.\d+)\.?([A-F])$/)
  if (sub) { const base = normalizeCode(sub[1]); return byCode.has(base.toUpperCase()) ? base + sub[2].toLowerCase() : raw.trim() }
  if (/^HS[NAFSG]\./.test(c)) c = c.slice(2).replace(/^([NAFSG])\.([A-Z]+)\./, '$1-$2.')
  else if (/^HS[NAFSG]-/.test(c)) c = c.slice(2)
  if (byCode.has(c)) return byCode.get(c)!.code
  // Without the cluster letter: 7.EE.1 -> 7.EE.A.1
  const m = c.match(/^([0-9]+\.[A-Z]+|[NAFSG]-[A-Z]+)\.(\d+)$/)
  if (m) { const hit = CCSS.find(s => s.code.toUpperCase().startsWith(m[1] + '.') && s.code.endsWith('.' + m[2])); if (hit) return hit.code }
  return raw.trim()
}

export function findStandard(code: string, custom: { code: string; desc: string }[] = []): StandardDef | undefined {
  const hit = byCode.get(code.toUpperCase())
  if (hit) return hit
  const c = custom.find(x => x.code === code)
  if (c) return { code: c.code, grade: '', desc: c.desc, q: c.desc }
  // A sub-standard reads its parent's description.
  const parent = /^(.*\d)[a-f]$/.test(code) ? byCode.get(code.slice(0, -1).toUpperCase()) : undefined
  return parent && { ...parent, code }
}
