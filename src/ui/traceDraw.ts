import { EVENT_COLORS, EVENT_LABELS, type PlantTickEvent, type ShootVisual, type SpikeKillVisual } from '../sim/plantEvents'
import { SHOOT_VISUAL_TTL, SPIKE_KILL_FLASH_TTL, SPIKE_LEAF_KILL_RADIUS, WORLD } from '../sim/config'
import { wrapX } from '../sim/coords'
import type { Plant } from '../sim/types'

interface LabelRect {
  x: number
  y: number
  w: number
  h: number
}

function rectsOverlap(a: LabelRect, b: LabelRect, margin = 3): boolean {
  return !(
    a.x + a.w + margin < b.x ||
    b.x + b.w + margin < a.x ||
    a.y + a.h + margin < b.y ||
    b.y + b.h + margin < a.y
  )
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  color: string,
  cellSize: number,
  lineWidth = 2.2,
  alpha = 0.95,
): void {
  const dx = tx - fx
  const dy = ty - fy
  const len = Math.hypot(dx, dy)
  const inset = Math.max(2, cellSize * 0.42)
  const ex = len > 0.01 ? tx - (dx / len) * inset : tx
  const ey = len > 0.01 ? ty - (dy / len) * inset : ty

  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.moveTo(fx, fy)
  ctx.lineTo(ex, ey)
  ctx.stroke()

  const angle = Math.atan2(ey - fy, ex - fx)
  const head = Math.max(5, cellSize * 0.9)
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - head * Math.cos(angle - 0.42), ey - head * Math.sin(angle - 0.42))
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - head * Math.cos(angle + 0.42), ey - head * Math.sin(angle + 0.42))
  ctx.stroke()
  ctx.globalAlpha = 1
}

function findLabelRect(
  cx: number,
  py: number,
  px: number,
  cellSize: number,
  lw: number,
  lh: number,
  gap: number,
  placed: LabelRect[],
): LabelRect {
  const slots = [
    () => ({ x: cx - lw / 2, y: py - gap - lh }),
    () => ({ x: px - lw - 8, y: py - gap * 0.65 }),
    () => ({ x: px + cellSize + 8, y: py - gap * 0.65 }),
    () => ({ x: px - lw - 10, y: py + (cellSize - lh) / 2 }),
    () => ({ x: px + cellSize + 10, y: py + (cellSize - lh) / 2 }),
    () => ({ x: cx - lw / 2, y: py + cellSize + gap * 0.5 }),
    () => ({ x: cx - lw / 2, y: py - gap * 2 - lh }),
    () => ({ x: px + cellSize + 14, y: py + cellSize + gap * 0.3 }),
    () => ({ x: px - lw - 14, y: py + cellSize + gap * 0.3 }),
  ]

  for (let layer = 0; layer < 4; layer++) {
    for (const slot of slots) {
      const base = slot()
      const rect: LabelRect = {
        x: base.x,
        y: base.y - layer * (lh + 4),
        w: lw,
        h: lh,
      }
      if (!placed.some((p) => rectsOverlap(p, rect))) return rect
    }
  }

  return {
    x: cx - lw / 2,
    y: py - gap - lh - placed.length * (lh + 5),
    w: lw,
    h: lh,
  }
}

function labelAnchorOnCell(
  rect: LabelRect,
  cx: number,
  py: number,
  px: number,
  cellSize: number,
): { x: number; y: number } {
  const cellBottom = py + cellSize
  const labelCx = rect.x + rect.w / 2
  const labelCy = rect.y + rect.h / 2

  if (rect.y + rect.h <= py + 1) {
    return { x: Math.max(px, Math.min(px + cellSize, labelCx)), y: py }
  }
  if (rect.y >= cellBottom - 1) {
    return { x: Math.max(px, Math.min(px + cellSize, labelCx)), y: cellBottom }
  }
  if (rect.x + rect.w <= px + 1) {
    return { x: px, y: Math.max(py, Math.min(cellBottom, labelCy)) }
  }
  if (rect.x >= px + cellSize - 1) {
    return { x: px + cellSize, y: Math.max(py, Math.min(cellBottom, labelCy)) }
  }
  return { x: cx, y: py }
}

const SHOOT_LINE_COLOR = '#ff3333'

