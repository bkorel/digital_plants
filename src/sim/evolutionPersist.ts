import { WORLD } from './config'
import { deserializeGenome, serializeGenome } from './genome'
import type { LineageOrigin, LineageSnapshot } from './lineage'
import type {
  CellType,
  Direction,
  EvolutionSnapshot,
  FallingSeed,
  Plant,
  PlantAccounting,
  SeedInSoil,
} from './types'

export const EVOLUTION_STATE_KEY = 'digital-plants-evolution'
const EVOLUTION_STATE_VERSION = 1

export interface PersistedEvolutionMeta {
  savedAt: number
  seed: number
  lastRestartUsedRandomGenomes: boolean
}

export interface PersistedEvolutionState extends PersistedEvolutionMeta {
  version: typeof EVOLUTION_STATE_VERSION
  snapshot: EvolutionSnapshot
}

interface StoredPlantCell {
  id: number
  x: number
  y: number
  type: CellType
  dir: Direction
  cellEnergy: number
  age: number
  waitingForGrow: boolean
  lastActionOk?: boolean | null
}

interface StoredEdgeFlux {
  fromId: number
  toId: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  flow: number
}

interface StoredPlant {
  id: number
  genomeHex: string
  cells: StoredPlantCell[]
  age: number
  lineageHue: number
  edgeFlux: StoredEdgeFlux[]
  dead: boolean
  accounting: PlantAccounting
}

interface StoredSeedInSoil {
  x: number
  y: number
  fromY?: number
  genomeHex: string
  energy: number
  ticksInSoil: number
  lineageHue: number
  parentPlantId?: number
}

interface StoredFallingSeed {
  x: number
  fromY: number
  toY: number
  startTick: number
  startTime: number
  genomeHex: string
  energy: number
  lineageHue: number
  parentPlantId?: number
}

interface StoredLineageNode {
  genomeKey: string
  genomeHex: string
  parentGenomeKeys: string[]
  firstTick: number
  lastActiveTick: number
  spawnCount: number
  livingCount: number
  origin: LineageOrigin
  mutatedFromParent: boolean
  manualSpawnCount: number
  lastManualTick?: number
}

interface StoredEvolutionSnapshot {
  tickCount: number
  plants: StoredPlant[]
  seeds: StoredSeedInSoil[]
  fallingSeeds: StoredFallingSeed[]
  mineralsB64: string
  occupancyB64: string
  rngState: number
  nextPlantId: number
  nextCellId: number
  selectedPlantId: number | null
  lineage: {
    nodes: StoredLineageNode[]
    revision?: number
  }
}

