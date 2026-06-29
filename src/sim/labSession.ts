import { LAB_WORLD } from './config'
import {
  buildGenomeCoverageForLines,
  createGenomeExecutionRecorder,
  type LabGenomeCoverage,
} from './genomeExecution'
import { disassemble, genomeMaxAge, type DisasmLine } from './genome'
import { traceGrowthVM, type GrowthVmTrace } from './plant'
import type { Genome, Plant } from './types'
import { World } from './world'
import { resetSimWorld, setSimWorld } from './worldBounds'

const LAB_MAX_TICKS = 5000
const TIME_SERIES_INTERVAL = 10
export const LIFE_SNAPSHOT_INTERVAL = 20
const SEED_LIFETIME_BUCKET = 50
const SEED_LIFETIME_BUCKETS = 8

export interface LabTimePoint {
  tick: number
  cellCount: number
  age: number
  roots: number
}

export interface LabSessionStats {
  tick: number
  cellCount: number
  age: number
  roots: number
  spikes: number
  shootsFired: number
  seedsCreated: number
  seedsViable: number
  seedsDead: number
  seedLifetimeHist: number[]
  timeSeries: LabTimePoint[]
  peakCellCount: number
}

export type LabSnapshotKind = 'start' | 'interval' | 'death'

export interface LabLifeSnapshot {
  tick: number
  image: ImageData
  kind: LabSnapshotKind
  cellCount: number
  age: number
}

export interface LabRunResult {
  stats: LabSessionStats
  viabilityScore: number
  viabilityLabel: string
  viabilityReasons: string[]
  /** @deprecated используйте lifeSnapshots */
  finalSnapshot: ImageData | null
  lifeSnapshots: LabLifeSnapshot[]
  plantDead: boolean
  maxAgeReached: boolean
}

export type LabSnapshotCapture = (
  world: World,
  rootPlantId: number,
  tick: number,
) => ImageData | null

export type { LabGenomeCoverage } from './genomeExecution'

export interface LabAfterTickResult {
  rootAlive: boolean
  justDied: boolean
  newSnapshot: boolean
  /** Нужен отложенный снимок для галереи (не блокировать tick) */
  needsIntervalCapture: boolean
}

interface TrackedOffspring {
  plantId: number
  germinatedAt: number
}

export class LabSession {
  readonly world: World
  private rootPlantId: number
  private genome: Genome
  private peakCellCount = 0
  private timeSeries: LabTimePoint[] = []
  private seedsViable = 0
  private seedsDead = 0
  private offspringLifetimes: number[] = []
  private trackedOffspring = new Map<number, TrackedOffspring>()
  private lifeSnapshots: LabLifeSnapshot[] = []
  private lastAliveImage: ImageData | null = null
  private lastAliveTick = -1
  private deathSnapshotAdded = false
  private startCaptured = false
  private rootAliveBeforeTick = true
  private ipHits = new Uint32Array(0)
  private structuralHits = new Uint8Array(0)
  private stopIpState = { ip: null as number | null }
  private stopTick = -1
  private disasmLines: DisasmLine[] = []

  constructor(genome: Genome, seed = 42) {
    this.genome = genome
    setSimWorld(LAB_WORLD)
    this.world = new World(seed, { empty: true })
    this.world.seedOutcomeListener = (outcome) => {
      if (outcome === 'germinated') this.seedsViable++
      else this.seedsDead++
    }
    const plant = this.world.startConstructorLab(genome)
    this.rootPlantId = plant.id
    this.setupExecutionRecorder()
    this.sampleStats()
  }

  dispose(): void {
    resetSimWorld()
  }

  reset(genome: Genome): void {
    this.genome = genome
    setSimWorld(LAB_WORLD)
    const plant = this.world.startConstructorLab(genome)
    this.rootPlantId = plant.id
    this.peakCellCount = 0
    this.timeSeries = []
    this.seedsViable = 0
    this.seedsDead = 0
    this.offspringLifetimes = []
    this.trackedOffspring.clear()
    this.resetSnapshots()
    this.setupExecutionRecorder()
    this.world.seedOutcomeListener = (outcome) => {
      if (outcome === 'germinated') this.seedsViable++
      else this.seedsDead++
    }
    this.sampleStats()
  }

  getGenomeCoverage(): LabGenomeCoverage {
    return buildGenomeCoverageForLines(
      this.disasmLines,
      this.ipHits,
      this.structuralHits,
      this.stopIpState.ip,
      this.stopTick,
    )
  }

  /** Трассировка VM на текущем состоянии корня (до следующего tick). */
  traceRootGrowth(): GrowthVmTrace | null {
    const root = this.rootPlant()
    if (!root || root.dead) return null
    return traceGrowthVM(
      root,
      this.world.plants,
      this.world.occupancy,
      this.world.light,
      this.world.minerals,
      this.world.rng,
    )
  }

  isRootAlive(): boolean {
    const root = this.rootPlant()
    return !!(root && !root.dead)
  }

  getLifeSnapshots(): LabLifeSnapshot[] {
    return this.lifeSnapshots
  }

  getRunResult(): LabRunResult {
    return this.buildResult()
  }

