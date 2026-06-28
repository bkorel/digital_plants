import { GROW_COST } from './config'
import type { Direction } from './types'

export const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
  UP_LEFT: { dx: -1, dy: -1 },
  UP_RIGHT: { dx: 1, dy: -1 },
  DOWN_LEFT: { dx: -1, dy: 1 },
  DOWN_RIGHT: { dx: 1, dy: 1 },
}

/** Порядок направлений по часовой стрелке от UP (шаг 45°). */
const CW_ORDER: Direction[] = [
  'UP',
  'UP_RIGHT',
  'RIGHT',
  'DOWN_RIGHT',
  'DOWN',
  'DOWN_LEFT',
  'LEFT',
  'UP_LEFT',
]

const CW_INDEX = new Map<Direction, number>(CW_ORDER.map((d, i) => [d, i]))

const DELTA_TO_DIR = new Map<string, Direction>(
  (Object.entries(DIR_DELTA) as [Direction, { dx: number; dy: number }][]).map(
    ([dir, { dx, dy }]) => [`${dx},${dy}`, dir],
  ),
)

/** Абсолютная дельта для направления */
export function directionDelta(dir: Direction): { dx: number; dy: number } {
  return DIR_DELTA[dir]
}

/** Поворот относительного направления в мировые координаты по ориентации клетки. */
export function resolveRelativeDir(orientation: Direction, relative: Direction): Direction {
  const o = CW_INDEX.get(orientation)!
  const r = CW_INDEX.get(relative)!
  return CW_ORDER[(o + r) % 8]!
}

/** Обратное: мировое направление → относительное в системе orientation. */
export function worldToRelativeDir(orientation: Direction, world: Direction): Direction {
  const o = CW_INDEX.get(orientation)!
  const w = CW_INDEX.get(world)!
  return CW_ORDER[(w - o + 8) % 8]!
}

export function directionFromDelta(dx: number, dy: number): Direction {
  const dir = DELTA_TO_DIR.get(`${dx},${dy}`)
  if (!dir) throw new Error(`directionFromDelta: invalid delta (${dx}, ${dy})`)
  return dir
}

/** Стоимость роста по относительному слоту (UP = вперёд дешевле). */
export function growCostRelative(relative: Direction): number {
  if (relative === 'UP') return GROW_COST * 0.7
  if (relative === 'DOWN') return GROW_COST * 1.0
  if (relative.includes('_')) return GROW_COST * 1.05
  return GROW_COST * 0.85
}