interface StoredEvolutionFile {
  version: typeof EVOLUTION_STATE_VERSION
  savedAt: number
  seed: number
  lastRestartUsedRandomGenomes: boolean
  snapshot: StoredEvolutionSnapshot
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function float32ToBase64(arr: Float32Array): string {
  return bytesToBase64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
}

function base64ToFloat32(b64: string, expectedLen: number): Float32Array {
  const bytes = base64ToBytes(b64)
  const arr = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  if (arr.length !== expectedLen) {
    throw new Error(`minerals length ${arr.length}, expected ${expectedLen}`)
  }
  return new Float32Array(arr)
}

function occupancyToBase64(occupancy: Int32Array[]): string {
  const flat = new Int32Array(WORLD.W * WORLD.H)
  for (let y = 0; y < WORLD.H; y++) {
    flat.set(occupancy[y]!, y * WORLD.W)
  }
  return bytesToBase64(new Uint8Array(flat.buffer, flat.byteOffset, flat.byteLength))
}

function base64ToOccupancy(b64: string): Int32Array[] {
  const bytes = base64ToBytes(b64)
  const flat = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  if (flat.length !== WORLD.W * WORLD.H) {
    throw new Error(`occupancy length ${flat.length}, expected ${WORLD.W * WORLD.H}`)
  }
  const rows: Int32Array[] = []
  for (let y = 0; y < WORLD.H; y++) {
    rows.push(flat.subarray(y * WORLD.W, (y + 1) * WORLD.W))
  }
  return rows.map((row) => new Int32Array(row))
}

function storePlant(plant: Plant): StoredPlant {
  return {
    id: plant.id,
    genomeHex: serializeGenome(plant.genome),
    cells: plant.cells.map((c) => ({ ...c })),
    age: plant.age,
    lineageHue: plant.lineageHue,
    edgeFlux: plant.edgeFlux.map((f) => ({ ...f })),
    dead: plant.dead,
    accounting: { ...plant.accounting },
  }
}

function restorePlant(stored: StoredPlant): Plant {
  return {
    id: stored.id,
    genome: deserializeGenome(stored.genomeHex),
    cells: stored.cells.map((c) => ({ ...c })),
    age: stored.age,
    lineageHue: stored.lineageHue,
    edgeFlux: stored.edgeFlux.map((f) => ({ ...f })),
    dead: stored.dead,
    accounting: { ...stored.accounting },
  }
}

function storeSeed(seed: SeedInSoil): StoredSeedInSoil {
  return {
    x: seed.x,
    y: seed.y,
    fromY: seed.fromY,
    genomeHex: serializeGenome(seed.genome),
    energy: seed.energy,
    ticksInSoil: seed.ticksInSoil,
    lineageHue: seed.lineageHue,
    parentPlantId: seed.parentPlantId,
  }
}

function restoreSeed(stored: StoredSeedInSoil): SeedInSoil {
  return {
    x: stored.x,
    y: stored.y,
    fromY: stored.fromY,
    genome: deserializeGenome(stored.genomeHex),
    energy: stored.energy,
    ticksInSoil: stored.ticksInSoil,
    lineageHue: stored.lineageHue,
    parentPlantId: stored.parentPlantId,
  }
}

function storeFallingSeed(seed: FallingSeed): StoredFallingSeed {
  return {
    x: seed.x,
    fromY: seed.fromY,
    toY: seed.toY,
    startTick: seed.startTick,
    startTime: seed.startTime,
    genomeHex: serializeGenome(seed.genome),
    energy: seed.energy,
    lineageHue: seed.lineageHue,
    parentPlantId: seed.parentPlantId,
  }
}

function restoreFallingSeed(stored: StoredFallingSeed): FallingSeed {
  return {
    x: stored.x,
    fromY: stored.fromY,
    toY: stored.toY,
    startTick: stored.startTick,
    startTime: stored.startTime,
    genome: deserializeGenome(stored.genomeHex),
    energy: stored.energy,
    lineageHue: stored.lineageHue,
    parentPlantId: stored.parentPlantId,
  }
}

function storeLineage(lineage: LineageSnapshot): StoredEvolutionSnapshot['lineage'] {
  return {
    revision: lineage.revision,
    nodes: lineage.nodes.map((node) => ({
      genomeKey: node.genomeKey,
      genomeHex: serializeGenome(node.genome),
      parentGenomeKeys: [...node.parentGenomeKeys],
      firstTick: node.firstTick,
      lastActiveTick: node.lastActiveTick,
      spawnCount: node.spawnCount,
      livingCount: node.livingCount,
      origin: node.origin,
      mutatedFromParent: node.mutatedFromParent,
      manualSpawnCount: node.manualSpawnCount,
      lastManualTick: node.lastManualTick,
    })),
  }
}

function restoreLineage(stored: StoredEvolutionSnapshot['lineage']): LineageSnapshot {
  return {
    revision: stored.revision,
    nodes: stored.nodes.map((node) => ({
      genomeKey: node.genomeKey,
      genome: deserializeGenome(node.genomeHex),
      parentGenomeKeys: [...node.parentGenomeKeys],
      firstTick: node.firstTick,
      lastActiveTick: node.lastActiveTick,
      spawnCount: node.spawnCount,
      livingCount: node.livingCount,
      origin: node.origin,
      mutatedFromParent: node.mutatedFromParent,
      manualSpawnCount: node.manualSpawnCount,
      lastManualTick: node.lastManualTick,
    })),
  }
}

function snapshotToStored(snapshot: EvolutionSnapshot): StoredEvolutionSnapshot {
  return {
    tickCount: snapshot.tickCount,
    plants: snapshot.plants.map(storePlant),
    seeds: snapshot.seeds.map(storeSeed),
    fallingSeeds: snapshot.fallingSeeds.map(storeFallingSeed),
    mineralsB64: float32ToBase64(snapshot.minerals),
    occupancyB64: occupancyToBase64(snapshot.occupancy),
    rngState: snapshot.rngState,
    nextPlantId: snapshot.nextPlantId,
    nextCellId: snapshot.nextCellId,
    selectedPlantId: snapshot.selectedPlantId,
    lineage: storeLineage(snapshot.lineage),
  }
}

function storedToSnapshot(stored: StoredEvolutionSnapshot): EvolutionSnapshot {
  const cellCount = WORLD.W * WORLD.H
  return {
    tickCount: stored.tickCount,
    plants: stored.plants.map(restorePlant),
    seeds: stored.seeds.map(restoreSeed),
    fallingSeeds: stored.fallingSeeds.map(restoreFallingSeed),
    minerals: base64ToFloat32(stored.mineralsB64, cellCount),
    occupancy: base64ToOccupancy(stored.occupancyB64),
    rngState: stored.rngState,
    nextPlantId: stored.nextPlantId,
    nextCellId: stored.nextCellId,
    selectedPlantId: stored.selectedPlantId,
    lineage: restoreLineage(stored.lineage),
  }
}

export function saveEvolutionState(
  snapshot: EvolutionSnapshot,
  meta: Omit<PersistedEvolutionMeta, 'savedAt'> & { savedAt?: number },
): boolean {
  try {
    const file: StoredEvolutionFile = {
      version: EVOLUTION_STATE_VERSION,
      savedAt: meta.savedAt ?? Date.now(),
      seed: meta.seed,
      lastRestartUsedRandomGenomes: meta.lastRestartUsedRandomGenomes,
      snapshot: snapshotToStored(snapshot),
    }
    localStorage.setItem(EVOLUTION_STATE_KEY, JSON.stringify(file))
    return true
  } catch {
    return false
  }
}

export function loadEvolutionState(): PersistedEvolutionState | null {
  try {
    const raw = localStorage.getItem(EVOLUTION_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredEvolutionFile
    if (parsed.version !== EVOLUTION_STATE_VERSION) return null
    if (!parsed.snapshot) return null
    return {
      version: EVOLUTION_STATE_VERSION,
      savedAt: parsed.savedAt,
      seed: parsed.seed,
      lastRestartUsedRandomGenomes: parsed.lastRestartUsedRandomGenomes ?? false,
      snapshot: storedToSnapshot(parsed.snapshot),
    }
  } catch {
    return null
  }
}

export function clearEvolutionState(): void {
  try {
    localStorage.removeItem(EVOLUTION_STATE_KEY)
  } catch {
    // ignore
  }
}

export function hasEvolutionState(): boolean {
  try {
    return localStorage.getItem(EVOLUTION_STATE_KEY) != null
  } catch {
    return false
  }
}

export function formatEvolutionSavedAt(savedAt: number): string {
  return new Date(savedAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
