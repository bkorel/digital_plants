import {
  BASE_LIGHT,
  MINERAL_BASE,
  MINERAL_CAP,
  MINERAL_DEPTH_GAIN,
  MINERAL_DIFFUSE_RATE,
  MINERAL_REGEN_RATE,
  MINERAL_SINK_RATE,
  MAX_SHADE_LAYERS,
  CROWD_ABOVE_X_RADIUS,
  SHADE_PER_LAYER,
  SHADE_SCATTER_INTERVAL,
  SKY_LIGHT_RAMP,
  UPTAKE_MAX,
  AIR_WATER,
  SURFACE_SOIL_WATER_FRAC,
  WATER_PER_DEPTH,
} from './config'
import { simWorld } from './worldBounds'
import { offsetX } from './coords'
import type { Plant, PlantCell } from './types'

export function isSoil(y: number): boolean {
  return y >= simWorld.SOIL_Y
}

export function soilDepth(y: number): number {
  return Math.max(0, y - simWorld.SOIL_Y)
}

export function initMinerals(): Float32Array {
  const minerals = new Float32Array(simWorld.W * simWorld.H)
  for (let y = simWorld.SOIL_Y; y < simWorld.H; y++) {
    const d = soilDepth(y)
    const val = Math.min(MINERAL_CAP, MINERAL_BASE + MINERAL_DEPTH_GAIN * d)
    for (let x = 0; x < simWorld.W; x++) {
      minerals[y * simWorld.W + x] = val
    }
  }
  return minerals
}

export function mineralIndex(x: number, y: number): number {
  return y * simWorld.W + x
}

export function getLocalWater(_x: number, y: number): number {
  if (!isSoil(y)) return AIR_WATER
  const depth = soilDepth(y) + 1
  return Math.min(1, depth * WATER_PER_DEPTH)
}

/** @deprecated используйте getLocalWater / plantWaterSupply */
export function getWater(x: number, y: number): number {
  return getLocalWater(x, y)
}

function absorbsWater(cell: PlantCell): boolean {
  return cell.type === 'ROOT' || (cell.type === 'SPROUT' && cell.y >= simWorld.SOIL_Y)
}

export function plantWaterSupply(plant: Plant): number {
  let supply = 0
  for (const cell of plant.cells) {
    if (absorbsWater(cell)) {
      supply = Math.max(supply, getLocalWater(cell.x, cell.y))
    } else if (cell.type === 'SPROUT' && cell.y === simWorld.SOIL_Y - 1) {
      supply = Math.max(
        supply,
        getLocalWater(cell.x, simWorld.SOIL_Y) * SURFACE_SOIL_WATER_FRAC,
      )
    }
  }
  return supply
}

export function getMineralAt(minerals: Float32Array, x: number, y: number): number {
  if (!isSoil(y)) return 0
  return minerals[mineralIndex(x, y)]
}

/** Эффективное число слоёв тени с учётом рассеивания ниже последнего затенителя. */
export function effectiveShadeLayers(
  layersAbove: number,
  y: number,
  lastOccY: number,
): number {
  let effective = layersAbove
  if (lastOccY >= 0 && y > lastOccY) {
    const steps = Math.floor((y - lastOccY) / SHADE_SCATTER_INTERVAL)
    if (steps > 0) effective *= Math.pow(0.5, steps)
  }
  return effective
}

/** Число занятых клеток строго над точкой (в той же колонке), с рассеиванием света. */
export function shadeLayersAbove(
  occupancy: (Int32Array | null)[],
  x: number,
  y: number,
): number {
  let layers = 0
  let lastOccY = -1
  for (let yy = 0; yy < y; yy++) {
    if ((occupancy[yy]?.[x] ?? 0) !== 0) {
      layers++
      lastOccY = yy
    }
  }
  return effectiveShadeLayers(layers, y, lastOccY)
}

/** Нормализованный уровень затенения 0..1 (с учётом рассеивания). */
export function normalizedShadeLevel(
  occupancy: (Int32Array | null)[],
  x: number,
  y: number,
): number {
  return Math.min(1, shadeLayersAbove(occupancy, x, y) / Math.max(1, MAX_SHADE_LAYERS))
}

/** Чужие растения (occ > 0, не своё) на строке y-1 в [x-radius .. x+radius]. */
export function countForeignAbove(
  occupancy: (Int32Array | null)[],
  plantId: number,
  x: number,
  y: number,
  radius = CROWD_ABOVE_X_RADIUS,
): number {
  const scanY = y - 1
  if (scanY < 0) return 0
  let count = 0
  for (let dx = -radius; dx <= radius; dx++) {
    const sx = offsetX(x, dx)
    const occ = occupancy[scanY]?.[sx] ?? 0
    if (occ > 0 && occ !== plantId) count++
  }
  return count
}

export function normalizedCrowdAbove(
  occupancy: (Int32Array | null)[],
  plantId: number,
  x: number,
  y: number,
): number {
  const span = 2 * CROWD_ABOVE_X_RADIUS + 1
  return countForeignAbove(occupancy, plantId, x, y) / span
}

