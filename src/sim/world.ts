import { GERMINATION_CHANCE, GERMINATION_NEIGHBOR_BLOCK, INITIAL_PLANTS, MAX_GERMINATIONS_PER_TICK, MIN_PLANT_SPACING, MIN_SEED_ENERGY, MINERAL_ENERGY_FACTOR, SEED_FALL_DURATION_TICKS, SEED_GERMINATION_TICKS, SEED_MIN_PAYLOAD, SEED_SCATTER, SEED_SOIL_UPKEEP, WORLD } from './config'
import {
  computeLightGridInto,
  depositMinerals,
  diffuseMinerals,
  initMinerals,
  totalSoilEnergy,
  uptakeMinerals,
} from './environment'
import { genomeHue, mutate, randomGenome, deserializeGenome, cloneGenome } from './genome'
import {
  agePlant,
  applyIncomeAndUpkeep,
  plantMineralSupply,
  createPlant,
  detachFallingSeeds,
  executeGrowthVM,
  isPlantDead,
  plantMaxHeight,
  plantTotalEnergy,
  processPlantDeath,
  removeStarvedCells,
  resetIdCounters,
  transportEnergy,
  getIdCounters,
  setIdCounters,
} from './plant'
import { applyWorldFoliageRules, clearPlantingColumn } from './foliage'
import { Rng } from './rng'
import type { AppMode, EvolutionSnapshot, FallingSeed, Genome, Plant, SeedInSoil, WorldStats } from './types'
import { estimateSpecies } from './genome'
import { SEED_OCC, isCellFree } from './occupancy'
import { emitPlantEvent, setPlantEventSink, type PlantTickEvent } from './plantEvents'

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

function cloneOccupancy(src: Int32Array[]): Int32Array[] {
  return src.map((row) => new Int32Array(row))
}

export class World {
  readonly rng: Rng
  mode: AppMode = 'EVOLUTION'
  tickCount = 0
  plants: Plant[] = []
  seeds: SeedInSoil[] = []
  fallingSeeds: FallingSeed[] = []
  minerals: Float32Array
  light: Float32Array
  occupancy: Int32Array[]
  selectedPlantId: number | null = null
  /** Если задан — собираем tickEvents только для этого растения (режим TRACE) */
  tracePlantId: number | null = null
  /** События последнего тика (для режима трассировки) */
  tickEvents: PlantTickEvent[] = []

  constructor(seed = 42) {
    this.rng = new Rng(seed)
    this.minerals = initMinerals()
    this.occupancy = Array.from({ length: WORLD.H }, () => new Int32Array(WORLD.W))
    this.light = new Float32Array(WORLD.W * WORLD.H)
    resetIdCounters()
    this.seedInitialPlants(INITIAL_PLANTS)
    this.rebuildLight()
  }

  private syncOccupancyFromPlants(): void {
    for (let y = 0; y < WORLD.H; y++) {
      this.occupancy[y].fill(0)
    }
    for (const seed of this.seeds) {
      this.markSoilSeed(seed.x, seed.y)
    }
    for (const plant of this.plants) {
      if (plant.dead) continue
      for (const cell of plant.cells) {
        this.occupancy[cell.y][cell.x] = plant.id
      }
    }
  }

  private rebuildLight(): void {
    this.syncOccupancyFromPlants()
    computeLightGridInto(this.occupancy, this.light)
  }

  private isOccupied(x: number, y: number): boolean {
    return !isCellFree(this.occupancy, x, y)
  }

  private markSoilSeed(x: number, y: number): void {
    this.occupancy[y][x] = SEED_OCC
  }

  private unmarkSoilSeed(x: number, y: number): void {
    if (this.occupancy[y][x] === SEED_OCC) this.occupancy[y][x] = 0
  }

