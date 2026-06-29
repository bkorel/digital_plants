import { describe, expect, it } from 'vitest'
import { assembleFromLines } from './genomeAssembler'
import { buildGenomeCoverage, ipToLineIndex } from './genomeExecution'
import { disassemble } from './genome'

describe('genomeExecution', () => {
  it('maps ip to disasm line index', () => {
    const genome = assembleFromLines(['NOP', 'SENSE ENERGY', 'PUSH 0.30', 'GT'])
    const lines = disassemble(genome)
    expect(ipToLineIndex(lines, 0)).toBe(0)
    expect(ipToLineIndex(lines, lines[1]!.index)).toBe(1)
  })

  it('builds coverage from ip hits', () => {
    const genome = assembleFromLines([
      'NOP',
      'SENSE ENERGY',
      'PUSH 0.30',
      'GT',
      'GROW WHEN≥0.50',
    ])
    const lines = disassemble(genome)
    const ipHits = new Uint32Array(genome.code.length)
    const structuralHits = new Uint8Array(genome.code.length)
    ipHits[0] = 2
    ipHits[lines[4]!.index] = 1
    structuralHits[lines[4]!.index] = 1

    const cov = buildGenomeCoverage(genome, ipHits, structuralHits, lines[4]!.index, 42)
    expect(cov.hitLineIndices).toContain(0)
    expect(cov.hitLineIndices).toContain(4)
    expect(cov.structuralLineIndices).toEqual([4])
    expect(cov.stopLineIndex).toBe(4)
    expect(cov.stopTick).toBe(42)
  })
})
