export type CellType = 'ROOT' | 'STEM' | 'SPROUT' | 'SEED' | 'SPIKE'

export type Direction =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'UP_LEFT'
  | 'UP_RIGHT'
  | 'DOWN_LEFT'
  | 'DOWN_RIGHT'

/**
 * Геном — плоская линейная последовательность байт (кодонов). Любая
 * последовательность валидна: при исполнении каждый байт декодируется в
 * инструкцию через остаток от деления (`байт % КОЛИЧЕСТВО_ОПКОДОВ`).
 * Это делает мутации (замена/вставка/удаление/дупликация) всегда корректными.
 */
export interface Genome {
  code: Uint8Array
}

export interface Vec2 {
  x: number
  y: number
}

export interface PlantCell {
  id: number
  x: number
  y: number
  type: CellType
  dir: Direction
  cellEnergy: number
  age: number
  waitingForGrow: boolean
}

export interface EdgeFlux {
  fromId: number
  toId: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  flow: number
}

export interface Plant {
  id: number
  genome: Genome
  cells: PlantCell[]
  age: number
  lineageHue: number
  edgeFlux: EdgeFlux[]
  dead: boolean
  /** Накопленная статистика за жизнь растения */
  accounting: PlantAccounting
}

/** Счётчики энергии и размножения за всю жизнь растения */
export interface PlantAccounting {
  seedsCreated: number
  photoEnergyGained: number
  mineralEnergyGained: number
  upkeepSpent: number
}

/** Снимок метрик растения для панели инспекции */
export interface PlantInspectStats {
  height: number
  rootDepth: number
  stems: number
  sprouts: number
  roots: number
  age: number
  waterLevel: number
  upkeepSpent: number
  seedsCreated: number
  photoEnergyGained: number
  mineralEnergyGained: number
  totalEnergy: number
}

export interface SeedInSoil {
  x: number
  y: number
  fromY?: number
  genome: Genome
  energy: number
  ticksInSoil: number
  lineageHue: number
  /** Родительское растение, сбросившее семя */
  parentPlantId?: number
}

export interface WorldStats {
  tick: number
  plantEnergy: number
  soilEnergy: number
  alivePlants: number
  seedsInSoil: number
  avgAge: number
  avgHeight: number
  speciesEstimate: number
}

export type ViewMode = 'PLANTS' | 'ENERGY' | 'FLOWS' | 'ANATOMY' | 'TRACE'

/** Режим приложения: эволюция популяции или изолированный опыт */
export type AppMode = 'EVOLUTION' | 'LABORATORY'

export interface FallingSeed {
  x: number
  fromY: number
  toY: number
  startTick: number
  startTime: number
  genome: Genome
  energy: number
  lineageHue: number
  parentPlantId?: number
}

export interface SavedGenome {
  id: string
  name: string
  genome: Genome
  savedAt: number
}

/** Снимок мира эволюции для восстановления после лаборатории */
export interface EvolutionSnapshot {
  tickCount: number
  plants: Plant[]
  seeds: SeedInSoil[]
  fallingSeeds: FallingSeed[]
  minerals: Float32Array
  occupancy: Int32Array[]
  rngState: number
  nextPlantId: number
  nextCellId: number
  selectedPlantId: number | null
}
