import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  disassemble,
  genomeDepthCap,
  genomeDoubleGrowth,
  genomeHeightCap,
  genomeMaxAge,
  genomeSeedReserve,
  genomeShadeSenescence,
  doubleGrowthLabel,
  shadeSenescenceLabel,
} from '../sim/genome'
import { disasmLineHelp } from '../sim/genomeHelp'
import {
  plantGrowActionBudget,
  plantTotalEnergy,
  traceGrowthVM,
  type GrowthVmTrace,
  type MeristemRunTrace,
} from '../sim/plant'
import { SHADED_SPROUT_LAYERS, WORLD } from '../sim/config'
import type { Plant } from '../sim/types'
import { World } from '../sim/world'

interface Props {
  world: World
  plant: Plant | undefined
  tick: number
  onBack: () => void
  onSelectPlant: (id: number | null) => void
}

function zoneLabel(zone: 'soil' | 'air'): string {
  return zone === 'soil' ? 'почва' : 'воздух'
}

export default function GenomeExplorerScreen({
  world,
  plant,
  tick,
  onBack,
  onSelectPlant,
}: Props) {
  const [selectedCellId, setSelectedCellId] = useState<number | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [autoPlay, setAutoPlay] = useState(false)

  const trace = useMemo<GrowthVmTrace | null>(() => {
    if (!plant || plant.dead) return null
    return traceGrowthVM(plant, world.occupancy, world.light, world.minerals, world.rng)
  }, [plant, tick, world])

  const lines = useMemo(
    () => (plant ? disassemble(plant.genome) : []),
    [plant?.genome.code],
  )

  const runs = trace?.runs ?? []
  const activeRun: MeristemRunTrace | undefined = useMemo(() => {
    if (runs.length === 0) return undefined
    if (selectedCellId != null) {
      return runs.find((r) => r.cellId === selectedCellId) ?? runs[0]
    }
    return runs[0]
  }, [runs, selectedCellId])

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedCellId(null)
      return
    }
    if (selectedCellId == null || !runs.some((r) => r.cellId === selectedCellId)) {
      setSelectedCellId(runs[0].cellId)
    }
  }, [runs, selectedCellId])

  useEffect(() => {
    setStepIndex(0)
  }, [activeRun?.cellId, tick])

  const maxStep = activeRun ? Math.max(0, activeRun.steps.length - 1) : 0
  const currentStep = activeRun?.steps[stepIndex]

  useEffect(() => {
    if (!autoPlay || !activeRun) return
    if (stepIndex >= maxStep) {
      setAutoPlay(false)
      return
    }
    const t = window.setTimeout(() => setStepIndex((s) => s + 1), 650)
    return () => window.clearTimeout(t)
  }, [autoPlay, stepIndex, maxStep, activeRun])

  const highlightedIp = currentStep?.ip ?? -1

  const handleRefreshTrace = useCallback(() => {
    setStepIndex(0)
    setAutoPlay(false)
  }, [])

  if (!plant) {
    return (
      <div className="genome-explorer genome-explorer--empty">
        <div className="genome-explorer__toolbar">
          <button type="button" onClick={onBack}>
            ← Назад
          </button>
        </div>
        <p className="genome-explorer__empty-msg">
          Выберите живое растение на поле симуляции и нажмите «Исследовать геном», или кликните
          по растению в режиме эволюции / лаборатории.
        </p>
        {world.plants.filter((p) => !p.dead).length > 0 && (
          <>
            <h3>Живые растения</h3>
            <ul className="genome-explorer__plant-list">
              {world.plants
                .filter((p) => !p.dead)
                .map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => onSelectPlant(p.id)}>
                      Растение #{p.id} — {p.cells.length} кл., возраст {p.age}
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </div>
    )
  }

  const g = plant.genome
  const sprouts = plant.cells.filter((c) => c.type === 'SPROUT')

  return (
    <div className="genome-explorer">
      <div className="genome-explorer__toolbar">
        <button type="button" onClick={onBack}>
          ← Назад к симуляции
        </button>
        <span className="genome-explorer__title">
          Исследование генома #{plant.id} · тик {tick}
        </span>
        <button type="button" onClick={handleRefreshTrace}>
          Обновить трассировку
        </button>
      </div>

      <div className="genome-explorer__meta panel">
        <div>
          Клеток: {plant.cells.length} · мерistem: {sprouts.length} · энергия:{' '}
          {plantTotalEnergy(plant).toFixed(1)} · бюджет роста:{' '}
          {trace?.growActionBudget ?? plantGrowActionBudget(plant)} (корни:{' '}
          {trace?.rootBudget ?? '—'})
        </div>
        <div>
          maxAge: {genomeMaxAge(g)} · seedReserve: {genomeSeedReserve(g)} · высота ~{' '}
          {Math.round(genomeHeightCap(g) * WORLD.SOIL_Y)} кл. · корни ~{' '}
          {Math.round(genomeDepthCap(g) * (WORLD.H - WORLD.SOIL_Y))} кл.
        </div>
        <div>
          тень (&gt;{SHADED_SPROUT_LAYERS} сл.): {shadeSenescenceLabel(genomeShadeSenescence(g))}{' '}
          · двойной рост: {doubleGrowthLabel(genomeDoubleGrowth(g))}
        </div>
      </div>

      <div className="genome-explorer__grid">
        <section className="panel genome-explorer__code">
          <h2>Расшифровка генома</h2>
          <p className="genome-explorer__hint">
            Наведите на инструкцию — появится пояснение. Подсвечена текущая строка трассировки.
          </p>
          <div className="gene-list genome-explorer__gene-list">
            {lines.map((line) => {
              const active = line.index === highlightedIp
              return (
                <div
                  key={line.index}
                  className={`gene-item genome-explorer__gene-item${active ? ' genome-explorer__gene-item--active' : ''}${line.structural ? ' genome-explorer__gene-item--structural' : ''}`}
                  title={disasmLineHelp(line.text)}
                >
                  <span className="genome-explorer__gene-ip">
                    {line.index.toString().padStart(3, ' ')}
                  </span>
                  <span className="genome-explorer__gene-text">{line.text}</span>
                  <span className="genome-explorer__gene-tip" aria-hidden>
                    ?
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel genome-explorer__sim">
          <h2>Пошаговая трассировка VM</h2>
          <p className="genome-explorer__hint">
            Симуляция одного тика роста: для каждой мерistemы (SPROUT) программа читается сверху
            вниз. Показаны проверки сенсоров, стек и результат каждой команды.
          </p>

          {runs.length === 0 ? (
            <p className="genome-explorer__empty-msg">
              Нет активных мерistem — у растения нет клеток SPROUT для исполнения генома.
            </p>
          ) : (
            <>
              <div className="genome-explorer__cells">
                <span className="genome-explorer__cells-label">Мерistemы за тик:</span>
                {runs.map((run) => (
                  <button
                    key={run.cellId}
                    type="button"
                    className={
                      run.cellId === activeRun?.cellId
                        ? 'genome-explorer__cell-btn active'
                        : 'genome-explorer__cell-btn'
                    }
                    onClick={() => {
                      setSelectedCellId(run.cellId)
                      setStepIndex(0)
                      setAutoPlay(false)
                    }}
                  >
                    #{run.cellId} ({run.x},{run.y}) {zoneLabel(run.zone)}
                  </button>
                ))}
              </div>

              {activeRun && (
                <>
                  <div className="genome-explorer__run-header">
                    <div>
                      Клетка #{activeRun.cellId} · ({activeRun.x}, {activeRun.y}) ·{' '}
                      {zoneLabel(activeRun.zone)} · dir: {activeRun.initialDir}
                    </div>
                    <div className="genome-explorer__outcome">{activeRun.outcome}</div>
                  </div>

                  <details className="genome-explorer__sensors" open>
                    <summary>Сенсоры на старте прогона</summary>
                    <div className="genome-explorer__sensor-grid">
                      {activeRun.initialSensors.map((s) => (
                        <div key={s.name} className="genome-explorer__sensor" title={disasmLineHelp(`SENSE ${s.name}`)}>
                          <span className="genome-explorer__sensor-name">{s.name}</span>
                          <span className="genome-explorer__sensor-val">{s.value.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  </details>

                  <div className="genome-explorer__step-controls">
                    <button
                      type="button"
                      disabled={stepIndex <= 0}
                      onClick={() => setStepIndex(0)}
                    >
                      ⏮
                    </button>
                    <button
                      type="button"
                      disabled={stepIndex <= 0}
                      onClick={() => setStepIndex((s) => Math.max(0, s - 1))}
                    >
                      ◀ Шаг
                    </button>
                    <span className="genome-explorer__step-counter">
                      {stepIndex + 1} / {activeRun.steps.length}
                    </span>
                    <button
                      type="button"
                      disabled={stepIndex >= maxStep}
                      onClick={() => setStepIndex((s) => Math.min(maxStep, s + 1))}
                    >
                      Шаг ▶
                    </button>
                    <button
                      type="button"
                      disabled={stepIndex >= maxStep}
                      onClick={() => setStepIndex(maxStep)}
                    >
                      ⏭
                    </button>
                    <button
                      type="button"
                      className={autoPlay ? 'active' : ''}
                      onClick={() => setAutoPlay((p) => !p)}
                    >
                      {autoPlay ? '⏸ Пауза' : '▶ Авто'}
                    </button>
                  </div>

                  {currentStep && (
                    <div className="genome-explorer__step-detail">
                      <div className="genome-explorer__step-op">
                        <span
                          className="genome-explorer__step-text"
                          title={disasmLineHelp(currentStep.text)}
                        >
                          {currentStep.text}
                        </span>
                        {currentStep.ip >= 0 && (
                          <span className="genome-explorer__step-ip">ip={currentStep.ip}</span>
                        )}
                      </div>
                      <div className="genome-explorer__step-note">{currentStep.note}</div>
                      <div className="genome-explorer__step-stack">
                        <span>DIR: {currentStep.dir}</span>
                        <span>
                          Стек: {formatStack(currentStep.stackBefore)} →{' '}
                          {formatStack(currentStep.stackAfter)}
                        </span>
                      </div>
                      {currentStep.skippedNext && (
                        <div className="genome-explorer__step-flag">Пропущена следующая инструкция (IF)</div>
                      )}
                      {currentStep.structuralAttempt && (
                        <div
                          className={
                            currentStep.structuralSuccess
                              ? 'genome-explorer__step-flag genome-explorer__step-flag--ok'
                              : 'genome-explorer__step-flag genome-explorer__step-flag--fail'
                          }
                        >
                          {currentStep.structuralSuccess
                            ? 'Структурное действие выполнено'
                            : 'Структурное действие не прошло'}
                        </div>
                      )}
                      {currentStep.runEnded && (
                        <div className="genome-explorer__step-flag genome-explorer__step-flag--end">
                          Прогон завершён
                        </div>
                      )}
                    </div>
                  )}

                  <ol className="genome-explorer__step-log">
                    {activeRun.steps.map((step, i) => (
                      <li
                        key={step.stepIndex}
                        className={
                          i === stepIndex
                            ? 'genome-explorer__step-log-item genome-explorer__step-log-item--active'
                            : 'genome-explorer__step-log-item'
                        }
                      >
                        <button
                          type="button"
                          className="genome-explorer__step-log-btn"
                          onClick={() => {
                            setStepIndex(i)
                            setAutoPlay(false)
                          }}
                          title={disasmLineHelp(step.text)}
                        >
                          <span className="genome-explorer__step-log-num">{i + 1}</span>
                          <span className="genome-explorer__step-log-text">{step.text}</span>
                          <span className="genome-explorer__step-log-note">{step.note}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function formatStack(stack: number[]): string {
  if (stack.length === 0) return '[]'
  return `[${stack.map((v) => v.toFixed(2)).join(', ')}]`
}
