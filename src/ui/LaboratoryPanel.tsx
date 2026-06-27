import { useState } from 'react'
import type { SavedGenome } from '../sim/types'

interface Props {
  collection: SavedGenome[]
  activeSpecimen: SavedGenome | null
  plantAlive: boolean
  onPlantSpecimen: (item: SavedGenome) => void
  onPlantManualGenome: (hex: string, name?: string) => void
  onRemoveFromCollection: (id: string) => void
  onRestartSpecimen: () => void
  onChangeSpecimen: () => void
  onExitLaboratory: () => void
}

export default function LaboratoryPanel({
  collection,
  activeSpecimen,
  plantAlive,
  onPlantSpecimen,
  onPlantManualGenome,
  onRemoveFromCollection,
  onRestartSpecimen,
  onChangeSpecimen,
  onExitLaboratory,
}: Props) {
  const [manualHex, setManualHex] = useState('')
  const [manualName, setManualName] = useState('')

  const handlePlantManual = () => {
    if (!manualHex.trim()) return
    onPlantManualGenome(manualHex, manualName)
    setManualHex('')
    setManualName('')
  }

  const handleRemove = (item: SavedGenome) => {
    if (!window.confirm(`Удалить «${item.name}» из коллекции?`)) return
    onRemoveFromCollection(item.id)
  }

  return (
    <div className="panel laboratory-panel">
      <h2>Лаборатория</h2>
      <p className="laboratory-hint">
        Пустой мир: одно растение, без соседей; семена прорастают в пределах ±1 клетки.
        Эволюция на поле сохраняется при возврате.
      </p>

      {!activeSpecimen ? (
        <>
          <h3>Из коллекции</h3>
          {collection.length === 0 ? (
            <p className="laboratory-empty">
              Коллекция пуста — можно ввести геном вручную ниже или забрать растение из
              эволюции.
            </p>
          ) : (
            <ul className="laboratory-list">
              {collection.map((item) => (
                <li key={item.id} className="laboratory-list__item">
                  <span className="laboratory-list__name">{item.name}</span>
                  <span className="laboratory-list__actions">
                    <button type="button" onClick={() => onPlantSpecimen(item)}>
                      Посадить
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleRemove(item)}
                    >
                      Удалить
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3>Ввести геном вручную</h3>
          <input
            type="text"
            placeholder="Имя образца (необязательно)"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            style={{ width: '100%', marginBottom: 6 }}
          />
          <textarea
            placeholder="Hex-код генома..."
            value={manualHex}
            onChange={(e) => setManualHex(e.target.value)}
          />
          <button type="button" onClick={handlePlantManual}>
            Посадить геном
          </button>
        </>
      ) : (
        <>
          <div className="laboratory-active">
            <span className="laboratory-active__label">Образец</span>
            <span className="laboratory-active__name">{activeSpecimen.name}</span>
            {!plantAlive && (
              <span className="laboratory-active__dead">растение погибло</span>
            )}
          </div>
          <div className="controls-row">
            <button type="button" onClick={onRestartSpecimen}>
              Пересадить
            </button>
            <button type="button" onClick={onChangeSpecimen}>
              Другой образец
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => handleRemove(activeSpecimen)}
            >
              Удалить из коллекции
            </button>
          </div>

          <h3>Другой геном</h3>
          <input
            type="text"
            placeholder="Имя образца (необязательно)"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            style={{ width: '100%', marginBottom: 6 }}
          />
          <textarea
            placeholder="Hex-код генома..."
            value={manualHex}
            onChange={(e) => setManualHex(e.target.value)}
          />
          <button type="button" onClick={handlePlantManual}>
            Посадить другой геном
          </button>
        </>
      )}

      <button type="button" className="laboratory-exit" onClick={onExitLaboratory}>
        ← Вернуться к эволюции
      </button>
    </div>
  )
}
