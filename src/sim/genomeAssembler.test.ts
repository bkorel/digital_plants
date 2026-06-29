import { describe, expect, it } from 'vitest'
import {
  disassemble,
  hardyTemplateGenome,
  shyPlantTemplateGenome,
  spikeShooterTemplateGenome,
} from './genome'
import { assembleFromLines, assembleProgram, linesToProgram, parseInstructionLine } from './genomeAssembler'
import { GENOME_BLOCKS, SNIPPETS } from './genomeSnippets'
import { Rng } from './rng'

function roundTripText(genome: ReturnType<typeof hardyTemplateGenome>) {
  const lines = disassemble(genome)
  const text = linesToProgram(lines)
  const { genome: assembled, errors } = assembleProgram(text)
  expect(errors).toEqual([])
  const lines2 = disassemble(assembled)
  expect(lines2.map((l) => l.text)).toEqual(lines.map((l) => l.text))
}

describe('parseInstructionLine', () => {
  it('parses stack ops', () => {
    expect(parseInstructionLine('NOP').bytes).toEqual([0])
    expect(parseInstructionLine('PUSH 0.50').bytes).toHaveLength(2)
    expect(parseInstructionLine('SENSE ENERGY').bytes[1]).toBe(0)
  })

  it('parses structural ops', () => {
    const r = parseInstructionLine('BRANCH UP WHEN≥0.50')
    expect(r.error).toBeUndefined()
    expect(r.bytes).toHaveLength(3)
  })

  it('parses WHEN prev ok/fail', () => {
    expect(parseInstructionLine('GROW WHEN prev ok').bytes[1]).toBe(250)
    expect(parseInstructionLine('GROW WHEN prev fail').bytes[1]).toBe(251)
  })

  it('parses GOTO', () => {
    const r = parseInstructionLine('BRANCH GOTO +15 WHEN≥0.50')
    expect(r.error).toBeUndefined()
    expect(r.bytes[1]).toBe(15)
  })

  it('reports errors', () => {
    expect(parseInstructionLine('FOO').error).toBeDefined()
    expect(parseInstructionLine('PUSH').error).toBeDefined()
  })
})

describe('assemble round-trip', () => {
  it('hardy template', () => {
    roundTripText(hardyTemplateGenome(new Rng(42)))
  })

  it('spike shooter template', () => {
    roundTripText(spikeShooterTemplateGenome())
  })

  it('shy plant template', () => {
    roundTripText(shyPlantTemplateGenome())
  })

  it('assembleFromLines matches program', () => {
    const lines = ['NOP', 'SENSE LIGHT', 'PUSH 0.50', 'GT', 'GROW WHEN≥0.50']
    const g = assembleFromLines(lines)
    expect(disassemble(g).map((l) => l.text)).toEqual(lines)
  })

  it('assembles genome blocks without errors', () => {
    for (const block of GENOME_BLOCKS) {
      const { genome, errors } = assembleProgram(block.lines.join('\n'))
      expect(errors, block.id).toEqual([])
      expect(genome.code.length).toBeGreaterThan(0)
    }
  })

  it('assembles all snippets without errors', () => {
    for (const snippet of SNIPPETS) {
      const { errors } = assembleProgram(snippet.lines.join('\n'))
      expect(errors, snippet.id).toEqual([])
    }
  })
})