  /** Свободная ячейка на поверхности почвы в радиусе maxScatter от originX */
  private findSeedSurfaceSlot(originX: number, maxScatter = SEED_SCATTER): { x: number; y: number } | null {
    const y = WORLD.SOIL_Y
    const offsets: number[] = []
    for (let dx = -maxScatter; dx <= maxScatter; dx++) offsets.push(dx)
    const start = this.rng.nextInt(0, offsets.length - 1)
    for (let i = 0; i < offsets.length; i++) {
      const x = originX + offsets[(start + i) % offsets.length]
      if (x < 0 || x >= WORLD.W) continue
      if (isCellFree(this.occupancy, x, y)) return { x, y }
    }
    return null
  }

  /** Положить семя на поверхность почвы; если места нет — семя погибает */
  private placeSoilSeed(seed: Omit<SeedInSoil, 'ticksInSoil'> & { ticksInSoil?: number }): boolean {
    if (seed.energy < SEED_MIN_PAYLOAD) return false
    const slot = this.findSeedSurfaceSlot(seed.x)
    if (!slot) return false
    this.seeds.push({
      x: slot.x,
      y: slot.y,
      genome: seed.genome,
      energy: seed.energy,
      ticksInSoil: seed.ticksInSoil ?? 0,
      lineageHue: seed.lineageHue,
      fromY: seed.fromY,
      parentPlantId: seed.parentPlantId,
    })
    this.markSoilSeed(slot.x, slot.y)
    return true
  }

  /** Верхняя свободная клетка почвы в колонке (рост начинается с уровня почвы) */
  private findSpawnY(x: number): number {
    for (let y = WORLD.SOIL_Y; y < WORLD.H; y++) {
      if (!this.isOccupied(x, y)) return y
    }
    return WORLD.SOIL_Y
  }

  private queueSeedFall(seed: SeedInSoil): void {
    const fromY = seed.fromY ?? seed.y
    const originX = seed.x
    const slot =
      this.findSeedSurfaceSlot(originX) ??
      this.findSeedSurfaceSlot(originX, SEED_SCATTER + 3)
    if (!slot) return

    if (fromY < WORLD.SOIL_Y) {
      this.fallingSeeds.push({
        x: slot.x,
        fromY,
        toY: slot.y,
        startTick: this.tickCount,
        startTime: performance.now(),
        genome: seed.genome,
        energy: seed.energy,
        lineageHue: seed.lineageHue,
        parentPlantId: seed.parentPlantId,
      })
    } else {
      this.placeSoilSeed({ ...seed, x: slot.x, y: slot.y })
    }
  }

  private processFallingSeeds(): void {
    const stillFalling: FallingSeed[] = []
    for (const f of this.fallingSeeds) {
      // Логика приземления — потиковая (детерминированная), а не по часам;
      // плавность падения рисует канвас отдельно по реальному времени.
      if (this.tickCount - f.startTick >= SEED_FALL_DURATION_TICKS) {
        this.placeSoilSeed({
          x: f.x,
          y: f.toY,
          genome: f.genome,
          energy: f.energy,
          ticksInSoil: 0,
          lineageHue: f.lineageHue,
          fromY: f.fromY,
          parentPlantId: f.parentPlantId,
        })
      } else {
        stillFalling.push(f)
      }
    }
    this.fallingSeeds = stillFalling
  }

  seedInitialPlants(count: number): void {
    const usedX = new Set<number>()
    for (let i = 0; i < count; i++) {
      let x = this.rng.nextInt(2, WORLD.W - 3)
      let attempts = 0
      while (attempts < 80) {
        const tooClose = [...usedX].some((ux) => Math.abs(ux - x) < MIN_PLANT_SPACING)
        if (!tooClose) break
        x = this.rng.nextInt(2, WORLD.W - 3)
        attempts++
      }
      usedX.add(x)
      const y = this.findSpawnY(x)
      const genome = randomGenome(this.rng)
      const plant = createPlant(genome, x, y, genomeHue(genome), 12, this.rng.nextInt(0, 15))
      this.plants.push(plant)
      this.occupancy[y][x] = plant.id
    }
  }

