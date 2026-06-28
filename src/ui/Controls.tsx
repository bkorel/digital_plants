import type { AppMode, ViewMode } from '../sim/types'

interface Props {
  viewMode: ViewMode
  seed: number
  appMode: AppMode
  lastRestartRandomGenomes?: boolean
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
  lastRestartRandomGenomes,
  onViewModeChange,
  onSeedChange,
}: Props) {
  return (
    <div className="panel">
      <h2>Отображение</h2>

      {appMode === 'EVOLUTION' && (
        <>
          <label>
            Сид ГПСЧ
            <input
              type="number"
              value={seed}
              onChange={(e) => onSeedChange(Number(e.target.value))}
            />
          </label>
          <p className="controls-hint">
            Стартовые геномы: случайный байткод (6–160 байт), без шаблона «до крыши».
            {lastRestartRandomGenomes
              ? ' Последний запуск — «Рестарт случайный» (новый сид).'
              : ' «Рестарт» — тот же сид, другая раскладка клеток.'}
          </p>
        </>
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
