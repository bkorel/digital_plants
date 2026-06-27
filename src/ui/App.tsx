import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cloneGenome, deserializeGenome, serializeGenome, spikeShooterTemplateGenome, shyPlantTemplateGenome, SPIKE_SHOOTER_PRESET_ID, SHY_PLANT_PRESET_ID } from '../sim/genome'
import { WORLD } from '../sim/config'
import type { AppMode, EvolutionSnapshot, Genome, SavedGenome, ViewMode } from '../sim/types'
import { World } from '../sim/world'
import Controls from './Controls'
import GenomePanel from './GenomePanel'
import LaboratoryPanel from './LaboratoryPanel'
import SimulationBar from './SimulationBar'
import StatsPanel from './StatsPanel'
import TracePanel from './TracePanel'
import WorldCanvas from './WorldCanvas'
import WorldRulesPanel from './WorldRulesPanel'

const COLLECTION_KEY = 'digital-plants-collection'

interface StoredGenome {
  id: string
  name: string
  savedAt: number
  genomeHex: string
}

function presetCollection(): SavedGenome[] {
  return [
    {
      id: SPIKE_SHOOTER_PRESET_ID,
      name: 'Стрелок (шипы)',
      genome: spikeShooterTemplateGenome(),
      savedAt: 0,
    },
    {
      id: SHY_PLANT_PRESET_ID,
      name: 'Стеснитель',
      genome: shyPlantTemplateGenome(),
      savedAt: 0,
    },
  ]
}

function loadCollection(): SavedGenome[] {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY)
    if (!raw) return presetCollection()
    const parsed = JSON.parse(raw) as StoredGenome[]
    const items = parsed.map((item) => ({
      id: item.id,
      name: item.name,
      savedAt: item.savedAt,
      genome: deserializeGenome(item.genomeHex),
    }))
    const missing = presetCollection().filter(
      (preset) => !items.some((item) => item.id === preset.id),
    )
    return missing.length > 0 ? [...missing, ...items] : items
  } catch {
    return presetCollection()
  }
}

function saveCollection(items: SavedGenome[]): void {
  try {
    const stored: StoredGenome[] = items.map((item) => ({
      id: item.id,
      name: item.name,
      savedAt: item.savedAt,
      genomeHex: serializeGenome(item.genome),
    }))
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(stored))
  } catch {
    // ignore quota errors
  }
}