  plantAt(x: number, y: number): Plant | undefined {
    const id = this.occupancy[y]?.[x]
    if (id == null || id <= 0) return undefined
    return this.plants.find((p) => p.id === id && !p.dead)
  }

  selectPlantAt(x: number, y: number): number | null {
    const plant = this.plantAt(x, y)
    this.selectedPlantId = plant?.id ?? null
    return this.selectedPlantId
  }

  selectedPlant(): Plant | undefined {
    if (this.selectedPlantId == null) return undefined
    return this.plants.find((p) => p.id === this.selectedPlantId && !p.dead)
  }

  spawnFromGenome(genomeJson: string, x?: number, _y?: number): boolean {
    try {
      const genome = deserializeGenome(genomeJson)
      return this.plantGenomeAt(genome, x ?? this.rng.nextInt(2, WORLD.W - 3), false) != null
    } catch {
      return false
    }
  }

  /** Клетки в колонке посадки, которые будут сняты (превью). plantId=0 — семя в почве. */
  plantingColumnBlockers(columnX: number): { x: number; y: number; plantId: number }[] {
    const gx = Math.max(0, Math.min(WORLD.W - 1, Math.floor(columnX)))
    const blockers: { x: number; y: number; plantId: number }[] = []
    for (let y = 0; y < WORLD.H; y++) {
      const occ = this.occupancy[y][gx]
      if (occ === SEED_OCC) blockers.push({ x: gx, y, plantId: 0 })
      else if (occ > 0) blockers.push({ x: gx, y, plantId: occ })
    }
    return blockers
  }

  private clearPlantingColumnAt(gx: number): void {
    this.seeds = this.seeds.filter((seed) => {
      if (seed.x !== gx) return true
      this.unmarkSoilSeed(seed.x, seed.y)
      return false
    })

    for (const dep of clearPlantingColumn(this.plants, this.occupancy, gx)) {
      depositMinerals(this.minerals, dep.x, dep.y, dep.amount)
    }

    const emptied: Plant[] = []
    for (const plant of this.plants) {
      if (!plant.dead && plant.cells.length === 0) emptied.push(plant)
    }
    for (const plant of emptied) {
      const result = processPlantDeath(plant, this.occupancy)
      for (const dep of result.deposits) depositMinerals(this.minerals, dep.x, dep.y, dep.amount)
      for (const seed of result.seeds) {
        const mutatedGenome = this.rng.chance(0.2) ? mutate(seed.genome, this.rng) : seed.genome
        this.queueSeedFall({
          ...seed,
          genome: mutatedGenome,
          lineageHue: genomeHue(mutatedGenome),
        })
      }
    }
  }

  /**
   * Посадить геном в колонке x (поверхность почвы). В эволюции снимаются только
   * клетки других растений в этой колонке — соседи не трогаются.
   */
  plantGenomeAt(genome: Genome, x: number, laboratory = false): Plant | null {
    const gx = Math.max(0, Math.min(WORLD.W - 1, Math.floor(x)))
    const gy = WORLD.SOIL_Y

    if (laboratory) {
      this.seeds = []
      this.fallingSeeds = []
      this.plants = this.plants.filter((p) => p.dead)
      this.mode = 'LABORATORY'
    } else {
      this.clearPlantingColumnAt(gx)
    }

    if (this.occupancy[gy][gx] !== 0) {
      const altY = this.findSpawnY(gx)
      if (this.occupancy[altY][gx] !== 0) return null
    }

    const spawnY = this.occupancy[gy][gx] === 0 ? gy : this.findSpawnY(gx)
    const plant = createPlant(genome, gx, spawnY, genomeHue(genome), 12)
    this.plants.push(plant)
    this.occupancy[spawnY][gx] = plant.id
    this.selectedPlantId = plant.id
    this.rebuildLight()
    return plant
  }

