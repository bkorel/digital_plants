import { CAP, MINERAL_CAP, WORLD } from '../sim/config'
import { genomeColor } from '../sim/genome'
import { getMineralAt } from '../sim/environment'
import type { CellType, Plant, ViewMode } from '../sim/types'
import type { World } from '../sim/world'

export const GRID_PIXELS = WORLD.W * WORLD.H

/** ABGR для Uint32Array (little-endian → ImageData RGBA) */
export function packPixel(r: number, g: number, b: number, a = 255): number {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)
}

export function hslPixel(h: number, s: number, l: number, a = 255): number {
  const sat = s / 100
  const lit = l / 100
  const c = (1 - Math.abs(2 * lit - 1)) * sat
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (hp < 1) {
    r1 = c
    g1 = x
  } else if (hp < 2) {
    r1 = x
    g1 = c
  } else if (hp < 3) {
    g1 = c
    b1 = x
  } else if (hp < 4) {
    g1 = x
    b1 = c
  } else if (hp < 5) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }
  const m = lit - c / 2
  return packPixel(
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
    a,
  )
}

function mineralPixel(m: number): number {
  const t = m <= 0 ? 0 : Math.min(1, Math.sqrt(m / MINERAL_CAP))
  const hue = 28 + t * 22
  const sat = 55 + t * 25
  const light = 14 + t * 52
  return hslPixel(hue, sat, light)
}

function anatomyPixel(type: CellType, dimmed: boolean, selected: boolean): number {
  switch (type) {
    case 'ROOT':
      return hslPixel(48, dimmed ? 35 : 78, dimmed ? 22 : selected ? 58 : 50)
    case 'STEM':
      return hslPixel(28, dimmed ? 25 : 48, dimmed ? 14 : selected ? 38 : 30)
    case 'SPROUT':
      return hslPixel(118, dimmed ? 30 : 58, dimmed ? 18 : selected ? 48 : 40)
    case 'SEED':
      return hslPixel(0, 0, dimmed ? 55 : selected ? 98 : 90)
    case 'SPIKE':
      return hslPixel(290, dimmed ? 35 : 72, dimmed ? 28 : selected ? 58 : 48)
  }
}

function anatomyTissueType(cell: { type: CellType; y: number }): CellType {
  if (cell.type === 'SPROUT' && cell.y >= WORLD.SOIL_Y) return 'ROOT'
  return cell.type
}

export function fillSoilPixels(
  pixels: Uint32Array,
  world: World,
  viewMode: ViewMode,
): void {
  for (let y = WORLD.SOIL_Y; y < WORLD.H; y++) {
    for (let x = 0; x < WORLD.W; x++) {
      const idx = y * WORLD.W + x
      if (viewMode === 'ENERGY') {
        pixels[idx] = mineralPixel(getMineralAt(world.minerals, x, y))
      } else {
        const depth = (y - WORLD.SOIL_Y) / (WORLD.H - WORLD.SOIL_Y)
        pixels[idx] = hslPixel(30, 25, 12 + depth * 18)
      }
    }
  }
}

export function fillSkyPixels(pixels: Uint32Array, world: World): void {
  for (let y = 0; y < WORLD.SOIL_Y; y++) {
    for (let x = 0; x < WORLD.W; x++) {
      const light = world.light[y * WORLD.W + x]
      pixels[idxAt(x, y)] = hslPixel(200, 30, 8 + light * 12)
    }
  }
}

function idxAt(x: number, y: number): number {
  return y * WORLD.W + x
}

/** Яркий цвет семени (клетка на растении, в почве, падение). */
export function seedPixel(viewMode: ViewMode, dimmed = false, selected = false): number {
  if (viewMode === 'ANATOMY' || viewMode === 'TRACE') {
    return anatomyPixel('SEED', dimmed, selected)
  }
  return hslPixel(0, 0, dimmed ? 80 : selected ? 98 : 92)
}

export function fillSoilSeedPixels(
  pixels: Uint32Array,
  world: World,
  viewMode: ViewMode,
): void {
  const px = seedPixel(viewMode)
  for (const seed of world.seeds) {
    pixels[idxAt(seed.x, seed.y)] = px
  }
}

