import { memo, useEffect, useRef } from 'react'
import type { LabLifeSnapshot, LabRunResult, LabSessionStats } from '../sim/labSession'
import { drawLabSnapshotScaled } from './labSnapshot'

/** Превью галереи уже даунскейлены — рисуем 1:1 */
const GALLERY_THUMB_SCALE = 1

interface Props {
  stats: LabSessionStats
  lifeSnapshots: LabLifeSnapshot[]
  runResult: LabRunResult | null
  plantDead: boolean
  fastForwarding: boolean
  onRunToEnd: () => void
  onReplant: () => void
}

function Sparkline({ points, field }: { points: LabSessionStats['timeSeries']; field: 'cellCount' | 'age' }) {
  if (points.length < 2) return null
  const values = points.map((p) => p[field])
  const max = Math.max(...values, 1)
  const w = 120
  const h = 28
  const coords = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - (v / max) * h
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg className="lab-stats__sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={coords} fill="none" stroke="#7fff7f" strokeWidth="1.5" />
    </svg>
  )
}

function SeedHistogram({ hist }: { hist: number[] }) {
  const max = Math.max(...hist, 1)
  const labels = ['0–50', '50–100', '100–150', '150–200', '200–250', '250–300', '300–350', '350+']
  return (
    <div className="lab-stats__histogram">
      {hist.map((v, i) => (
        <div key={i} className="lab-stats__hist-bar-wrap" title={`${labels[i]} тиков: ${v}`}>
          <div className="lab-stats__hist-bar" style={{ height: `${(v / max) * 100}%` }} />
          <span className="lab-stats__hist-label">{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

function snapshotTitle(kind: LabLifeSnapshot['kind'], tick: number): string {
  if (kind === 'start') return 'Старт'
  if (kind === 'death') return 'Перед гибелью'
  return `Тик ${tick}`
}

function LifeSnapshotThumb({ snap }: { snap: LabLifeSnapshot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawnKeyRef = useRef('')
  const displayW = snap.image.width * GALLERY_THUMB_SCALE
  const displayH = snap.image.height * GALLERY_THUMB_SCALE
  const snapKey = `${snap.kind}-${snap.tick}`

  useEffect(() => {
    if (drawnKeyRef.current === snapKey) return
    const canvas = canvasRef.current
    if (!canvas || snap.image.width === 0) return
    drawLabSnapshotScaled(canvas, snap.image, GALLERY_THUMB_SCALE)
    drawnKeyRef.current = snapKey
  }, [snap.image, snapKey])

  return (
    <figure className={`lab-stats__life-frame lab-stats__life-frame--${snap.kind}`}>
      <div className="lab-stats__life-frame-inner">
        <canvas
          ref={canvasRef}
          className="lab-stats__life-canvas"
          width={displayW}
          height={displayH}
          style={{ width: displayW, height: displayH }}
          aria-label={snapshotTitle(snap.kind, snap.tick)}
        />
      </div>
      <figcaption className="lab-stats__life-caption">
        <span className="lab-stats__life-caption-title">{snapshotTitle(snap.kind, snap.tick)}</span>
        <span className="lab-stats__life-caption-meta">
          {snap.cellCount} кл. · возр. {snap.age}
        </span>
      </figcaption>
    </figure>
  )
}

const MemoLifeSnapshotThumb = memo(LifeSnapshotThumb)

function LabStatsPanel({
  stats,
  lifeSnapshots,
  runResult,
  plantDead,
  fastForwarding,
  onRunToEnd,
  onReplant,
}: Props) {
  const showViability = plantDead && runResult

  return (
    <div className="lab-stats">
      {lifeSnapshots.length > 0 && (
        <div className="lab-stats__life-gallery">
          <h4>Жизненный цикл · {lifeSnapshots.length} кадров</h4>
          <div className="lab-stats__life-scroll">
            {lifeSnapshots.map((snap) => (
              <MemoLifeSnapshotThumb key={`${snap.kind}-${snap.tick}`} snap={snap} />
            ))}
          </div>
        </div>
      )}

      <div className="lab-stats__grid">
        <div className="lab-stats__card">
          <span className="lab-stats__label">Клеток</span>
          <span className="lab-stats__value">{stats.cellCount}</span>
          <Sparkline points={stats.timeSeries} field="cellCount" />
        </div>
        <div className="lab-stats__card">
          <span className="lab-stats__label">Возраст</span>
          <span className="lab-stats__value">{stats.age}</span>
          <Sparkline points={stats.timeSeries} field="age" />
        </div>
        <div className="lab-stats__card">
          <span className="lab-stats__label">Корни</span>
          <span className="lab-stats__value">{stats.roots}</span>
        </div>
        <div className="lab-stats__card">
          <span className="lab-stats__label">Шипы</span>
          <span className="lab-stats__value">{stats.spikes}</span>
        </div>
        <div className="lab-stats__card">
          <span className="lab-stats__label">Выстрелы</span>
          <span className="lab-stats__value">{stats.shootsFired}</span>
        </div>
        <div className="lab-stats__card">
          <span className="lab-stats__label">Семена</span>
          <span className="lab-stats__value">
            {stats.seedsCreated} / {stats.seedsViable} / {stats.seedsDead}
          </span>
          <span className="lab-stats__hint">созд. / пророс. / погиб.</span>
        </div>
      </div>

      <div className="lab-stats__actions">
        <button type="button" onClick={onRunToEnd} disabled={fastForwarding || plantDead}>
          {fastForwarding ? 'Прогон…' : 'Прогнать до конца'}
        </button>
        <button type="button" onClick={onReplant}>
          Пересадить
        </button>
      </div>

      {showViability && (
        <div className="lab-stats__result">
          <div className={`lab-stats__viability lab-stats__viability--${runResult.viabilityLabel.replace(/\s/g, '-')}`}>
            <span className="lab-stats__score">{runResult.viabilityScore}/100</span>
            <span className="lab-stats__viability-label">{runResult.viabilityLabel}</span>
          </div>
          <ul className="lab-stats__reasons">
            {runResult.viabilityReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>

          {(runResult.stats.seedLifetimeHist.some((v) => v > 0) || runResult.stats.seedsViable > 0) && (
            <div className="lab-stats__seed-hist">
              <h4>Жизнь проростков (тики)</h4>
              <SeedHistogram hist={runResult.stats.seedLifetimeHist} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(LabStatsPanel)
