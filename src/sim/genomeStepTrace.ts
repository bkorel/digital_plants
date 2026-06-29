import { disassemble, type DisasmLine } from './genome'
import { ipToLineIndex } from './genomeExecution'
import type { GrowthVmTrace, MeristemRunTrace, VmStepTrace } from './plant'
import type { Genome } from './types'

export type StepLineKind = 'executed' | 'skipped' | 'sense'

export interface StepLineHighlight {
  kind: StepLineKind
  detail?: string
  cellIds: number[]
}

export interface StepTraceSequenceEntry {
  lineIndex: number
  kind: StepLineKind
  detail?: string
  cellId: number
  opcode: string
}

export interface GenomeStepTraceView {
  tick: number
  lineHighlights: Map<number, StepLineHighlight>
  sequence: StepTraceSequenceEntry[]
  /** Меристемы с реальным движением (не wait) */
  activeCellCount: number
  /** Меристемы, у которых VM прошла по коду в этом тике */
  tracedCellCount: number
}

function isBudgetExhaustedRun(run: MeristemRunTrace): boolean {
  return run.steps.length === 1 && (run.steps[0]?.ip ?? -1) < 0
}

function isActiveMeristemRun(run: MeristemRunTrace): boolean {
  return run.actionsTaken > 0 || run.matured || run.attempted
}

function classifyVmStep(
  step: VmStepTrace,
  lines: DisasmLine[],
): Array<{ lineIndex: number; kind: StepLineKind; detail?: string }> {
  if (step.ip < 0) return []

  const entries: Array<{ lineIndex: number; kind: StepLineKind; detail?: string }> = []
  const selfLine = ipToLineIndex(lines, step.ip)
  if (selfLine == null) return []

  if (step.skippedNext) {
    entries.push({ lineIndex: selfLine, kind: 'executed', detail: step.note })
    const skippedIp = step.ip + 1
    const skippedLine = ipToLineIndex(lines, skippedIp)
    if (skippedLine != null && skippedLine !== selfLine) {
      entries.push({
        lineIndex: skippedLine,
        kind: 'skipped',
        detail: `пропущено IF: ${formatInstrAt(lines, skippedIp)}`,
      })
    }
    return entries
  }

  if (step.structuralAttempt) {
    entries.push({
      lineIndex: selfLine,
      kind: step.structuralSuccess ? 'executed' : 'skipped',
      detail: step.note,
    })
    return entries
  }

  const structuralOps = new Set(['GROW', 'BRANCH', 'SEED', 'SPIKE', 'SHOOT'])
  if (structuralOps.has(step.opcode)) {
    entries.push({ lineIndex: selfLine, kind: 'skipped', detail: step.note })
    return entries
  }

  if (step.opcode === 'SENSE') {
    entries.push({ lineIndex: selfLine, kind: 'sense', detail: step.note })
    return entries
  }

  entries.push({ lineIndex: selfLine, kind: 'executed', detail: step.note })
  return entries
}

function formatInstrAt(lines: DisasmLine[], ip: number): string {
  const line = ipToLineIndex(lines, ip)
  if (line != null) return lines[line]!.text
  return `ip ${ip}`
}

const KIND_PRIORITY: Record<StepLineKind, number> = {
  sense: 3,
  skipped: 2,
  executed: 1,
}

function mergeHighlight(
  map: Map<number, StepLineHighlight>,
  lineIndex: number,
  kind: StepLineKind,
  detail: string | undefined,
  cellId: number,
): void {
  const prev = map.get(lineIndex)
  if (!prev) {
    map.set(lineIndex, { kind, detail, cellIds: [cellId] })
    return
  }
  const mergedKind =
    KIND_PRIORITY[kind] > KIND_PRIORITY[prev.kind] ? kind : prev.kind
  const mergedDetail =
    mergedKind === kind && detail ? detail : prev.detail ?? detail
  const cellIds = prev.cellIds.includes(cellId) ? prev.cellIds : [...prev.cellIds, cellId]
  map.set(lineIndex, { kind: mergedKind, detail: mergedDetail, cellIds })
}

export function buildGenomeStepTraceView(
  genome: Genome,
  trace: GrowthVmTrace,
  tick: number,
): GenomeStepTraceView {
  const lines = disassemble(genome)
  const lineHighlights = new Map<number, StepLineHighlight>()
  const sequence: StepTraceSequenceEntry[] = []

  let activeCellCount = 0
  let tracedCellCount = 0
  for (const run of trace.runs) {
    if (isBudgetExhaustedRun(run)) continue
    tracedCellCount++
    const active = isActiveMeristemRun(run)
    if (active) activeCellCount++

    for (const step of run.steps) {
      const classified = classifyVmStep(step, lines)
      for (const entry of classified) {
        if (entry.kind === 'sense' && !active) continue
        sequence.push({
          lineIndex: entry.lineIndex,
          kind: entry.kind,
          detail: entry.detail,
          cellId: run.cellId,
          opcode: step.opcode,
        })
        mergeHighlight(lineHighlights, entry.lineIndex, entry.kind, entry.detail, run.cellId)
      }
    }
  }

  return { tick, lineHighlights, sequence, activeCellCount, tracedCellCount }
}
