/** События жизненного цикла растения за один тик (для режима трассировки). */
export type PlantEventKind =
  | 'GROW'
  | 'BRANCH'
  | 'ROOT'
  | 'STEM'
  | 'SEED'
  | 'SEED_DROP'
  | 'SPIKE'
  | 'SHOOT'
  | 'GERMINATE'
  | 'DEATH'

export interface PlantTickEvent {
  plantId: number
  kind: PlantEventKind
  x: number
  y: number
  fromX?: number
  fromY?: number
}

/** Линия выстрела шипа для отрисовки (живёт несколько тиков). */
export interface ShootVisual {
  plantId: number
  fromX: number
  fromY: number
  x: number
  y: number
  expireTick: number
}

export const EVENT_LABELS: Record<PlantEventKind, string> = {
  GROW: 'рост',
  BRANCH: 'ветка',
  ROOT: 'корень',
  STEM: 'ствол',
  SEED: 'семечко',
  SEED_DROP: 'сброс',
  SPIKE: 'шип',
  SHOOT: 'выстрел',
  GERMINATE: 'пророст',
  DEATH: 'гибель',
}

export const EVENT_COLORS: Record<PlantEventKind, string> = {
  GROW: '#7fff7f',
  BRANCH: '#4dd0e1',
  ROOT: '#ffd54f',
  STEM: '#a1887f',
  SEED: '#ffffff',
  SEED_DROP: '#b0bec5',
  SPIKE: '#e040fb',
  SHOOT: '#ff3333',
  GERMINATE: '#80cbc4',
  DEATH: '#ff5252',
}

let sink: ((e: PlantTickEvent) => void) | null = null

export function setPlantEventSink(fn: ((e: PlantTickEvent) => void) | null): void {
  sink = fn
}

export function emitPlantEvent(event: PlantTickEvent): void {
  sink?.(event)
}
