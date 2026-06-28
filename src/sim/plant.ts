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
  SHOOT_STEM_KILL_MAX_ENERGY,
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
  decodeStructuralDir,
  formatStructuralArg,
  formatWhenArg,
  genomeMaxAge,
  genomeSeedReserve,
  genomeDoubleGrowth,
  genomeShootRange,
  isStructuralGoto,
  opArgCount,
  passesWhen,
  readPrevFailSensor,
  readPrevOkSensor,
  structuralGotoIp,
  WHEN_PREV_FAIL,
  WHEN_PREV_OK,
  type OpName,
  type SensorName,
} from './genome'
import { isInWorld, isYInBounds, offsetX, wrapX } from './coords'
import { killAirCellAndPrune, type MineralDeposit } from './foliage'
import { SEED_OCC, isCellFree } from './occupancy'
import { emitPlantEvent } from './plantEvents'
import { Rng } from './rng'
import type { Direction, Genome, Plant, PlantCell, PlantInspectStats, SeedInSoil } from './types'

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
    x: wrapX(x),
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
    const n = getCellAt(plant, offsetX(cell.x, dx), cell.y + dy)
    if (n) result.push(n)
  }
  return result
}

/** Значение сенсора, нормализованное в 0..1 (экспорт для UI-трассировки) */
export function readSensorValue(
  sensor: SensorName,
  plant: Plant,
  cell: PlantCell,
  dir: Direction,
  occupancy: Int32Array[],
  light: Float32Array,
  minerals: Float32Array,
  rng: Rng,
  lastActionOk: boolean | null = cell.lastActionOk ?? null,
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
      const nx = offsetX(cell.x, dx)
      const ny = cell.y + dy
      if (!isYInBounds(ny)) return 1
      const occ = occupancy[ny][nx]
      if (occ === SEED_OCC || (occ > 0 && occ !== plant.id)) return 1
      return 0
    }
    case 'SHADE':
      return normalizedShadeLevel(occupancy, cell.x, cell.y)
    case 'SHADE_DIR': {
      const { dx, dy } = DIR_DELTA[dir]
      const nx = offsetX(cell.x, dx)
      const ny = cell.y + dy
      if (!isYInBounds(ny)) return 1
      return normalizedShadeLevel(occupancy, nx, ny)
    }
    case 'MINERAL_DIR': {
      const { dx, dy } = DIR_DELTA[dir]
      const nx = offsetX(cell.x, dx)
      const ny = cell.y + dy
      if (!isYInBounds(ny) || ny < WORLD.SOIL_Y) return 0
      return Math.min(1, getMineralAt(minerals, nx, ny) / 20)
    }
    case 'CROWD_ABOVE':
      return normalizedCrowdAbove(occupancy, plant.id, cell.x, cell.y)
    case 'PREV_OK':
      return readPrevOkSensor(lastActionOk)
    case 'PREV_FAIL':
      return readPrevFailSensor(lastActionOk)
  }
}

function potential(cell: PlantCell): number {
  let pot = cell.cellEnergy / CAP[cell.type]
  if (cell.type === 'SPROUT' && cell.waitingForGrow) {
    pot -= SPROUT_SINK_POTENTIAL
  }
  return pot
}