export default function App() {
  const worldRef = useRef<World | null>(null)
  const evolutionSnapshotRef = useRef<EvolutionSnapshot | null>(null)
  const [world, setWorld] = useState<World | null>(null)
  const [appMode, setAppMode] = useState<AppMode>('EVOLUTION')
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('PLANTS')
  const [seed, setSeed] = useState(42)
  const [collection, setCollection] = useState<SavedGenome[]>(() => loadCollection())
  const [labSpecimen, setLabSpecimen] = useState<SavedGenome | null>(null)
  const [plantPlacement, setPlantPlacement] = useState<{ genome: Genome; laboratory: boolean } | null>(
    null,
  )
  const [plantPreviewX, setPlantPreviewX] = useState(Math.floor(WORLD.W / 2))
  const [selectedPlantId, setSelectedPlantId] = useState<number | null>(null)
  const speedAccumRef = useRef(0)
  const [renderTick, setRenderTick] = useState(0)

  const refresh = useCallback(() => {
    setRenderTick((n) => n + 1)
  }, [])

  useEffect(() => {
    const w = new World(seed)
    worldRef.current = w
    setWorld(w)
  }, [])

  useEffect(() => {
    saveCollection(collection)
  }, [collection])

  useEffect(() => {
    speedAccumRef.current = 0
  }, [speed])

  useEffect(() => {
    const w = worldRef.current
    if (!w) return
    w.tracePlantId =
      viewMode === 'TRACE' && selectedPlantId != null ? selectedPlantId : null
  }, [viewMode, selectedPlantId])

  useEffect(() => {
    let frame = 0
    const tickBudgetMs = 14
    const loop = () => {
      const w = worldRef.current
      if (w && !paused) {
        const tickBefore = w.tickCount
        const deadline = performance.now() + tickBudgetMs
        while (performance.now() < deadline) {
          if (speed >= 1) {
            const batch = Math.floor(speed)
            for (let i = 0; i < batch; i++) {
              w.tick()
              if (performance.now() >= deadline) break
            }
          } else {
            speedAccumRef.current += speed
            if (speedAccumRef.current < 1) break
            while (speedAccumRef.current >= 1 && performance.now() < deadline) {
              w.tick()
              speedAccumRef.current -= 1
            }
          }
          if (performance.now() >= deadline) break
          if (speed < 1 && speedAccumRef.current < 1) break
        }
        if (w.tickCount !== tickBefore) {
          refresh()
        }
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [paused, speed, refresh])

  useEffect(() => {
    if (selectedPlantId == null || !world) return
    const stillAlive = world.plants.some((p) => p.id === selectedPlantId && !p.dead)
    if (!stillAlive) setSelectedPlantId(null)
  }, [world?.tickCount, selectedPlantId, world])

  const handleStep = useCallback(() => {
    worldRef.current?.tick()
    refresh()
  }, [refresh])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (e.repeat) return
      const el = e.target as HTMLElement
      if (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      handleStep()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleStep])

  const handleRestart = () => {
    if (appMode === 'LABORATORY' && labSpecimen) {
      const plant = worldRef.current?.startLaboratory(labSpecimen.genome)
      setSelectedPlantId(plant?.id ?? null)
      setPaused(true)
    } else {
      evolutionSnapshotRef.current = null
      worldRef.current?.restart(seed)
      setSelectedPlantId(null)
    }
    refresh()
  }

  const handleSeedChange = (newSeed: number) => {
    if (appMode === 'LABORATORY') return
    setSeed(newSeed)
    worldRef.current?.restart(newSeed)
    setSelectedPlantId(null)
    refresh()
  }

  const handleSelectPlant = (plantId: number | null) => {
    setSelectedPlantId(plantId)
    if (plantId != null) {
      setViewMode('TRACE')
      setPaused(true)
    }
    refresh()
  }

  const handleSaveToCollection = (genome: import('../sim/types').Genome, name: string) => {
    setCollection((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        genome: cloneGenome(genome),
        savedAt: Date.now(),
      },
    ])
  }

  const handleRemoveFromCollection = (id: string) => {
    setCollection((prev) => prev.filter((item) => item.id !== id))
    if (labSpecimen?.id === id) {
      setLabSpecimen(null)
      worldRef.current?.clearLaboratory()
      setSelectedPlantId(null)
      setPaused(true)
    }
    refresh()
  }

  const beginPlantPlacement = (genome: Genome, laboratory: boolean) => {
    setPlantPlacement({ genome: cloneGenome(genome), laboratory })
    setPlantPreviewX(Math.floor(WORLD.W / 2))
    setPaused(true)
    setSelectedPlantId(null)
  }

  const cancelPlantPlacement = () => {
    setPlantPlacement(null)
  }

  const confirmPlantPlacement = (x: number) => {
    if (!plantPlacement || !worldRef.current) return
    const laboratory = plantPlacement.laboratory
    const plant = worldRef.current.plantGenomeAt(
      plantPlacement.genome,
      x,
      laboratory,
    )
    if (!plant) {
      alert('Не удалось посадить здесь — колонка занята')
      return
    }
    setPlantPlacement(null)
    if (laboratory) {
      setSelectedPlantId(plant.id)
      setPaused(true)
      setViewMode('ANATOMY')
    } else {
      // В эволюции не ставим паузу — иначе кажется, что симуляция «зависла»
      setSelectedPlantId(null)
      setPaused(false)
    }
    refresh()
  }

  const handlePlantGenome = (genome: Genome) => {
    beginPlantPlacement(genome, appMode === 'LABORATORY')
  }

  const handlePlantPaste = (text: string) => {
    try {
      const genome = deserializeGenome(text)
      if (appMode === 'LABORATORY') {
        setLabSpecimen({
          id: `paste-${Date.now()}`,
          name: 'Вставленный геном',
          genome: cloneGenome(genome),
          savedAt: Date.now(),
        })
      }
      beginPlantPlacement(genome, appMode === 'LABORATORY')
      refresh()
    } catch {
      alert('Неверный формат генома')
    }
  }

  const enterLaboratory = (specimen: SavedGenome | null = null) => {
    if (appMode === 'EVOLUTION' && worldRef.current) {
      evolutionSnapshotRef.current = worldRef.current.captureEvolution()
    }
    setAppMode('LABORATORY')
    setPaused(true)
    setViewMode('ANATOMY')
    if (specimen) {
      setLabSpecimen(specimen)
      const plant = worldRef.current?.startLaboratory(specimen.genome)
      setSelectedPlantId(plant?.id ?? null)
      setPaused(true)
    } else {
      setLabSpecimen(null)
      worldRef.current?.clearLaboratory()
      setSelectedPlantId(null)
    }
    refresh()
  }

  const handleTakeToLaboratory = (plantId: number) => {
    const extracted = worldRef.current?.extractToLaboratory(plantId)
    if (!extracted) return
    const saved: SavedGenome = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `Лаборатория #${extracted.id}`,
      genome: cloneGenome(extracted.genome),
      savedAt: Date.now(),
    }
    setCollection((prev) => [...prev, saved])
    enterLaboratory(saved)
  }

  const handlePlantSpecimen = (item: SavedGenome) => {
    setLabSpecimen(item)
    beginPlantPlacement(item.genome, true)
    refresh()
  }

  const handleChangeSpecimen = () => {
    setLabSpecimen(null)
    worldRef.current?.clearLaboratory()
    setSelectedPlantId(null)
    setPaused(true)
    refresh()
  }

  const handleExitLaboratory = () => {
    setAppMode('EVOLUTION')
    setLabSpecimen(null)
    setSelectedPlantId(null)
    setPaused(false)
    setViewMode('PLANTS')
    const snapshot = evolutionSnapshotRef.current
    if (snapshot && worldRef.current) {
      worldRef.current.restoreEvolution(snapshot)
      const restoredId = snapshot.selectedPlantId
      if (
        restoredId != null &&
        worldRef.current.plants.some((p) => p.id === restoredId && !p.dead)
      ) {
        setSelectedPlantId(restoredId)
      }
    } else {
      worldRef.current?.restart(seed)
    }
    refresh()
  }

  const handlePlantManualGenome = (text: string, name?: string) => {
    try {
      const genome = deserializeGenome(text)
      const item: SavedGenome = {
        id: `manual-${Date.now()}`,
        name: name?.trim() || 'Ручной геном',
        genome: cloneGenome(genome),
        savedAt: Date.now(),
      }
      setLabSpecimen(item)
      beginPlantPlacement(genome, true)
      refresh()
    } catch {
      alert('Неверный формат генома')
    }
  }

  const worldStats = useMemo(
    () => (world ? world.stats() : null),
    [world, world?.tickCount, renderTick],
  )

  if (!world || !worldStats) return <div className="app">Загрузка...</div>

  const selectedPlant =
    selectedPlantId != null
      ? world.plants.find((p) => p.id === selectedPlantId && !p.dead)
      : undefined
  const labPlantAlive = world.plants.some((p) => !p.dead)

  return (
    <div className={`app${appMode === 'LABORATORY' ? ' app--laboratory' : ''}`}>
      <header className="app-header">
        <h1>Digital Plants Evolution</h1>
        <div className="app-mode-switch">
          <button
            type="button"
            className={appMode === 'EVOLUTION' ? 'active' : ''}
            onClick={() => {
              if (appMode === 'LABORATORY') handleExitLaboratory()
            }}
          >
            Эволюция
          </button>
          <button
            type="button"
            className={appMode === 'LABORATORY' ? 'active' : ''}
            onClick={() => enterLaboratory()}
          >
            Лаборатория
          </button>
        </div>
      </header>

      <div className="world-column">
        <WorldCanvas
          world={world}
          viewMode={viewMode}
          frame={world.tickCount}
          selectedPlantId={selectedPlantId}
          paused={paused}
          appMode={appMode}
          onSelectPlant={handleSelectPlant}
          onTakeToLaboratory={handleTakeToLaboratory}
          plantPlacementActive={plantPlacement != null}
          plantPreviewX={plantPreviewX}
          onPlantPreviewMove={setPlantPreviewX}
          onPlantConfirm={confirmPlantPlacement}
          onPlantCancel={cancelPlantPlacement}
        />
        <SimulationBar
          paused={paused}
          speed={speed}
          appMode={appMode}
          onPauseToggle={() => setPaused((p) => !p)}
          onStep={handleStep}
          onRestart={handleRestart}
          onSpeedChange={setSpeed}
        />
      </div>

      <aside className="sidebar">
        {appMode === 'LABORATORY' ? (
          <LaboratoryPanel
            collection={collection}
            activeSpecimen={labSpecimen}
            plantAlive={labPlantAlive}
            onPlantSpecimen={handlePlantSpecimen}
            onPlantManualGenome={handlePlantManualGenome}
            onRemoveFromCollection={handleRemoveFromCollection}
            onRestartSpecimen={handleRestart}
            onChangeSpecimen={handleChangeSpecimen}
            onExitLaboratory={handleExitLaboratory}
          />
        ) : null}
        <StatsPanel stats={worldStats} />
        <WorldRulesPanel />
        <Controls
          viewMode={viewMode}
          seed={seed}
          appMode={appMode}
          onViewModeChange={setViewMode}
          onSeedChange={handleSeedChange}
        />
        {viewMode === 'TRACE' && selectedPlantId != null && (
          <TracePanel
            plantId={selectedPlantId}
            tick={world.tickCount}
            events={world.tickEvents}
          />
        )}
        <GenomePanel
          plant={selectedPlant}
          collection={collection}
          appMode={appMode}
          onSaveToCollection={handleSaveToCollection}
          onRemoveFromCollection={handleRemoveFromCollection}
          onPlantFromCollection={handlePlantGenome}
          onPlantFromPaste={handlePlantPaste}
        />
      </aside>
    </div>
  )
}
