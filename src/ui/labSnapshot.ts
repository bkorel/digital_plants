import type { ViewMode } from '../sim/types'
import type { World } from '../sim/world'
import { withSimWorld } from '../sim/worldBounds'
import { computeLabViewport } from './labViewport'
import {
  blitPlantLayerOnto,
  buildPlantsPixelLayerInto,
  fillSkyPixels,
  fillSoilPixels,
  fillSoilSeedPixels,
} from './worldPixelGrid'

export const LAB_SNAPSHOT_INTERVAL = 20
export const LAB_SNAPSHOT_SCALE = 2
/** Высота превью в галерее (ширина — по пропорциям кропа вокруг растения) */
export const GALLERY_SNAPSHOT_H = 96

function copyImageData(src: ImageData): ImageData {
  const copy = new ImageData(src.width, src.height)
  copy.data.set(src.data)
  return copy
}

function pixelsView(imageData: ImageData): Uint32Array {
  return new Uint32Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength / 4,
  )
}

/** Рендер снимка мини-лаборатории (по умолчанию — режим «Ткани» / ANATOMY). */
export function renderLabSnapshot(
  world: World,
  plantId: number | null,
  viewMode: ViewMode = 'ANATOMY',
): ImageData | null {
  if (typeof document === 'undefined') return null

  return withSimWorld(world.bounds, () => {
    const w = world.bounds.W
    const h = world.bounds.H
    const pixelCount = w * h

    const imageData = new ImageData(w, h)
    const pixels = pixelsView(imageData)
    fillSkyPixels(pixels, world)
    fillSoilPixels(pixels, world, viewMode)

    const plantLayer = new Uint32Array(pixelCount)
    buildPlantsPixelLayerInto(plantLayer, world, viewMode, plantId, false)
    blitPlantLayerOnto(pixels, plantLayer)

    fillSoilSeedPixels(pixels, world, viewMode)

    return copyImageData(imageData)
  })
}

function cropImageData(src: ImageData, sx: number, sy: number, sw: number, sh: number): ImageData {
  const out = new ImageData(sw, sh)
  for (let y = 0; y < sh; y++) {
    const srcRow = (sy + y) * src.width + sx
    out.data.set(src.data.subarray(srcRow * 4, (srcRow + sw) * 4), y * sw * 4)
  }
  return out
}

function downscaleImageDataToHeight(src: ImageData, targetH: number): ImageData {
  if (typeof document === 'undefined') return src
  const targetW = Math.max(1, Math.round(src.width * (targetH / src.height)))
  if (targetH >= src.height && targetW >= src.width) return copyImageData(src)

  const tmp = document.createElement('canvas')
  tmp.width = src.width
  tmp.height = src.height
  const tctx = tmp.getContext('2d')
  if (!tctx) return copyImageData(src)
  tctx.putImageData(src, 0, 0)

  const out = document.createElement('canvas')
  out.width = targetW
  out.height = targetH
  const octx = out.getContext('2d')
  if (!octx) return copyImageData(src)
  octx.imageSmoothingEnabled = false
  octx.drawImage(tmp, 0, 0, targetW, targetH)
  return octx.getImageData(0, 0, targetW, targetH)
}

function plantCellsForSnapshot(world: World, plantId: number | null) {
  const id = plantId ?? world.plants[0]?.id ?? null
  if (id == null) return []
  return world.plants.find((p) => p.id === id)?.cells ?? []
}

/** Компактный снимок для галереи — кроп вокруг растения, без пустого неба по бокам. */
export function renderLabGallerySnapshot(
  world: World,
  plantId: number | null,
  viewMode: ViewMode = 'ANATOMY',
): ImageData | null {
  const full = renderLabSnapshot(world, plantId, viewMode)
  if (!full) return null
  const cells = plantCellsForSnapshot(world, plantId)
  const viewport = computeLabViewport(world.bounds, cells)
  const cropped = cropImageData(full, viewport.x, viewport.y, viewport.w, viewport.h)
  return downscaleImageDataToHeight(cropped, GALLERY_SNAPSHOT_H)
}

/** Нарисовать снимок на canvas с целочисленным масштабом (pixel-perfect). */
export function drawLabSnapshotScaled(
  canvas: HTMLCanvasElement,
  image: ImageData,
  scale = LAB_SNAPSHOT_SCALE,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = image.width * scale
  canvas.height = image.height * scale
  ctx.imageSmoothingEnabled = false

  const tmp = document.createElement('canvas')
  tmp.width = image.width
  tmp.height = image.height
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.putImageData(image, 0, 0)
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height)
}

export { LAB_WORLD } from '../sim/config'
