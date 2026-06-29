import { simWorld } from './worldBounds'

/** Нормализовать X на торе [0, W). */
export function wrapX(x: number): number {
  return ((Math.floor(x) % simWorld.W) + simWorld.W) % simWorld.W
}

export function isYInBounds(y: number): boolean {
  return y >= 0 && y < simWorld.H
}

/** Клетка доступна по Y; X всегда можно нормализовать на тор. */
export function isInWorld(_x: number, y: number): boolean {
  return isYInBounds(y)
}

/** Кратчайшее расстояние по X на замкнутом мире. */
export function xDistance(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, simWorld.W - d)
}

export function offsetX(x: number, dx: number): number {
  return wrapX(x + dx)
}
