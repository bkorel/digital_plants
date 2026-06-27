import { EVENT_COLORS, EVENT_LABELS, type PlantTickEvent } from '../sim/plantEvents'

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
): void {
  const dx = tx - fx
  const dy = ty - fy
  const len = Math.hypot(dx, dy)
  const inset = Math.max(2, cellSize * 0.42)
  const ex = len > 0.01 ? tx - (dx / len) * inset : tx
  const ey = len > 0.01 ? ty - (dy / len) * inset : ty

  ctx.strokeStyle = color
  ctx.lineWidth = 2.2
  ctx.globalAlpha = 0.95
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
    drawArrow(ctx, fx, fy, tx, ty, color, cellSize)
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
