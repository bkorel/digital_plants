import { SEED_FALL_DURATION_MS, SEED_FALL_DURATION_TICKS, WORLD } from './config'
import { cloneGenome } from './genome'
import { getIdCounters, setIdCounters } from './plant'
import type { LineageSnapshot } from './lineage'
import type {
  AppMode,
  EvolutionSnapshot,
  FallingSeed,
  Plant,
  SeedInSoil,
} from './types'
import type { PlantTickEvent } from './plantEvents'
import { SEED_OCC } from './occupancy'

/** Снимок мира для передачи между потоками (Worker ↔ main). */
export interface WorldSnapshot {
  tickCount: number
  mode: AppMode
  plants: Plant[]
  seeds: SeedInSoil[]
  fallingSeeds: FallingSeed[]
  minerals: Float32Array
  light: Float32Array
  selectedPlantId: number | null
  lastRestartUsedRandomGenomes: boolean
  tickEvents: PlantTickEvent[]
  rngState: number
  nextPlantId: number
  nextCellId: number
}

function clonePlant(plant: Plant): Plant {
  return {
    ...plant,
    genome: cloneGenome(plant.genome),
    cells: plant.cells.map((c) => ({ ...c })),
    edgeFlux: plant.edgeFlux.map((f) => ({ ...f })),
    accounting: { ...plant.accounting },
  }
}

function cloneSeed(seed: SeedInSoil): SeedInSoil {
  return { ...seed, genome: cloneGenome(seed.genome) }
}

function cloneFallingSeed(seed: FallingSeed): FallingSeed {
  return { ...seed, genome: cloneGenome(seed.genome) }
}

/** Сериализовать состояние World (глубокие копии + transferables для буферов). */
export function captureWorldSnapshot(w: {
  tickCount: number
  mode: AppMode
  plants: Plant[]
  seeds: SeedInSoil[]
  fallingSeeds: FallingSeed[]
  minerals: Float32Array
  light: Float32Array
  selectedPlantId: number | null
  lastRestartUsedRandomGenomes: boolean
  tickEvents: PlantTickEvent[]
  rng: { getState(): number }
}): WorldSnapshot {
  const ids = getIdCounters()
  return {
    tickCount: w.tickCount,
    mode: w.mode,
    plants: w.plants.map(clonePlant),
    seeds: w.seeds.map(cloneSeed),
    fallingSeeds: w.fallingSeeds.map(cloneFallingSeed),
    minerals: new Float32Array(w.minerals),
    light: new Float32Array(w.light),
    selectedPlantId: w.selectedPlantId,
    lastRestartUsedRandomGenomes: w.lastRestartUsedRandomGenomes,
    tickEvents: w.tickEvents.map((e) => ({ ...e })),
    rngState: w.rng.getState(),
    nextPlantId: ids.nextPlantId,
    nextCellId: ids.nextCellId,
  }
}

/** Применить снимок к экземпляру World на main thread. */
export function applyWorldSnapshot(
  w: {
    tickCount: number
    mode: AppMode
    plants: Plant[]
    seeds: SeedInSoil[]
    fallingSeeds: FallingSeed[]
    minerals: Float32Array
    light: Float32Array
    occupancy: Int32Array[]
    selectedPlantId: number | null
    lastRestartUsedRandomGenomes: boolean
    tickEvents: PlantTickEvent[]
    rng: { setState(n: number): void }
  },
  snap: WorldSnapshot,
): void {
  w.tickCount = snap.tickCount
  w.mode = snap.mode
  w.plants = snap.plants.map(clonePlant)
  w.seeds = snap.seeds.map(cloneSeed)
  const msPerTick = SEED_FALL_DURATION_MS / SEED_FALL_DURATION_TICKS
  w.fallingSeeds = snap.fallingSeeds.map((f) => {
    const seed = cloneFallingSeed(f)
    seed.startTime = performance.now() - (snap.tickCount - seed.startTick) * msPerTick
    return seed
  })
  w.minerals.set(snap.minerals)
  w.light.set(snap.light)
  w.selectedPlantId = snap.selectedPlantId
  w.lastRestartUsedRandomGenomes = snap.lastRestartUsedRandomGenomes
  w.tickEvents = snap.tickEvents.map((e) => ({ ...e }))
  w.rng.setState(snap.rngState)
  setIdCounters(snap.nextPlantId, snap.nextCellId)

  for (let y = 0; y < WORLD.H; y++) {
    w.occupancy[y].fill(0)
  }
  for (const seed of w.seeds) {
    w.occupancy[seed.y][seed.x] = SEED_OCC
  }
  for (const plant of w.plants) {
    if (plant.dead) continue
    for (const cell of plant.cells) {
      w.occupancy[cell.y][cell.x] = plant.id
    }
  }
  // light уже в snapshot — не пересчитываем
}

export function snapshotToEvolutionSnapshot(
  snap: WorldSnapshot,
  lineage: LineageSnapshot = { nodes: [] },
): EvolutionSnapshot {
  return {
    tickCount: snap.tickCount,
    plants: snap.plants.map(clonePlant),
    seeds: snap.seeds.map(cloneSeed),
    fallingSeeds: snap.fallingSeeds.map(cloneFallingSeed),
    minerals: new Float32Array(snap.minerals),
    occupancy: Array.from({ length: WORLD.H }, () => new Int32Array(WORLD.W)),
    rngState: snap.rngState,
    nextPlantId: snap.nextPlantId,
    nextCellId: snap.nextCellId,
    selectedPlantId: snap.selectedPlantId,
    lineage,
  }
}

export function transferablesFromSnapshot(snap: WorldSnapshot): ArrayBuffer[] {
  return [snap.minerals.buffer, snap.light.buffer]
}
