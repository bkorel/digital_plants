import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { CAP, SEED_FALL_DURATION_MS, WORLD } from '../sim/config'
import { genomeColor } from '../sim/genome'
import { mineralColorCss, getMineralAt } from '../sim/environment'
import type { AppMode, CellType, Plant } from '../sim/types'
import type { ViewMode } from '../sim/types'
import type { World } from '../sim/world'
import { drawPlantTraceEvents } from './traceDraw'
import PlantInspectOverlay from './PlantInspectOverlay'

type PlantDrawState = 'normal' | 'dimmed' | 'selected'

interface Props {
  world: World
  viewMode: ViewMode
  frame: number
  selectedPlantId: number | null
  paused: boolean
  appMode: AppMode
  onSelectPlant: (plantId: number | null) => void
  onTakeToLaboratory: (plantId: number) => void
  plantPlacementActive?: boolean
  plantPreviewX?: number
  onPlantPreviewMove?: (x: number) => void
  onPlantConfirm?: (x: number) => void
  onPlantCancel?: () => void
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`
}

function mineralColor(m: number): string {
  return mineralColorCss(m)
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

/** В почве меристема отображается как корень (правило мира). */
function anatomyTissueType(cell: { type: CellType; y: number }): CellType {
  if (cell.type === 'SPROUT' && cell.y >= WORLD.SOIL_Y) return 'ROOT'
  return cell.type
}

function fallEase(t: number): number {
  return t * (2 - t)
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

interface CachedLayer {
  canvas: HTMLCanvasElement
  key: string
}

function buildSoilLayer(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewMode: ViewMode,
  cellSize: number,
): void {
  for (let y = WORLD.SOIL_Y; y < WORLD.H; y++) {
    for (let x = 0; x < WORLD.W; x++) {
      const px = x * cellSize
      const py = y * cellSize
      if (viewMode === 'ENERGY') {
        ctx.fillStyle = mineralColor(getMineralAt(world.minerals, x, y))
      } else {
        const depth = (y - WORLD.SOIL_Y) / (WORLD.H - WORLD.SOIL_Y)
        ctx.fillStyle = hsl(30, 25, 12 + depth * 18)
      }
      ctx.fillRect(px, py, cellSize, cellSize)
    }
  }
}

function buildSkyLayer(
  ctx: CanvasRenderingContext2D,
  world: World,
  cellSize: number,
): void {
  for (let y = 0; y < WORLD.SOIL_Y; y++) {
    for (let x = 0; x < WORLD.W; x++) {
      const px = x * cellSize
      const py = y * cellSize
      const light = world.light[y * WORLD.W + x]
      ctx.fillStyle = hsl(200, 30, 8 + light * 12)
      ctx.fillRect(px, py, cellSize, cellSize)
    }
  }
}

function getCachedLayer(
  cacheRef: MutableRefObject<CachedLayer | null>,
  key: string,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const cached = cacheRef.current
  if (cached && cached.key === key && cached.canvas.width === w && cached.canvas.height === h) {
    return cached.canvas
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  paint(ctx)
  cacheRef.current = { canvas, key }
  return canvas
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
  plantPlacementActive = false,
  plantPreviewX = Math.floor(WORLD.W / 2),
  onPlantPreviewMove,
  onPlantConfirm,
  onPlantCancel,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const soilLayerRef = useRef<CachedLayer | null>(null)
  const skyLayerRef = useRef<CachedLayer | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const [viewport, setViewport] = useState<ViewportFit>(() => computeViewport(1, 1))
  const { cellSize, displayW, displayH } = viewport

  const gridFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const x = Math.max(0, Math.min(WORLD.W - 1, Math.floor(((clientX - rect.left) / rect.width) * WORLD.W)))
    const y = Math.max(0, Math.min(WORLD.H - 1, Math.floor(((clientY - rect.top) / rect.height) * WORLD.H)))
    return { x, y }
  }

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
    const w = Math.round(WORLD.W * cellSize)
    const h = Math.round(WORLD.H * cellSize)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      soilLayerRef.current = null
      skyLayerRef.current = null
    }

    ctx.fillStyle = '#0a100a'
    ctx.fillRect(0, 0, w, h)

    const soilKey =
      viewMode === 'ENERGY'
        ? `${cellSize}:${viewMode}:${frame}`
        : `${cellSize}:${viewMode}`
    const soilCanvas = getCachedLayer(soilLayerRef, soilKey, w, h, (sctx) =>
      buildSoilLayer(sctx, world, viewMode, cellSize),
    )
    ctx.drawImage(soilCanvas, 0, 0)

    const skyKey = `${cellSize}:${frame}`
    const skyCanvas = getCachedLayer(skyLayerRef, skyKey, w, h, (sctx) =>
      buildSkyLayer(sctx, world, cellSize),
    )
    ctx.drawImage(skyCanvas, 0, 0)


    const hasSelection = selectedPlantId != null
    const showTrace = viewMode === 'TRACE' && selectedPlantId != null

    if (hasSelection && viewMode !== 'TRACE') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, w, h)
    }

    const drawPlantCell = (plant: Plant, drawState: PlantDrawState) => {
      const color = genomeColor(plant.genome)
      const dimmed = drawState === 'dimmed'
      const selected = drawState === 'selected'

      for (const cell of plant.cells) {
        const px = cell.x * cellSize
        const py = cell.y * cellSize

        if (viewMode === 'ANATOMY' || viewMode === 'TRACE') {
          const fill = anatomyColor(anatomyTissueType(cell), dimmed, selected)
          if (cell.type === 'SEED') {
            drawSeedMarker(ctx, px, py, cellSize, fill)
          } else {
            ctx.fillStyle = fill
            ctx.fillRect(px, py, cellSize, cellSize)
          }
        } else if (viewMode === 'PLANTS') {
          const sat = selected ? color.sat + 25 : dimmed ? 18 : color.sat
          const light = (selected ? color.light + 12 : dimmed ? color.light * 0.35 : color.light)
          const fill = hsl(color.hue, sat, Math.min(85, light))
          if (cell.type === 'SEED') {
            drawSeedMarker(ctx, px, py, cellSize, fill)
          } else {
            ctx.fillStyle = fill
            ctx.fillRect(px, py, cellSize, cellSize)
          }
        } else if (viewMode === 'ENERGY') {
          const t = Math.min(1, cell.cellEnergy / CAP[cell.type])
          const hueE = 45 - t * 45
          const light = (15 + t * 55) * (dimmed ? 0.3 : selected ? 1.2 : 1)
          const sat = dimmed ? 30 : selected ? 90 : 80
          const fill = hsl(hueE, sat, Math.min(90, light))
          if (cell.type === 'SEED') {
            drawSeedMarker(ctx, px, py, cellSize, fill)
          } else {
            ctx.fillStyle = fill
            ctx.fillRect(px, py, cellSize, cellSize)
          }
        } else {
          const sat = dimmed ? 15 : selected ? color.sat + 10 : color.sat - 8
          const light = dimmed ? color.light * 0.25 : selected ? color.light * 0.85 : color.light * 0.6
          const fill = hsl(color.hue, sat, light)
          if (cell.type === 'SEED') {
            drawSeedMarker(ctx, px, py, cellSize, fill)
          } else {
            ctx.fillStyle = fill
            ctx.fillRect(px, py, cellSize, cellSize)
          }
        }

        if (selected && cell.type !== 'SEED') {
          ctx.strokeStyle = '#ffffffcc'
          ctx.lineWidth = 1.5
          ctx.strokeRect(px + 0.5, py + 0.5, cellSize - 1, cellSize - 1)
        }
      }
    }

    const alive = world.plants.filter((p) => !p.dead)
    for (const plant of alive) {
      if (showTrace && plant.id === selectedPlantId) continue
      if (hasSelection && plant.id === selectedPlantId) continue
      drawPlantCell(plant, hasSelection || showTrace ? 'dimmed' : 'normal')
    }

    if (showTrace || hasSelection) {
      const selected = alive.find((p) => p.id === selectedPlantId)
      if (selected) {
        drawPlantCell(selected, 'selected')

        if (showTrace) {
          drawPlantTraceEvents(ctx, world.tickEvents, selectedPlantId, cellSize)
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
      const elapsed = performance.now() - seed.startTime
      const t = fallEase(Math.min(1, elapsed / SEED_FALL_DURATION_MS))
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
      className={`canvas-wrap${selectedPlantId != null ? ' canvas-wrap--selected' : ''}${plantPlacementActive ? ' canvas-wrap--planting' : ''}`}
    >
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
