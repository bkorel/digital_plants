import { CellType } from './types'

export const WORLD = {
  W: 300,
  H: 200,
  SOIL_Y: 124,
} as const

/** Градиент освещённости в воздухе — как при прежней высоте неба (62 клетки) */
export const SKY_LIGHT_RAMP = 62

export const SHADE_PER_LAYER = 0.28
/** Если над точкой больше этого числа слоёв клеток — фотосинтез полностью пропадает */
export const MAX_SHADE_LAYERS = 4
/** Ниже последней клетки-затенителя в колонке: каждые N клеток эффективная тень делится пополам */
export const SHADE_SCATTER_INTERVAL = 20
/** Если над мерistemой (SPROUT в воздухе) больше N слоёв — отмирание по геному */
export const SHADED_SPROUT_LAYERS = 5
/** Радиус по X для сенсора CROWD_ABOVE (клетки чужих растений на 1 выше) */
export const CROWD_ABOVE_X_RADIUS = 5
export const BASE_LIGHT = 1.0
export const WATER_PER_DEPTH = 0.25
export const AIR_WATER = 0.05
export const MIN_WATER_FOR_GROW = 0.1
export const SURFACE_SOIL_WATER_FRAC = 0.75
export const DEATH_ENERGY_RETURN = 0.3

export const MAINTAIN: Record<CellType, number> = {
  ROOT: 0.035,
  STEM: 0.04,
  SPROUT: 0.06,
  SEED: 0.03,
  SPIKE: 0.025,
}

export const CAP: Record<CellType, number> = {
  ROOT: 12,
  STEM: 10,
  SPROUT: 12,
  SEED: 10,
  SPIKE: 6,
}

export const TRANSPORT_RATE = 0.35
export const GROW_COST = 2.0
/** Множитель стоимости при двойном росте (GROW на 2 клетки за одно действие) */
export const DOUBLE_GROW_COST_MULT = 3
export const MINERAL_SUPPLY_NORM = 1.6
/** Минимальный «подушечный» запас энергии растения перед активным ростом */
export const GROW_MIN_ENERGY_RESERVE = 5
/** Сколько тиков содержания резервируется поверх GROW_MIN_ENERGY_RESERVE */
export const GROW_ENERGY_RESERVE_TICKS = 2.5
export const PHOTO_GAIN_FACTOR = 1.5
/** Доля фотосинтеза у ствола (STEM) относительно мерistemы/листа (SPROUT) */
export const STEM_PHOTO_GAIN_FACTOR = 0.2
export const MINERAL_ENERGY_FACTOR = 0.4
/** Доля жизни, после которой растёт расход на старость (долгожители платят ближе к концу) */
export const SENESCENCE_START = 0.72
/** Насколько сильно upkeep растёт к maxAge (1 → без эффекта, 2.5 → +180% в конце) */
export const SENESCENCE_UPKEEP_GAIN = 2.5

export const MINERAL_BASE = 8
export const MINERAL_DEPTH_GAIN = 0.55
export const MINERAL_CAP = 40
export const MINERAL_SINK_RATE = 0.02
export const MINERAL_DIFFUSE_RATE = 0.05
/** Скорость восстановления минералов в почве (выветривание/осадки) к базовому уровню */
export const MINERAL_REGEN_RATE = 0.01
export const UPTAKE_MAX = 1.2

export const MUTATION_RATE = 1.0
export const REPEAT_CAP = 8
export const MIN_AGE = 30
export const DEFAULT_MAX_AGE = 220
export const INITIAL_PLANTS = 30
/** Минимальная дистанция по X между стартовыми/проросшими растениями */
export const MIN_PLANT_SPACING = 5
export const SEED_GERMINATION_TICKS = 5
export const MIN_SEED_ENERGY = 5
/** Вероятность прорастания готового семени за тик (при свободной ячейке) */
export const GERMINATION_CHANCE = 0.85
/** Расход энергии семени в почве после окна ожидания (за тик) */
export const SEED_SOIL_UPKEEP = 0.008
/** Минимальная энергия в только что созданном семени (можно «выстрелить» с меньшим запасом) */
export const SEED_MIN_PAYLOAD = 1
/** Доп. метаболические затраты на образование семени (сжигаются, не попадают в семя) */
export const SEED_FORMATION_OVERHEAD = 2
export const MAX_GERMINATIONS_PER_TICK = 4
/** 0 — только занятость ячейки; >0 блокирует соседние колонки (конфликтует с малым SEED_SCATTER) */
export const GERMINATION_NEIGHBOR_BLOCK = 0
export const SPROUT_SINK_POTENTIAL = 0.15
export const SEED_FALL_DURATION_MS = 420
export const SEED_FALL_DURATION_TICKS = 4
/** Семя образуется только на побеге не ниже этой высоты над почвой (закон движка) */
export const MIN_SEED_HEIGHT = 2
/** Боковой разброс семян при падении: не дальше N клеток от места создания */
export const SEED_SCATTER = 3
/** Энергия на выставление шипа в соседнюю клетку */
export const SPIKE_COST = 1.5
/** Энергия на «выстрел» шипа на расстояние 2 клетки */
export const SHOOT_COST = 2.5
/** Радиус от шипа, в котором гибнут чужие листья (манхэттен) */
/** @deprecated больше не используется — расчистка только колонки посадки */
export const PLANT_CLEAR_RADIUS = 2
/** Радиус от шипа, в котором гибнут чужие листья (манхэттен) */
export const SPIKE_LEAF_KILL_RADIUS = 2
/** Потеря энергии чужого стебля за тик в радиусе шипа */
export const SPIKE_STEM_DRAIN = 0.35

export const MUTATION = {
  P_POINT: 0.005,
  P_INS: 0.025,
  P_DEL: 0.025,
  P_DUP: 0.02,
  P_INV: 0.015,
} as const

export const GENOME = {
  MIN_BYTES: 6,
  MAX_BYTES: 160,
  RANDOM_GENE_COUNT_MIN: 5,
  RANDOM_GENE_COUNT_MAX: 8,
} as const

export const VM_STEP_BUDGET = 128
/** Базовый бюджет ростовых действий за тик */
export const MAX_GROW_ACTIONS_PER_PLANT_PER_TICK = 2
/** Доп. ростовое действие за каждые N ед. энергии сверх резерва (богатое растение ветвится активнее) */
export const ENERGY_PER_EXTRA_GROW_ACTION = 14
/** Жёсткий потолок ростовых действий за тик */
export const MAX_GROW_ACTIONS_CAP = 6
/** Доля бюджета роста, резервируемая под меристемы в почве (корни) */
export const ROOT_GROW_BUDGET_FRAC = 0.35
