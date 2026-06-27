import type { WorldStats } from '../sim/types'

interface Props {
  stats: WorldStats
}

export default function StatsPanel({ stats }: Props) {
  return (
    <div className="panel">
      <h2>Статистика</h2>
      <div className="stat-grid">
        <div className="stat-item tick">
          <div className="label">Ход (итерация)</div>
          <div className="value">{stats.tick}</div>
        </div>
        <div className="stat-item">
          <div className="label">Живых растений</div>
          <div className="value">{stats.alivePlants}</div>
        </div>
        <div className="stat-item">
          <div className="label">Энергия растений</div>
          <div className="value">{stats.plantEnergy.toFixed(1)}</div>
        </div>
        <div className="stat-item">
          <div className="label">Энергия почвы</div>
          <div className="value">{stats.soilEnergy.toFixed(1)}</div>
        </div>
        <div className="stat-item">
          <div className="label">Семян в почве</div>
          <div className="value">{stats.seedsInSoil}</div>
        </div>
        <div className="stat-item">
          <div className="label">Видов (оценка)</div>
          <div className="value">{stats.speciesEstimate}</div>
        </div>
        <div className="stat-item">
          <div className="label">Средний возраст</div>
          <div className="value">{stats.avgAge.toFixed(1)}</div>
        </div>
        <div className="stat-item">
          <div className="label">Средняя высота</div>
          <div className="value">{stats.avgHeight.toFixed(1)}</div>
        </div>
      </div>
    </div>
  )
}