export function fillPlantPixels(
  pixels: Uint32Array,
  plant: Plant,
  viewMode: ViewMode,
  drawState: 'normal' | 'dimmed' | 'selected',
): void {
  const color = genomeColor(plant.genome)
  const dimmed = drawState === 'dimmed'
  const selected = drawState === 'selected'

  for (const cell of plant.cells) {
    const idx = idxAt(cell.x, cell.y)
    if (cell.type === 'SEED') {
      pixels[idx] = seedPixel(viewMode, dimmed, selected)
      continue
    }
    if (viewMode === 'ANATOMY' || viewMode === 'TRACE') {
      pixels[idx] = anatomyPixel(anatomyTissueType(cell), dimmed, selected)
    } else if (viewMode === 'PLANTS') {
      const sat = selected ? color.sat + 25 : dimmed ? 18 : color.sat
      const light = selected ? color.light + 12 : dimmed ? color.light * 0.35 : color.light
      pixels[idx] = hslPixel(color.hue, sat, Math.min(85, light))
    } else if (viewMode === 'ENERGY') {
      const t = Math.min(1, cell.cellEnergy / CAP[cell.type])
      const hueE = 45 - t * 45
      const light = (15 + t * 55) * (dimmed ? 0.3 : selected ? 1.2 : 1)
      const sat = dimmed ? 30 : selected ? 90 : 80
      pixels[idx] = hslPixel(hueE, sat, Math.min(90, light))
    } else {
      const sat = dimmed ? 15 : selected ? color.sat + 10 : color.sat - 8
      const light = dimmed ? color.light * 0.25 : selected ? color.light * 0.85 : color.light * 0.6
      pixels[idx] = hslPixel(color.hue, sat, light)
    }
  }
}

export interface PixelLayerCache {
  canvas: HTMLCanvasElement
  key: string
  pixels: Uint32Array
  imageData: ImageData
}

export function getPixelLayer(
  cacheRef: { current: PixelLayerCache | null },
  key: string,
  paint: (pixels: Uint32Array) => void,
): HTMLCanvasElement {
  const cached = cacheRef.current
  if (cached && cached.key === key) {
    return cached.canvas
  }

  const canvas = document.createElement('canvas')
  canvas.width = WORLD.W
  canvas.height = WORLD.H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const imageData = ctx.createImageData(WORLD.W, WORLD.H)
  const pixels = new Uint32Array(imageData.data.buffer)
  paint(pixels)
  ctx.putImageData(imageData, 0, 0)

  cacheRef.current = { canvas, key, pixels, imageData }
  return canvas
}

/** Собрать слой растений в пиксельную сетку 1px/клетку (переиспользует буфер). */
export function buildPlantsPixelLayerInto(
  pixels: Uint32Array,
  world: World,
  viewMode: ViewMode,
  selectedPlantId: number | null,
  showTrace: boolean,
): void {
  pixels.fill(0)
  const hasSelection = selectedPlantId != null
  const alive = world.plants.filter((p) => !p.dead)

  for (const plant of alive) {
    if (showTrace && plant.id === selectedPlantId) continue
    if (hasSelection && plant.id === selectedPlantId) continue
    fillPlantPixels(pixels, plant, viewMode, hasSelection || showTrace ? 'dimmed' : 'normal')
  }

  if (showTrace || hasSelection) {
    const selected = alive.find((p) => p.id === selectedPlantId)
    if (selected) {
      fillPlantPixels(pixels, selected, viewMode, 'selected')
    }
  }
}

export function buildPlantsPixelLayer(
  world: World,
  viewMode: ViewMode,
  selectedPlantId: number | null,
  showTrace: boolean,
): Uint32Array {
  const pixels = new Uint32Array(GRID_PIXELS)
  buildPlantsPixelLayerInto(pixels, world, viewMode, selectedPlantId, showTrace)
  return pixels
}

export function blitPixelGrid(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | OffscreenCanvas,
  destW: number,
  destH: number,
): void {
  const prevSmooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0, destW, destH)
  ctx.imageSmoothingEnabled = prevSmooth
}
