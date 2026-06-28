import { DEATH_ENERGY_RETURN, SHADED_SPROUT_LAYERS, SPIKE_LEAF_KILL_RADIUS, WORLD } from './config'
import { isYInBounds, offsetX, xDistance } from './coords'
import { shadeLayersAbove } from './environment'
import { genomeShadeSenescence } from './genome'
import { findLandingY } from './plant'
import { emitPlantEvent } from './plantEvents'
import type { Plant, PlantCell } from './types'

const NEIGHBOR_DELTA = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const

export interface MineralDeposit {
  x: number
  y: number
  amount: number
}

function isAir(y: number): boolean {
  return y < WORLD.SOIL_Y
}

function isSoil(y: number): boolean {
  return y >= WORLD.SOIL_Y
}

/** Корневая ткань в почве. */
function isRootTissue(cell: PlantCell): boolean {
  return isSoil(cell.y) && (cell.type === 'ROOT' || cell.type === 'SPROUT')
}

/** Активная «листовая» ткань в воздухе (меристема / лист). */
function isFoliageLeaf(cell: PlantCell): boolean {
  return isAir(cell.y) && cell.type === 'SPROUT'
}

/** Созревший надземный ствол. */
function isFoliageStem(cell: PlantCell): boolean {
  return isAir(cell.y) && cell.type === 'STEM'
}

function cellKey(plantId: number, cellId: number): string {
  return `${plantId}:${cellId}`
}

function getCellAt(plant: Plant, x: number, y: number): PlantCell | undefined {
  return plant.cells.find((c) => c.x === x && c.y === y)
}

function neighborsInPlant(plant: Plant, cell: PlantCell): PlantCell[] {
  const result: PlantCell[] = []
  for (const [dx, dy] of NEIGHBOR_DELTA) {
    const n = getCellAt(plant, offsetX(cell.x, dx), cell.y + dy)
    if (n) result.push(n)
  }
  return result
}

function removeAirCell(
  plant: Plant,
  cell: PlantCell,
  occupancy: Int32Array[],
  deposits: MineralDeposit[],
): void {
  occupancy[cell.y][cell.x] = 0
  plant.cells = plant.cells.filter((c) => c.id !== cell.id)
  const landY = Math.max(WORLD.SOIL_Y, findLandingY(occupancy, cell.x, cell.y))
  deposits.push({
    x: cell.x,
    y: landY,
    amount: Math.max(0.8, cell.cellEnergy) * DEATH_ENERGY_RETURN,
  })
  emitPlantEvent({ plantId: plant.id, kind: 'DEATH', x: cell.x, y: cell.y })
}

function removeSoilCell(
  plant: Plant,
  cell: PlantCell,
  occupancy: Int32Array[],
  deposits: MineralDeposit[],
): void {
  occupancy[cell.y][cell.x] = 0
  plant.cells = plant.cells.filter((c) => c.id !== cell.id)
  deposits.push({
    x: cell.x,
    y: cell.y,
    amount: Math.max(0.8, cell.cellEnergy) * DEATH_ENERGY_RETURN,
  })
  emitPlantEvent({ plantId: plant.id, kind: 'DEATH', x: cell.x, y: cell.y })
}

/** Клетки воздуха, связанные с почвой/корнями; остальное — отвал. */
function pruneFloatingAirParts(
  plant: Plant,
  occupancy: Int32Array[],
  deposits: MineralDeposit[],
): void {
  const anchored = new Set<number>()
  const queue: PlantCell[] = []

  for (const cell of plant.cells) {
    if (cell.y >= WORLD.SOIL_Y) {
      anchored.add(cell.id)
      queue.push(cell)
    }
  }

  if (anchored.size === 0) {
    for (const cell of [...plant.cells]) {
      if (isAir(cell.y)) removeAirCell(plant, cell, occupancy, deposits)
    }
    return
  }

  while (queue.length > 0) {
    const cell = queue.shift()!
    for (const n of neighborsInPlant(plant, cell)) {
      if (!anchored.has(n.id)) {
        anchored.add(n.id)
        queue.push(n)
      }
    }
  }

  for (const cell of [...plant.cells]) {
    if (isAir(cell.y) && !anchored.has(cell.id)) {
      removeAirCell(plant, cell, occupancy, deposits)
    }
  }
}