/** Красные линии выстрелов шипов (SHOOT). */
export function drawShootLines(
  ctx: CanvasRenderingContext2D,
  lines: ShootVisual[],
  cellSize: number,
  tickCount: number,
  selectedPlantId: number | null = null,
): void {
  for (const line of lines) {
    const remaining = line.expireTick - tickCount
    if (remaining <= 0) continue
    const fade = Math.min(1, remaining / SHOOT_VISUAL_TTL)
    const selected = selectedPlantId != null && line.plantId === selectedPlantId
    const dimmed = selectedPlantId != null && !selected
    const alpha = (dimmed ? 0.35 : 0.95) * (0.35 + fade * 0.65)
    const width = selected ? 3.5 : dimmed ? 2 : 3

    const fx = line.fromX * cellSize + cellSize / 2
    const fy = line.fromY * cellSize + cellSize / 2
    const tx = line.x * cellSize + cellSize / 2
    const ty = line.y * cellSize + cellSize / 2
    drawArrow(ctx, fx, fy, tx, ty, SHOOT_LINE_COLOR, cellSize, width, alpha)
  }
}

interface AuraCell {
  edge: boolean
  bright: boolean
}

/** Пассивная аура шипа: манхэттен SPIKE_LEAF_KILL_RADIUS, только воздух. */
export function drawSpikeAuras(
  ctx: CanvasRenderingContext2D,
  plants: Plant[],
  cellSize: number,
  selectedPlantId: number | null,
): void {
  const radius = SPIKE_LEAF_KILL_RADIUS
  const cells = new Map<number, AuraCell>()

  for (const plant of plants) {
    if (plant.dead) continue
    const bright = selectedPlantId == null || plant.id === selectedPlantId
    for (const cell of plant.cells) {
      if (cell.type !== 'SPIKE' || cell.y >= WORLD.SOIL_Y) continue
      for (let dy = -radius; dy <= radius; dy++) {
        const y = cell.y + dy
        if (y < 0 || y >= WORLD.SOIL_Y) continue
        const span = radius - Math.abs(dy)
        for (let dx = -span; dx <= span; dx++) {
          if (dx === 0 && dy === 0) continue
          const x = wrapX(cell.x + dx)
          const key = y * WORLD.W + x
          const edge = Math.abs(dx) + Math.abs(dy) === radius
          const prev = cells.get(key)
          if (!prev) {
            cells.set(key, { edge, bright })
          } else {
            prev.bright = prev.bright || bright
            prev.edge = prev.edge && edge
          }
        }
      }
    }
  }

  for (const [key, cell] of cells) {
    const x = key % WORLD.W
    const y = (key - x) / WORLD.W
    const px = x * cellSize
    const py = y * cellSize
    const fillAlpha = cell.bright ? (cell.edge ? 0.42 : 0.3) : cell.edge ? 0.16 : 0.1
    ctx.fillStyle = cell.edge
      ? `rgba(255, 186, 255, ${fillAlpha})`
      : `rgba(176, 64, 220, ${fillAlpha})`
    ctx.fillRect(px, py, cellSize, cellSize)
  }
}

/** Короткий контур ауры поверх растений, чтобы радиус читался и на кроне. */
export function drawSpikeAuraEdges(
  ctx: CanvasRenderingContext2D,
  plants: Plant[],
  cellSize: number,
  selectedPlantId: number | null,
): void {
  const radius = SPIKE_LEAF_KILL_RADIUS
  ctx.lineWidth = Math.max(1, cellSize * 0.22)

  for (const plant of plants) {
    if (plant.dead) continue
    const dimmed = selectedPlantId != null && plant.id !== selectedPlantId
    ctx.strokeStyle = dimmed ? 'rgba(220, 150, 245, 0.35)' : 'rgba(255, 210, 255, 0.92)'
    for (const cell of plant.cells) {
      if (cell.type !== 'SPIKE' || cell.y >= WORLD.SOIL_Y) continue
      for (let dy = -radius; dy <= radius; dy++) {
        const y = cell.y + dy
        if (y < 0 || y >= WORLD.SOIL_Y) continue
        const span = radius - Math.abs(dy)
        for (let dx = -span; dx <= span; dx++) {
          if (Math.abs(dx) + Math.abs(dy) !== radius) continue
          const x = wrapX(cell.x + dx)
          const px = x * cellSize
          const py = y * cellSize
          ctx.strokeRect(px + 0.5, py + 0.5, Math.max(0.5, cellSize - 1), Math.max(0.5, cellSize - 1))
        }
      }
    }
  }
}

