import { WORLD } from './config'

/** Метка ячейки, занятой покоящимся семенем (id растений > 0). */
export const SEED_OCC = -1

export function isCellFree(occupancy: Int32Array[], x: number, y: number): boolean {
  return occupancy[y]?.[x] === 0
}

export function isPlantOccupancy(id: number): boolean {
  return id > 0
}

const NEIGHBOR_DELTA = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const

/**
 * Раньше запрещало соприкосновение крон разных растений в воздухе.
 * Сейчас не используется — конкуренция листьев в `foliage.ts`.
 */
export function touchesForeignPlantInAir(
  occupancy: Int32Array[],
  plantId: number,
  x: number,
  y: number,
): boolean {
  if (y >= WORLD.SOIL_Y) return false
  for (const [dx, dy] of NEIGHBOR_DELTA) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || nx >= WORLD.W || ny < 0 || ny >= WORLD.H) continue
    if (ny >= WORLD.SOIL_Y) continue
    const occ = occupancy[ny][nx]
    if (occ > 0 && occ !== plantId) return true
  }
  return false
}