/** Уничтожить надземную клетку и отсечь незакреплённые ветки (как после соприкосновения листьев). */
export function killAirCellAndPrune(
  plant: Plant,
  cell: PlantCell,
  occupancy: Int32Array[],
): MineralDeposit[] {
  const deposits: MineralDeposit[] = []
  if (!isAir(cell.y)) return deposits
  removeAirCell(plant, cell, occupancy, deposits)
  pruneFloatingAirParts(plant, occupancy, deposits)
  return deposits
}

function manhattan(x1: number, y1: number, x2: number, y2: number): number {
  return xDistance(x1, x2) + Math.abs(y1 - y2)
}

/** Пассивная аура шипа: чужие побеги (SPROUT) в радиусе гибнут без выстрела. */
function resolveSpikeAura(plants: Plant[]): Set<string> {
  const toKill = new Set<string>()
  const spikes: { x: number; y: number; plantId: number }[] = []

  for (const plant of plants) {
    if (plant.dead) continue
    for (const cell of plant.cells) {
      if (cell.type === 'SPIKE' && isAir(cell.y)) {
        spikes.push({ x: cell.x, y: cell.y, plantId: plant.id })
      }
    }
  }

  for (const plant of plants) {
    if (plant.dead) continue
    for (const cell of plant.cells) {
      if (!isFoliageLeaf(cell)) continue
      for (const spike of spikes) {
        if (spike.plantId === plant.id) continue
        if (manhattan(cell.x, cell.y, spike.x, spike.y) > SPIKE_LEAF_KILL_RADIUS) continue
        toKill.add(cellKey(plant.id, cell.id))
        break
      }
    }
  }

  return toKill
}

function resolveLeafContacts(
  plants: Plant[],
  occupancy: Int32Array[],
  plantById: Map<number, Plant>,
): Set<string> {
  const toKill = new Set<string>()
  const processedPairs = new Set<string>()

  for (const plant of plants) {
    if (plant.dead) continue
    for (const cell of plant.cells) {
      if (!isAir(cell.y)) continue

      for (const [dx, dy] of NEIGHBOR_DELTA) {
        const nx = offsetX(cell.x, dx)
        const ny = cell.y + dy
        if (!isYInBounds(ny) || !isAir(ny)) continue

        const otherPlantId = occupancy[ny][nx]
        if (otherPlantId <= 0 || otherPlantId === plant.id) continue

        const otherPlant = plantById.get(otherPlantId)
        if (!otherPlant) continue

        const other = getCellAt(otherPlant, nx, ny)
        if (!other) continue

        const pairKey =
          cell.id < other.id ? `${cell.id}-${other.id}` : `${other.id}-${cell.id}`
        if (processedPairs.has(pairKey)) continue
        processedPairs.add(pairKey)

        if (isFoliageLeaf(cell) && isFoliageLeaf(other)) {
          if (cell.cellEnergy < other.cellEnergy) {
            toKill.add(cellKey(plant.id, cell.id))
          } else if (other.cellEnergy < cell.cellEnergy) {
            toKill.add(cellKey(otherPlant.id, other.id))
          } else if (cell.id < other.id) {
            toKill.add(cellKey(plant.id, cell.id))
          } else {
            toKill.add(cellKey(otherPlant.id, other.id))
          }
        } else if (isFoliageLeaf(cell) && isFoliageStem(other)) {
          toKill.add(cellKey(plant.id, cell.id))
        } else if (isFoliageStem(cell) && isFoliageLeaf(other)) {
          toKill.add(cellKey(otherPlant.id, other.id))
        }
      }
    }
  }

  return toKill
}

/** Затенённые мерistemы: лигнификация или минерализация; затем отвал незакреплённых веток. */
function applyShadedSproutSenescence(
  plants: Plant[],
  occupancy: Int32Array[],
  deposits: MineralDeposit[],
): void {
  for (const plant of plants) {
    if (plant.dead) continue
    const mode = genomeShadeSenescence(plant.genome)
    let changed = false

    for (const cell of [...plant.cells]) {
      if (!isFoliageLeaf(cell)) continue
      if (shadeLayersAbove(occupancy, cell.x, cell.y) <= SHADED_SPROUT_LAYERS) continue

      changed = true
      if (mode === 'lignify') {
        cell.type = 'STEM'
        cell.waitingForGrow = false
        emitPlantEvent({ plantId: plant.id, kind: 'STEM', x: cell.x, y: cell.y })
      } else {
        removeAirCell(plant, cell, occupancy, deposits)
      }
    }

    if (changed) {
      pruneFloatingAirParts(plant, occupancy, deposits)
    }
  }
}

