import { WORLD, type WorldBounds } from './config'

/** Активные размеры мира для слоя sim (меняется в мини-лаборатории конструктора). */
export let simWorld: WorldBounds = { ...WORLD }

export function setSimWorld(bounds: WorldBounds): void {
  simWorld = bounds
}

export function resetSimWorld(): void {
  simWorld = { ...WORLD }
}

/** Выполнить отрисовку/снимок с размерами конкретного мира. */
export function withSimWorld<T>(bounds: WorldBounds, fn: () => T): T {
  const prev = { ...simWorld }
  setSimWorld(bounds)
  try {
    return fn()
  } finally {
    setSimWorld(prev)
  }
}
