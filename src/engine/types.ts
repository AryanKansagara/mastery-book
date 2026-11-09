export interface Level { value: number; label: string; /** Lowest percent (0..1) that earns this level when scores are points */ minPct: number; /** Plain-language meaning for families */ plain: string }

export interface Scale { id: string; name: string; levels: Level[]; /** Level value that counts as "met" */ proficient: number }

export type Method = 'recent' | 'highest' | 'mean' | 'decaying' | 'powerlaw' | 'mode' | 'recentN'
export type ReassessRule = 'replace' | 'highest' | 'average' | 'keep'

export interface GradeRule { letter: string; /** share mode: minimum share of standards at proficient or above (0..1) */ minShare: number; /** share mode: no standard may sit below this level (0 = no floor) */ floor: number; /** average mode: minimum average level */ minAvg: number }

export interface Config {
  scale: Scale
  /** 'percent': scores are points and get converted with the scale cut-offs. 'level': scores are already proficiency levels. */
  scoreMode: 'percent' | 'level'
  method: Method
  /** Decaying average weight on the newest score (0..1). PowerSchool's default is 0.65. */
  decay: number
  recentN: number
  reassess: ReassessRule
  /** How a calculated mastery value becomes a level on the scale */
  rounding: 'nearest' | 'down'
  grading: { mode: 'share' | 'average'; rules: GradeRule[] }
  groups: { k: number; maxSize: number }
}

export interface Student { id: string; name: string; section?: string }

export interface Assessment {
  id: string
  name: string
  /** YYYY-MM-DD, or '' when the export had no dates (column order is used) */
  date: string
  order: number
  max: number
  standards: string[]
  reassessOf?: string
  /** Item tags: item label -> standard code */
  items?: Record<string, string>
}

export interface Score { s: string; a: string; pts: number }
/** std is '' when the row only names an item; the assessment's item tags resolve it. */
export interface ItemScore { s: string; a: string; std: string; pts: number; max: number; item?: string }

export interface Dataset { students: Student[]; assessments: Assessment[]; scores: Score[]; itemScores: ItemScore[]; customStandards?: { code: string; desc: string }[] }

export interface Evidence { a: string; name: string; date: string; order: number; value: number; reassessOf?: string; /** Assessments folded into this one by a reassessment rule */ replaced?: string[]; note?: string }

export const emptyDataset = (): Dataset => ({ students: [], assessments: [], scores: [], itemScores: [] })
