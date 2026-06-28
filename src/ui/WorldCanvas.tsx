import { useEffect, useRef, useState } from 'react'
import { recordDraw } from '../dev/perfProbe'
import { SEED_FALL_DURATION_MS, SEED_FALL_DURATION_TICKS, WORLD } from '../sim/config'
import { wrapX } from '../sim/coords'
import type { AppMode, CellType } from '../sim/types'
import type { ViewMode } from '../sim/types'
import type { World } from '../sim/world'
import { drawPlantTraceEvents, drawShootLines } from './traceDraw'
import PlantInspectOverlay from './PlantInspectOverlay'
import {
  blitPixelGrid,
  buildPlantsPixelLayerInto,
  fillSkyPixels,
  fillSoilPixels,
  getPixelLayer,
  type PixelLayerCache,
} from './worldPixelGrid'

interface Props {
  world: World
  viewMode: ViewMode
  frame: number
  selectedPlantId: number | null
  paused: boolean
  appMode: AppMode
  onSelectPlant: (plantId: number | null) => void
  onTakeToLaboratory: (plantId: number) => void
  onExploreGenome?: (plantId: number) => void
  onCompareGenomes?: (plantId: number) => void
  plantPlacementActive?: boolean
  plantPreviewX?: number
  onPlantPreviewMove?: (x: number) => void
  onPlantConfirm?: (x: number) => void
  onPlantCancel?: () => void
  highlightPlantIds?: number[]
  comparePickActive?: boolean
  comparePickHint?: string
  onCancelComparePick?: () => void
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`
}

function anatomyColor(type: CellType, dimmed: boolean, selected: boolean): string {
  switch (type) {
    case 'ROOT':
      return hsl(48, dimmed ? 35 : 78, dimmed ? 22 : selected ? 58 : 50)
    case 'STEM':
      return hsl(28, dimmed ? 25 : 48, dimmed ? 14 : selected ? 38 : 30)
    case 'SPROUT':
      return hsl(118, dimmed ? 30 : 58, dimmed ? 18 : selected ? 48 : 40)
    case 'SEED':
      return hsl(0, 0, dimmed ? 55 : selected ? 98 : 90)
    case 'SPIKE':
      return hsl(290, dimmed ? 35 : 72, dimmed ? 28 : selected ? 58 : 48)
  }
}

function fallEase(t: number): number {
  return t * (2 - t)
}

/** Прогресс падения семени: тики + сглаживание по времени между кадрами. */
function fallingSeedProgress(
  seed: { startTick: number; startTime: number },
  tickCount: number,
): number {
  const tickT = (tickCount - seed.startTick) / SEED_FALL_DURATION_TICKS
  const timeT = (performance.now() - seed.startTime) / SEED_FALL_DURATION_MS
  return fallEase(Math.min(1, Math.max(tickT, timeT)))
}

interface ViewportFit {
  cellSize: number
  displayW: number
  displayH: number
}

function computeViewport(containerW: number, containerH: number): ViewportFit {
  if (containerW <= 0 || containerH <= 0) {
    return { cellSize: 2, displayW: 0, displayH: 0 }
  }

  // Сначала заполняем ширину; если не влезает по высоте — ужимаем пропорционально
  let displayW = containerW
  let displayH = (containerW * WORLD.H) / WORLD.W
  if (displayH > containerH) {
    displayH = containerH
    displayW = (containerH * WORLD.W) / WORLD.H
  }

  return {
    cellSize: displayW / WORLD.W,
    displayW,
    displayH,
  }
}

function drawSeedMarker(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  fill: string,
  outline = true,
): void {
  ctx.fillStyle = fill
  ctx.fillRect(px, py, size, size)
  if (outline) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1)
  }
}

export default function WorldCanvas({
  world,
  viewMode,
  frame,
  selectedPlantId,
  paused,
  appMode,
  onSelectPlant,
  onTakeToLaboratory,
  onExploreGenome,
  onCompareGenomes,
  plantPlacementActive = false,
  plantPreviewX = Math.floor(WORLD.W / 2),
  onPlantPreviewMove,
  onPlantConfirm,
  onPlantCancel,
  comparePickActive = false,
  comparePickHint,
  onCancelComparePick,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const soilLayerRef = useRef<PixelLayerCache | null>(null)
  const skyLayerRef = useRef<PixelLayerCache | null>(null)
  const plantsGridRef = useRef<HTMLCanvasElement | null>(null)
  const plantsGridCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const plantsImageDataRef = useRef<ImageData | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const [viewport, setViewport] = useState<ViewportFit>(() => computeViewport(1, 1))
  const { cellSize, displayW, displayH } = viewport

  const gridFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const x = wrapX(Math.floor(((clientX - rect.left) / rect.width) * WORLD.W))
    const y = Math.max(0, Math.min(WORLD.H - 1, Math.floor(((clientY - rect.top) / rect.height) * WORLD.H)))
    return { x, y }
  }

  useEffect(() => {
    if (!comparePickActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelComparePick?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [comparePickActive, onCancelComparePick])

  useEffect(() => {
    if (!plantPlacementActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onPlantCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plantPlacementActive, onPlantCancel])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const fitViewport = () => {
      setViewport(computeViewport(wrap.clientWidth, wrap.clientHeight))
    }

    fitViewport()
    const ro = new ResizeObserver(fitViewport)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || displayW <= 0 || displayH <= 0) return
    canvas.style.width = `${displayW}px`
    canvas.style.height = `${displayH}px`
  }, [displayW, displayH])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (displayW <= 0 || displayH <= 0 || cellSize <= 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
    const drawT0 = performance.now()
    const w = Math.round(WORLD.W * cellSize)
    const h = Math.round(WORLD.H * cellSize)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      soilLayerRef.current = null
      skyLayerRef.current = null
      plantsImageDataRef.current = null
    }

    const soilKey =
      viewMode === 'ENERGY'
        ? `${viewMode}:${frame}`
        : `${viewMode}`
    const soilCanvas = getPixelLayer(soilLayerRef, soilKey, (pixels) => {
      fillSoilPixels(pixels, world, viewMode)
    })
    blitPixelGrid(ctx, soilCanvas, w, h)

    const skyKey = `${Math.floor(frame / 4)}`
    const skyCanvas = getPixelLayer(skyLayerRef, skyKey, (pixels) => {
      fillSkyPixels(pixels, world)
    })
    blitPixelGrid(ctx, skyCanvas, w, h)

    const hasSelection = selectedPlantId != null
    const showTrace = viewMode === 'TRACE' && selectedPlantId != null

    if (hasSelection && viewMode !== 'TRACE') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, w, h)
    }

    let plantsCanvas = plantsGridRef.current
    if (!plantsCanvas) {
      plantsCanvas = document.createElement('canvas')
      plantsCanvas.width = WORLD.W
      plantsCanvas.height = WORLD.H
      plantsGridRef.current = plantsCanvas
      plantsGridCtxRef.current = plantsCanvas.getContext('2d')
    }
    const pgCtx = plantsGridCtxRef.current
    if (pgCtx) {
      if (!plantsImageDataRef.current) {
        plantsImageDataRef.current = pgCtx.createImageData(WORLD.W, WORLD.H)
      }
      const imageData = plantsImageDataRef.current
      const gridPixels = new Uint32Array(imageData.data.buffer)
      buildPlantsPixelLayerInto(
        gridPixels,
        world,
        viewMode,
        selectedPlantId,
        showTrace,
      )
      pgCtx.putImageData(imageData, 0, 0)
      blitPixelGrid(ctx, plantsCanvas, w, h)
    }

    const alive = world.plants.filter((p) => !p.dead)

    if (showTrace || hasSelection) {
      const selected = alive.find((p) => p.id === selectedPlantId)
      if (selected) {
        if (showTrace) {
          drawPlantTraceEvents(ctx, world.tickEvents, selectedPlantId, cellSize)
        }

        for (const cell of selected.cells) {
          if (cell.type === 'SEED') continue
          const px = cell.x * cellSize
          const py = cell.y * cellSize
          ctx.strokeStyle = '#ffffffcc'
          ctx.lineWidth = 1.5
          ctx.strokeRect(px + 0.5, py + 0.5, cellSize - 1, cellSize - 1)
        }

        let minX: number = WORLD.W
        let minY: number = WORLD.H
        let maxX = 0
        let maxY = 0
        for (const cell of selected.cells) {
          minX = Math.min(minX, cell.x)
          minY = Math.min(minY, cell.y)
          maxX = Math.max(maxX, cell.x)
          maxY = Math.max(maxY, cell.y)
        }
        const pad = 2
        const bx = minX * cellSize - pad
        const by = minY * cellSize - pad
        const bw = (maxX - minX + 1) * cellSize + pad * 2
        const bh = (maxY - minY + 1) * cellSize + pad * 2
        ctx.strokeStyle = 'rgba(184, 224, 176, 0.9)'
        ctx.lineWidth = 2
        ctx.strokeRect(bx, by, bw, bh)
        ctx.fillStyle = 'rgba(184, 224, 176, 0.06)'
        ctx.fillRect(bx, by, bw, bh)
      }
    }

    if (viewMode === 'PLANTS' || viewMode === 'ANATOMY') {
      drawShootLines(ctx, world.recentShoots, cellSize, world.tickCount, selectedPlantId)
    }

    if (viewMode === 'FLOWS') {
      for (const plant of alive) {
        const isSelected = plant.id === selectedPlantId
        const dimmed = hasSelection && !isSelected
        for (const edge of plant.edgeFlux) {
          if (edge.flow < 0.05) continue
          const x1 = edge.fromX * cellSize + cellSize / 2
          const y1 = edge.fromY * cellSize + cellSize / 2
          const x2 = edge.toX * cellSize + cellSize / 2
          const y2 = edge.toY * cellSize + cellSize / 2
          const alpha = dimmed ? 0.12 : isSelected ? 0.95 : 0.7
          const width = Math.min(3, 0.5 + edge.flow * 2) * (isSelected ? 1.3 : 1)
          ctx.strokeStyle = `rgba(120, 220, 100, ${Math.min(0.95, edge.flow * alpha)})`
          ctx.lineWidth = width
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()

          const angle = Math.atan2(y2 - y1, x2 - x1)
          const head = isSelected ? 4 : 3
          ctx.beginPath()
          ctx.moveTo(x2, y2)
          ctx.lineTo(
            x2 - head * Math.cos(angle - 0.4),
            y2 - head * Math.sin(angle - 0.4),
          )
          ctx.moveTo(x2, y2)
          ctx.lineTo(
            x2 - head * Math.cos(angle + 0.4),
            y2 - head * Math.sin(angle + 0.4),
          )
          ctx.stroke()
        }
      }
    }

    for (const seed of world.fallingSeeds) {
      const t = fallingSeedProgress(seed, world.tickCount)
      const drawY = seed.fromY + (seed.toY - seed.fromY) * t
      const px = seed.x * cellSize
      const py = drawY * cellSize
      const fill =
        viewMode === 'ANATOMY' || viewMode === 'TRACE'
          ? anatomyColor('SEED', false, false)
          : hsl(0, 0, 92)
      drawSeedMarker(ctx, px, py, cellSize, fill)
    }

    for (const seed of world.seeds) {
      const px = seed.x * cellSize
      const py = seed.y * cellSize
      const fill =
        viewMode === 'ANATOMY' || viewMode === 'TRACE'
          ? anatomyColor('SEED', false, false)
          : hsl(0, 0, 88)
      drawSeedMarker(ctx, px, py, cellSize, fill)
    }

    if (plantPlacementActive) {
      const blockers = world.plantingColumnBlockers(plantPreviewX)
      const affectedPlants = new Set(blockers.filter((b) => b.plantId > 0).map((b) => b.plantId))

      for (const plant of alive) {
        if (!affectedPlants.has(plant.id)) continue
        for (const cell of plant.cells) {
          if (cell.x !== plantPreviewX) continue
          const px = cell.x * cellSize
          const py = cell.y * cellSize
          ctx.fillStyle = 'rgba(255, 80, 80, 0.45)'
          ctx.fillRect(px, py, cellSize, cellSize)
        }
      }

      for (const b of blockers) {
        if (b.plantId !== 0) continue
        ctx.fillStyle = 'rgba(255, 80, 80, 0.45)'
        ctx.fillRect(b.x * cellSize, b.y * cellSize, cellSize, cellSize)
      }

      const colX = plantPreviewX * cellSize
      ctx.fillStyle = 'rgba(255, 200, 60, 0.1)'
      ctx.fillRect(colX, 0, cellSize, WORLD.H * cellSize)

      const cy = WORLD.SOIL_Y
      const mx = plantPreviewX * cellSize
      const my = cy * cellSize
      ctx.strokeStyle = '#ffe066'
      ctx.lineWidth = 2
      ctx.strokeRect(mx + 1, my + 1, cellSize - 2, cellSize - 2)
      ctx.beginPath()
      ctx.moveTo(mx + cellSize / 2, my - cellSize * 0.6)
      ctx.lineTo(mx + cellSize / 2, my - cellSize * 0.15)
      ctx.moveTo(mx + cellSize / 2, my + cellSize * 1.15)
      ctx.lineTo(mx + cellSize / 2, my + cellSize * 1.6)
      ctx.stroke()
    }

    ctx.strokeStyle = '#5a7a50'
    ctx.lineWidth = 1
    const soilLine = WORLD.SOIL_Y * cellSize
    ctx.beginPath()
    ctx.moveTo(0, soilLine)
    ctx.lineTo(w, soilLine)
    ctx.stroke()
    recordDraw(performance.now() - drawT0)
    }

    drawRef.current = draw
    draw()
  }, [world, viewMode, cellSize, displayW, displayH, frame, selectedPlantId, plantPlacementActive, plantPreviewX])

  useEffect(() => {
    if (world.fallingSeeds.length === 0) return
    let animId = 0
    const loop = () => {
      if (world.fallingSeeds.length === 0) return
      drawRef.current?.()
      animId = requestAnimationFrame(loop)
    }
    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [world, frame, world.fallingSeeds.length])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const grid = gridFromClient(e.clientX, e.clientY)
    if (!grid) return
    if (plantPlacementActive) {
      onPlantConfirm?.(grid.x)
      return
    }
    const plantId = world.selectPlantAt(grid.x, grid.y)
    onSelectPlant(plantId)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!plantPlacementActive) return
    const grid = gridFromClient(e.clientX, e.clientY)
    if (!grid) return
    onPlantPreviewMove?.(grid.x)
  }

  const selectedPlant =
    selectedPlantId != null
      ? world.plants.find((p) => p.id === selectedPlantId && !p.dead)
      : undefined

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap${selectedPlantId != null ? ' canvas-wrap--selected' : ''}${plantPlacementActive ? ' canvas-wrap--planting' : ''}${comparePickActive ? ' canvas-wrap--compare-pick' : ''}`}
    >
      {comparePickActive && comparePickHint && (
        <div className="compare-pick-bar">
          {comparePickHint}
          <button type="button" onClick={() => onCancelComparePick?.()}>
            Отмена
          </button>
        </div>
      )}
      {plantPlacementActive && (
        <div className="plant-placement-bar">
          Укажите колонку посадки · красным — клетки, которые будут сняты · клик — посадить · Esc — отмена
        </div>
      )}
      {paused && selectedPlant && !plantPlacementActive && (
        <PlantInspectOverlay
          plant={selectedPlant}
          showTakeButton={appMode === 'EVOLUTION'}
          onTakeToLaboratory={() => onTakeToLaboratory(selectedPlant.id)}
          onExploreGenome={
            onExploreGenome ? () => onExploreGenome(selectedPlant.id) : undefined
          }
          onCompareGenomes={
            comparePickActive ? undefined : () => onCompareGenomes?.(selectedPlant.id)
          }
        />
      )}
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        style={{ cursor: plantPlacementActive ? 'crosshair' : undefined }}
      />
    </div>
  )
}
