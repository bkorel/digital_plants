import { WORLD } from '../sim/config'
import {
  genomeDepthCap,
  genomeDoubleGrowth,
  genomeHeightCap,
  genomeMaxAge,
  genomeShadeSenescence,
  genomeShootRange,
} from '../sim/genome'
import type { Genome } from '../sim/types'

/** Короткая строка стратегии для инспектора растения. */
export function formatPlantStrategy(genome: Genome): string {
  const range = genomeShootRange(genome)
  const shoot = range >= 16 ? `стрелок ${range}` : `луч ${range}`
  const shade =
    genomeShadeSenescence(genome) === 'lignify' ? 'лигнификация' : 'минерализация'
  const height = Math.round(genomeHeightCap(genome) * WORLD.SOIL_Y)
  const depth = Math.round(genomeDepthCap(genome) * (WORLD.H - WORLD.SOIL_Y))
  const parts = [shoot, shade]
  if (genomeDoubleGrowth(genome)) parts.push('двойной рост')
  parts.push(`потолок ~${height}`)
  parts.push(`корни ~${depth}`)
  parts.push(`возраст ${genomeMaxAge(genome)}`)
  return parts.join(' · ')
}