/** Вспышка на месте ростка, убитого аурой шипа. */
export function drawSpikeKillFlashes(
  ctx: CanvasRenderingContext2D,
  flashes: SpikeKillVisual[],
  cellSize: number,
  tickCount: number,
): void {
  for (const flash of flashes) {
    const life = flash.expireTick - tickCount
    if (life <= 0) continue
    const t = Math.min(1, life / SPIKE_KILL_FLASH_TTL)
    const alpha = 0.4 + 0.6 * t
    const grow = (1 - t) * cellSize * 0.45
    const px = flash.x * cellSize
    const py = flash.y * cellSize
    ctx.fillStyle = `rgba(255, 244, 255, ${alpha})`
    ctx.fillRect(px - grow, py - grow, cellSize + grow * 2, cellSize + grow * 2)
    ctx.strokeStyle = `rgba(255, 60, 220, ${alpha})`
    ctx.lineWidth = Math.max(1.5, cellSize * 0.4)
    ctx.strokeRect(px + 0.5, py + 0.5, Math.max(0.5, cellSize - 1), Math.max(0.5, cellSize - 1))
  }
}

export function drawPlantTraceEvents(
  ctx: CanvasRenderingContext2D,
  events: PlantTickEvent[],
  plantId: number,
  cellSize: number,
): void {
  const filtered = events.filter((e) => e.plantId === plantId)
  if (filtered.length === 0) return

  const fontSize = Math.max(12, Math.round(cellSize * 2.4))
  const padX = 6
  const padY = 4
  const lineH = fontSize + padY * 2
  const gap = cellSize * 2.8

  ctx.font = `bold ${fontSize}px Segoe UI, system-ui, sans-serif`

  // 1) подсветка клеток
  for (const ev of filtered) {
    const color = EVENT_COLORS[ev.kind]
    const px = ev.x * cellSize
    const py = ev.y * cellSize

    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    ctx.strokeRect(px + 0.5, py + 0.5, cellSize - 1, cellSize - 1)

    if (ev.kind === 'DEATH') {
      ctx.beginPath()
      ctx.moveTo(px + 2, py + 2)
      ctx.lineTo(px + cellSize - 2, py + cellSize - 2)
      ctx.moveTo(px + cellSize - 2, py + 2)
      ctx.lineTo(px + 2, py + cellSize - 2)
      ctx.stroke()
    }
  }

  // 2) стрелки на целевые клетки
  for (const ev of filtered) {
    if (ev.fromX == null || ev.fromY == null) continue
    const color = EVENT_COLORS[ev.kind]
    const fx = ev.fromX * cellSize + cellSize / 2
    const fy = ev.fromY * cellSize + cellSize / 2
    const tx = ev.x * cellSize + cellSize / 2
    const ty = ev.y * cellSize + cellSize / 2
    drawArrow(ctx, fx, fy, tx, ty, color, cellSize, ev.kind === 'SHOOT' ? 3 : 2.2)
  }

  // 3) подписи с разведением
  const placed: LabelRect[] = []
  const sorted = [...filtered].sort((a, b) => a.y - b.y || a.x - b.x)

  for (const ev of sorted) {
    const color = EVENT_COLORS[ev.kind]
    const label = EVENT_LABELS[ev.kind]
    const tw = ctx.measureText(label).width
    const lw = tw + padX * 2
    const lh = lineH

    const px = ev.x * cellSize
    const py = ev.y * cellSize
    const cx = px + cellSize / 2

    const rect = findLabelRect(cx, py, px, cellSize, lw, lh, gap, placed)
    placed.push(rect)

    const anchor = labelAnchorOnCell(rect, cx, py, px, cellSize)
    const labelAnchorX = rect.x + rect.w / 2
    const labelAnchorY =
      rect.y + rect.h <= py + 1
        ? rect.y + rect.h
        : rect.y >= py + cellSize - 1
          ? rect.y
          : rect.y + rect.h / 2

    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.55
    ctx.setLineDash([2, 2])
    ctx.beginPath()
    ctx.moveTo(labelAnchorX, labelAnchorY)
    ctx.lineTo(anchor.x, anchor.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1

    ctx.fillStyle = 'rgba(10, 16, 10, 0.88)'
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    const r = 3
    const { x, y, w, h } = rect
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
}
