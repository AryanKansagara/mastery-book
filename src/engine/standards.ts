import data from './ccss-math.json' with { type: 'json' }

export interface StandardDef { code: string; grade: string; desc: string; q: string }
export const CCSS: StandardDef[] = data.standards
export const CCSS_SOURCE = { source: data.source, url: data.url, license: data.license, attribution: data.attribution }
const byCode = new Map(CCSS.map(s => [s.code.toUpperCase(), s]))

/** Accepts "7.EE.A.1", "CCSS.MATH.CONTENT.7.EE.A.1", "7.EE.1" and "HSA-SSE.A.1" style codes. */
export function normalizeCode(raw: string): string {
  let c = raw.trim().toUpperCase().replace(/^CCSS\.MATH\.CONTENT\./, '').replace(/\s+/g, '')
  if (/^HS[NAFSG]\./.test(c)) c = c.slice(2).replace(/^([NAFSG])\.([A-Z]+)\./, '$1-$2.')
  else if (/^HS[NAFSG]-/.test(c)) c = c.slice(2)
  if (byCode.has(c)) return byCode.get(c)!.code
  // Without the cluster letter: 7.EE.1 -> 7.EE.A.1
  const m = c.match(/^([0-9]+\.[A-Z]+|[NAFSG]-[A-Z]+)\.(\d+)$/)
  if (m) { const hit = CCSS.find(s => s.code.toUpperCase().startsWith(m[1] + '.') && s.code.endsWith('.' + m[2])); if (hit) return hit.code }
  return raw.trim()
}

export const findStandard = (code: string, custom: { code: string; desc: string }[] = []) =>
  byCode.get(code.toUpperCase()) ?? (() => { const c = custom.find(x => x.code === code); return c ? { code: c.code, grade: '', desc: c.desc, q: c.desc } : undefined })()
