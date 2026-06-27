import {
  CAP,
  DEATH_ENERGY_RETURN,
  DOUBLE_GROW_COST_MULT,
  GROW_COST,
  GROW_ENERGY_RESERVE_TICKS,
  GROW_MIN_ENERGY_RESERVE,
  MAINTAIN,
  MAX_GROW_ACTIONS_PER_PLANT_PER_TICK,
  MAX_GROW_ACTIONS_CAP,
  ENERGY_PER_EXTRA_GROW_ACTION,
  ROOT_GROW_BUDGET_FRAC,
  SENESCENCE_START,
  SENESCENCE_UPKEEP_GAIN,
  MIN_SEED_HEIGHT,
  MIN_WATER_FOR_GROW,
  MINERAL_SUPPLY_NORM,
  SEED_MIN_PAYLOAD,
  SEED_FORMATION_OVERHEAD,
  SPIKE_COST,
  SHOOT_COST,
  PHOTO_GAIN_FACTOR,
  STEM_PHOTO_GAIN_FACTOR,
  SPROUT_SINK_POTENTIAL,
  TRANSPORT_RATE,
  VM_STEP_BUDGET,
  WORLD,
} from './config'
import {
  getLocalWater,
  getMineralAt,
  normalizedCrowdAbove,
  normalizedDepth,
  normalizedHeight,
  normalizedShadeLevel,
  plantWaterSupply,
} from './environment'
import {
  decodeDir,
  decodeLiteral,
  decodeOp,
  decodeSensor,
  genomeMaxAge,
  genomeSeedReserve,
  genomeDoubleGrowth,
  opArgCount,
  type SensorName,
} from './genome'
import { SEED_OCC, isCellFree } from './occupancy'
import { emitPlantEvent } from './plantEvents'
import type { Direction, Genome, Plant, PlantCell, PlantInspectStats, SeedInSoil } from './types'
import { Rng } from './rng'

let nextCellId = 1
let nextPlantId = 1

export function resetIdCounters(): void {
  nextCellId = 1
  nextPlantId = 1
}

export function getIdCounters(): { nextPlantId: number; nextCellId: number } {
  return { nextPlantId, nextCellId }
}

export function setIdCounters(plantId: number, cellId: number): void {
  nextPlantId = plantId
  nextCellId = cellId
}

const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
  UP_LEFT: { dx: -1, dy: -1 },
  UP_RIGHT: { dx: 1, dy: -1 },
  DOWN_LEFT: { dx: -1, dy: 1 },
  DOWN_RIGHT: { dx: 1, dy: 1 },
}

export function directionDelta(dir: Direction): { dx: number; dy: number } {
  return DIR_DELTA[dir]
}

export function createPlant(
  genome: Genome,
  x: number,
  y: number,
  lineageHue?: number,
  initialEnergy = 8,
  initialAge = 0,
): Plant {
  const cell: PlantCell = {
    id: nextCellId++,
    x,
    y,
    type: 'SPROUT',
    dir: 'UP',
    cellEnergy: initialEnergy,
    age: 0,
    waitingForGrow: false,
  }

  return {
    id: nextPlantId++,
    genome,
    cells: [cell],
    // Разброс стартового возраста рассинхронизирует гибель клонов (без него
    // одинаковые растения умирают разом, и популяция проваливается в ноль).
    age: initialAge,
    lineageHue: lineageHue ?? 0,
    edgeFlux: [],
    dead: false,
    accounting: {
      seedsCreated: 0,
      photoEnergyGained: 0,
      mineralEnergyGained: 0,
      upkeepSpent: 0,
    },
  }
}

export function plantEnergyRatio(plant: Plant): number {
  let energy = 0
  let cap = 0
  for (const cell of plant.cells) {
    energy += cell.cellEnergy
    cap += CAP[cell.type]
  }
  return cap > 0 ? energy / cap : 0
}

export function plantTotalEnergy(plant: Plant): number {
  return plant.cells.reduce((s, c) => s + c.cellEnergy, 0)
}

/** Суммарный расход энергии на содержание за тик (с учётом старости) */
export function plantUpkeepPerTick(plant: Plant): number {
  let base = 0
  for (const cell of plant.cells) {
    base += MAINTAIN[cell.type]
  }
  const maxAge = genomeMaxAge(plant.genome)
  const lifeFrac = maxAge > 0 ? plant.age / maxAge : 0
  const senescence =
    lifeFrac > SENESCENCE_START
      ? 1 + (lifeFrac - SENESCENCE_START) * SENESCENCE_UPKEEP_GAIN
      : 1
  return base * senescence
}

/**
 * Бюджет структурных действий за тик: растёт только от энергии сверх резерва
 * (содержание + подушка). Размер растения ограничен балансом дохода и upkeep.
 */