  /** Убрать живое растение с поля без смерти (для лаборатории). */
  extractToLaboratory(plantId: number): Plant | null {
    const plant = this.plants.find((p) => p.id === plantId && !p.dead)
    if (!plant) return null
    for (const cell of plant.cells) {
      this.occupancy[cell.y][cell.x] = 0
    }
    this.plants = this.plants.filter((p) => p.id !== plantId)
    if (this.selectedPlantId === plantId) this.selectedPlantId = null
    this.rebuildLight()
    return plant
  }

  private uptakeRoots(): Map<number, number> {
    const uptakeByCell = new Map<number, number>()
    for (const plant of this.plants) {
      if (plant.dead) continue
      for (const cell of plant.cells) {
        const isRootLike = cell.type === 'ROOT' || (cell.type === 'SPROUT' && cell.y >= WORLD.SOIL_Y)
        if (!isRootLike) continue
        const uptake = uptakeMinerals(this.minerals, cell.x, cell.y, 1)
        if (uptake > 0) uptakeByCell.set(cell.id, uptake)
      }
    }
    return uptakeByCell
  }

  tick(): void {
    this.tickEvents = []
    const traceId = this.tracePlantId
    if (traceId != null) {
      setPlantEventSink((e) => {
        if (e.plantId === traceId) this.tickEvents.push(e)
      })
    }
    try {
      this.tickCount++
    this.processFallingSeeds()

    const uptakeByCell = this.uptakeRoots()

    for (const plant of this.plants) {
      if (plant.dead) continue
      const mineralSupply = plantMineralSupply(plant, uptakeByCell)
      let mineralUptake = 0
      for (const cell of plant.cells) {
        mineralUptake += uptakeByCell.get(cell.id) ?? 0
      }
      plant.accounting.mineralEnergyGained += mineralUptake * MINERAL_ENERGY_FACTOR
      applyIncomeAndUpkeep(plant, this.light, mineralSupply)
      agePlant(plant)
      removeStarvedCells(plant, this.occupancy)
    }

    for (const dep of applyWorldFoliageRules(this.plants, this.occupancy)) {
      depositMinerals(this.minerals, dep.x, dep.y, dep.amount)
    }
    this.rebuildLight()

    const fallenSeeds: SeedInSoil[] = []
    for (const plant of this.plants) {
      if (plant.dead) continue
      executeGrowthVM(plant, this.occupancy, this.light, this.minerals, this.rng)
      fallenSeeds.push(...detachFallingSeeds(plant, this.occupancy))
    }

    for (const plant of this.plants) {
      if (plant.dead) continue
      transportEnergy(plant)
    }

  for (const seed of fallenSeeds) {
    this.queueSeedFall(seed)
  }

    this.germinateSeeds()

    const deaths: Plant[] = []
    for (const plant of this.plants) {
      if (!plant.dead && isPlantDead(plant)) deaths.push(plant)
    }

    for (const plant of deaths) {
      const result = processPlantDeath(plant, this.occupancy)
      for (const dep of result.deposits) depositMinerals(this.minerals, dep.x, dep.y, dep.amount)
      for (const seed of result.seeds) {
        const mutatedGenome = this.rng.chance(0.2) ? mutate(seed.genome, this.rng) : seed.genome
        this.queueSeedFall({
          ...seed,
          genome: mutatedGenome,
          lineageHue: genomeHue(mutatedGenome),
        })
      }
    }

    this.plants = this.plants.filter((p) => !p.dead)

    diffuseMinerals(this.minerals)
    this.rebuildLight()
    } finally {
      setPlantEventSink(null)
    }
  }

