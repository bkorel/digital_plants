import { useEffect, useRef, useState } from 'react'
import type { AppMode } from '../sim/types'
import { SPEED_STEPS, formatSpeed, speedToIndex } from './speed'

interface Props {
  paused: boolean
  speed: number
  appMode: AppMode
  autoRandomRestartOnExtinction: boolean
  evolutionSavedAt?: number | null
  onPauseToggle: () => void
  onStep: () => void
  onRestart: () => void
  onRandomRestart?: () => void
  onSaveEvolution?: () => boolean
  onLoadEvolution?: () => void
  onAutoRandomRestartChange: (enabled: boolean) => void
  onSpeedChange: (speed: number) => void
}

function formatSavedAt(savedAt: number): string {
  return new Date(savedAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SimulationBar({
  paused,
  speed,
  appMode,
  autoRandomRestartOnExtinction,
  evolutionSavedAt = null,
  onPauseToggle,
  onStep,
  onRestart,
  onRandomRestart,
  onSaveEvolution,
  onLoadEvolution,
  onAutoRandomRestartChange,
  onSpeedChange,
}: Props) {
  const [saveNotice, setSaveNotice] = useState(false)
  const saveNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (saveNoticeTimerRef.current) clearTimeout(saveNoticeTimerRef.current)
    }
  }, [])

  const handleSaveClick = () => {
    if (!onSaveEvolution?.()) return
    setSaveNotice(true)
    if (saveNoticeTimerRef.current) clearTimeout(saveNoticeTimerRef.current)
    saveNoticeTimerRef.current = setTimeout(() => setSaveNotice(false), 2000)
  }

  return (
    <div className="simulation-bar">
      <div className="controls-row simulation-bar__buttons">
        <button type="button" onClick={onPauseToggle}>
          {paused ? '▶ Продолжить' : '⏸ Пауза'}
        </button>
        <button type="button" onClick={onStep}>
          Шаг (пробел)
        </button>
        <button
          type="button"
          onClick={onRestart}
          title={
            appMode === 'EVOLUTION'
              ? 'Тот же сид из панели «Отображение», новые случайные геномы'
              : undefined
          }
        >
          {appMode === 'LABORATORY' ? 'Пересадить' : 'Рестарт'}
        </button>
        {appMode === 'EVOLUTION' && onRandomRestart && (
          <button
            type="button"
            className="simulation-bar__random-restart"
            onClick={onRandomRestart}
            title="Новый сид ГПСЧ и полностью случайный геном у каждого растения (без шаблона роста до крыши)"
          >
            Рестарт случайный
          </button>
        )}
        {appMode === 'EVOLUTION' && onSaveEvolution && onLoadEvolution && (
          <>
            <button
              type="button"
              className="simulation-bar__save"
              onClick={handleSaveClick}
              title="Сохранить мир в браузере (продолжить после перезагрузки страницы)"
            >
              Сохранить
            </button>
            {saveNotice && (
              <span className="simulation-bar__save-notice" role="status">
                Сохранено
              </span>
            )}
            <button
              type="button"
              className="simulation-bar__load"
              onClick={onLoadEvolution}
              title={
                evolutionSavedAt != null
                  ? `Загрузить сохранение от ${formatSavedAt(evolutionSavedAt)}`
                  : 'Загрузить сохранение из браузера'
              }
            >
              Загрузить
            </button>
          </>
        )}
        {appMode === 'EVOLUTION' && (
          <label
            className="simulation-bar__auto-restart"
            title="Как только не осталось живых растений и семян — сразу «Рестарт случайный» (в том числе до 1000-го хода)"
          >
            <input
              type="checkbox"
              checked={autoRandomRestartOnExtinction}
              onChange={(e) => onAutoRandomRestartChange(e.target.checked)}
            />
            Рестарт случ. при вымирании
          </label>
        )}
      </div>

      <label className="simulation-bar__speed">
        <span className="simulation-bar__speed-label">Скорость</span>
        <input
          type="range"
          min={0}
          max={SPEED_STEPS.length - 1}
          value={speedToIndex(speed)}
          onChange={(e) => onSpeedChange(SPEED_STEPS[Number(e.target.value)] ?? 1)}
        />
        <span className="simulation-bar__speed-value">{formatSpeed(speed)}</span>
      </label>
    </div>
  )
}