export function normalizedHeight(y: number): number {
  const above = simWorld.SOIL_Y - y
  return Math.max(0, Math.min(1, above / Math.max(1, simWorld.SOIL_Y)))
}

export function normalizedDepth(y: number): number {
  const depth = soilDepth(y)
  return Math.max(0, Math.min(1, depth / Math.max(1, simWorld.H - simWorld.SOIL_Y)))
}

/**
 * Базовая освещённость растёт с высотой: у самой земли света мало, у вершины
 * мира — максимум. Это вознаграждает рост вверх (за свет надо тянуться).
 */
export function altitudeLight(y: number): number {
  if (y >= simWorld.SOIL_Y) return BASE_LIGHT * 0.45
  const above = simWorld.SOIL_Y - y
  const frac = Math.min(1, above / SKY_LIGHT_RAMP)
  return BASE_LIGHT * (0.5 + 0.5 * frac)
}

export function computeLightGrid(occupancy: (Int32Array | null)[]): Float32Array {
  const light = new Float32Array(simWorld.W * simWorld.H)
  computeLightGridInto(occupancy, light)
  return light
}

/** Пересчёт освещённости в уже выделенный буфер (без аллокации). */
export function computeLightGridInto(
  occupancy: (Int32Array | null)[],
  light: Float32Array,
): void {
  for (let x = 0; x < simWorld.W; x++) {
    let layersAbove = 0
    let lastOccY = -1
    for (let y = 0; y < simWorld.H; y++) {
      const idx = y * simWorld.W + x
      const effective = effectiveShadeLayers(layersAbove, y, lastOccY)
      light[idx] =
        effective > MAX_SHADE_LAYERS
          ? 0
          : altitudeLight(y) * Math.pow(1 - SHADE_PER_LAYER, effective)
      const occ = occupancy[y]?.[x] ?? 0
      if (occ !== 0) {
        layersAbove++
        lastOccY = y
      }
    }
  }
}

export function uptakeMinerals(
  minerals: Float32Array,
  x: number,
  y: number,
  uptakeEff = 1,
): number {
  if (!isSoil(y)) return 0
  const idx = mineralIndex(x, y)
  const available = minerals[idx]
  const uptake = Math.min(available, UPTAKE_MAX * uptakeEff)
  minerals[idx] = Math.max(0, available - uptake)
  return uptake
}

export function depositMinerals(
  minerals: Float32Array,
  x: number,
  y: number,
  amount: number,
): void {
  if (!isSoil(y) || amount <= 0) return
  const idx = mineralIndex(x, y)
  minerals[idx] = Math.min(MINERAL_CAP, minerals[idx] + amount)
}

export function mineralDisplayRatio(m: number): number {
  if (m <= 0) return 0
  return Math.min(1, Math.sqrt(m / MINERAL_CAP))
}

export function mineralColorCss(m: number): string {
  const t = mineralDisplayRatio(m)
  const hue = 28 + t * 22
  const sat = 55 + t * 25
  const light = 14 + t * 52
  return `hsl(${hue} ${sat}% ${light}%)`
}

export function diffuseMinerals(
  minerals: Float32Array,
  scratch?: { next: Float32Array; lateral: Float32Array },
): void {
  const gridSize = simWorld.W * simWorld.H
  const next = scratch?.next ?? new Float32Array(gridSize)
  const lateral = scratch?.lateral ?? new Float32Array(gridSize)

  for (let y = simWorld.SOIL_Y; y < simWorld.H; y++) {
    for (let x = 0; x < simWorld.W; x++) {
      const idx = mineralIndex(x, y)
      const down = minerals[idx] * MINERAL_SINK_RATE
      next[idx] -= down
      if (y + 1 < simWorld.H) {
        next[mineralIndex(x, y + 1)] += down
      }
    }
  }

  for (let y = simWorld.SOIL_Y; y < simWorld.H; y++) {
    for (let x = 0; x < simWorld.W; x++) {
      const idx = mineralIndex(x, y)
      const left = next[mineralIndex(offsetX(x, -1), y)]
      const right = next[mineralIndex(offsetX(x, 1), y)]
      lateral[idx] = MINERAL_DIFFUSE_RATE * ((left + right) / 2 - next[idx])
    }
  }

  for (let y = simWorld.SOIL_Y; y < simWorld.H; y++) {
    const baseline = Math.min(MINERAL_CAP, MINERAL_BASE + MINERAL_DEPTH_GAIN * soilDepth(y))
    for (let x = 0; x < simWorld.W; x++) {
      const idx = mineralIndex(x, y)
      let v = next[idx] + lateral[idx]
      // медленная регенерация к естественному уровню (выветривание породы, осадки)
      if (v < baseline) v += (baseline - v) * MINERAL_REGEN_RATE
      next[idx] = Math.max(0, Math.min(MINERAL_CAP, v))
    }
  }

  minerals.set(next)
}

export function totalSoilEnergy(minerals: Float32Array): number {
  let sum = 0
  for (let y = simWorld.SOIL_Y; y < simWorld.H; y++) {
    for (let x = 0; x < simWorld.W; x++) {
      sum += minerals[mineralIndex(x, y)]
    }
  }
  return sum
}
