import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { withSimWorld } from '../sim/worldBounds'
import type { World } from '../sim/world'
import { computeLabViewport } from './labViewport'
import { drawLabSnapshotScaled } from './labSnapshot'
import {
  blitPixelGrid,
  buildPlantsPixelLayerInto,
  fillSkyPixels,
  fillSoilPixels,
  getPixelLayer,
  type PixelLayerCache,
} from './worldPixelGrid'

interface Props {
  getWorld: () => World | null
  /** Живой рендер через rAF */
  live: boolean
  selectedPlantId: number | null
  frozenImage?: ImageData | null
}

const skyCache: { current: PixelLayerCache | null } = { current: null }
const soilCache: { current: PixelLayerCache | null } = { current: null }
const plantsCache: { current: PixelLayerCache | null } = { current: null }

function invalidateCachesIfSizeChanged(w: number, h: number): void {
  const sky = skyCache.current
  if (sky && (sky.canvas.width !== w || sky.canvas.height !== h)) {
    skyCache.current = null
    soilCache.current = null
    plantsCache.current = null
  }
}

function plantCells(world: World, plantId: number | null) {
  const id = plantId ?? world.plants[0]?.id ?? null
  if (id == null) return []
  return world.plants.find((p) => p.id === id)?.cells ?? []
}

function MiniLabCanvas({ getWorld, live, selectedPlantId, frozenImage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  const lastZoomRef = useRef(1)
  const frameRef = useRef(0)
  const [clientSize, setClientSize] = useState({ w: 320, h: 240 })

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setClientSize({
        w: Math.max(1, entry.contentRect.width),
        h: Math.max(1, entry.contentRect.height),
      })
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (frozenImage) {
      const scale = Math.max(
        2,
        Math.floor(
          Math.min(clientSize.w / frozenImage.width, clientSize.h / frozenImage.height),
        ),
      )
      canvas.width = frozenImage.width * scale
      canvas.height = frozenImage.height * scale
      drawLabSnapshotScaled(canvas, frozenImage, scale)
      if (zoomLabelRef.current) zoomLabelRef.current.textContent = ''
      return
    }

    const world = getWorld()
    if (!world) return

    const w = world.bounds.W
    const h = world.bounds.H
    const soilY = world.bounds.SOIL_Y
    const cells = plantCells(world, selectedPlantId)
    const viewport = computeLabViewport(world.bounds, cells)

    if (Math.abs(viewport.zoom - lastZoomRef.current) > 0.08) {
      lastZoomRef.current = viewport.zoom
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent =
          viewport.zoom > 1.05 ? `×${viewport.zoom.toFixed(1)}` : ''
      }
    }

    withSimWorld(world.bounds, () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      invalidateCachesIfSizeChanged(w, h)
      frameRef.current++

      const cellPx = Math.max(
        2,
        Math.floor(Math.min(clientSize.w / viewport.w, clientSize.h / viewport.h)),
      )
      canvas.width = viewport.w * cellPx
      canvas.height = viewport.h * cellPx

      const crop = { sx: viewport.x, sy: viewport.y, sw: viewport.w, sh: viewport.h }
      const dim = `${w}x${h}`
      const frame = frameRef.current
      const skyLayer = getPixelLayer(skyCache, `${dim}-sky-${frame >> 4}`, (px) =>
        fillSkyPixels(px, world),
      )
      const soilLayer = getPixelLayer(soilCache, `${dim}-soil-${frame >> 4}`, (px) =>
        fillSoilPixels(px, world, 'ANATOMY'),
      )
      const plantsLayer = getPixelLayer(
        plantsCache,
        `${dim}-plants-${frame}-${selectedPlantId}`,
        (px) => buildPlantsPixelLayerInto(px, world, 'ANATOMY', selectedPlantId, false),
      )

      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#0a0f0a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      blitPixelGrid(ctx, skyLayer, canvas.width, canvas.height, crop)
      blitPixelGrid(ctx, soilLayer, canvas.width, canvas.height, crop)
      blitPixelGrid(ctx, plantsLayer, canvas.width, canvas.height, crop)

      if (soilY >= viewport.y && soilY < viewport.y + viewport.h) {
        const lineY = (soilY - viewport.y) * cellPx
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.beginPath()
        ctx.moveTo(0, lineY)
        ctx.lineTo(canvas.width, lineY)
        ctx.stroke()
      }
    })
  }, [clientSize, frozenImage, getWorld, selectedPlantId])

  useEffect(() => {
    if (live && !frozenImage) return
    paint()
  }, [paint, frozenImage, clientSize, live])

  useEffect(() => {
    if (!live || frozenImage) return
    let raf = 0
    const loop = () => {
      paint()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [live, frozenImage, paint])

  const world = getWorld()
  const w = world?.bounds.W ?? 0
  const h = world?.bounds.H ?? 0

  return (
    <div ref={wrapRef} className="mini-lab-canvas-wrap">
      <span ref={zoomLabelRef} className="mini-lab-canvas__zoom" />
      <canvas
        ref={canvasRef}
        className="mini-lab-canvas"
        aria-label={`Мини-лаборатория ${w}×${h}`}
      />
    </div>
  )
}

export default memo(MiniLabCanvas)
