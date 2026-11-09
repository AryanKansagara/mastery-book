import type { Matrix } from './mastery.ts'
import type { Config } from './types.ts'

export interface Group { id: number; students: { id: string; name: string; unmet: string[] }[]; focus: { code: string; count: number }[] }
export interface Grouping { groups: Group[]; onTrack: { id: string; name: string }[]; k: number; requestedK: number }

const dist = (a: number[], b: number[]) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0)

/**
 * Clusters students by their gaps (how far below proficient they are on each standard) into k groups of at most maxSize.
 * Deterministic: farthest-point seeding from the student with the largest total gap, then capacity-constrained
 * assignment (biggest gaps placed first) and centroid updates until nothing moves.
 */
export function reteachGroups(m: Matrix, cfg: Config): Grouping {
  const prof = cfg.scale.proficient
  const people = m.students.map((s, i) => {
    const gaps = m.cells[i].map(c => c ? Math.max(0, prof - c.level) : 0)
    return { ...s, gaps, unmet: m.standards.filter((_, j) => gaps[j] > 0), total: gaps.reduce((a, b) => a + b, 0) }
  })
  const need = people.filter(p => p.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  const onTrack = people.filter(p => p.total === 0).map(({ id, name }) => ({ id, name }))
  const maxSize = Math.max(1, Math.round(cfg.groups.maxSize))
  const requestedK = Math.max(1, Math.round(cfg.groups.k))
  const k = Math.min(need.length, Math.max(requestedK, Math.ceil(need.length / maxSize)))
  if (!k) return { groups: [], onTrack, k: 0, requestedK }

  const centroids: number[][] = [need[0].gaps.slice()]
  while (centroids.length < k) {
    let best = -1, bestD = -1
    need.forEach((p, i) => {
      const d = Math.min(...centroids.map(c => dist(p.gaps, c)))
      if (d > bestD + 1e-9) { bestD = d; best = i }
    })
    centroids.push(need[best].gaps.slice())
  }

  let assign: number[] = []
  for (let iter = 0; iter < 25; iter++) {
    const size = new Array(k).fill(0)
    const next = new Array(need.length).fill(-1)
    // Place students with the clearest preference first so capacity limits bend the fewest choices.
    const order = need.map((p, i) => {
      const ds = centroids.map(c => dist(p.gaps, c)).sort((a, b) => a - b)
      return { i, margin: (ds[1] ?? Infinity) - ds[0] }
    }).sort((a, b) => b.margin - a.margin || a.i - b.i)
    for (const { i } of order) {
      const ranked = centroids.map((c, g) => ({ g, d: dist(need[i].gaps, c) })).sort((a, b) => a.d - b.d || a.g - b.g)
      const pick = ranked.find(r => size[r.g] < maxSize) ?? ranked[0]
      next[i] = pick.g
      size[pick.g]++
    }
    const stable = next.every((g, i) => g === assign[i])
    assign = next
    for (let g = 0; g < k; g++) {
      const members = need.filter((_, i) => assign[i] === g)
      if (members.length) centroids[g] = members[0].gaps.map((_, j) => members.reduce((s, p) => s + p.gaps[j], 0) / members.length)
    }
    if (stable) break
  }

  const groups: Group[] = []
  for (let g = 0; g < k; g++) {
    const members = need.filter((_, i) => assign[i] === g)
    if (!members.length) continue
    const all = m.standards.map((code, j) => ({ code, count: members.filter(p => p.gaps[j] > 0).length, gap: members.reduce((s, p) => s + p.gaps[j], 0) }))
      .filter(f => f.count > 0)
      .sort((a, b) => b.count - a.count || b.gap - a.gap)
    // Shared needs (at least half the group); if needs are scattered, the two most common.
    const shared = all.filter(f => f.count * 2 >= members.length)
    const focus = (shared.length ? shared.slice(0, 3) : all.slice(0, 2)).map(({ code, count }) => ({ code, count }))
    groups.push({ id: 0, students: members.map(p => ({ id: p.id, name: p.name, unmet: p.unmet })).sort((a, b) => a.name.localeCompare(b.name)), focus })
  }
  // Biggest shared need first.
  groups.sort((a, b) => (b.focus[0]?.count ?? 0) - (a.focus[0]?.count ?? 0) || b.students.length - a.students.length)
  groups.forEach((g, i) => { g.id = i + 1 })
  return { groups, onTrack, k, requestedK }
}
