import { scaleMax } from './mastery.ts'
import type { Config, Dataset, Scale } from './types.ts'

const fits = (max: number, scale: Scale) => max === 4 || max === 5 || max === scaleMax(scale)

/** Assessments with scores whose total is not a proficiency scale: 4, 5 or the top of the class's own scale. */
export function notLevels(ds: Dataset, scale: Scale): string[] {
  const whole = new Set(ds.scores.map(s => s.a))
  const items = new Set(ds.itemScores.filter(i => !fits(i.max, scale)).map(i => i.a))
  return ds.assessments.filter(a => items.has(a.id) || (whole.has(a.id) && !fits(a.max, scale))).map(a => a.name)
}

/** Level-scored gradebooks are read as levels; anything else as points. Null when there are no scores to judge by. */
export function detectScoreMode(ds: Dataset, scale: Scale): Config['scoreMode'] | null {
  if (!ds.scores.length && !ds.itemScores.length) return null
  return notLevels(ds, scale).length ? 'percent' : 'level'
}
