import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  disassemble,
  genomeDepthCap,
  genomeDoubleGrowth,
  genomeHeightCap,
  genomeMaxAge,
  genomeSeedReserve,
  genomeShadeSenescence,
  genomeShootRange,
  doubleGrowthLabel,
  shadeSenescenceLabel,
} from '../sim/genome'
import {
  disasmLineHelp,
  disasmLineHuman,
  formatStack,
  vmStepSummary,
} from '../sim/genomeHelp'
import {
  plantGrowActionBudget,
  plantTotalEnergy,
  traceGrowthVM,
  type GrowthVmTrace,
  type MeristemRunTrace,
  type VmStepTrace,
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
  const [expandedHelpIp, setExpandedHelpIp] = useState<number | null>(null)
  const [showLegend, setShowLegend] = useState(true)
  const activeGeneRef = useRef<HTMLDivElement | null>(null)

  const trace = useMemo<GrowthVmTrace | null>(() => {
    if (!plant || plant.dead) return null
    return traceGrowthVM(plant, world.plants, world.occupancy, world.light, world.minerals, world.rng)
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
  const highlightedIp = currentStep?.ip ?? -1

  useEffect(() => {
    activeGeneRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [highlightedIp])

  useEffect(() => {
    if (!autoPlay || !activeRun) return
    if (stepIndex >= maxStep) {
      setAutoPlay(false)
      return
    }
    const t = window.setTimeout(() => setStepIndex((s) => s + 1), 650)
    return () => window.clearTimeout(t)
  }, [autoPlay, stepIndex, maxStep, activeRun])

  const handleRefreshTrace = useCallback(() => {
    setStepIndex(0)
    setAutoPlay(false)
  }, [])

  const jumpToStepForIp = useCallback(
    (ip: number) => {
      if (!activeRun) return
      const idx = activeRun.steps.findIndex((s) => s.ip === ip)
      if (idx >= 0) {
        setStepIndex(idx)
        setAutoPlay(false)
      }
    },
    [activeRun],
  )

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
        <label className="genome-explorer__legend-toggle">
          <input
            type="checkbox"
            checked={showLegend}
            onChange={(e) => setShowLegend(e.target.checked)}
          />
          Справка по опкодам
        </label>
      </div>

      <div className="genome-explorer__meta panel">
        <div className="genome-explorer__meta-row">
          <span>Клеток: {plant.cells.length}</span>
          <span>Мерistem: {sprouts.length}</span>
          <span>Энергия: {plantTotalEnergy(plant).toFixed(1)}</span>
          <span>
            Бюджет роста: {trace?.growActionBudget ?? plantGrowActionBudget(plant)} (корни:{' '}
            {trace?.rootBudget ?? '—'})
          </span>
        </div>
        <div className="genome-explorer__meta-row">
          <span>maxAge: {genomeMaxAge(g)}</span>
          <span>seedReserve: {genomeSeedReserve(g)}</span>
          <span>высота ~{Math.round(genomeHeightCap(g) * WORLD.SOIL_Y)} кл.</span>
          <span>корни ~{Math.round(genomeDepthCap(g) * (WORLD.H - WORLD.SOIL_Y))} кл.</span>
        </div>
        <div className="genome-explorer__meta-row">
          <span>тень (&gt;{SHADED_SPROUT_LAYERS} сл.): {shadeSenescenceLabel(genomeShadeSenescence(g))}</span>
          <span>двойной рост: {doubleGrowthLabel(genomeDoubleGrowth(g))}</span>
          <span>дальность SHOOT: {genomeShootRange(g)} кл.</span>
          <span>байт в геноме: {g.code.length}</span>
        </div>
      </div>

      {showLegend && (
        <details className="panel genome-explorer__legend" open>
          <summary>Как читать байткод</summary>
          <div className="genome-explorer__legend-body">
            <p>
              Программа читается <strong>сверху вниз</strong>. Сначала на стек кладутся сенсоры и
              сравнения; структурные команды — <code>ACTION(WHERE, WHEN)</code>: WHERE — направление,
              WHEN — условие (стек ≥ порог, или «prev ok / prev fail»).
            </p>
            <ul>
              <li>
                <code>DIR</code> — WHERE для <code>GROW</code>/<code>SEED</code> и сенсоров по
                направлению
              </li>
              <li>
                <code>GROW / BRANCH / SEED / SPIKE / SHOOT</code> — действия; зелёные строки в
                списке
              </li>
              <li>
                <code>SENSE PREV_OK / PREV_FAIL</code> — исход предыдущего структурного действия
              </li>
              <li>
                <code>WHEN prev ok</code> / <code>WHEN prev fail</code> — встроенный IF по прошлому
                действию
              </li>
            </ul>
          </div>
        </details>
      )}

      <div className="genome-explorer__layout">
        <section className="panel genome-explorer__code">
          <h2>Расшифровка генома</h2>
          <p className="genome-explorer__hint">
            Клик по строке — развернуть пояснение. Подсветка — текущий шаг трассировки. Клик по
            ▶ — перейти к шагу VM.
          </p>
          <div className="genome-explorer__gene-list">
            {lines.map((line) => {
              const active = line.index === highlightedIp
              const expanded = expandedHelpIp === line.index
              const hasTraceStep = activeRun?.steps.some((s) => s.ip === line.index)
              return (
                <div
                  key={line.index}
                  ref={active ? activeGeneRef : undefined}
                  className={`genome-explorer__gene-item${active ? ' genome-explorer__gene-item--active' : ''}${line.structural ? ' genome-explorer__gene-item--structural' : ''}`}
                >
                  <div className="genome-explorer__gene-row">
                    <span className="genome-explorer__gene-ip">{line.index.toString().padStart(3, ' ')}</span>
                    <code className="genome-explorer__gene-bytes">{line.bytesHex}</code>
                    <code className="genome-explorer__gene-text">{line.text}</code>
                    {hasTraceStep && (
                      <button
                        type="button"
                        className="genome-explorer__gene-jump"
                        title="Перейти к шагу трассировки"
                        onClick={() => jumpToStepForIp(line.index)}
                      >
                        ▶
                      </button>
                    )}
                    <button
                      type="button"
                      className="genome-explorer__gene-help-btn"
                      aria-expanded={expanded}
                      title="Пояснение"
                      onClick={() =>
                        setExpandedHelpIp(expanded ? null : line.index)
                      }
                    >
                      {expanded ? '−' : '?'}
                    </button>
                  </div>
                  <div className="genome-explorer__gene-human">{disasmLineHuman(line.text)}</div>
                  {expanded && (
                    <div className="genome-explorer__gene-help">{disasmLineHelp(line.text)}</div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel genome-explorer__sim">
          <h2>Трассировка VM (один тик)</h2>

          {runs.length === 0 ? (
            <p className="genome-explorer__empty-msg">
              Нет активных мерistem — у растения нет клеток SPROUT для исполнения генома.
            </p>
          ) : (
            <>
              <div className="genome-explorer__cells">
                <span className="genome-explorer__cells-label">Мерistemы:</span>
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
                <div className="genome-explorer__sim-body">
                  <div className="genome-explorer__run-header">
                    <div>
                      Клетка #{activeRun.cellId} · ({activeRun.x}, {activeRun.y}) ·{' '}
                      {zoneLabel(activeRun.zone)} · dir: {activeRun.initialDir}
                    </div>
                    <div className="genome-explorer__outcome">{activeRun.outcome}</div>
                  </div>

                  <details className="genome-explorer__sensors" open>
                    <summary>Сенсоры на старте ({activeRun.initialSensors.length})</summary>
                    <div className="genome-explorer__sensor-grid">
                      {activeRun.initialSensors.map((s) => (
                        <div
                          key={s.name}
                          className="genome-explorer__sensor"
                          title={disasmLineHelp(`SENSE ${s.name}`)}
                        >
                          <span className="genome-explorer__sensor-name">{s.name}</span>
                          <span className="genome-explorer__sensor-val">{s.value.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  </details>

                  <div className="genome-explorer__step-controls">
                    <button type="button" disabled={stepIndex <= 0} onClick={() => setStepIndex(0)}>
                      ⏮
                    </button>
                    <button
                      type="button"
                      disabled={stepIndex <= 0}
                      onClick={() => setStepIndex((s) => Math.max(0, s - 1))}
                    >
                      ◀
                    </button>
                    <span className="genome-explorer__step-counter">
                      шаг {stepIndex + 1} / {activeRun.steps.length}
                    </span>
                    <button
                      type="button"
                      disabled={stepIndex >= maxStep}
                      onClick={() => setStepIndex((s) => Math.min(maxStep, s + 1))}
                    >
                      ▶
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

                  {currentStep && <StepDetailCard step={currentStep} />}

                  <div className="genome-explorer__step-log-wrap">
                    <h3 className="genome-explorer__step-log-title">Журнал шагов</h3>
                    <ol className="genome-explorer__step-log">
                      {activeRun.steps.map((step, i) => (
                        <StepLogItem
                          key={step.stepIndex}
                          step={step}
                          active={i === stepIndex}
                          onSelect={() => {
                            setStepIndex(i)
                            setAutoPlay(false)
                          }}
                        />
                      ))}
                    </ol>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function StepDetailCard({ step }: { step: VmStepTrace }) {
  return (
    <div className="genome-explorer__step-detail">
      <div className="genome-explorer__step-detail-head">
        <code className="genome-explorer__step-text">{step.text}</code>
        {step.ip >= 0 && <span className="genome-explorer__step-ip">ip = {step.ip}</span>}
      </div>
      <p className="genome-explorer__step-human">{disasmLineHuman(step.text)}</p>
      <pre className="genome-explorer__step-summary">{vmStepSummary(step)}</pre>
      <div className="genome-explorer__step-flags">
        {step.skippedNext && (
          <span className="genome-explorer__step-flag">IF → пропуск</span>
        )}
        {step.structuralAttempt && (
          <span
            className={
              step.structuralSuccess
                ? 'genome-explorer__step-flag genome-explorer__step-flag--ok'
                : 'genome-explorer__step-flag genome-explorer__step-flag--fail'
            }
          >
            {step.structuralSuccess ? 'Действие OK' : 'Действие FAIL'}
          </span>
        )}
        {step.runEnded && (
          <span className="genome-explorer__step-flag genome-explorer__step-flag--end">
            Конец прогона
          </span>
        )}
      </div>
    </div>
  )
}

function StepLogItem({
  step,
  active,
  onSelect,
}: {
  step: VmStepTrace
  active: boolean
  onSelect: () => void
}) {
  return (
    <li
      className={
        active
          ? 'genome-explorer__step-log-item genome-explorer__step-log-item--active'
          : 'genome-explorer__step-log-item'
      }
    >
      <button type="button" className="genome-explorer__step-log-btn" onClick={onSelect}>
        <div className="genome-explorer__step-log-head">
          <span className="genome-explorer__step-log-num">{step.stepIndex + 1}</span>
          <code className="genome-explorer__step-log-text">{step.text}</code>
          {step.ip >= 0 && <span className="genome-explorer__step-log-ip">ip={step.ip}</span>}
        </div>
        <div className="genome-explorer__step-log-human">{disasmLineHuman(step.text)}</div>
        <div className="genome-explorer__step-log-note">{step.note}</div>
        <div className="genome-explorer__step-log-stack">
          DIR {step.dir} · стек {formatStack(step.stackBefore)} → {formatStack(step.stackAfter)}
        </div>
      </button>
    </li>
  )
}
