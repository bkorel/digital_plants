import type { AppMode } from '../sim/types'
import { SPEED_STEPS, formatSpeed, speedToIndex } from './speed'

interface Props {
  paused: boolean
  speed: number
  appMode: AppMode
  autoRandomRestartOnExtinction: boolean
  onPauseToggle: () => void
  onStep: () => void
  onRestart: () => void
  onRandomRestart?: () => void
  onAutoRandomRestartChange: (enabled: boolean) => void
  onSpeedChange: (speed: number) => void
}

export default function SimulationBar({
  paused,
  speed,
  appMode,
  autoRandomRestartOnExtinction,
  onPauseToggle,
  onStep,
  onRestart,
  onRandomRestart,
  onAutoRandomRestartChange,
  onSpeedChange,
}: Props) {
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
