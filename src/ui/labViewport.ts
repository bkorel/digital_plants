import type { WorldBounds } from '../sim/config'
import type { PlantCell } from '../sim/types'

export interface LabViewport {
  x: number
  y: number
  w: number
  h: number
  /** 1 = весь мир, >1 = приближение */
  zoom: number
}

const MIN_VIEW_W = 12
const MIN_VIEW_H = 20
const PAD = 3
/** Доля мира, занятая растением, после которой показываем весь мир */
const FULL_WORLD_FILL = 0.72

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Камера лаборатории: крупный план на ростке, отъезд по мере роста. */
export function computeLabViewport(bounds: WorldBounds, cells: PlantCell[]): LabViewport {
  const full: LabViewport = { x: 0, y: 0, w: bounds.W, h: bounds.H, zoom: 1 }

  if (cells.length === 0) return full

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of cells) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x)
    maxY = Math.max(maxY, c.y)
  }

  const plantW = maxX - minX + 1
  const plantH = maxY - minY + 1
  const skyH = Math.max(1, bounds.SOIL_Y)
  const fillW = plantW / bounds.W
  const fillH = plantH / skyH

  if (Math.max(fillW, fillH) >= FULL_WORLD_FILL) return full

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  let vw = Math.max(plantW + PAD * 2, MIN_VIEW_W)
  let vh = Math.max(plantH + PAD * 2, MIN_VIEW_H)

  // Всегда держим в кадре линию почвы вокруг корня
  vh = Math.max(vh, Math.max(maxY, bounds.SOIL_Y) - minY + PAD + 4)

  vw = Math.min(vw, bounds.W)
  vh = Math.min(vh, bounds.H)

  let x = Math.round(cx - vw / 2)
  let y = Math.round(cy - vh / 2)
  x = clamp(x, 0, bounds.W - vw)
  y = clamp(y, 0, bounds.H - vh)

  return {
    x,
    y,
    w: vw,
    h: vh,
    zoom: bounds.W / vw,
  }
}