function resolveRootContacts(
  plants: Plant[],
  occupancy: Int32Array[],
  plantById: Map<number, Plant>,
): Set<string> {
  const toKill = new Set<string>()
  const processedPairs = new Set<string>()

  for (const plant of plants) {
    if (plant.dead) continue
    for (const cell of plant.cells) {
      if (!isRootTissue(cell)) continue

      for (const [dx, dy] of NEIGHBOR_DELTA) {
        const nx = offsetX(cell.x, dx)
        const ny = cell.y + dy
        if (!isYInBounds(ny) || !isSoil(ny)) continue

        const otherPlantId = occupancy[ny][nx]
        if (otherPlantId <= 0 || otherPlantId === plant.id) continue

        const otherPlant = plantById.get(otherPlantId)
        if (!otherPlant) continue

        const other = getCellAt(otherPlant, nx, ny)
        if (!other || !isRootTissue(other)) continue

        const pairKey =
          cell.id < other.id ? `${cell.id}-${other.id}` : `${other.id}-${cell.id}`
        if (processedPairs.has(pairKey)) continue
        processedPairs.add(pairKey)

        if (cell.cellEnergy < other.cellEnergy) {
          toKill.add(cellKey(plant.id, cell.id))
        } else if (other.cellEnergy < cell.cellEnergy) {
          toKill.add(cellKey(otherPlant.id, other.id))
        } else if (cell.id < other.id) {
          toKill.add(cellKey(plant.id, cell.id))
        } else {
          toKill.add(cellKey(otherPlant.id, other.id))
        }
      }
    }
  }

  return toKill
}

/**
 * Конкуренция кроны между растениями и отсечение «висящих» частей.
 * Вызывается после дохода/расхода за тик, до роста VM.
 */
export function applyWorldFoliageRules(
  plants: Plant[],
  occupancy: Int32Array[],
): MineralDeposit[] {
  const deposits: MineralDeposit[] = []
  const toKill = new Set<string>()
  const plantById = new Map<number, Plant>()
  for (const plant of plants) {
    if (!plant.dead) plantById.set(plant.id, plant)
  }
  applyShadedSproutSenescence(plants, occupancy, deposits)
  for (const key of resolveSpikeAura(plants)) toKill.add(key)
  for (const key of resolveLeafContacts(plants, occupancy, plantById)) toKill.add(key)
  for (const key of resolveRootContacts(plants, occupancy, plantById)) toKill.add(key)

  for (const key of toKill) {
    const [plantIdStr, cellIdStr] = key.split(':')
    const plantId = Number(plantIdStr)
    const cellId = Number(cellIdStr)
    const plant = plantById.get(plantId)
    if (!plant) continue
    const cell = plant.cells.find((c) => c.id === cellId)
    if (!cell) continue
    if (isAir(cell.y)) {
      removeAirCell(plant, cell, occupancy, deposits)
    } else if (isRootTissue(cell)) {
      removeSoilCell(plant, cell, occupancy, deposits)
    }
  }

  for (const plant of plants) {
    if (plant.dead) continue
    pruneFloatingAirParts(plant, occupancy, deposits)
  }

  return deposits
}

/** Снять чужие клетки в колонке посадки (как «расчистка» под проросток). */
export function clearPlantingColumn(
  plants: Plant[],
  occupancy: Int32Array[],
  columnX: number,
): MineralDeposit[] {
  const deposits: MineralDeposit[] = []
  const affected = new Set<number>()

  for (let y = 0; y < WORLD.H; y++) {
    const occ = occupancy[y][columnX]
    if (occ <= 0) continue

    const plant = plants.find((p) => p.id === occ && !p.dead)
    if (!plant) {
      occupancy[y][columnX] = 0
      continue
    }

    const cell = plant.cells.find((c) => c.x === columnX && c.y === y)
    if (!cell) {
      occupancy[y][columnX] = 0
      continue
    }

    affected.add(plant.id)
    if (isAir(cell.y)) {
      removeAirCell(plant, cell, occupancy, deposits)
    } else {
      removeSoilCell(plant, cell, occupancy, deposits)
    }
  }

  for (const plant of plants) {
    if (!affected.has(plant.id) || plant.dead) continue
    pruneFloatingAirParts(plant, occupancy, deposits)
  }

  return deposits
}
