import { describe, expect, it, beforeEach } from 'vitest'
import { WORLD } from './config'
import { resolveRelativeDir } from './direction'
import { OPS, encodeStructuralDir, passesWhen } from './genome'
import {
  createPlant,
  executeGrowthVM,
  resetIdCounters,
  setIdCounters,
} from './plant'
import { Rng } from './rng'
import type { Direction, Genome, Plant, PlantCell } from './types'

const OP = (name: string): number => OPS.indexOf(name as (typeof OPS)[number])
const SD = (d: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'): number => encodeStructuralDir(d)
/** WHEN с порогом 0 — проходит при пустом стеке */
const WHEN_ALWAYS = 0

function genomeFromTokens(tokens: number[]): Genome {
  return { code: Uint8Array.from(tokens) }
}

function emptyOccupancy(): Int32Array[] {
  const occ: Int32Array[] = []
  for (let y = 0; y < WORLD.H; y++) {
    occ.push(new Int32Array(WORLD.W))
  }
  return occ
}

function placePlant(plant: Plant, occupancy: Int32Array[]): void {
  for (const c of plant.cells) {
    occupancy[c.y][c.x] = plant.id
  }
}

function runVm(plant: Plant, occupancy: Int32Array[]): void {
  executeGrowthVM(plant, [plant], occupancy, new Float32Array(WORLD.W * WORLD.H), new Float32Array(WORLD.W * WORLD.H), new Rng(1))
}

function addSoilAnchor(plant: Plant, x: number): void {
  plant.cells.push({
    id: plant.cells.length + 100,
    x,
    y: WORLD.SOIL_Y,
    type: 'ROOT',
    dir: 'DOWN',
    cellEnergy: 5,
    age: 0,
    waitingForGrow: false,
  })
}

function sproutAt(plant: Plant, x: number, y: number, dir: Direction, energy = 20): PlantCell {
  const cell: PlantCell = {
    id: plant.cells.length + 1,
    x,
    y,
    type: 'SPROUT',
    dir,
    cellEnergy: energy,
    age: 0,
    waitingForGrow: false,
  }
  plant.cells.push(cell)
  return cell
}

describe('plant orientation integration', () => {
  beforeEach(() => {
    resetIdCounters()
  })

  it('BRANCH UP on dir=RIGHT grows forward (world RIGHT)', () => {
    const genome = genomeFromTokens([
      OP('BRANCH'),
      SD('UP'),
      WHEN_ALWAYS,
    ])
    const plant = createPlant(genome, 30, WORLD.SOIL_Y, 0, 30)
    plant.cells = []
    const parent = sproutAt(plant, 30, WORLD.SOIL_Y, 'RIGHT')
    const occ = emptyOccupancy()
    placePlant(plant, occ)

    runVm(plant, occ)

    const child = plant.cells.find((c) => c.type === 'SPROUT' && c.id !== parent.id)
    expect(child).toBeDefined()
    expect(child!.x).toBe(31)
    expect(child!.y).toBe(WORLD.SOIL_Y)
    expect(child!.dir).toBe('RIGHT')
    expect(parent.dir).toBe('RIGHT')
  })

  it('BRANCH LEFT on dir=UP grows perpendicular (world LEFT)', () => {
    const genome = genomeFromTokens([OP('BRANCH'), SD('LEFT'), WHEN_ALWAYS])
    const plant = createPlant(genome, 30, WORLD.SOIL_Y, 0, 30)
    plant.cells = []
    const parent = sproutAt(plant, 30, WORLD.SOIL_Y, 'UP')
    const occ = emptyOccupancy()
    placePlant(plant, occ)

    runVm(plant, occ)

    const child = plant.cells.find((c) => c.type === 'SPROUT' && c.id !== parent.id)
    expect(child).toBeDefined()
    expect(child!.x).toBe(29)
    expect(child!.y).toBe(WORLD.SOIL_Y)
    expect(child!.dir).toBe('LEFT')
  })

  it('GROW with DIR UP on dir=DOWN continues root downward', () => {
    const genome = genomeFromTokens([
      OP('DIR'),
      0,
      OP('GROW'),
      WHEN_ALWAYS,
    ])
    const plant = createPlant(genome, 30, WORLD.SOIL_Y + 1, 0, 30)
    plant.cells = []
    addSoilAnchor(plant, 30)
    const parent = sproutAt(plant, 30, WORLD.SOIL_Y + 1, 'DOWN')
    const occ = emptyOccupancy()
    placePlant(plant, occ)

    runVm(plant, occ)

    expect(parent.type).toBe('ROOT')
    const child = plant.cells.find((c) => c.type === 'SPROUT')
    expect(child).toBeDefined()
    expect(child!.y).toBe(WORLD.SOIL_Y + 2)
    expect(child!.dir).toBe('DOWN')
  })

  it('SEED uses absolute world direction from DIR opcode', () => {
    const genome = genomeFromTokens([
      OP('DIR'),
      0, // UP absolute
      OP('SEED'),
      50,
      WHEN_ALWAYS,
    ])
    const plant = createPlant(genome, 30, WORLD.SOIL_Y - 5, 0, 40)
    plant.cells = []
    addSoilAnchor(plant, 30)
    sproutAt(plant, 30, WORLD.SOIL_Y - 5, 'RIGHT')
    const occ = emptyOccupancy()
    placePlant(plant, occ)

    runVm(plant, occ)

    const seed = plant.cells.find((c) => c.type === 'SEED')
    expect(seed).toBeDefined()
    expect(seed!.x).toBe(30)
    expect(seed!.y).toBe(WORLD.SOIL_Y - 6)
  })

  it('SHOOT ray is relative to spike orientation', () => {
    setIdCounters(1, 10)
    const genome = genomeFromTokens([OP('SHOOT'), SD('LEFT'), WHEN_ALWAYS])
    const plant = createPlant(genome, 30, WORLD.SOIL_Y - 3, 0, 50)
    plant.cells = []
    addSoilAnchor(plant, 30)
    const meristem = sproutAt(plant, 30, WORLD.SOIL_Y - 3, 'UP', 50)
    plant.cells.push({
      id: 99,
      x: 29,
      y: WORLD.SOIL_Y - 3,
      type: 'SPIKE',
      dir: 'UP',
      cellEnergy: 5,
      age: 0,
      waitingForGrow: false,
    })
    const target = createPlant({ code: new Uint8Array(0) }, 28, WORLD.SOIL_Y - 3, 0, 5)
    target.id = 2
    target.cells = [{
      id: 200,
      x: 28,
      y: WORLD.SOIL_Y - 3,
      type: 'SPROUT',
      dir: 'UP',
      cellEnergy: 1,
      age: 0,
      waitingForGrow: false,
    }]

    const occ = emptyOccupancy()
    placePlant(plant, occ)
    placePlant(target, occ)

    executeGrowthVM(
      plant,
      [plant, target],
      occ,
      new Float32Array(WORLD.W * WORLD.H).fill(1),
      new Float32Array(WORLD.W * WORLD.H),
      new Rng(1),
    )

    expect(target.cells.some((c) => c.type === 'SPROUT')).toBe(false)
    expect(meristem.cellEnergy).toBeLessThan(50)
  })
})

describe('passesWhen sanity', () => {
  it('threshold 0 passes empty stack', () => {
    expect(passesWhen([], WHEN_ALWAYS, null)).toBe(true)
  })
})

describe('resolveRelativeDir branch scenario', () => {
  it('horizontal branch LEFT gives world UP', () => {
    expect(resolveRelativeDir('RIGHT', 'LEFT')).toBe('UP')
  })
})
