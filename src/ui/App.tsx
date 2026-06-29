import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cloneGenome, deserializeGenome, serializeGenome, spikeShooterTemplateGenome, shyPlantTemplateGenome, SPIKE_SHOOTER_PRESET_ID, SHY_PLANT_PRESET_ID } from '../sim/genome'
import { WORLD } from '../sim/config'
import {
  recordRafBatch,
  recordTick,
  recordWorldMeta,
  startPerfProbe,
} from '../dev/perfProbe'
import type { AppMode, EvolutionSnapshot, Genome, GenomeLineageNode, SavedGenome, ViewMode } from '../sim/types'
import {
  formatEvolutionSavedAt,
  loadEvolutionState,
  saveEvolutionState,
} from '../sim/evolutionPersist'
import { genomeKey } from '../sim/lineage'
import { resetSimWorld } from '../sim/worldBounds'
import { World } from '../sim/world'
import { isWorkerSimulationAvailable, WorldWorkerHost } from '../sim/worldWorkerHost'
import Controls from './Controls'
import GenealogyScreen from './GenealogyScreen'
import GenomeConstructorScreen from './GenomeConstructorScreen'
import GenomeCompareScreen from './GenomeCompareScreen'
import GenomeExplorerScreen from './GenomeExplorerScreen'
import GenomePanel from './GenomePanel'
import LaboratoryPanel from './LaboratoryPanel'
import SimulationBar from './SimulationBar'
import StatsPanel from './StatsPanel'
import TracePanel from './TracePanel'
import WorldCanvas from './WorldCanvas'
import WorldRulesPanel from './WorldRulesPanel'

const COLLECTION_KEY = 'digital-plants-collection'

const FULLSCREEN_MODES: AppMode[] = ['GENOME_EXPLORER', 'GENOME_COMPARE', 'GENEALOGY', 'GENOME_CONSTRUCTOR']

const SIMULATION_BLOCKED_MODES: AppMode[] = ['GENOME_EXPLORER', 'GENOME_COMPARE', 'GENOME_CONSTRUCTOR']

function isFullscreenMode(mode: AppMode): boolean {
  return FULLSCREEN_MODES.includes(mode)
}

function isSimulationBlocked(mode: AppMode): boolean {
  return SIMULATION_BLOCKED_MODES.includes(mode)
}

function resolveGenomeByKey(
  world: World,
  key: string,
): { genome: Genome; node?: GenomeLineageNode } | null {
  const node = world.lineage.get(key)
  if (node) return { genome: node.genome, node }
  for (const p of world.plants) {
    if (!p.dead && genomeKey(p.genome) === key) {
      return { genome: p.genome }
    }
  }
  for (const s of world.seeds) {
    if (genomeKey(s.genome) === key) return { genome: s.genome }
  }
  for (const s of world.fallingSeeds) {
    if (genomeKey(s.genome) === key) return { genome: s.genome }
  }
  return null
}

