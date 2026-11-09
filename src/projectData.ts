import { useEffect, useMemo, useState } from 'react'
import { evidenceFor, matrix } from './engine/mastery.ts'
import { snapshot } from './engine/report.ts'
import { findStandard } from './engine/standards.ts'
import { generate, SAMPLE_TERMS, SAMPLES, sampleConfig } from './engine/sample.ts'
import type { Config, Dataset } from './engine/types.ts'
import { blankConfig, getData, getProjects, saveProject, useProjects, uuid, type Project } from './store.ts'

const sampleCache = new Map<string, Dataset>()
export function sampleData(id: string): Dataset | null {
  if (!SAMPLES.some(s => s.id === id)) return null
  if (!sampleCache.has(id)) sampleCache.set(id, generate(id))
  return sampleCache.get(id)!
}

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const ds = sampleData(sampleId)!
  const config = sampleConfig(sampleId)
  const snapshots = SAMPLE_TERMS[sampleId].map(t => snapshot(ds, config, uuid(), t.label, t.date))
  const now = Date.now()
  return saveProject({
    id: uuid(), name: def.name, createdAt: now, updatedAt: now, config, snapshots, sampleId,
    imports: [{ id: uuid(), kind: 'generic-wide', fileName: 'synthetic gradebook (Aug to Dec 2026)', rows: ds.students.length, skipped: 0, at: now }],
  })
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, config: blankConfig(), snapshots: [], imports: [] })
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const importsKey = project ? project.imports.map(i => i.id).join(',') + project.updatedAt : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) { setDs(sampleData(project.sampleId)); return }
    void getData(project.id).then(d => { if (live) setDs(d ?? { students: [], assessments: [], scores: [], itemScores: [] }) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey])
  const update = (patch: Partial<Project>) => project ? saveProject({ ...project, ...patch }) : Promise.resolve(null)
  const setConfig = (patch: Partial<Config>) => project && saveProject({ ...project, config: { ...project.config, ...patch } })
  return { loading: list === null || (project !== null && ds === null), project, ds, setDs, update, setConfig }
}

export function useAnalysis(ds: Dataset | null, cfg: Config | undefined) {
  return useMemo(() => {
    if (!ds || !cfg) return null
    const ev = evidenceFor(ds, cfg)
    return { ev, m: matrix(ds, cfg, cfg.method, ev) }
  }, [ds, cfg])
}

export const displayName = (s: { id: string; name: string }) => s.name || `Student ${s.id.slice(1, 6)}`
export const stdDesc = (code: string, ds?: Dataset | null) => findStandard(code, ds?.customStandards)?.desc ?? ''
export const stdQuery = (code: string, ds?: Dataset | null) => findStandard(code, ds?.customStandards)?.q ?? code
