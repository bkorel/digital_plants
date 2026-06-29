import { describe, expect, it } from 'vitest'
import { hardyTemplateGenome } from './genome'
import { LabSession } from './labSession'
import { buildGenomeStepTraceView } from './genomeStepTrace'
import { Rng } from './rng'

describe('buildGenomeStepTraceView', () => {
  it('строит подсветку шага для живого корня', () => {
    const genome = hardyTemplateGenome(new Rng(7))
    const session = new LabSession(genome)
    const trace = session.traceRootGrowth()
    expect(trace).not.toBeNull()
    expect(trace!.runs.length).toBeGreaterThan(0)

    const view = buildGenomeStepTraceView(genome, trace!, 1)
    expect(view.tick).toBe(1)
    expect(view.sequence.length).toBeGreaterThan(0)

    const kinds = new Set(view.sequence.map((e) => e.kind))
    expect(kinds.has('executed') || kinds.has('sense') || kinds.has('skipped')).toBe(true)
  })

  it('не включает клетки с исчерпанным бюджетом', () => {
    const genome = hardyTemplateGenome(new Rng(99))
    const session = new LabSession(genome)
    for (let i = 0; i < 50; i++) session.tick()
    const trace = session.traceRootGrowth()
    expect(trace).not.toBeNull()

    const budgetWait = trace!.runs.filter(
      (r) => r.steps.length === 1 && (r.steps[0]?.ip ?? -1) < 0,
    )
    const view = buildGenomeStepTraceView(genome, trace!, session.world.tickCount)
    for (const entry of view.sequence) {
      expect(budgetWait.some((w) => w.cellId === entry.cellId)).toBe(false)
    }
    expect(view.tracedCellCount).toBeGreaterThan(0)
  })
})