export function transportEnergy(plant: Plant): void {
  const cells = plant.cells
  const posMap = new Map<number, PlantCell>()
  for (const c of cells) {
    posMap.set(c.y * WORLD.W + c.x, c)
  }

  const flows: { from: PlantCell; to: PlantCell; amount: number }[] = []

  for (const a of cells) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const b = posMap.get((a.y + dy) * WORLD.W + offsetX(a.x, dx))
      if (!b) continue

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
  if (!isInWorld(x, y)) return false
  if (!isCellFree(occupancy, wrapX(x), y)) return false
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
  shootDeposits: MineralDeposit[]
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

/** Один шаг исполнения VM для UI «Исследование генома» */
export interface VmStepTrace {
  stepIndex: number
  ip: number
  opcode: OpName
  text: string
  dir: Direction
  stackBefore: number[]
  stackAfter: number[]
  note: string
  skippedNext?: boolean
  structuralAttempt?: boolean
  structuralSuccess?: boolean
  runEnded?: boolean
}

export interface MeristemRunTrace {
  cellId: number
  x: number
  y: number
  zone: 'soil' | 'air'
  initialDir: Direction
  initialSensors: { name: SensorName; value: number }[]
  steps: VmStepTrace[]
  actionsTaken: number
  matured: boolean
  attempted: boolean
  outcome: string
}

export interface GrowthVmTrace {
  growActionBudget: number
  rootBudget: number
  runs: MeristemRunTrace[]
}

function snapshotSensors(
  plant: Plant,
  cell: PlantCell,
  dir: Direction,
  occupancy: Int32Array[],
  light: Float32Array,
  minerals: Float32Array,
  rng: Rng,
): { name: SensorName; value: number }[] {
  const names: SensorName[] = [
    'ENERGY',
    'LIGHT',
    'WATER',
    'MINERALS',
    'DEPTH',
    'HEIGHT',
    'AGE',
    'RANDOM',
    'FOREIGN',
    'SHADE',
    'SHADE_DIR',
    'MINERAL_DIR',
    'CROWD_ABOVE',
    'PREV_OK',
    'PREV_FAIL',
  ]
  const lastActionOk = cell.lastActionOk ?? null
  return names.map((name) => ({
    name,
    value: readSensorValue(name, plant, cell, dir, occupancy, light, minerals, rng, lastActionOk),
  }))
}

function formatInstrText(op: OpName, args: number[]): string {
  const a0 = args[0] ?? 0
  const a1 = args[1] ?? 0
  if (op === 'PUSH') return `PUSH ${decodeLiteral(a0).toFixed(2)}`
  if (op === 'SENSE') return `SENSE ${decodeSensor(a0)}`
  if (op === 'DIR') return `DIR ${decodeDir(a0)}`
  if (op === 'SEED') return `SEED ${decodeLiteral(a0).toFixed(2)} ${formatWhenArg(a1)}`
  if (op === 'GROW') return `GROW ${formatWhenArg(a0)}`
  if (op === 'BRANCH' || op === 'SPIKE' || op === 'SHOOT') {
    return `${op} ${formatStructuralArg(a0)} ${formatWhenArg(a1)}`
  }
  return op
}

function readInstrArgs(code: Uint8Array, ip: number, n: number): number[] {
  return Array.from({ length: n }, (_, j) => readArg(code, ip, j))
}

function readArg(code: Uint8Array, ip: number, j: number): number {
  const idx = ip + 1 + j
  return idx < code.length ? code[idx]! : 0
}

/** BRANCH/SPIKE/SHOOT: WHERE + WHEN; WHERE %8===7 → GOTO после проверки WHEN. */
function resolveStructuralWhere(
  whereArg: number,
  ip: number,
  codeLength: number,
): { kind: 'goto'; ip: number } | { kind: 'dir'; direction: Direction } {
  if (isStructuralGoto(whereArg)) {
    return { kind: 'goto', ip: structuralGotoIp(ip, whereArg, codeLength) }
  }
  return { kind: 'dir', direction: decodeStructuralDir(whereArg) ?? 'UP' }
}

function recordVmStep(
  trace: VmStepTrace[] | undefined,
  stepIndex: number,
  ip: number,
  opcode: OpName,
  args: number[],
  dir: Direction,
  stackBefore: number[],
  stackAfter: number[],
  note: string,
  extra?: Partial<VmStepTrace>,
): number {
  if (!trace) return stepIndex
  trace.push({
    stepIndex,
    ip,
    opcode,
    text: formatInstrText(opcode, args),
    dir,
    stackBefore: [...stackBefore],
    stackAfter: [...stackAfter],
    note,
    ...extra,
  })
  return stepIndex + 1
}

interface VMContext {
  plant: Plant
  plants: Plant[]
  occupancy: Int32Array[]
  light: Float32Array
  minerals: Float32Array
  rng: Rng
  newSeeds: { x: number; y: number; energy: number }[]
  shootDeposits: MineralDeposit[]
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
  const nx = offsetX(cell.x, dx)
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
  const nx = offsetX(cell.x, dx)
  const ny = cell.y + dy
  const nx2 = offsetX(cell.x, dx * 2)
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

/** null — успех; иначе текст причины отказа (для трассировки VM). */
function dropSeed(
  cell: PlantCell,
  dir: Direction,
  ctx: VMContext,
  energyFraction: number,
): string | null {
  const { plant, occupancy, newSeeds } = ctx
  if (cell.y > WORLD.SOIL_Y - MIN_SEED_HEIGHT) return 'слишком низко для семени'

  const { dx, dy } = DIR_DELTA[dir]
  const nx = offsetX(cell.x, dx)
  const ny = cell.y + dy
  if (!canPlace(occupancy, plant.id, nx, ny, dir)) return 'нет места для семени'

  const frac = Math.max(0, Math.min(1, energyFraction))
  const maxReserve = genomeSeedReserve(plant.genome)
  let target = Math.max(
    SEED_MIN_PAYLOAD,
    Math.round(SEED_MIN_PAYLOAD + (maxReserve - SEED_MIN_PAYLOAD) * frac),
  )
  // Не требовать больше, чем растение может выделить (иначе SEED никогда не проходит)
  const affordable = Math.max(
    SEED_MIN_PAYLOAD,
    Math.floor(plantTotalEnergy(plant) * 0.25),
  )
  target = Math.min(target, affordable)
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
    if (need > 0) {
      const remote = plant.cells
        .filter((c) => c.id !== cell.id && !neighborsOf(plant, cell).includes(c))
        .sort((a, b) => b.cellEnergy - a.cellEnergy)
      for (const src of remote) {
        if (need <= 0) break
        const take = takeFrom(src, need, 0.25)
        seedEnergy += take
        need -= take
      }
    }
  }
  if (seedEnergy < SEED_MIN_PAYLOAD) return 'не хватает энергии на семя'

  let overhead = SEED_FORMATION_OVERHEAD
  const overheadSources = [
    cell,
    ...neighborsOf(plant, cell),
    ...plant.cells
      .filter((c) => c.id !== cell.id && !neighborsOf(plant, cell).includes(c))
      .sort((a, b) => b.cellEnergy - a.cellEnergy),
  ]
  for (const src of overheadSources) {
    if (overhead <= 0) break
    overhead -= takeFrom(src, overhead, 0.25)
  }
  if (overhead > 0) return 'не хватает энергии на образование семени'

  for (const src of plant.cells) {
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
  return null
}

function placeSpikeCell(
  cell: PlantCell,
  dir: Direction,
  ctx: VMContext,
): PlantCell | null {
  const { plant, occupancy } = ctx
  if (cell.y >= WORLD.SOIL_Y - 1) return null

  const { dx, dy } = DIR_DELTA[dir]
  const nx = offsetX(cell.x, dx)
  const ny = cell.y + dy
  if (!isYInBounds(ny) || ny >= WORLD.SOIL_Y) return null

  const existing = getCellAt(plant, nx, ny)
  if (existing?.type === 'SPIKE') {
    if (cell.cellEnergy < SPIKE_COST) return null
    cell.cellEnergy -= SPIKE_COST
    existing.cellEnergy = Math.min(CAP.SPIKE, existing.cellEnergy + SPIKE_COST * 0.35)
    return existing
  }
  if (!canPlace(occupancy, plant.id, nx, ny, dir)) return null

  if (cell.cellEnergy < SPIKE_COST) return null

  cell.cellEnergy -= SPIKE_COST
  const spike: PlantCell = {
    id: nextCellId++,
    x: nx,
    y: ny,
    type: 'SPIKE',
    dir,
    cellEnergy: SPIKE_COST * 0.4,
    age: 0,
    waitingForGrow: false,
  }
  plant.cells.push(spike)
  setOccupancy(occupancy, plant.id, spike)
  emitPlantEvent({
    plantId: plant.id,
    kind: 'SPIKE',
    x: nx,
    y: ny,
    fromX: cell.x,
    fromY: cell.y,
  })
  return spike
}

interface ShootHit {
  x: number
  y: number
  targetPlant: Plant
  targetCell: PlantCell
}

function raycastShootTarget(
  spikeX: number,
  spikeY: number,
  dir: Direction,
  shooterPlantId: number,
  range: number,
  plantById: Map<number, Plant>,
  occupancy: Int32Array[],
): ShootHit | null {
  const { dx, dy } = DIR_DELTA[dir]
  for (let step = 1; step <= range; step++) {
    const x = offsetX(spikeX, dx * step)
    const y = spikeY + dy * step
    if (!isYInBounds(y) || y >= WORLD.SOIL_Y) return null

    const occ = occupancy[y][x]
    if (occ === 0) continue
    if (occ === SEED_OCC) return null
    if (occ === shooterPlantId) continue

    const targetPlant = plantById.get(occ)
    if (!targetPlant) return null

    const targetCell = targetPlant.cells.find((c) => c.x === x && c.y === y)
    if (!targetCell) return null

    if (targetCell.type === 'SPROUT') {
      return { x, y, targetPlant, targetCell }
    }
    if (targetCell.type === 'STEM' && targetCell.cellEnergy <= SHOOT_STEM_KILL_MAX_ENERGY) {
      return { x, y, targetPlant, targetCell }
    }
    return null
  }
  return null
}

function shootSpike(cell: PlantCell, dir: Direction, ctx: VMContext): boolean {
  const { plant, occupancy, plants, shootDeposits } = ctx
  if (cell.cellEnergy < SHOOT_COST) return false
  if (cell.y >= WORLD.SOIL_Y - 1) return false

  const { dx, dy } = DIR_DELTA[dir]
  const sx = offsetX(cell.x, dx)
  const sy = cell.y + dy
  if (!isYInBounds(sy) || sy >= WORLD.SOIL_Y) return false

  const existingSpike = getCellAt(plant, sx, sy)
  const hasSpike = existingSpike?.type === 'SPIKE'
  const canCreateSpike = !existingSpike && canPlace(occupancy, plant.id, sx, sy, dir)
  if (!hasSpike && !canCreateSpike) return false

  const plantById = new Map<number, Plant>()
  for (const p of plants) {
    if (!p.dead) plantById.set(p.id, p)
  }

  const range = genomeShootRange(plant.genome)
  const hit = raycastShootTarget(sx, sy, dir, plant.id, range, plantById, occupancy)
  if (!hit) return false

  cell.cellEnergy -= SHOOT_COST
  let spike: PlantCell
  if (hasSpike && existingSpike) {
    spike = existingSpike
    spike.cellEnergy = Math.min(CAP.SPIKE, spike.cellEnergy + SHOOT_COST * 0.35)
  } else {
    spike = {
      id: nextCellId++,
      x: sx,
      y: sy,
      type: 'SPIKE',
      dir,
      cellEnergy: SHOOT_COST * 0.4,
      age: 0,
      waitingForGrow: false,
    }
    plant.cells.push(spike)
    setOccupancy(occupancy, plant.id, spike)
  }

  shootDeposits.push(...killAirCellAndPrune(hit.targetPlant, hit.targetCell, occupancy))

  emitPlantEvent({
    plantId: plant.id,
    kind: 'SHOOT',
    x: hit.x,
    y: hit.y,
    fromX: spike.x,
    fromY: spike.y,
  })
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
function runCellProgram(
  cell: PlantCell,
  ctx: VMContext,
  maxActions: number,
  trace?: VmStepTrace[],
): CellRun {
  const code = ctx.plant.genome.code
  if (code.length === 0 || maxActions <= 0) {
    return { actions: 0, matured: false, attempted: false }
  }

  const stack: number[] = []
  let dir: Direction = cell.dir
  let ip = 0
  let steps = 0
  let traceStep = 0
  let attempted = false
  let actions = 0
  /** Исход последнего структурного действия (включая прошлый прогон до первой попытки в этом) */
  let lastActionOk: boolean | null = cell.lastActionOk ?? null

  const tracing = trace !== undefined

  const markStructural = (ok: boolean) => {
    lastActionOk = ok
    cell.lastActionOk = ok
  }

  const traceArgs = (argCount: number, a0: number, a1: number): number[] =>
    argCount <= 1 ? [a0] : [a0, a1]

  const logStep = (
    opcode: OpName,
    argCount: number,
    a0: number,
    a1: number,
    stackBefore: number[],
    stackAfter: number[],
    note: () => string,
    extra?: Partial<VmStepTrace>,
  ) => {
    if (!tracing) return
    traceStep = recordVmStep(
      trace,
      traceStep,
      ip,
      opcode,
      traceArgs(argCount, a0, a1),
      dir,
      stackBefore,
      stackAfter,
      note(),
      extra,
    )
  }

  const formatWhenNote = (whenArg: number): string => {
    const stackVal = stack.length > 0 ? stack[stack.length - 1]! : 0
    if (whenArg === WHEN_PREV_OK) return 'WHEN prev ok — не было успешного действия'
    if (whenArg === WHEN_PREV_FAIL) return 'WHEN prev fail — предыдущее не провалилось'
    return `WHEN не выполнено (${stackVal.toFixed(2)} < ${decodeLiteral(whenArg).toFixed(2)})`
  }

  while (steps < VM_STEP_BUDGET && ip < code.length) {
    steps++
    const op = decodeOp(code[ip])
    const a0 = readArg(code, ip, 0)
    const a1 = readArg(code, ip, 1)
    const stackBefore = tracing ? [...stack] : []

    switch (op) {
      case 'NOP':
        logStep(op, 0, 0, 0, stackBefore, stack, () => 'Пустая операция')
        ip++
        break
      case 'PUSH': {
        const val = decodeLiteral(a0)
        stack.push(val)
        logStep(op, 1, a0, 0, stackBefore, stack, () => `На стек: ${val.toFixed(2)}`)
        ip += 2
        break
      }
      case 'SENSE': {
        const sensor = decodeSensor(a0)
        const val = readSensorValue(
          sensor,
          ctx.plant,
          cell,
          dir,
          ctx.occupancy,
          ctx.light,
          ctx.minerals,
          ctx.rng,
          lastActionOk,
        )
        stack.push(val)
        logStep(op, 1, a0, 0, stackBefore, stack, () => `SENSE ${sensor} → ${val.toFixed(3)}`)
        ip += 2
        break
      }
      case 'DIR': {
        dir = decodeDir(a0)
        logStep(op, 1, a0, 0, stackBefore, stack, () => `Направление: ${dir}`)
        ip += 2
        break
      }
      case 'LT': {
        const a = stack.pop() ?? 0
        const b = stack.pop() ?? 0
        const result = b < a ? 1 : 0
        stack.push(result)
        logStep(op, 0, 0, 0, stackBefore, stack, () => `${b.toFixed(2)} < ${a.toFixed(2)} → ${result}`)
        ip++
        break
      }
      case 'GT': {
        const a = stack.pop() ?? 0
        const b = stack.pop() ?? 0
        const result = b > a ? 1 : 0
        stack.push(result)
        logStep(op, 0, 0, 0, stackBefore, stack, () => `${b.toFixed(2)} > ${a.toFixed(2)} → ${result}`)
        ip++
        break
      }
      case 'AND': {
        const a = stack.pop() ?? 0
        const b = stack.pop() ?? 0
        const result = a >= 0.5 && b >= 0.5 ? 1 : 0
        stack.push(result)
        logStep(op, 0, 0, 0, stackBefore, stack, () => `AND(${a.toFixed(2)}, ${b.toFixed(2)}) → ${result}`)
        ip++
        break
      }
      case 'OR': {
        const a = stack.pop() ?? 0
        const b = stack.pop() ?? 0
        const result = a >= 0.5 || b >= 0.5 ? 1 : 0
        stack.push(result)
        logStep(op, 0, 0, 0, stackBefore, stack, () => `OR(${a.toFixed(2)}, ${b.toFixed(2)}) → ${result}`)
        ip++
        break
      }
      case 'IF': {
        const v = stack.pop() ?? 0
        if (v < 0.5 && ip + 1 < code.length) {
          const skipOp = decodeOp(code[ip + 1]!)
          const skipArgN = opArgCount(skipOp)
          if (tracing) {
            const skipArgs = readInstrArgs(code, ip + 1, skipArgN)
            const skipText = formatInstrText(skipOp, skipArgs)
            logStep(
              op,
              0,
              0,
              0,
              stackBefore,
              stack,
              () => `Условие ${v.toFixed(2)} < 0.5 — пропуск: ${skipText}`,
              { skippedNext: true },
            )
          }
          ip += 2 + skipArgN
        } else {
          logStep(
            op,
            0,
            0,
            0,
            stackBefore,
            stack,
            () => `Условие ${v.toFixed(2)} ≥ 0.5 — выполняем следующую инструкцию`,
          )
          ip++
        }
        break
      }
      case 'GROW': {
        const whenArg = a0
        if (!passesWhen(stack, whenArg, lastActionOk)) {
          logStep(op, 1, a0, 0, stackBefore, stack, () => formatWhenNote(whenArg))
          ip += 2
          break
        }
        attempted = true
        if (tryGrowMeristem(cell, dir, ctx, 'GROW')) {
          markStructural(true)
          matureParentAfterOffspring(cell, ctx.plant.id)
          logStep(op, 1, a0, 0, stackBefore, stack, () => 'GROW успешен — родитель созрел', {
            structuralAttempt: true,
            structuralSuccess: true,
            runEnded: true,
          })
          return { actions: actions + 1, matured: true, attempted }
        }
        markStructural(false)
        logStep(op, 1, a0, 0, stackBefore, stack, () => 'GROW не прошёл (нет места, воды или энергии)', {
          structuralAttempt: true,
          structuralSuccess: false,
        })
        ip += 2
        break
      }
      case 'BRANCH': {
        const whereArg = a0
        const whenArg = a1
        if (!passesWhen(stack, whenArg, lastActionOk)) {
          logStep(op, 2, a0, a1, stackBefore, stack, () => formatWhenNote(whenArg))
          ip += 3
          break
        }
        const resolved = resolveStructuralWhere(whereArg, ip, code.length)
        if (resolved.kind === 'goto') {
          logStep(op, 2, a0, a1, stackBefore, stack, () => `GOTO ip → ${resolved.ip}`)
          ip = resolved.ip
          break
        }
        const actionDir = resolved.direction
        attempted = true
        if (tryGrowMeristem(cell, actionDir, ctx, 'BRANCH')) {
          markStructural(true)
          cell.dir = actionDir
          cell.waitingForGrow = false
          actions++
          logStep(op, 2, a0, a1, stackBefore, stack, () => `BRANCH ${actionDir} успешен (${actions}/${maxActions})`, {
            structuralAttempt: true,
            structuralSuccess: true,
            runEnded: actions >= maxActions,
          })
          if (actions >= maxActions) {
            return { actions, matured: false, attempted }
          }
          ip += 3
          break
        }
        markStructural(false)
        logStep(op, 2, a0, a1, stackBefore, stack, () => `BRANCH ${actionDir} не прошёл`, {
          structuralAttempt: true,
          structuralSuccess: false,
        })
        ip += 3
        break
      }
      case 'SEED': {
        const seedFrac = decodeLiteral(a0)
        const whenArg = a1
        if (!passesWhen(stack, whenArg, lastActionOk)) {
          logStep(op, 2, a0, a1, stackBefore, stack, () => formatWhenNote(whenArg))
          ip += 3
          break
        }
        attempted = true
        const seedErr = dropSeed(cell, dir, ctx, seedFrac)
        if (seedErr === null) {
          markStructural(true)
          cell.waitingForGrow = false
          logStep(
            op,
            2,
            a0,
            a1,
            stackBefore,
            stack,
            () => `SEED успешен (доля ${seedFrac.toFixed(2)})`,
            { structuralAttempt: true, structuralSuccess: true, runEnded: true },
          )
          return { actions: actions + 1, matured: false, attempted }
        }
        markStructural(false)
        logStep(op, 2, a0, a1, stackBefore, stack, () => `SEED не прошёл: ${seedErr}`, {
          structuralAttempt: true,
          structuralSuccess: false,
        })
        ip += 3
        break
      }
      case 'SPIKE': {
        const whereArg = a0
        const whenArg = a1
        if (!passesWhen(stack, whenArg, lastActionOk)) {
          logStep(op, 2, a0, a1, stackBefore, stack, () => formatWhenNote(whenArg))
          ip += 3
          break
        }
        const resolved = resolveStructuralWhere(whereArg, ip, code.length)
        if (resolved.kind === 'goto') {
          logStep(op, 2, a0, a1, stackBefore, stack, () => `GOTO ip → ${resolved.ip}`)
          ip = resolved.ip
          break
        }
        const actionDir = resolved.direction
        attempted = true
        if (placeSpikeCell(cell, actionDir, ctx)) {
          markStructural(true)
          cell.dir = actionDir
          cell.waitingForGrow = false
          actions++
          logStep(op, 2, a0, a1, stackBefore, stack, () => `SPIKE ${actionDir} успешен (${actions}/${maxActions})`, {
            structuralAttempt: true,
            structuralSuccess: true,
            runEnded: actions >= maxActions,
          })
          if (actions >= maxActions) {
            return { actions, matured: false, attempted }
          }
          ip += 3
          break
        }
        markStructural(false)
        logStep(op, 2, a0, a1, stackBefore, stack, () => `SPIKE ${actionDir} не прошёл`, {
          structuralAttempt: true,
          structuralSuccess: false,
        })
        ip += 3
        break
      }
      case 'SHOOT': {
        const whereArg = a0
        const whenArg = a1
        if (!passesWhen(stack, whenArg, lastActionOk)) {
          logStep(op, 2, a0, a1, stackBefore, stack, () => formatWhenNote(whenArg))
          ip += 3
          break
        }
        const resolved = resolveStructuralWhere(whereArg, ip, code.length)
        if (resolved.kind === 'goto') {
          logStep(op, 2, a0, a1, stackBefore, stack, () => `GOTO ip → ${resolved.ip}`)
          ip = resolved.ip
          break
        }
        const actionDir = resolved.direction
        attempted = true
        if (shootSpike(cell, actionDir, ctx)) {
          markStructural(true)
          cell.waitingForGrow = false
          logStep(op, 2, a0, a1, stackBefore, stack, () => `SHOOT ${actionDir} успешен — попадание по цели`, {
            structuralAttempt: true,
            structuralSuccess: true,
            runEnded: true,
          })
          return { actions: actions + 1, matured: false, attempted }
        }
        markStructural(false)
        logStep(op, 2, a0, a1, stackBefore, stack, () => `SHOOT ${actionDir} не прошёл`, {
          structuralAttempt: true,
          structuralSuccess: false,
        })
        ip += 3
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

function describeMeristemOutcome(
  run: CellRun,
  cellY: number,
  actionsTaken: number,
): string {
  if (run.matured) return 'GROW — мерistema созрела в ткань'
  if (actionsTaken > 0) return `Выполнено структурных действий: ${actionsTaken}`
  if (run.attempted) return 'Структурное действие не прошло — ждёт (waitingForGrow)'
  if (cellY < WORLD.SOIL_Y) return 'Ни одно правило не сработало — воздушная мерistema ждёт'
  return 'Ни одно правило не сработало — созревает в ROOT/STEM'
}

function traceProcessSproutGroup(
  cells: PlantCell[],
  ctx: VMContext,
  budget: number,
  actionsRef: { used: number },
  runs: MeristemRunTrace[],
  occupancy: Int32Array[],
  light: Float32Array,
  minerals: Float32Array,
  rng: Rng,
): void {
  for (const cell of cells) {
    if (actionsRef.used >= budget) {
      runs.push({
        cellId: cell.id,
        x: cell.x,
        y: cell.y,
        zone: cell.y >= WORLD.SOIL_Y ? 'soil' : 'air',
        initialDir: cell.dir,
        initialSensors: snapshotSensors(
          ctx.plant,
          cell,
          cell.dir,
          occupancy,
          light,
          minerals,
          rng,
        ),
        steps: [
          {
            stepIndex: 0,
            ip: -1,
            opcode: 'NOP',
            text: '—',
            dir: cell.dir,
            stackBefore: [],
            stackAfter: [],
            note: `Бюджет исчерпан (${actionsRef.used}/${budget}) — клетка ждёт`,
          },
        ],
        actionsTaken: 0,
        matured: false,
        attempted: false,
        outcome: 'Бюджет роста исчерпан — waitingForGrow',
      })
      continue
    }
    if (cell.type !== 'SPROUT') continue

    const steps: VmStepTrace[] = []
    const run = runCellProgram(cell, ctx, budget - actionsRef.used, steps)
    actionsRef.used += run.actions

    let outcome = describeMeristemOutcome(run, cell.y, run.actions)
    if (run.actions === 0 && !run.attempted) {
      if (cell.y < WORLD.SOIL_Y) {
        outcome = 'Ни одно правило не сработало — воздушная мерistema ждёт'
      } else {
        outcome = 'Ни одно правило не сработало — созревает в ROOT/STEM'
      }
    }

    runs.push({
      cellId: cell.id,
      x: cell.x,
      y: cell.y,
      zone: cell.y >= WORLD.SOIL_Y ? 'soil' : 'air',
      initialDir: cell.dir,
      initialSensors: snapshotSensors(
        ctx.plant,
        cell,
        cell.dir,
        occupancy,
        light,
        minerals,
        rng,
      ),
      steps,
      actionsTaken: run.actions,
      matured: run.matured,
      attempted: run.attempted,
      outcome,
    })
  }
}

/** Прогон VM с полной трассировкой на клоне растения (не меняет исходное растение) */
export function traceGrowthVM(
  plant: Plant,
  plants: Plant[],
  occupancy: Int32Array[],
  light: Float32Array,
  minerals: Float32Array,
  rng: Rng,
): GrowthVmTrace {
  const traceRng = new Rng(0)
  traceRng.setState(rng.getState())

  const clone: Plant = {
    ...plant,
    genome: { code: Uint8Array.from(plant.genome.code) },
    cells: plant.cells.map((c) => ({ ...c })),
    edgeFlux: [],
    accounting: { ...plant.accounting },
  }

  const occ = occupancy.map((row) => new Int32Array(row))
  const newSeeds: { x: number; y: number; energy: number }[] = []
  const shootDeposits: MineralDeposit[] = []
  const plantsForTrace = plants.map((p) => (p.id === plant.id ? clone : p))
  const ctx: VMContext = {
    plant: clone,
    plants: plantsForTrace,
    occupancy: occ,
    light,
    minerals,
    rng: traceRng,
    newSeeds,
    shootDeposits,
  }

  const sprouts = clone.cells.filter((c) => c.type === 'SPROUT')
  const soilSprouts = sprouts
    .filter((c) => c.y >= WORLD.SOIL_Y)
    .sort((a, b) => a.y - b.y || a.id - b.id)
  const airSprouts = sprouts
    .filter((c) => c.y < WORLD.SOIL_Y)
    .sort((a, b) => a.y - b.y || a.id - b.id)

  const growActionBudget = plantGrowActionBudget(clone)
  const rootBudget =
    soilSprouts.length > 0
      ? Math.max(1, Math.min(growActionBudget, Math.floor(growActionBudget * ROOT_GROW_BUDGET_FRAC)))
      : 0

  const runs: MeristemRunTrace[] = []
  const actionsRef = { used: 0 }

  traceProcessSproutGroup(
    soilSprouts,
    ctx,
    rootBudget,
    actionsRef,
    runs,
    occ,
    light,
    minerals,
    traceRng,
  )
  traceProcessSproutGroup(
    airSprouts,
    ctx,
    growActionBudget,
    actionsRef,
    runs,
    occ,
    light,
    minerals,
    traceRng,
  )

  return { growActionBudget, rootBudget, runs }
}

export function executeGrowthVM(
  plant: Plant,
  plants: Plant[],
  occupancy: Int32Array[],
  light: Float32Array,
  minerals: Float32Array,
  rng: Rng,
): GrowthResult {
  const newSeeds: { x: number; y: number; energy: number }[] = []
  const shootDeposits: MineralDeposit[] = []
  if (plant.dead) return { newSeeds, shootDeposits }
  // Размер не ограничен жёстко: рост и выживание лимитируются энергией (доход vs upkeep).

  const ctx: VMContext = {
    plant,
    plants,
    occupancy,
    light,
    minerals,
    rng,
    newSeeds,
    shootDeposits,
  }

  const sprouts = plant.cells.filter((c) => c.type === 'SPROUT')
  const soilSprouts = sprouts
    .filter((c) => c.y >= WORLD.SOIL_Y)
    .sort((a, b) => a.y - b.y || a.id - b.id)
  const airSprouts = sprouts
    .filter((c) => c.y < WORLD.SOIL_Y)
    .sort((a, b) => a.y - b.y || a.id - b.id)

  const budget = plantGrowActionBudget(plant)

  const rootBudget =
    soilSprouts.length > 0
      ? Math.max(1, Math.min(budget, Math.floor(budget * ROOT_GROW_BUDGET_FRAC)))
      : 0

  const actionsRef = { used: 0 }
  // Почвенные мерistemы: сначала поверхность (побег вверх), затем глубокие корни
  processSproutGroup(soilSprouts, ctx, rootBudget, actionsRef)
  processSproutGroup(airSprouts, ctx, budget, actionsRef)

  return { newSeeds, shootDeposits }
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
