import type { AppMode } from '../sim/types'
import { SPEED_STEPS, formatSpeed, speedToIndex } from './speed'

interface Props {
  paused: boolean
  speed: number
  appMode: AppMode
  onPauseToggle: () => void
  onStep: () => void
  onRestart: () => void
  onSpeedChange: (speed: number) => void
}

export default function SimulationBar({
  paused,
  speed,
  appMode,
  onPauseToggle,
  onStep,
  onRestart,
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
        <button type="button" onClick={onRestart}>
          {appMode === 'LABORATORY' ? 'Пересадить' : 'Рестарт'}
        </button>
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
