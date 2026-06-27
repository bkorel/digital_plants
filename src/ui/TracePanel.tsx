import { EVENT_COLORS, EVENT_LABELS, type PlantTickEvent } from '../sim/plantEvents'

interface Props {
  plantId: number | null
  tick: number
  events: PlantTickEvent[]
}

export default function TracePanel({ plantId, tick, events }: Props) {
  if (plantId == null) {
    return (
      <div className="panel trace-panel">
        <h2>Трассировка</h2>
        <p className="trace-hint">Кликните по растению на поле — откроется пошаговая трассировка его изменений.</p>
      </div>
    )
  }

  const mine = events.filter((e) => e.plantId === plantId)

  return (
    <div className="panel trace-panel">
      <h2>Трассировка #{plantId}</h2>
      <p className="trace-hint">
        Тик {tick}: {mine.length === 0 ? 'без изменений' : `${mine.length} событий`}. Нажмите «Шаг» для следующего
        тика.
      </p>
      {mine.length > 0 && (
        <ul className="trace-list">
          {mine.map((ev, i) => (
            <li key={`${ev.kind}-${ev.x}-${ev.y}-${i}`}>
              <span className="trace-dot" style={{ background: EVENT_COLORS[ev.kind] }} />
              <span className="trace-kind">{EVENT_LABELS[ev.kind]}</span>
              <span className="trace-pos">
                ({ev.x}, {ev.y})
                {ev.fromX != null && ev.fromY != null ? ` ← (${ev.fromX}, ${ev.fromY})` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="trace-legend">
        {(['GROW', 'BRANCH', 'ROOT', 'STEM', 'SEED', 'SEED_DROP', 'SPIKE', 'SHOOT', 'GERMINATE', 'DEATH'] as const).map((k) => (
          <span key={k} className="trace-legend-item">
            <span className="trace-dot" style={{ background: EVENT_COLORS[k] }} />
            {EVENT_LABELS[k]}
          </span>
        ))}
      </div>
    </div>
  )
}