  private getGerminationBlockedColumns(): Set<number> {
    const blocked = new Set<number>()
    for (const plant of this.plants) {
      if (plant.dead) continue
      const surfaceColumns = new Set<number>()
      for (const cell of plant.cells) {
        if (cell.y <= WORLD.SOIL_Y) surfaceColumns.add(cell.x)
      }
      for (const px of surfaceColumns) {
        for (let d = 1; d <= GERMINATION_NEIGHBOR_BLOCK; d++) {
          if (px - d >= 0) blocked.add(px - d)
          if (px + d < WORLD.W) blocked.add(px + d)
        }
      }
    }
    return blocked
  }

  private canGerminateAt(seed: SeedInSoil, spawnY: number): boolean {
    const occ = this.occupancy[spawnY][seed.x]
    if (occ > 0) return false
    // своё семя занимает ячейку на поверхности — это нормально, проросток её займёт
    if (occ === SEED_OCC) return seed.y === spawnY
    return true
  }

  private isTooCloseForGermination(x: number, surfaceColumns: Set<number>): boolean {
    for (const sx of surfaceColumns) {
      if (Math.abs(sx - x) < MIN_PLANT_SPACING) return true
    }
    return false
  }

  private germinateSeeds(): void {
    const remaining: SeedInSoil[] = []
    let germinated = 0
    const blocked = this.getGerminationBlockedColumns()
    const surfaceColumns = new Set<number>()
    for (const plant of this.plants) {
      if (plant.dead) continue
      for (const cell of plant.cells) {
        if (cell.y <= WORLD.SOIL_Y) surfaceColumns.add(cell.x)
      }
    }

    for (const seed of this.seeds) {
      seed.ticksInSoil++

      if (seed.energy < MIN_SEED_ENERGY) {
        this.unmarkSoilSeed(seed.x, seed.y)
        continue
      }

      const spawnY = WORLD.SOIL_Y
      const ready =
        seed.ticksInSoil >= SEED_GERMINATION_TICKS && seed.energy >= MIN_SEED_ENERGY
      if (
        ready &&
        this.canGerminateAt(seed, spawnY) &&
        !blocked.has(seed.x) &&
        !this.isTooCloseForGermination(seed.x, surfaceColumns) &&
        germinated < MAX_GERMINATIONS_PER_TICK &&
        this.rng.chance(GERMINATION_CHANCE)
      ) {
        const genome = this.rng.chance(0.1) ? mutate(seed.genome, this.rng) : seed.genome
        this.unmarkSoilSeed(seed.x, seed.y)
        const plant = createPlant(
          genome,
          seed.x,
          spawnY,
          genomeHue(genome),
          seed.energy,
          this.rng.nextInt(0, 10),
        )
        this.plants.push(plant)
        this.occupancy[spawnY][seed.x] = plant.id
        surfaceColumns.add(seed.x)
        germinated++
        if (seed.parentPlantId != null) {
          emitPlantEvent({
            plantId: seed.parentPlantId,
            kind: 'GERMINATE',
            x: seed.x,
            y: spawnY,
            fromX: seed.x,
            fromY: seed.y,
          })
        }

        for (let d = 1; d <= GERMINATION_NEIGHBOR_BLOCK; d++) {
          if (seed.x - d >= 0) blocked.add(seed.x - d)
          if (seed.x + d < WORLD.W) blocked.add(seed.x + d)
        }
        continue
      }

      // После окна ожидания — лёгкий метаболизм; ниже порога прорастания не дожидаемся нуля
      if (seed.ticksInSoil > SEED_GERMINATION_TICKS) {
        seed.energy = Math.max(0, seed.energy - SEED_SOIL_UPKEEP)
      }
      if (seed.energy < MIN_SEED_ENERGY) {
        this.unmarkSoilSeed(seed.x, seed.y)
        continue
      }
      remaining.push(seed)
    }
    this.seeds = remaining
  }

