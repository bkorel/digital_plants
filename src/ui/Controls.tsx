import type { AppMode, ViewMode } from '../sim/types'

interface Props {
  viewMode: ViewMode
  seed: number
  appMode: AppMode
  onViewModeChange: (mode: ViewMode) => void
  onSeedChange: (seed: number) => void
}

const MODES: ViewMode[] = ['PLANTS', 'ANATOMY', 'TRACE', 'ENERGY', 'FLOWS']

const MODE_LABELS: Record<ViewMode, string> = {
  PLANTS: 'Растения',
  ANATOMY: 'Ткани',
  TRACE: 'Трассировка',
  ENERGY: 'Энергия',
  FLOWS: 'Потоки',
}

export default function Controls({
  viewMode,
  seed,
  appMode,
  onViewModeChange,
  onSeedChange,
}: Props) {
  return (
    <div className="panel">
      <h2>Отображение</h2>

      {appMode === 'EVOLUTION' && (
        <label>
          Сид ГПСЧ
          <input
            type="number"
            value={seed}
            onChange={(e) => onSeedChange(Number(e.target.value))}
          />
        </label>
      )}

      <h3>Режим отображения</h3>
      <div className="controls-row">
        {MODES.map((m) => (
          <button
            key={m}
            className={viewMode === m ? 'active' : ''}
            onClick={() => onViewModeChange(m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  )
}
