import { describe, expect, it } from 'vitest'
import { WORLD } from '../sim/config'
import { genomeColor, genomeHue, spikeShooterTemplateGenome } from '../sim/genome'
import {
  genomeDepthCap,
  genomeDoubleGrowth,
  genomeHeightCap,
  genomeMaxAge,
  genomeShadeSenescence,
  genomeShootRange,
} from '../sim/genome'
import type { CellType, Genome, Plant, PlantCell } from '../sim/types'
import { formatPlantStrategy } from './plantStrategy'
import { fillPlantPixels } from './worldPixelGrid'

function rgb(pixel: number): [number, number, number] {
  return [pixel & 255, (pixel >>> 8) & 255, (pixel >>> 16) & 255]
}

function sum(pixel: number): number {
  const [r, g, b] = rgb(pixel)
  return r + g + b
}

function genomeOfHue(target: number): Genome {
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 48; b++) {
      const genome = { code: Uint8Array.from([a, b, 4, 8, 12, 16]) }
      if (genomeHue(genome) === target) return genome
    }
  }
  throw new Error(`hue ${target}`)
}

function makePlant(genome: Genome, specs: { x: number; y: number; type: CellType }[]): Plant {
  return {
    id: 1,
    genome,
    cells: specs.map((spec, i): PlantCell => ({
      id: i + 1,
      x: spec.x,
      y: spec.y,
      type: spec.type,
      dir: 'UP',
      cellEnergy: 3,
      age: 0,
      waitingForGrow: false,
    })),
    age: 1,
    lineageHue: genomeColor(genome).hue,
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

describe('formatPlantStrategy', () => {
  it('собирает короткую строку из уже посчитанных параметров генома', () => {
    const genome = spikeShooterTemplateGenome()
    const line = formatPlantStrategy(genome)
    const range = genomeShootRange(genome)
    const shoot = range >= 16 ? `стрелок ${range}` : `луч ${range}`
    const shade = genomeShadeSenescence(genome) === 'lignify' ? 'лигнификация' : 'минерализация'
    const height = Math.round(genomeHeightCap(genome) * WORLD.SOIL_Y)
    const depth = Math.round(genomeDepthCap(genome) * (WORLD.H - WORLD.SOIL_Y))

    expect(line.startsWith(shoot)).toBe(true)
    expect(line).toContain(shade)
    expect(line.includes('двойной рост')).toBe(genomeDoubleGrowth(genome))
    expect(line).toContain(`потолок ~${height}`)
    expect(line).toContain(`корни ~${depth}`)
    expect(line).toContain(`возраст ${genomeMaxAge(genome)}`)
    expect(line).toContain(' · ')
  })
})

describe('fillPlantPixels PLANTS', () => {
  it('различает ткани внутри hue и затемняет клетку светом колонки', () => {
    const genome = genomeOfHue(120)
    const air = WORLD.SOIL_Y - 8
    const plant = makePlant(genome, [
      { x: 10, y: WORLD.SOIL_Y, type: 'ROOT' },
      { x: 11, y: air, type: 'STEM' },
      { x: 12, y: air, type: 'SPROUT' },
      { x: 13, y: air, type: 'SPIKE' },
      { x: 14, y: air, type: 'SPROUT' },
    ])
    const light = new Float32Array(WORLD.W * WORLD.H)
    light.fill(1)
    const shadeIdx = air * WORLD.W + 14
    light[shadeIdx] = 0

    const pixels = new Uint32Array(WORLD.W * WORLD.H)
    fillPlantPixels(pixels, plant, 'PLANTS', 'normal', light)

    const root = pixels[WORLD.SOIL_Y * WORLD.W + 10]
    const stem = pixels[air * WORLD.W + 11]
    const sprout = pixels[air * WORLD.W + 12]
    const spike = pixels[air * WORLD.W + 13]
    const shaded = pixels[shadeIdx]

    expect(sum(sprout)).toBeGreaterThan(sum(stem))
    expect(sum(stem)).toBeGreaterThan(sum(root))
    expect(spike).not.toBe(sprout)

    const [sr, , sb] = rgb(sprout)
    const [kr, , kb] = rgb(spike)
    const [rr, , rb] = rgb(root)
    expect(kb / (kr + kb + 1)).toBeGreaterThan(sb / (sr + sb + 1))
    expect(rr / (rb + 1)).toBeGreaterThan(sr / (sb + 1))
    expect(sum(shaded)).toBeLessThan(sum(sprout) * 0.35)
  })
})