  /** Сохранить текущее состояние эволюции (перед входом в лабораторию). */
  captureEvolution(): EvolutionSnapshot | null {
    if (this.mode !== 'EVOLUTION') return null
    const ids = getIdCounters()
    return {
      tickCount: this.tickCount,
      plants: this.plants.map(clonePlant),
      seeds: this.seeds.map(cloneSeed),
      fallingSeeds: this.fallingSeeds.map(cloneFallingSeed),
      minerals: new Float32Array(this.minerals),
      occupancy: cloneOccupancy(this.occupancy),
      rngState: this.rng.getState(),
      nextPlantId: ids.nextPlantId,
      nextCellId: ids.nextCellId,
      selectedPlantId: this.selectedPlantId,
    }
  }

  /** Восстановить сохранённую эволюцию после лаборатории. */
  restoreEvolution(snapshot: EvolutionSnapshot): void {
    this.mode = 'EVOLUTION'
    this.tickCount = snapshot.tickCount
    this.plants = snapshot.plants.map(clonePlant)
    this.seeds = snapshot.seeds.map(cloneSeed)
    this.fallingSeeds = snapshot.fallingSeeds.map(cloneFallingSeed)
    this.minerals = new Float32Array(snapshot.minerals)
    this.occupancy = cloneOccupancy(snapshot.occupancy)
    this.rng.setState(snapshot.rngState)
    setIdCounters(snapshot.nextPlantId, snapshot.nextCellId)
    this.selectedPlantId = snapshot.selectedPlantId
    this.rebuildLight()
  }

  restart(seed?: number): void {
    if (seed != null) {
      this.rng.reseed(seed)
    }
    this.mode = 'EVOLUTION'
    this.tickCount = 0
    this.plants = []
    this.seeds = []
    this.fallingSeeds = []
    this.selectedPlantId = null
    this.minerals = initMinerals()
    this.occupancy = Array.from({ length: WORLD.H }, () => new Int32Array(WORLD.W))
    resetIdCounters()
    this.seedInitialPlants(INITIAL_PLANTS)
    this.rebuildLight()
  }

  /** Пустой мир с одним экземпляром из коллекции (без прорастания семян). */
  startLaboratory(genome: Genome): Plant {
    this.mode = 'LABORATORY'
    this.tickCount = 0
    this.plants = []
    this.seeds = []
    this.fallingSeeds = []
    this.selectedPlantId = null
    this.minerals = initMinerals()
    this.occupancy = Array.from({ length: WORLD.H }, () => new Int32Array(WORLD.W))
    resetIdCounters()
    this.rebuildLight()

    const x = Math.floor(WORLD.W / 2)
    const y = WORLD.SOIL_Y
    const plant = createPlant(genome, x, y, genomeHue(genome), 12)
    this.plants.push(plant)
    this.occupancy[y][x] = plant.id
    this.selectedPlantId = plant.id
    return plant
  }

  /** Очистить мир для выбора нового образца в лаборатории. */
  clearLaboratory(): void {
    this.mode = 'LABORATORY'
    this.tickCount = 0
    this.plants = []
    this.seeds = []
    this.fallingSeeds = []
    this.selectedPlantId = null
    this.minerals = initMinerals()
    this.occupancy = Array.from({ length: WORLD.H }, () => new Int32Array(WORLD.W))
    resetIdCounters()
    this.rebuildLight()
  }

  stats(): WorldStats {
    const alive = this.plants.filter((p) => !p.dead)
    const plantEnergy = alive.reduce((s, p) => s + plantTotalEnergy(p), 0)
    const soilEnergy = totalSoilEnergy(this.minerals)
    const avgAge = alive.length
      ? alive.reduce((s, p) => s + p.age, 0) / alive.length
      : 0
    const avgHeight = alive.length
      ? alive.reduce((s, p) => s + plantMaxHeight(p), 0) / alive.length
      : 0

    return {
      tick: this.tickCount,
      plantEnergy,
      soilEnergy,
      alivePlants: alive.length,
      seedsInSoil: this.seeds.length,
      avgAge,
      avgHeight,
      speciesEstimate: estimateSpecies(this.plants),
    }
  }
}