export function plantGrowActionBudget(plant: Plant): number {
  const surplus = Math.max(
    0,
    plantTotalEnergy(plant) -
      plantUpkeepPerTick(plant) * GROW_ENERGY_RESERVE_TICKS -
      GROW_MIN_ENERGY_RESERVE,
  )
  return Math.min(
    MAX_GROW_ACTIONS_CAP,
    MAX_GROW_ACTIONS_PER_PLANT_PER_TICK +
      Math.floor(surplus / ENERGY_PER_EXTRA_GROW_ACTION),
  )
}

function plantSenescenceMultiplier(plant: Plant): number {
  const maxAge = genomeMaxAge(plant.genome)
  const lifeFrac = maxAge > 0 ? plant.age / maxAge : 0
  if (lifeFrac <= SENESCENCE_START) return 1
  return 1 + (lifeFrac - SENESCENCE_START) * SENESCENCE_UPKEEP_GAIN
}

export function plantMaxHeight(plant: Plant): number {
  let maxAbove = 0
  for (const c of plant.cells) {
    if (c.y < WORLD.SOIL_Y) {
      maxAbove = Math.max(maxAbove, WORLD.SOIL_Y - c.y)
    }
  }
  return maxAbove
}

export function plantMaxRootDepth(plant: Plant): number {
  let maxDepth = 0
  for (const c of plant.cells) {
    if (c.y >= WORLD.SOIL_Y) {
      maxDepth = Math.max(maxDepth, c.y - WORLD.SOIL_Y)
    }
  }
  return maxDepth
}

export function computePlantInspectStats(plant: Plant): PlantInspectStats {
  let stems = 0
  let sprouts = 0
  let roots = 0
  for (const c of plant.cells) {
    if (c.type === 'STEM') stems++
    else if (c.type === 'SPROUT') sprouts++
    else if (c.type === 'ROOT') roots++
  }
  return {
    height: plantMaxHeight(plant),
    rootDepth: plantMaxRootDepth(plant),
    stems,
    sprouts,
    roots,
    age: plant.age,
    waterLevel: plantWaterSupply(plant),
    upkeepSpent: plant.accounting.upkeepSpent,
    seedsCreated: plant.accounting.seedsCreated,
    photoEnergyGained: plant.accounting.photoEnergyGained,
    mineralEnergyGained: plant.accounting.mineralEnergyGained,
    totalEnergy: plantTotalEnergy(plant),
  }
}

function getCellAt(plant: Plant, x: number, y: number): PlantCell | undefined {
  return plant.cells.find((c) => c.x === x && c.y === y)
}

function neighborsOf(plant: Plant, cell: PlantCell): PlantCell[] {
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]
  const result: PlantCell[] = []
  for (const [dx, dy] of dirs) {
    const n = getCellAt(plant, cell.x + dx, cell.y + dy)
    if (n) result.push(n)
  }
  return result
}

/** Значение сенсора, нормализованное в 0..1 */
function senseValue(
  sensor: SensorName,
  plant: Plant,
  cell: PlantCell,
  dir: Direction,
  occupancy: Int32Array[],
  light: Float32Array,
  minerals: Float32Array,
  rng: Rng,
): number {
  switch (sensor) {
    case 'ENERGY':
      return plantEnergyRatio(plant)
    case 'LIGHT':
      return light[cell.y * WORLD.W + cell.x]
    case 'WATER':
      return cell.y >= WORLD.SOIL_Y || cell.type === 'ROOT'
        ? getLocalWater(cell.x, cell.y)
        : plantWaterSupply(plant)
    case 'MINERALS':
      return Math.min(1, getMineralAt(minerals, cell.x, cell.y) / 20)
    case 'AGE':
      return Math.min(1, plant.age / genomeMaxAge(plant.genome))
    case 'HEIGHT':
      return normalizedHeight(cell.y)
    case 'DEPTH':
      return normalizedDepth(cell.y)
    case 'RANDOM':
      return rng.next()
    case 'FOREIGN': {
      const { dx, dy } = DIR_DELTA[dir]
      const nx = cell.x + dx
      const ny = cell.y + dy
      if (!inBounds(nx, ny)) return 1
      const occ = occupancy[ny][nx]
      if (occ === SEED_OCC || (occ > 0 && occ !== plant.id)) return 1
      return 0
    }
    case 'SHADE':
      return normalizedShadeLevel(occupancy, cell.x, cell.y)
    case 'SHADE_DIR': {
      const { dx, dy } = DIR_DELTA[dir]
      const nx = cell.x + dx
      const ny = cell.y + dy
      if (!inBounds(nx, ny)) return 1
      return normalizedShadeLevel(occupancy, nx, ny)
    }
    case 'MINERAL_DIR': {
      const { dx, dy } = DIR_DELTA[dir]
      const nx = cell.x + dx
      const ny = cell.y + dy
      if (!inBounds(nx, ny) || ny < WORLD.SOIL_Y) return 0
      return Math.min(1, getMineralAt(minerals, nx, ny) / 20)
    }
    case 'CROWD_ABOVE':
      return normalizedCrowdAbove(occupancy, plant.id, cell.x, cell.y)
  }
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < WORLD.W && y >= 0 && y < WORLD.H
}