  getLiveStats(): LabSessionStats {
    return this.collectStats(this.world.tickCount)
  }

  /** Стартовый кадр (тик 0). Вызывать из UI через rAF после посадки. */
  captureStart(capture?: LabSnapshotCapture): boolean {
    if (this.startCaptured || !capture) return false
    const ok = this.captureAt(0, 'start', capture)
    if (ok) this.startCaptured = true
    return ok
  }

  tick(): void {
    this.rootAliveBeforeTick = this.isRootAlive()
    const beforePlants = new Map(this.world.plants.map((p) => [p.id, p.dead]))
    this.world.tick()
    this.stopTick = this.world.tickCount
    this.trackOffspring(beforePlants)
    this.sampleStats()
  }

  /** Снимки и детект гибели — вызывать после tick(). Снимки интервала — отдельно через completeIntervalCapture. */
  afterTick(): LabAfterTickResult {
    const rootAlive = this.isRootAlive()
    let newSnapshot = false
    const tick = this.world.tickCount
    const needsIntervalCapture = rootAlive && tick > 0 && tick % LIFE_SNAPSHOT_INTERVAL === 0

    if (!rootAlive && this.rootAliveBeforeTick && !this.deathSnapshotAdded && this.lastAliveImage) {
      this.pushGallery(this.makeSnap(this.lastAliveTick, this.lastAliveImage, 'death'))
      this.deathSnapshotAdded = true
      newSnapshot = true
    }

    return {
      rootAlive,
      justDied: this.rootAliveBeforeTick && !rootAlive,
      newSnapshot,
      needsIntervalCapture,
    }
  }

  /** Отложенный снимок галереи — вызывать из rAF/idle, не в hot path tick. */
  completeIntervalCapture(capture: LabSnapshotCapture): boolean {
    return this.captureLiveFrame(capture)
  }

  runToEnd(maxTicks = LAB_MAX_TICKS, capture?: LabSnapshotCapture): LabRunResult {
    this.captureStart(capture)

    let ticks = 0
    while (ticks < maxTicks && !this.isEcologyDone()) {
      this.tick()
      ticks++
      const after = this.afterTick()
      if (after.needsIntervalCapture && capture) {
        this.completeIntervalCapture(capture)
      }
      if (!this.isRootAlive()) break
    }

    return this.buildResult()
  }

  private resetSnapshots(): void {
    this.lifeSnapshots = []
    this.lastAliveImage = null
    this.lastAliveTick = -1
    this.deathSnapshotAdded = false
    this.startCaptured = false
  }

  private setupExecutionRecorder(): void {
    this.disasmLines = disassemble(this.genome)
    const len = Math.max(1, this.genome.code.length)
    this.ipHits = new Uint32Array(len)
    this.structuralHits = new Uint8Array(len)
    this.stopIpState = { ip: null }
    this.stopTick = -1
    this.world.labGrowthRecorder = createGenomeExecutionRecorder(
      len,
      this.ipHits,
      this.structuralHits,
      this.stopIpState,
    )
  }

  private makeSnap(
    tick: number,
    image: ImageData,
    kind: LabSnapshotKind,
    plant?: Plant,
  ): LabLifeSnapshot {
    const root = plant ?? this.rootPlant()
    return {
      tick,
      image,
      kind,
      cellCount: root?.cells.length ?? 0,
      age: root?.age ?? 0,
    }
  }

  private pushGallery(snap: LabLifeSnapshot): void {
    const idx = this.lifeSnapshots.findIndex((s) => s.tick === snap.tick && s.kind === snap.kind)
    if (idx >= 0) {
      this.lifeSnapshots[idx] = snap
    } else {
      this.lifeSnapshots.push(snap)
    }
    this.lifeSnapshots.sort((a, b) => a.tick - b.tick)
  }

  private captureAt(tick: number, kind: LabSnapshotKind, capture: LabSnapshotCapture): boolean {
    const root = this.rootPlant()
    if (!root) return false
    if (root.dead && kind !== 'death') return false
    const image = capture(this.world, this.rootPlantId, tick)
    if (!image) return false
    if (!root.dead) {
      this.lastAliveTick = tick
      this.lastAliveImage = image
    }
    this.pushGallery(this.makeSnap(tick, image, kind, root))
    return true
  }

  private captureLiveFrame(capture: LabSnapshotCapture): boolean {
    const root = this.rootPlant()
    if (!root || root.dead) return false
    const tick = this.world.tickCount
    if (tick % LIFE_SNAPSHOT_INTERVAL !== 0) return false

    const image = capture(this.world, this.rootPlantId, tick)
    if (!image) return false
    this.lastAliveTick = tick
    this.lastAliveImage = image
    if (tick > 0) {
      this.pushGallery(this.makeSnap(tick, image, 'interval', root))
      return true
    }
    return false
  }

  private isEcologyDone(): boolean {
    const alive = this.world.plants.filter((p) => !p.dead)
    if (alive.length > 0) return false
    if (this.world.seeds.length > 0) return false
    if (this.world.fallingSeeds.length > 0) return false
    return true
  }

