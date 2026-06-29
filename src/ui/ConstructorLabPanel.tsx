import { useCallback, useEffect, useRef, useState, startTransition, memo } from 'react'
import { buildGenomeStepTraceView, type GenomeStepTraceView } from '../sim/genomeStepTrace'
import {
  LabSession,
  type LabGenomeCoverage,
  type LabLifeSnapshot,
  type LabRunResult,
  type LabSessionStats,
} from '../sim/labSession'
import { resetSimWorld } from '../sim/worldBounds'
import type { Genome } from '../sim/types'
import LabStatsPanel from './LabStatsPanel'
import MiniLabCanvas from './MiniLabCanvas'
import { renderLabGallerySnapshot } from './labSnapshot'

const STATS_EVERY_TICKS = 8
const COVERAGE_EVERY_TICKS = 25

interface Props {
  genome: Genome
  sessionKey: number
  onCoverageChange: (coverage: LabGenomeCoverage) => void
  onStepTrace: (trace: GenomeStepTraceView | null) => void
}

function captureGallery(world: LabSession['world'], plantId: number) {
  return renderLabGallerySnapshot(world, plantId, 'ANATOMY')
}

function ConstructorLabPanel({ genome, sessionKey, onCoverageChange, onStepTrace }: Props) {
  const sessionRef = useRef<LabSession | null>(null)
  const tickLabelRef = useRef<HTMLSpanElement>(null)
  const plantDeadRef = useRef(false)
  const captureQueuedRef = useRef(false)

  const [paused, setPaused] = useState(false)
  const [plantDead, setPlantDead] = useState(false)
  const [speed, setSpeed] = useState(2)
  const [stats, setStats] = useState<LabSessionStats | null>(null)
  const [lifeSnapshots, setLifeSnapshots] = useState<LabLifeSnapshot[]>([])
  const [runResult, setRunResult] = useState<LabRunResult | null>(null)
  const [fastForwarding, setFastForwarding] = useState(false)
  const [frozenImage, setFrozenImage] = useState<ImageData | null>(null)

  const getWorld = useCallback(() => sessionRef.current?.world ?? null, [])

  const syncGallery = useCallback((session: LabSession, withResult: boolean) => {
    startTransition(() => {
      setLifeSnapshots(session.getLifeSnapshots())
      if (withResult) {
        setRunResult(session.getRunResult())
      }
    })
  }, [])

  const queueGalleryCapture = useCallback(
    (session: LabSession) => {
      if (captureQueuedRef.current) return
      captureQueuedRef.current = true
      requestAnimationFrame(() => {
        captureQueuedRef.current = false
        if (session.completeIntervalCapture((world, plantId) => captureGallery(world, plantId))) {
          syncGallery(session, false)
        }
      })
    },
    [syncGallery],
  )

  const markDead = useCallback(
    (session: LabSession) => {
      plantDeadRef.current = true
      setPlantDead(true)
      setPaused(true)
      const snap = session.getLifeSnapshots().at(-1)?.image ?? null
      setFrozenImage(snap)
      requestAnimationFrame(() => {
        startTransition(() => syncGallery(session, true))
      })
    },
    [syncGallery],
  )

  useEffect(() => {
    sessionRef.current?.dispose()
    const session = new LabSession(genome)
    sessionRef.current = session
    plantDeadRef.current = false
    setPlantDead(false)
    setPaused(false)
    setRunResult(null)
    setLifeSnapshots([])
    setFrozenImage(null)
    setStats(session.getLiveStats())

    if (tickLabelRef.current) {
      tickLabelRef.current.textContent = 'тик 0'
    }

    requestAnimationFrame(() => {
      if (session.captureStart((world, plantId) => captureGallery(world, plantId))) {
        syncGallery(session, false)
      }
    })

    return () => {
      session.dispose()
      resetSimWorld()
    }
  }, [genome, sessionKey, syncGallery])

  const advanceOneTick = useCallback(() => {
    const session = sessionRef.current
    if (!session || plantDeadRef.current) return

    session.tick()
    const after = session.afterTick()
    const tick = session.world.tickCount

    if (tickLabelRef.current) {
      tickLabelRef.current.textContent = `тик ${tick}`
    }

    if (tick % STATS_EVERY_TICKS === 0 || after.justDied) {
      startTransition(() => setStats(session.getLiveStats()))
    }

    if (tick % COVERAGE_EVERY_TICKS === 0 || after.justDied) {
      startTransition(() => onCoverageChange(session.getGenomeCoverage()))
    }

    if (after.needsIntervalCapture) {
      queueGalleryCapture(session)
    }

    if (after.newSnapshot && after.justDied) {
      startTransition(() => setLifeSnapshots(session.getLifeSnapshots()))
    }

    if (!after.rootAlive) {
      markDead(session)
    }
  }, [markDead, onCoverageChange, queueGalleryCapture])

  useEffect(() => {
    if (paused || fastForwarding || plantDead) return

    let last = performance.now()
    let acc = 0
    const intervalMs = Math.max(30, 120 / speed)
    let raf = 0

    const loop = (now: number) => {
      const dt = now - last
      last = now
      acc += dt
      while (acc >= intervalMs) {
        acc -= intervalMs
        advanceOneTick()
      }
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [paused, speed, fastForwarding, plantDead, advanceOneTick])

  const handleStep = () => {
    const session = sessionRef.current
    if (!session || plantDeadRef.current) return
    const trace = session.traceRootGrowth()
    advanceOneTick()
    if (trace) {
      startTransition(() =>
        onStepTrace(buildGenomeStepTraceView(genome, trace, session.world.tickCount)),
      )
    } else {
      onStepTrace(null)
    }
  }

  const handleReplant = () => {
    const session = sessionRef.current
    if (!session) return
    session.reset(genome)
    plantDeadRef.current = false
    setPlantDead(false)
    setPaused(false)
    setRunResult(null)
    setLifeSnapshots([])
    setFrozenImage(null)
    onStepTrace(null)
    setStats(session.getLiveStats())
    if (tickLabelRef.current) tickLabelRef.current.textContent = 'тик 0'
    requestAnimationFrame(() => {
      if (session.captureStart((world, plantId) => captureGallery(world, plantId))) {
        syncGallery(session, false)
      }
    })
  }

  const handleRunToEnd = () => {
    const session = sessionRef.current
    if (!session || plantDeadRef.current) return
    setFastForwarding(true)
    setPaused(true)
    requestAnimationFrame(() => {
      const result = session.runToEnd(undefined, (world, plantId) =>
        captureGallery(world, plantId),
      )
      plantDeadRef.current = !session.isRootAlive()
      setPlantDead(!session.isRootAlive())
      setStats(result.stats)
      setFrozenImage(result.finalSnapshot)
      startTransition(() => {
        setLifeSnapshots(result.lifeSnapshots)
        setRunResult(result)
      })
      onCoverageChange(session.getGenomeCoverage())
      setFastForwarding(false)
    })
  }

  const session = sessionRef.current
  const selectedPlantId = session?.world.selectedPlantId ?? null
  const live = !plantDead && !frozenImage

  return (
    <div className="constructor-screen__lab">
      <div className="constructor-screen__lab-toolbar">
        <button type="button" onClick={() => setPaused((p) => !p)} disabled={plantDead}>
          {paused || plantDead ? '▶' : '⏸'}
        </button>
        <button type="button" onClick={handleStep} disabled={plantDead || fastForwarding}>
          Шаг
        </button>
        <label>
          Скорость
          <input
            type="range"
            min={1}
            max={8}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={plantDead}
          />
          {speed}×
        </label>
        <span ref={tickLabelRef} className="constructor-screen__tick">
          тик 0
        </span>
        {plantDead && <span className="constructor-screen__dead">погибло</span>}
      </div>

      <div className="constructor-screen__canvas-wrap">
        <MiniLabCanvas
          getWorld={getWorld}
          live={live}
          selectedPlantId={selectedPlantId}
          frozenImage={frozenImage}
        />
      </div>

      {stats && (
        <LabStatsPanel
          stats={stats}
          lifeSnapshots={lifeSnapshots}
          runResult={runResult}
          plantDead={plantDead}
          fastForwarding={fastForwarding}
          onRunToEnd={handleRunToEnd}
          onReplant={handleReplant}
        />
      )}
    </div>
  )
}

export default memo(ConstructorLabPanel)