function potential(cell: PlantCell): number {
  let pot = cell.cellEnergy / CAP[cell.type]
  if (cell.type === 'SPROUT' && cell.waitingForGrow) {
    pot -= SPROUT_SINK_POTENTIAL
  }
  return pot
}

export function transportEnergy(plant: Plant): void {
  const flows: { from: PlantCell; to: PlantCell; amount: number }[] = []
  const seen = new Set<string>()

  for (const a of plant.cells) {
    for (const b of neighborsOf(plant, a)) {
      const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`
      if (seen.has(key)) continue
      seen.add(key)

      const potA = potential(a)
      const potB = potential(b)
      let flow = TRANSPORT_RATE * (potA - potB)
      if (Math.abs(flow) < 0.001) continue

      const from = flow > 0 ? a : b
      const to = flow > 0 ? b : a
      const amount = Math.abs(flow)
      const maxFrom = from.cellEnergy
      const maxTo = CAP[to.type] - to.cellEnergy
      const actual = Math.min(amount, maxFrom, Math.max(0, maxTo))
      if (actual > 0) flows.push({ from, to, amount: actual })
    }
  }

  plant.edgeFlux = []
  for (const f of flows) {
    f.from.cellEnergy -= f.amount
    f.to.cellEnergy += f.amount
    plant.edgeFlux.push({
      fromId: f.from.id,
      toId: f.to.id,
      fromX: f.from.x,
      fromY: f.from.y,
      toX: f.to.x,
      toY: f.to.y,
      flow: f.amount,
    })
  }
}

/** Минеральное снабжение растения от корней, 0..1 */
export function plantMineralSupply(
  plant: Plant,
  uptakeByCell: Map<number, number>,
): number {
  let total = 0
  for (const cell of plant.cells) {
    total += uptakeByCell.get(cell.id) ?? 0
  }
  return Math.min(1, total / MINERAL_SUPPLY_NORM)
}

/** Клетка, способная к фотосинтезу: надземные стебли (слабее) и ростки */
function isLeaf(cell: PlantCell): boolean {
  return cell.y < WORLD.SOIL_Y && (cell.type === 'STEM' || cell.type === 'SPROUT')
}

function photoGainFactor(cell: PlantCell): number {
  if (cell.type === 'STEM') return PHOTO_GAIN_FACTOR * STEM_PHOTO_GAIN_FACTOR
  return PHOTO_GAIN_FACTOR
}

/**
 * Энергию даёт только фотосинтез в надземных клетках. Он ограничен по закону
 * минимума: нужны и свет (сверху), и вода + минералы (от корней снизу). Поэтому
 * растению необходимы одновременно листья наверху и корни в почве.
 */
export function applyIncomeAndUpkeep(
  plant: Plant,
  light: Float32Array,
  mineralSupply: number,
): void {
  const water = plantWaterSupply(plant)
  const nutrient = Math.min(water, mineralSupply)
  const senescence = plantSenescenceMultiplier(plant)
  for (const cell of plant.cells) {
    let income = 0
    if (isLeaf(cell)) {
      const l = light[cell.y * WORLD.W + cell.x]
      income = l * photoGainFactor(cell) * nutrient
      plant.accounting.photoEnergyGained += income
    }
    const upkeep = MAINTAIN[cell.type] * senescence
    plant.accounting.upkeepSpent += upkeep
    cell.cellEnergy = Math.min(CAP[cell.type], cell.cellEnergy + income)
    cell.cellEnergy = Math.max(0, cell.cellEnergy - upkeep)
  }
}

/** Тип зрелой клетки определяется тем, где она находится: в почве — корень, в воздухе — стебель */
function matureType(cell: PlantCell): 'ROOT' | 'STEM' {
  return cell.y >= WORLD.SOIL_Y ? 'ROOT' : 'STEM'
}

/** После появления потомка меристема созревает в ткань по положению в мире. */
function matureParentAfterOffspring(cell: PlantCell, plantId: number): 'ROOT' | 'STEM' {
  const kind = matureType(cell)
  cell.type = kind
  cell.waitingForGrow = false
  emitPlantEvent({ plantId, kind, x: cell.x, y: cell.y })
  return kind
}

function canPlace(
  occupancy: Int32Array[],
  _plantId: number,
  x: number,
  y: number,
  _dir?: Direction,
): boolean {
  if (!inBounds(x, y)) return false
  if (!isCellFree(occupancy, x, y)) return false
  return true
}

function setOccupancy(occupancy: Int32Array[], plantId: number, cell: PlantCell): void {
  occupancy[cell.y][cell.x] = plantId
}

function clearOccupancy(occupancy: Int32Array[], cell: PlantCell): void {
  occupancy[cell.y][cell.x] = 0
}

export interface GrowthResult {
  newSeeds: { x: number; y: number; energy: number }[]
}

function growCost(dir: Direction): number {
  if (dir === 'UP') return GROW_COST * 0.7
  if (dir === 'DOWN') return GROW_COST * 1.0
  if (dir.includes('_')) return GROW_COST * 1.05
  return GROW_COST * 0.85
}

/** Есть ли в почве опора ниже точки роста (корень/клетка глубже) */
export function hasSoilAnchor(plant: Plant, fromY: number): boolean {
  return plant.cells.some((c) => c.y > fromY && c.y >= WORLD.SOIL_Y)
}

function canGrowIntoAir(plant: Plant, fromY: number): boolean {
  return hasSoilAnchor(plant, fromY)
}

// Результат прогона программы меристемы за тик.
//  actions  — сколько структурных действий совершено (несколько BRANCH подряд)
//  matured  — меристема созрела в ткань (после GROW) и больше не активна
//  attempted— пыталось ли хоть одно структурное действие (для различения blocked/inert)
interface CellRun {
  actions: number
  matured: boolean
  attempted: boolean
}

interface VMContext {
  plant: Plant
  occupancy: Int32Array[]
  light: Float32Array
  minerals: Float32Array
  rng: Rng
  newSeeds: { x: number; y: number; energy: number }[]
}

/** Создать дочернюю клетку-меристему в направлении dir. true — если получилось. */
function spawnMeristem(
  cell: PlantCell,
  dir: Direction,
  ctx: VMContext,
  growKind: 'GROW' | 'BRANCH',
): boolean {
  const { plant, occupancy } = ctx
  if (plantWaterSupply(plant) < MIN_WATER_FOR_GROW) return false

  const { dx, dy } = DIR_DELTA[dir]
  const nx = cell.x + dx
  const ny = cell.y + dy
  if (!canPlace(occupancy, plant.id, nx, ny, dir)) return false

  // Рост в воздух разрешён только если в почве есть опора (корень глубже точки роста)
  if (ny < WORLD.SOIL_Y && !canGrowIntoAir(plant, cell.y)) return false

  const cost = growCost(dir)
  if (cell.cellEnergy < cost) return false

  cell.cellEnergy -= cost
  const child: PlantCell = {
    id: nextCellId++,
    x: nx,
    y: ny,
    type: 'SPROUT',
    dir,
    cellEnergy: dir === 'DOWN' ? 3.5 : 1.0,
    age: 0,
    waitingForGrow: false,
  }
  plant.cells.push(child)
  setOccupancy(occupancy, plant.id, child)
  emitPlantEvent({
    plantId: plant.id,
    kind: growKind,
    x: child.x,
    y: child.y,
    fromX: cell.x,
    fromY: cell.y,
  })
  return true
}

function canGrowAt(
  plant: Plant,
  occupancy: Int32Array[],
  fromY: number,
  x: number,
  y: number,
): boolean {
  if (!canPlace(occupancy, plant.id, x, y)) return false
  if (y < WORLD.SOIL_Y && !canGrowIntoAir(plant, fromY)) return false
  return true
}

/** GROW на 2 клетки: промежуточный сегмент созревает, на конце — новая мерistema. */
function spawnDoubleGrow(cell: PlantCell, dir: Direction, ctx: VMContext): boolean {
  const { plant, occupancy } = ctx
  if (plantWaterSupply(plant) < MIN_WATER_FOR_GROW) return false

  const { dx, dy } = DIR_DELTA[dir]
  const nx = cell.x + dx
  const ny = cell.y + dy
  const nx2 = cell.x + dx * 2
  const ny2 = cell.y + dy * 2

  if (!canGrowAt(plant, occupancy, cell.y, nx, ny)) return false
  if (!canGrowAt(plant, occupancy, cell.y, nx2, ny2)) return false

  const cost = growCost(dir) * DOUBLE_GROW_COST_MULT
  if (cell.cellEnergy < cost) return false

  cell.cellEnergy -= cost
  const midKind = ny >= WORLD.SOIL_Y ? 'ROOT' : 'STEM'
  const mid: PlantCell = {
    id: nextCellId++,
    x: nx,
    y: ny,
    type: midKind,
    dir,
    cellEnergy: dir === 'DOWN' ? 2.5 : 0.6,
    age: 0,
    waitingForGrow: false,
  }
  plant.cells.push(mid)
  setOccupancy(occupancy, plant.id, mid)
  emitPlantEvent({ plantId: plant.id, kind: midKind, x: nx, y: ny })

  const child: PlantCell = {
    id: nextCellId++,
    x: nx2,
    y: ny2,
    type: 'SPROUT',
    dir,
    cellEnergy: dir === 'DOWN' ? 3.5 : 1.0,
    age: 0,
    waitingForGrow: false,
  }
  plant.cells.push(child)
  setOccupancy(occupancy, plant.id, child)
  emitPlantEvent({
    plantId: plant.id,
    kind: 'GROW',
    x: child.x,
    y: child.y,
    fromX: mid.x,
    fromY: mid.y,
  })
  return true
}

function tryGrowMeristem(
  cell: PlantCell,
  dir: Direction,
  ctx: VMContext,
  growKind: 'GROW' | 'BRANCH',
): boolean {
  if (growKind === 'GROW' && genomeDoubleGrowth(ctx.plant.genome)) {
    const unit = growCost(dir)
    if (cell.cellEnergy >= unit * DOUBLE_GROW_COST_MULT && spawnDoubleGrow(cell, dir, ctx)) {
      return true
    }
  }
  return spawnMeristem(cell, dir, ctx, growKind)
}

function dropSeed(
  cell: PlantCell,
  dir: Direction,
  ctx: VMContext,
  energyFraction: number,
): boolean {
  const { plant, occupancy, newSeeds } = ctx
  if (cell.y > WORLD.SOIL_Y - MIN_SEED_HEIGHT) return false

  const { dx, dy } = DIR_DELTA[dir]
  const nx = cell.x + dx
  const ny = cell.y + dy
  if (!canPlace(occupancy, plant.id, nx, ny, dir)) return false

  const frac = Math.max(0, Math.min(1, energyFraction))
  const maxReserve = genomeSeedReserve(plant.genome)
  const target = Math.max(
    SEED_MIN_PAYLOAD,
    Math.round(SEED_MIN_PAYLOAD + (maxReserve - SEED_MIN_PAYLOAD) * frac),
  )
  const sources = [cell, ...neighborsOf(plant, cell)]
  const deductions = new Map<number, number>()

  const takeFrom = (src: PlantCell, amount: number, minLeft: number): number => {
    if (amount <= 0) return 0
    const available = Math.max(0, src.cellEnergy - (deductions.get(src.id) ?? 0) - minLeft)
    const take = Math.min(amount, available)
    if (take > 0) deductions.set(src.id, (deductions.get(src.id) ?? 0) + take)
    return take
  }

  let seedEnergy = takeFrom(cell, target, 0.5)
  if (seedEnergy < target) {
    let need = target - seedEnergy
    for (const n of neighborsOf(plant, cell)) {
      if (need <= 0) break
      const take = takeFrom(n, need, 0.5)
      seedEnergy += take
      need -= take
    }
  }
  if (seedEnergy < SEED_MIN_PAYLOAD) return false

  let overhead = SEED_FORMATION_OVERHEAD
  for (const src of sources) {
    if (overhead <= 0) break
    overhead -= takeFrom(src, overhead, 0.3)
  }
  if (overhead > 0) return false

  for (const src of sources) {
    const amount = deductions.get(src.id)
    if (amount != null && amount > 0) src.cellEnergy -= amount
  }

  const seedCell: PlantCell = {
    id: nextCellId++,
    x: nx,
    y: ny,
    type: 'SEED',
    dir: 'DOWN',
    cellEnergy: seedEnergy,
    age: 0,
    waitingForGrow: false,
  }
  plant.cells.push(seedCell)
  setOccupancy(occupancy, plant.id, seedCell)
  newSeeds.push({ x: nx, y: ny, energy: seedEnergy })
  plant.accounting.seedsCreated++
  emitPlantEvent({
    plantId: plant.id,
    kind: 'SEED',
    x: nx,
    y: ny,
    fromX: cell.x,
    fromY: cell.y,
  })
  return true
}

function placeSpikeCell(
  cell: PlantCell,
  dir: Direction,
  ctx: VMContext,
  eventKind: 'SPIKE' | 'SHOOT',
): PlantCell | null {
  const { plant, occupancy } = ctx
  if (cell.y >= WORLD.SOIL_Y - 1) return null

  const { dx, dy } = DIR_DELTA[dir]
  const nx = cell.x + dx
  const ny = cell.y + dy
  if (!inBounds(nx, ny) || ny >= WORLD.SOIL_Y) return null

  const existing = getCellAt(plant, nx, ny)
  if (existing?.type === 'SPIKE') {
    const cost = eventKind === 'SHOOT' ? SHOOT_COST : SPIKE_COST
    if (cell.cellEnergy < cost) return null
    cell.cellEnergy -= cost
    existing.cellEnergy = Math.min(CAP.SPIKE, existing.cellEnergy + cost * 0.35)
    return existing
  }
  if (!canPlace(occupancy, plant.id, nx, ny, dir)) return null

  const cost = eventKind === 'SHOOT' ? SHOOT_COST : SPIKE_COST
  if (cell.cellEnergy < cost) return null

  cell.cellEnergy -= cost
  const spike: PlantCell = {
    id: nextCellId++,
    x: nx,
    y: ny,
    type: 'SPIKE',
    dir,
    cellEnergy: cost * 0.4,
    age: 0,
    waitingForGrow: false,
  }
  plant.cells.push(spike)
  setOccupancy(occupancy, plant.id, spike)
  emitPlantEvent({
    plantId: plant.id,
    kind: eventKind,
    x: nx,
    y: ny,
    fromX: cell.x,
    fromY: cell.y,
  })
  return spike
}

/** Мерistemа за шипом — цепочка «выстрелов». */
function sproutBeyondSpike(
  source: PlantCell,
  spike: PlantCell,
  dir: Direction,
  ctx: VMContext,
): boolean {
  const { plant, occupancy } = ctx
  const { dx, dy } = DIR_DELTA[dir]
  const ax = spike.x + dx
  const ay = spike.y + dy
  if (!inBounds(ax, ay) || ay >= WORLD.SOIL_Y) return false
  if (!canPlace(occupancy, plant.id, ax, ay, dir)) return false
  if (plantWaterSupply(plant) < MIN_WATER_FOR_GROW) return false

  const cost = growCost(dir) * 0.6
  if (source.cellEnergy < cost) return false

  source.cellEnergy -= cost
  const sprout: PlantCell = {
    id: nextCellId++,
    x: ax,
    y: ay,
    type: 'SPROUT',
    dir,
    cellEnergy: 0.8,
    age: 0,
    waitingForGrow: false,
  }
  plant.cells.push(sprout)
  setOccupancy(occupancy, plant.id, sprout)
  emitPlantEvent({
    plantId: plant.id,
    kind: 'GROW',
    x: ax,
    y: ay,
    fromX: spike.x,
    fromY: spike.y,
  })
  return true
}

function shootSpike(cell: PlantCell, dir: Direction, ctx: VMContext): boolean {
  const spike = placeSpikeCell(cell, dir, ctx, 'SHOOT')
  if (!spike) return false
  sproutBeyondSpike(cell, spike, dir, ctx)
  return true
}

/**
 * Исполнить геном-байткод для одной меристемы. Правила читаются сверху вниз.
 *
 *  GROW   — вытянуть филамент: дочерняя меристема в dir, родитель созревает
 *           (в почве → корень, в воздухе → стебель) и перестаёт быть меристемой.
 *           Завершает прогон (клетка больше не меристема).
 *  BRANCH — ответвление: дочерняя меристема в dir, родитель остаётся меристемой,
 *           поэтому при наличии энергии и бюджета может ответвиться НЕСКОЛЬКО раз
 *           за тик (если геном содержит несколько BRANCH).
 *  SEED   — сбросить семя в dir. Завершает прогон.
 *
 * `maxActions` — сколько ещё структурных действий разрешено растению в этом тике.
 */
function runCellProgram(cell: PlantCell, ctx: VMContext, maxActions: number): CellRun {
  const code = ctx.plant.genome.code
  if (code.length === 0 || maxActions <= 0) {
    return { actions: 0, matured: false, attempted: false }
  }

  const stack: number[] = []
  let dir: Direction = cell.dir
  let ip = 0
  let steps = 0
  let attempted = false
  let actions = 0

  while (steps < VM_STEP_BUDGET && ip < code.length) {
    steps++
    const op = decodeOp(code[ip])
    const arg = ip + 1 < code.length ? code[ip + 1] : 0

    switch (op) {
      case 'NOP':
        ip++
        break
      case 'PUSH':
        stack.push(decodeLiteral(arg))
        ip += 2
        break
      case 'SENSE':
        stack.push(
          senseValue(
            decodeSensor(arg),
            ctx.plant,
            cell,
            dir,
            ctx.occupancy,
            ctx.light,
            ctx.minerals,
            ctx.rng,
          ),
        )
        ip += 2
        break
      case 'DIR':
        dir = decodeDir(arg)
        ip += 2
        break
      case 'LT': {
        const a = stack.pop() ?? 0
        const b = stack.pop() ?? 0
        stack.push(b < a ? 1 : 0)
        ip++
        break
      }
      case 'GT': {
        const a = stack.pop() ?? 0
        const b = stack.pop() ?? 0
        stack.push(b > a ? 1 : 0)
        ip++
        break
      }
      case 'AND': {
        const a = stack.pop() ?? 0
        const b = stack.pop() ?? 0
        stack.push(a >= 0.5 && b >= 0.5 ? 1 : 0)
        ip++
        break
      }
      case 'OR': {
        const a = stack.pop() ?? 0
        const b = stack.pop() ?? 0
        stack.push(a >= 0.5 || b >= 0.5 ? 1 : 0)
        ip++
        break
      }
      case 'IF': {
        const v = stack.pop() ?? 0
        ip++
        if (v < 0.5 && ip < code.length) {
          // пропустить следующую инструкцию вместе с её аргументом
          const skipOp = decodeOp(code[ip])
          ip += 1 + opArgCount(skipOp)
        }
        break
      }
      case 'GROW': {
        attempted = true
        if (tryGrowMeristem(cell, dir, ctx, 'GROW')) {
          matureParentAfterOffspring(cell, ctx.plant.id)
          return { actions: actions + 1, matured: true, attempted }
        }
        ip++
        break
      }
      case 'BRANCH': {
        attempted = true
        if (tryGrowMeristem(cell, dir, ctx, 'BRANCH')) {
          cell.dir = dir
          cell.waitingForGrow = false
          // Родитель остаётся меристемой — можно ответвиться ещё раз за тик
          // (несколько боковых корней или побегов). Созревание только через GROW
          // или когда ни одно правило не подошло.
          actions++
          if (actions >= maxActions) {
            return { actions, matured: false, attempted }
          }
          ip++
          break
        }
        ip++
        break
      }
      case 'SEED': {
        attempted = true
        const seedFrac = decodeLiteral(arg)
        if (dropSeed(cell, dir, ctx, seedFrac)) {
          cell.waitingForGrow = false
          return { actions: actions + 1, matured: false, attempted }
        }
        ip += 2
        break
      }
      case 'SPIKE': {
        attempted = true
        if (placeSpikeCell(cell, dir, ctx, 'SPIKE')) {
          cell.dir = dir
          cell.waitingForGrow = false
          actions++
          if (actions >= maxActions) {
            return { actions, matured: false, attempted }
          }
          ip++
          break
        }
        ip++
        break
      }
      case 'SHOOT': {
        attempted = true
        if (shootSpike(cell, dir, ctx)) {
          cell.waitingForGrow = false
          return { actions: actions + 1, matured: false, attempted }
        }
        ip++
        break
      }
    }
  }
  return { actions, matured: false, attempted }
}

function processSproutGroup(
  cells: PlantCell[],
  ctx: VMContext,
  budget: number,
  actionsRef: { used: number },
): void {
  for (const cell of cells) {
    if (actionsRef.used >= budget) {
      cell.waitingForGrow = true
      continue
    }
    if (cell.type !== 'SPROUT') continue
    const run = runCellProgram(cell, ctx, budget - actionsRef.used)
    actionsRef.used += run.actions
    if (run.actions === 0) {
      if (run.attempted) {
        cell.waitingForGrow = true
      } else if (cell.y < WORLD.SOIL_Y) {
        // Воздушная меристема без сработавшего правила — не созревает, ждёт семя/рост
        cell.waitingForGrow = false
      } else {
        const kind = matureType(cell)
        cell.type = kind
        cell.waitingForGrow = false
        emitPlantEvent({ plantId: ctx.plant.id, kind, x: cell.x, y: cell.y })
      }
    }
  }
}

export function executeGrowthVM(
  plant: Plant,
  occupancy: Int32Array[],
  light: Float32Array,
  minerals: Float32Array,
  rng: Rng,
): GrowthResult {
  const newSeeds: { x: number; y: number; energy: number }[] = []
  if (plant.dead) return { newSeeds }
  // Размер не ограничен жёстко: рост и выживание лимитируются энергией (доход vs upkeep).

  const ctx: VMContext = { plant, occupancy, light, minerals, rng, newSeeds }

  const sprouts = plant.cells.filter((c) => c.type === 'SPROUT')
  const soilSprouts = sprouts
    .filter((c) => c.y >= WORLD.SOIL_Y)
    .sort((a, b) => b.y - a.y || a.id - b.id)
  const airSprouts = sprouts
    .filter((c) => c.y < WORLD.SOIL_Y)
    .sort((a, b) => a.y - b.y || a.id - b.id)

  const budget = plantGrowActionBudget(plant)

  const rootBudget =
    soilSprouts.length > 0
      ? Math.max(1, Math.min(budget, Math.floor(budget * ROOT_GROW_BUDGET_FRAC)))
      : 0

  const actionsRef = { used: 0 }
  // Сначала корни — им раньше не хватало бюджета после кроны
  processSproutGroup(soilSprouts, ctx, rootBudget, actionsRef)
  processSproutGroup(airSprouts, ctx, budget, actionsRef)

  return { newSeeds }
}

export function agePlant(plant: Plant): void {
  plant.age++
  for (const cell of plant.cells) cell.age++
}

export function isPlantDead(plant: Plant): boolean {
  if (plant.dead) return true
  if (plant.age >= genomeMaxAge(plant.genome)) return true
  if (plantTotalEnergy(plant) < 0.5) return true
  if (plant.cells.length === 0) return true
  return false
}

export function findLandingY(
  occupancy: Int32Array[],
  x: number,
  startY: number,
): number {
  let y = Math.min(WORLD.H - 1, startY)
  while (y < WORLD.H - 1) {
    const below = y + 1
    if (occupancy[below][x] !== 0) break
    y = below
  }
  return y
}

export interface DeathResult {
  seeds: SeedInSoil[]
  deposits: { x: number; y: number; amount: number }[]
  clearedCells: PlantCell[]
}

export function processPlantDeath(
  plant: Plant,
  occupancy: Int32Array[],
): DeathResult {
  const seeds: SeedInSoil[] = []
  const deposits: { x: number; y: number; amount: number }[] = []
  const clearedCells: PlantCell[] = []

  for (const cell of [...plant.cells]) {
    emitPlantEvent({ plantId: plant.id, kind: 'DEATH', x: cell.x, y: cell.y })
    clearOccupancy(occupancy, cell)

    // Только настоящие семена дают потомство. Ткани (ростки/стебли/корни) при
    // гибели лишь возвращают минералы в почву — размножение возможно лишь через
    // семена, сброшенные с надземного побега при жизни.
    if (cell.type === 'SEED') {
      const landY = Math.max(WORLD.SOIL_Y, findLandingY(occupancy, cell.x, cell.y))
      seeds.push({
        x: cell.x,
        y: landY,
        fromY: cell.y,
        genome: plant.genome,
        energy: Math.max(cell.cellEnergy, genomeSeedReserve(plant.genome) * 0.5),
        ticksInSoil: 0,
        lineageHue: plant.lineageHue,
        parentPlantId: plant.id,
      })
    } else {
      let landY = cell.y
      if (cell.y < WORLD.SOIL_Y) {
        landY = Math.max(WORLD.SOIL_Y, findLandingY(occupancy, cell.x, cell.y))
      }
      const amount = Math.max(0.8, cell.cellEnergy) * DEATH_ENERGY_RETURN
      if (amount > 0) deposits.push({ x: cell.x, y: landY, amount })
    }
    clearedCells.push(cell)
  }

  plant.cells = []
  plant.dead = true
  return { seeds, deposits, clearedCells }
}

export function removeStarvedCells(plant: Plant, occupancy: Int32Array[]): void {
  const surviving: PlantCell[] = []
  for (const cell of plant.cells) {
    if (cell.type === 'SEED' && cell.cellEnergy <= 0) {
      clearOccupancy(occupancy, cell)
      emitPlantEvent({ plantId: plant.id, kind: 'DEATH', x: cell.x, y: cell.y })
      continue
    }
    surviving.push(cell)
  }
  plant.cells = surviving
}

export function detachFallingSeeds(
  plant: Plant,
  occupancy: Int32Array[],
): SeedInSoil[] {
  const fallen: SeedInSoil[] = []
  const remaining: PlantCell[] = []

  for (const cell of plant.cells) {
    if (cell.type === 'SEED') {
      clearOccupancy(occupancy, cell)
      const fromY = cell.y
      let y = fromY
      while (y < WORLD.H - 1 && occupancy[y + 1][cell.x] === 0) {
        y++
      }
      const landY = Math.max(WORLD.SOIL_Y, y)
      fallen.push({
        x: cell.x,
        y: landY,
        fromY,
        genome: plant.genome,
        energy: cell.cellEnergy,
        ticksInSoil: 0,
        lineageHue: plant.lineageHue,
        parentPlantId: plant.id,
      })
      emitPlantEvent({
        plantId: plant.id,
        kind: 'SEED_DROP',
        x: cell.x,
        y: landY,
        fromX: cell.x,
        fromY,
      })
    } else {
      remaining.push(cell)
    }
  }

  plant.cells = remaining
  return fallen
}