  private trackOffspring(beforePlants: Map<number, boolean>): void {
    for (const plant of this.world.plants) {
      if (plant.id === this.rootPlantId) continue
      if (this.trackedOffspring.has(plant.id)) continue
      if (plant.id > this.rootPlantId && !beforePlants.has(plant.id)) {
        this.trackedOffspring.set(plant.id, {
          plantId: plant.id,
          germinatedAt: this.world.tickCount,
        })
      }
    }
    for (const [id] of [...this.trackedOffspring]) {
      const plant = this.world.plants.find((p) => p.id === id)
      if (plant?.dead) {
        this.offspringLifetimes.push(plant.age)
        this.trackedOffspring.delete(id)
      }
    }
  }

  private sampleStats(): void {
    const tick = this.world.tickCount
    const root = this.rootPlant()
    const cellCount = root?.cells.length ?? 0
    this.peakCellCount = Math.max(this.peakCellCount, cellCount)
    if (tick % TIME_SERIES_INTERVAL === 0 || tick === 0) {
      this.timeSeries.push({
        tick,
        cellCount,
        age: root?.age ?? 0,
        roots: root ? root.cells.filter((c) => c.type === 'ROOT').length : 0,
      })
    }
  }

  private rootPlant(): Plant | undefined {
    return this.world.plants.find((p) => p.id === this.rootPlantId)
  }

  private countCellType(plant: Plant, type: Plant['cells'][0]['type']): number {
    return plant.cells.filter((c) => c.type === type).length
  }

  private collectStats(tick: number): LabSessionStats {
    const root = this.rootPlant()
    const alive = root && !root.dead ? root : undefined

    const hist = new Array(SEED_LIFETIME_BUCKETS).fill(0)
    for (const life of this.offspringLifetimes) {
      const bucket = Math.min(SEED_LIFETIME_BUCKETS - 1, Math.floor(life / SEED_LIFETIME_BUCKET))
      hist[bucket]++
    }

    return {
      tick,
      cellCount: alive?.cells.length ?? root?.cells.length ?? 0,
      age: alive?.age ?? root?.age ?? 0,
      roots: alive ? this.countCellType(alive, 'ROOT') : 0,
      spikes: alive ? this.countCellType(alive, 'SPIKE') : root ? this.countCellType(root, 'SPIKE') : 0,
      shootsFired: root?.accounting.shootsFired ?? 0,
      seedsCreated: root?.accounting.seedsCreated ?? 0,
      seedsViable: this.seedsViable,
      seedsDead: this.seedsDead,
      seedLifetimeHist: hist,
      timeSeries: [...this.timeSeries],
      peakCellCount: this.peakCellCount,
    }
  }

  private buildResult(): LabRunResult {
    const stats = this.collectStats(this.world.tickCount)
    const root = this.rootPlant()
    const maxAge = genomeMaxAge(this.genome)
    const plantDead = !this.isRootAlive()
    const maxAgeReached = (root?.age ?? this.lastAliveTick) >= maxAge * 0.95

    const { score, label, reasons } = evaluateViability(stats, maxAge, plantDead, this.world.tickCount)

    const finalSnapshot =
      this.lastAliveImage ?? this.lifeSnapshots[this.lifeSnapshots.length - 1]?.image ?? null

    return {
      stats,
      viabilityScore: score,
      viabilityLabel: label,
      viabilityReasons: reasons,
      finalSnapshot,
      lifeSnapshots: [...this.lifeSnapshots],
      plantDead,
      maxAgeReached,
    }
  }
}

function evaluateViability(
  stats: LabSessionStats,
  maxAge: number,
  plantDead: boolean,
  deathTick: number,
): { score: number; label: string; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  if (stats.age >= maxAge * 0.5) {
    score += 25
    reasons.push(`Дожил до ${Math.round((stats.age / maxAge) * 100)}% максимального возраста`)
  } else {
    reasons.push(`Погиб на тике ${deathTick} (${Math.round((stats.age / maxAge) * 100)}% maxAge)`)
  }

  if (stats.peakCellCount >= 5) {
    score += 20
    reasons.push(`Пик клеток: ${stats.peakCellCount}`)
  } else {
    reasons.push(`Мало клеток (пик ${stats.peakCellCount})`)
  }

  if (stats.roots >= 2) {
    score += 15
    reasons.push(`Корней: ${stats.roots}`)
  } else {
    reasons.push('Недостаточно корней')
  }

  if (stats.seedsCreated >= 1) {
    score += 15
    reasons.push(`Создано семян: ${stats.seedsCreated}`)
  } else {
    reasons.push('Семена не создавались')
  }

  if (stats.seedsViable >= 1) {
    score += 25
    reasons.push(`Проросло семян: ${stats.seedsViable}`)
  } else if (stats.seedsCreated > 0) {
    reasons.push('Ни одно семя не проросло')
  }

  let label: string
  if (score >= 70) label = 'жизнеспособен'
  else if (score >= 35) label = 'слабый'
  else label = 'нежизнеспособен'

  if (plantDead && stats.age < 10) {
    reasons.unshift('Раняя гибель')
  }

  return { score, label, reasons }
}
