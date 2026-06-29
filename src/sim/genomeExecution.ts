import { disassemble, type DisasmLine } from './genome'
import type { Genome } from './types'

/** Лёгкая запись исполнения байткода (без полной VM-трассировки). */
export interface GenomeExecutionRecorder {
  onStep(ip: number): void
  onStructuralSuccess(ip: number): void
  onStop(ip: number): void
}

export interface LabGenomeCoverage {
  /** Индексы строк дизассемблера, хотя бы раз исполненных */
  hitLineIndices: number[]
  /** Строки, где структурная инструкция прошла успешно */
  structuralLineIndices: number[]
  /** Строка последней остановки VM */
  stopLineIndex: number | null
  stopIp: number | null
  stopTick: number
  /** Попаданий по строкам (параллельно disassemble) */
  lineHitCounts: number[]
}

export function createGenomeExecutionRecorder(
  codeLength: number,
  ipHits: Uint32Array,
  structuralHits: Uint8Array,
  stop: { ip: number | null },
): GenomeExecutionRecorder {
  return {
    onStep(ip: number) {
      if (ip >= 0 && ip < codeLength) ipHits[ip]++
    },
    onStructuralSuccess(ip: number) {
      if (ip >= 0 && ip < codeLength) structuralHits[ip] = 1
    },
    onStop(ip: number) {
      if (ip >= 0 && ip < codeLength) {
        stop.ip = ip
      }
    },
  }
}

export function ipToLineIndex(lines: DisasmLine[], ip: number): number | null {
  if (lines.length === 0 || ip < 0) return null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (ip >= line.index && ip < line.index + line.byteLength) return i
  }
  return lines.length - 1
}

export function buildGenomeCoverage(
  genome: Genome,
  ipHits: Uint32Array,
  structuralHits: Uint8Array,
  stopIp: number | null,
  stopTick: number,
): LabGenomeCoverage {
  return buildGenomeCoverageForLines(disassemble(genome), ipHits, structuralHits, stopIp, stopTick)
}

export function buildGenomeCoverageForLines(
  lines: DisasmLine[],
  ipHits: Uint32Array,
  structuralHits: Uint8Array,
  stopIp: number | null,
  stopTick: number,
): LabGenomeCoverage {
  const lineHitCounts = lines.map((line) => {
    let sum = 0
    for (let b = line.index; b < line.index + line.byteLength; b++) {
      sum += ipHits[b] ?? 0
    }
    return sum
  })

  const hitLineIndices: number[] = []
  const structuralLineIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lineHitCounts[i]! > 0) hitLineIndices.push(i)
    const line = lines[i]!
    for (let b = line.index; b < line.index + line.byteLength; b++) {
      if (structuralHits[b]) {
        structuralLineIndices.push(i)
        break
      }
    }
  }

  return {
    hitLineIndices,
    structuralLineIndices,
    stopLineIndex: stopIp != null ? ipToLineIndex(lines, stopIp) : null,
    stopIp,
    stopTick,
    lineHitCounts,
  }
}
