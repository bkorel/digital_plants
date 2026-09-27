import { beforeEach, describe, expect, it } from 'vitest'
import { WORLD } from './config'
import { applyWorldFoliageRules } from './foliage'
import { setPlantEventSink, type PlantTickEvent } from './plantEvents'
import type { CellType, Genome, Plant, PlantCell } from './types'

const genome: Genome = { code: Uint8Array.from([1, 2, 3, 4, 5, 6]) }

function cell(id: number, x: number, y: number, type: CellType): PlantCell {
  return {
    id,
    x,
    y,
    type,
    dir: 'UP',
    cellEnergy: 4,
    age: 0,
    waitingForGrow: false,
  }
}

function plant(id: number, cells: PlantCell[]): Plant {
  return {
    id,
    genome,
    cells,
    age: 3,
    lineageHue: 0,
    edgeFlux: [],
    dead: false,
    accounting: {
      seedsCreated: 0,
      spikesCreated: 0,
      shootsFired: 0,
      photoEnergyGained: 0,
      mineralEnergyGained: 0,
      upkeepSpent: 0,
    },
  }
}

function occupancyOf(plants: Plant[]): Int32Array[] {
  const occ = Array.from({ length: WORLD.H }, () => new Int32Array(WORLD.W))
  for (const p of plants) {
    for (const c of p.cells) occ[c.y][c.x] = p.id
  }
  return occ
}

describe('spike aura', () => {
  beforeEach(() => {
    setPlantEventSink(null)
  })

  it('убивает чужой росток в манхэттене 2 и шлёт SPIKE_KILL', () => {
    const y = WORLD.SOIL_Y - 4
    const events: PlantTickEvent[] = []
    setPlantEventSink((e) => events.push(e))

    const attacker = plant(1, [
      cell(1, 20, WORLD.SOIL_Y, 'ROOT'),
      cell(2, 20, WORLD.SOIL_Y - 1, 'STEM'),
      cell(3, 20, WORLD.SOIL_Y - 2, 'STEM'),
      cell(4, 20, WORLD.SOIL_Y - 3, 'STEM'),
      cell(5, 20, y, 'SPIKE'),
      cell(6, 20, y - 1, 'SPROUT'),
    ])
    const victim = plant(2, [
      cell(7, 22, WORLD.SOIL_Y, 'ROOT'),
      cell(8, 22, WORLD.SOIL_Y - 1, 'SPROUT'),
      cell(9, 22, WORLD.SOIL_Y - 2, 'STEM'),
      cell(10, 22, WORLD.SOIL_Y - 3, 'STEM'),
      cell(11, 22, y, 'SPROUT'),
    ])

    applyWorldFoliageRules([attacker, victim], occupancyOf([attacker, victim]))

    expect(victim.cells.some((c) => c.id === 11)).toBe(false)
    expect(victim.cells.some((c) => c.id === 8)).toBe(true)
    expect(attacker.cells.some((c) => c.id === 6)).toBe(true)
    expect(events.some((e) => e.kind === 'SPIKE_KILL' && e.x === 22 && e.y === y)).toBe(true)
    expect(events.some((e) => e.kind === 'SPIKE_KILL' && e.plantId === attacker.id)).toBe(false)
  })
})
