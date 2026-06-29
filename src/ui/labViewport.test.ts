import { describe, expect, it } from 'vitest'
import { LAB_WORLD } from '../sim/config'
import type { PlantCell } from '../sim/types'
import { computeLabViewport } from './labViewport'

function cell(x: number, y: number): PlantCell {
  return {
    id: 1,
    x,
    y,
    type: 'STEM',
    dir: 'UP',
    cellEnergy: 1,
    age: 0,
    waitingForGrow: false,
  }
}

describe('computeLabViewport', () => {
  it('zooms in on a single seedling cell', () => {
    const vp = computeLabViewport(LAB_WORLD, [cell(75, 124)])
    expect(vp.w).toBeLessThan(LAB_WORLD.W)
    expect(vp.h).toBeLessThan(LAB_WORLD.H)
    expect(vp.zoom).toBeGreaterThan(1)
  })

  it('shows full world when plant is large', () => {
    const cells: PlantCell[] = []
    for (let y = 30; y < 120; y++) {
      for (let x = 10; x < 140; x++) cells.push(cell(x, y))
    }
    const vp = computeLabViewport(LAB_WORLD, cells)
    expect(vp.w).toBe(LAB_WORLD.W)
    expect(vp.h).toBe(LAB_WORLD.H)
    expect(vp.zoom).toBe(1)
  })
})