function genomeKeyFromPlant(world: World, plantId: number): string | null {
  const plant = world.plants.find((p) => p.id === plantId && !p.dead)
  if (!plant) return null
  return genomeKey(plant.genome)
}

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
  const workerHostRef = useRef<WorldWorkerHost | null>(null)
  const useWorkerSimRef = useRef(false)
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
  const [explorerReturnMode, setExplorerReturnMode] = useState<AppMode>('EVOLUTION')
  const [comparePick, setComparePick] = useState<number | null>(null)
  const [comparePair, setComparePair] = useState<{ a: string; b: string } | null>(null)
  const [constructorGenome, setConstructorGenome] = useState<Genome | null>(null)
  const [autoRandomRestartOnExtinction, setAutoRandomRestartOnExtinction] = useState(false)
  const autoRandomRestartRef = useRef(false)
  const speedAccumRef = useRef(0)
  const [renderTick, setRenderTick] = useState(0)
  const [evolutionSavedAt, setEvolutionSavedAt] = useState<number | null>(() => {
    return loadEvolutionState()?.savedAt ?? null
  })

  const refresh = useCallback(() => {
    setRenderTick((n) => n + 1)
  }, [])

  const stopWorkerSim = useCallback(() => {
    workerHostRef.current?.stop()
    workerHostRef.current = null
    useWorkerSimRef.current = false
  }, [])

  const syncWorkerRestartRef = useRef<(seed: number, randomGenomes?: boolean) => void>(() => {})

  const performRandomRestart = useCallback(() => {
    if (appMode !== 'EVOLUTION') return
    const newSeed = Math.floor(Math.random() * 999_999) + 1
    evolutionSnapshotRef.current = null
    setSeed(newSeed)
    syncWorkerRestartRef.current(newSeed, true)
    setSelectedPlantId(null)
    setPaused(false)
    refresh()
  }, [appMode, refresh])

  const tryAutoRandomRestart = useCallback(
    (w: World) => {
      if (!autoRandomRestartRef.current) return
      if (w.mode !== 'EVOLUTION') return
      if (!w.isEcologyEmpty()) return
      performRandomRestart()
    },
    [performRandomRestart],
  )

  const onWorkerSnapshot = useCallback(
    (ticksRun: number) => {
      const w = worldRef.current
      if (!w) return
      if (ticksRun > 0) {
        recordRafBatch(0, ticksRun)
        let cells = 0
        let alive = 0
        for (const p of w.plants) {
          if (p.dead) continue
          alive++
          cells += p.cells.length
        }
        recordWorldMeta(w.tickCount, alive, cells)
        tryAutoRandomRestart(w)
      }
      refresh()
    },
    [refresh, tryAutoRandomRestart],
  )

  const startWorkerSim = useCallback(() => {
    const w = worldRef.current
    if (!w || !isWorkerSimulationAvailable()) return
    stopWorkerSim()
    const host = new WorldWorkerHost(w, (ticksRun) => onWorkerSnapshot(ticksRun))
    workerHostRef.current = host
    useWorkerSimRef.current = true
    host.start()
  }, [onWorkerSnapshot, stopWorkerSim])

  const resyncWorkerFromMain = useCallback(() => {
    if (appMode === 'EVOLUTION' && isWorkerSimulationAvailable()) {
      startWorkerSim()
    }
  }, [appMode, startWorkerSim])

  const syncWorkerRestart = useCallback(
    (newSeed: number, randomGenomes = false) => {
      worldRef.current?.restart(newSeed, randomGenomes)
      resyncWorkerFromMain()
    },
    [resyncWorkerFromMain],
  )

  useEffect(() => {
    syncWorkerRestartRef.current = syncWorkerRestart
  }, [syncWorkerRestart])

  useEffect(() => {
    return () => stopWorkerSim()
  }, [stopWorkerSim])

  useEffect(() => {
    if (appMode === 'EVOLUTION') {
      startWorkerSim()
    } else {
      stopWorkerSim()
    }
  }, [appMode, startWorkerSim, stopWorkerSim])

  useEffect(() => {
    const persisted = loadEvolutionState()
    const w = new World(persisted?.seed ?? seed)
    if (persisted) {
      w.restoreEvolution(persisted.snapshot)
      w.lastRestartUsedRandomGenomes = persisted.lastRestartUsedRandomGenomes
      if (persisted.seed !== seed) setSeed(persisted.seed)
    }
    worldRef.current = w
    setWorld(w)
    startPerfProbe()
  }, [])

  useEffect(() => {
    saveCollection(collection)
  }, [collection])

  useEffect(() => {
    autoRandomRestartRef.current = autoRandomRestartOnExtinction
  }, [autoRandomRestartOnExtinction])

  useEffect(() => {
    speedAccumRef.current = 0
  }, [speed])

  useEffect(() => {
    const w = worldRef.current
    if (!w) return
    const traceId = selectedPlantId
    w.tracePlantId = traceId
    workerHostRef.current?.setTracePlant(
      viewMode === 'TRACE' && selectedPlantId != null ? selectedPlantId : null,
    )
  }, [viewMode, selectedPlantId])

  useEffect(() => {
    let frame = 0
    const tickBudgetMs = 22
    const loop = () => {
      const w = worldRef.current
      const host = workerHostRef.current
      const useWorker = useWorkerSimRef.current && host != null

      if (w && !paused && !isSimulationBlocked(appMode)) {
        const traceId =
          viewMode === 'TRACE' && selectedPlantId != null ? selectedPlantId : null

        if (useWorker && appMode === 'EVOLUTION') {
          if (!host.isBusy()) {
            const rafT0 = performance.now()
            const tickBefore = w.tickCount
            let toQueue = 0
            const deadline = performance.now() + tickBudgetMs
            while (performance.now() < deadline) {
              if (speed >= 1) {
                toQueue += Math.floor(speed)
              } else {
                speedAccumRef.current += speed
                if (speedAccumRef.current >= 1) {
                  toQueue += Math.floor(speedAccumRef.current)
                  speedAccumRef.current %= 1
                }
              }
              if (toQueue >= 32) break
              if (speed < 1 && speedAccumRef.current < 1) break
            }
            if (toQueue > 0) {
              host.queueTicks(toQueue, traceId)
            } else if (w.tickCount !== tickBefore) {
              refresh()
            }
            if (toQueue > 0) {
              recordRafBatch(performance.now() - rafT0, toQueue)
            }
          }
        } else {
          const rafT0 = performance.now()
          const tickBefore = w.tickCount
          const deadline = performance.now() + tickBudgetMs
          while (performance.now() < deadline) {
            if (speed >= 1) {
              const batch = Math.floor(speed)
              for (let i = 0; i < batch; i++) {
                const tickT0 = performance.now()
                w.tick()
                recordTick(performance.now() - tickT0)
                if (performance.now() >= deadline) break
              }
            } else {
              speedAccumRef.current += speed
              if (speedAccumRef.current < 1) break
              while (speedAccumRef.current >= 1 && performance.now() < deadline) {
                const tickT0 = performance.now()
                w.tick()
                recordTick(performance.now() - tickT0)
                speedAccumRef.current -= 1
              }
            }
            if (performance.now() >= deadline) break
            if (speed < 1 && speedAccumRef.current < 1) break
          }
          if (w.tickCount !== tickBefore) {
            const tickDelta = w.tickCount - tickBefore
            recordRafBatch(performance.now() - rafT0, tickDelta)
            let cells = 0
            let alive = 0
            for (const p of w.plants) {
              if (p.dead) continue
              alive++
              cells += p.cells.length
            }
            recordWorldMeta(w.tickCount, alive, cells)
            tryAutoRandomRestart(w)
            refresh()
          }
        }
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [paused, speed, refresh, appMode, tryAutoRandomRestart, viewMode, selectedPlantId])

  useEffect(() => {
    if (selectedPlantId == null || !world) return
    const stillAlive = world.plants.some((p) => p.id === selectedPlantId && !p.dead)
    if (!stillAlive) setSelectedPlantId(null)
  }, [world?.tickCount, selectedPlantId, world])

  const handleStep = useCallback(() => {
    const w = worldRef.current
    if (!w) return
    const host = workerHostRef.current
    if (useWorkerSimRef.current && host) {
      const traceId =
        viewMode === 'TRACE' && selectedPlantId != null ? selectedPlantId : null
      host.queueTicks(1, traceId)
    } else {
      w.tick()
      tryAutoRandomRestart(w)
      refresh()
    }
  }, [refresh, tryAutoRandomRestart, viewMode, selectedPlantId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && comparePick != null) {
        setComparePick(null)
        return
      }
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
  }, [handleStep, comparePick])

  const handleRestart = () => {
    if (appMode === 'LABORATORY' && labSpecimen) {
      const plant = worldRef.current?.startLaboratory(labSpecimen.genome)
      setSelectedPlantId(plant?.id ?? null)
      setPaused(true)
    } else {
      evolutionSnapshotRef.current = null
      syncWorkerRestart(seed)
      setSelectedPlantId(null)
    }
    refresh()
  }

  const handleRandomRestart = () => {
    performRandomRestart()
  }

  const handleSaveEvolution = useCallback((): boolean => {
    const w = worldRef.current
    if (!w || appMode !== 'EVOLUTION') return false
    const snapshot = w.captureEvolution()
    if (!snapshot) return false
    const savedAt = Date.now()
    const ok = saveEvolutionState(snapshot, {
      seed,
      lastRestartUsedRandomGenomes: w.lastRestartUsedRandomGenomes,
      savedAt,
    })
    if (ok) {
      setEvolutionSavedAt(savedAt)
      return true
    }
    alert('Не удалось сохранить — возможно, переполнен localStorage')
    return false
  }, [appMode, seed])

  const handleLoadEvolution = useCallback(() => {
    const persisted = loadEvolutionState()
    if (!persisted) {
      alert('Нет сохранённого состояния')
      return
    }
    if (
      worldRef.current &&
      !window.confirm(
        `Загрузить сохранение от ${formatEvolutionSavedAt(persisted.savedAt)} (тик ${persisted.snapshot.tickCount})? Текущий мир будет заменён.`,
      )
    ) {
      return
    }
    const w = worldRef.current ?? new World(persisted.seed)
    w.restoreEvolution(persisted.snapshot)
    w.lastRestartUsedRandomGenomes = persisted.lastRestartUsedRandomGenomes
    worldRef.current = w
    setWorld(w)
    evolutionSnapshotRef.current = null
    setSeed(persisted.seed)
    setEvolutionSavedAt(persisted.savedAt)
    setSelectedPlantId(persisted.snapshot.selectedPlantId)
    setPaused(false)
    setAppMode('EVOLUTION')
    workerHostRef.current?.restoreFromDisplay()
    resyncWorkerFromMain()
    refresh()
  }, [refresh, resyncWorkerFromMain])

  const handleSeedChange = (newSeed: number) => {
    if (appMode === 'LABORATORY') return
    setSeed(newSeed)
    syncWorkerRestart(newSeed)
    setSelectedPlantId(null)
    refresh()
  }

  const handleSelectPlant = (plantId: number | null) => {
    if (comparePick === -1 && plantId != null) {
      setComparePick(plantId)
      setSelectedPlantId(plantId)
      refresh()
      return
    }
    if (comparePick != null && comparePick > 0 && plantId != null && plantId !== comparePick) {
      const keyA = genomeKeyFromPlant(worldRef.current!, comparePick)
      const keyB = genomeKeyFromPlant(worldRef.current!, plantId)
      if (keyA && keyB) handleEnterGenomeCompareKeys(keyA, keyB)
      return
    }
    setSelectedPlantId(plantId)
    if (plantId != null) {
      setViewMode('TRACE')
      setPaused(true)
    }
    refresh()
  }

  const handleExitFullscreenMode = () => {
    setAppMode(explorerReturnMode === 'LABORATORY' ? 'LABORATORY' : 'EVOLUTION')
    setComparePair(null)
    setComparePick(null)
    refresh()
  }

  const handleEnterGenomeCompareKeys = (keyA: string, keyB: string) => {
    if (!isFullscreenMode(appMode) && appMode !== 'GENEALOGY') {
      setExplorerReturnMode(appMode === 'LABORATORY' ? 'LABORATORY' : 'EVOLUTION')
    }
    setComparePair({ a: keyA, b: keyB })
    setComparePick(null)
    setAppMode('GENOME_COMPARE')
    setPaused(true)
    refresh()
  }

  const handleStartComparePick = (plantId?: number | null) => {
    setPaused(true)
    if (plantId != null) {
      setComparePick(plantId)
      setSelectedPlantId(plantId)
    } else {
      setComparePick(-1)
      setSelectedPlantId(null)
    }
    refresh()
  }

  const handleEnterGenealogy = () => {
    worldRef.current?.syncLineage()
    if (!isFullscreenMode(appMode)) {
      setExplorerReturnMode(appMode === 'LABORATORY' ? 'LABORATORY' : 'EVOLUTION')
    }
    setAppMode('GENEALOGY')
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
      resyncWorkerFromMain()
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

  const handleExitGenomeExplorer = () => {
    handleExitFullscreenMode()
  }

  const handleEnterGenomeExplorer = (plantId?: number | null) => {
    if (appMode !== 'GENOME_EXPLORER') {
      setExplorerReturnMode(appMode === 'LABORATORY' ? 'LABORATORY' : 'EVOLUTION')
    }
    if (plantId != null) setSelectedPlantId(plantId)
    setAppMode('GENOME_EXPLORER')
    setPaused(true)
    refresh()
  }

  const handleEnterConstructor = (genome?: Genome) => {
    if (appMode !== 'GENOME_CONSTRUCTOR') {
      setExplorerReturnMode(appMode === 'LABORATORY' ? 'LABORATORY' : 'EVOLUTION')
    }
    if (genome) {
      setConstructorGenome(cloneGenome(genome))
    } else {
      const plant = worldRef.current?.selectedPlant()
      setConstructorGenome(plant ? cloneGenome(plant.genome) : null)
    }
    setAppMode('GENOME_CONSTRUCTOR')
    setPaused(true)
    refresh()
  }

  const handleExitConstructor = () => {
    setConstructorGenome(null)
    resetSimWorld()
    handleExitFullscreenMode()
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
      syncWorkerRestart(seed)
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

  const explorerPlant =
    selectedPlantId != null
      ? world.plants.find((p) => p.id === selectedPlantId && !p.dead)
      : undefined

  const compareResolved =
    comparePair != null
      ? (() => {
          const a = resolveGenomeByKey(world, comparePair.a)
          const b = resolveGenomeByKey(world, comparePair.b)
          if (!a || !b) return null
          return {
            keyA: comparePair.a,
            keyB: comparePair.b,
            genomeA: a.genome,
            genomeB: b.genome,
            nodeA: a.node,
            nodeB: b.node,
          }
        })()
      : null

  const appClass =
    appMode === 'LABORATORY'
      ? ' app--laboratory'
      : isFullscreenMode(appMode)
        ? ' app--genome-explorer'
        : ''

  return (
    <div className={`app${appClass}`}>
      <header className="app-header">
        <h1>Digital Plants Evolution</h1>
        <div className="app-mode-switch">
          <button
            type="button"
            className={appMode === 'EVOLUTION' ? 'active' : ''}
            onClick={() => {
              if (isFullscreenMode(appMode)) handleExitFullscreenMode()
              else if (appMode === 'LABORATORY') handleExitLaboratory()
            }}
          >
            Эволюция
          </button>
          <button
            type="button"
            className={appMode === 'LABORATORY' ? 'active' : ''}
            onClick={() => {
              if (isFullscreenMode(appMode)) handleExitFullscreenMode()
              if (appMode !== 'LABORATORY') enterLaboratory()
            }}
          >
            Лаборатория
          </button>
          <button
            type="button"
            className={appMode === 'GENOME_CONSTRUCTOR' ? 'active' : ''}
            onClick={() => {
              if (appMode === 'GENOME_CONSTRUCTOR') handleExitConstructor()
              else handleEnterConstructor()
            }}
          >
            Конструктор
          </button>
          <button
            type="button"
            className={appMode === 'GENOME_EXPLORER' ? 'active' : ''}
            onClick={() => handleEnterGenomeExplorer(selectedPlantId)}
          >
            Исследование генома
          </button>
          <button
            type="button"
            className={appMode === 'GENEALOGY' ? 'active' : ''}
            onClick={handleEnterGenealogy}
          >
            Генеология
          </button>
        </div>
      </header>

      {appMode === 'GENOME_CONSTRUCTOR' ? (
        <GenomeConstructorScreen
          initialGenome={constructorGenome ?? undefined}
          collection={collection}
          onBack={handleExitConstructor}
          onSaveToCollection={(g, name) => {
            const item: SavedGenome = {
              id: crypto.randomUUID(),
              name,
              genome: cloneGenome(g),
              savedAt: Date.now(),
            }
            setCollection((prev) => {
              const next = [item, ...prev]
              saveCollection(next)
              return next
            })
          }}
        />
      ) : appMode === 'GENOME_EXPLORER' ? (
        <GenomeExplorerScreen
          world={world}
          plant={explorerPlant ?? selectedPlant}
          tick={world.tickCount}
          onBack={handleExitGenomeExplorer}
          onSelectPlant={(id) => {
            setSelectedPlantId(id)
            refresh()
          }}
        />
      ) : appMode === 'GENOME_COMPARE' ? (
        compareResolved ? (
        <GenomeCompareScreen
          keyA={compareResolved.keyA}
          keyB={compareResolved.keyB}
          genomeA={compareResolved.genomeA}
          genomeB={compareResolved.genomeB}
          nodeA={compareResolved.nodeA}
          nodeB={compareResolved.nodeB}
          lineage={world.lineage}
          onBack={handleExitFullscreenMode}
          onSwap={() =>
            setComparePair((p) => (p ? { a: p.b, b: p.a } : null))
          }
        />
        ) : (
          <div className="genome-explorer genome-explorer--empty">
            <p className="genome-explorer__empty-msg">Не удалось найти геномы для сравнения.</p>
            <button type="button" onClick={handleExitFullscreenMode}>
              ← Назад
            </button>
          </div>
        )
      ) : appMode === 'GENEALOGY' ? (
        <div className="genealogy-shell">
          <GenealogyScreen
            world={world}
            frame={renderTick}
            paused={paused}
            speed={speed}
            onPauseToggle={() => setPaused((p) => !p)}
            onStep={handleStep}
            onBack={handleExitFullscreenMode}
            onCompare={handleEnterGenomeCompareKeys}
          />
          <SimulationBar
            paused={paused}
            speed={speed}
            appMode="EVOLUTION"
            autoRandomRestartOnExtinction={autoRandomRestartOnExtinction}
            evolutionSavedAt={evolutionSavedAt}
            onPauseToggle={() => setPaused((p) => !p)}
            onStep={handleStep}
            onRestart={handleRestart}
            onRandomRestart={handleRandomRestart}
            onSaveEvolution={handleSaveEvolution}
            onLoadEvolution={handleLoadEvolution}
            onAutoRandomRestartChange={setAutoRandomRestartOnExtinction}
            onSpeedChange={setSpeed}
          />
        </div>
      ) : (
        <>
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
          onExploreGenome={handleEnterGenomeExplorer}
          onCompareGenomes={(id) => handleStartComparePick(id)}
          plantPlacementActive={plantPlacement != null}
          plantPreviewX={plantPreviewX}
          onPlantPreviewMove={setPlantPreviewX}
          onPlantConfirm={confirmPlantPlacement}
          highlightPlantIds={
            comparePick != null && comparePick > 0 ? [comparePick] : undefined
          }
          comparePickActive={comparePick != null}
          comparePickHint={
            comparePick === -1
              ? 'Выберите первое растение для сравнения'
              : comparePick != null && comparePick > 0
                ? `Выберите второе растение (первое: #${comparePick})`
                : undefined
          }
          onCancelComparePick={() => setComparePick(null)}
          onPlantCancel={cancelPlantPlacement}
        />
        <SimulationBar
          paused={paused}
          speed={speed}
          appMode={appMode}
          autoRandomRestartOnExtinction={autoRandomRestartOnExtinction}
          evolutionSavedAt={evolutionSavedAt}
          onPauseToggle={() => setPaused((p) => !p)}
          onStep={handleStep}
          onRestart={handleRestart}
          onRandomRestart={handleRandomRestart}
          onSaveEvolution={handleSaveEvolution}
          onLoadEvolution={handleLoadEvolution}
          onAutoRandomRestartChange={setAutoRandomRestartOnExtinction}
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
          lastRestartRandomGenomes={world.lastRestartUsedRandomGenomes}
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
          onExploreGenome={() => handleEnterGenomeExplorer(selectedPlantId)}
          onOpenConstructor={() => handleEnterConstructor(selectedPlant?.genome)}
          onCompareGenomes={() => handleStartComparePick(selectedPlantId)}
          comparePickActive={comparePick != null}
        />
      </aside>
        </>
      )}
    </div>
  )
}
