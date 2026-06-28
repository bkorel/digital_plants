import { useMemo, useState } from 'react'
import {
  disassemble,
  genomeDepthCap,
  genomeDoubleGrowth,
  genomeHeightCap,
  genomeMaxAge,
  genomeOriginLabel,
  genomeSeedReserve,
  genomeShadeSenescence,
  serializeGenome,
  doubleGrowthLabel,
  shadeSenescenceLabel,
} from '../sim/genome'
import { disasmLineHuman } from '../sim/genomeHelp'
import { SHADED_SPROUT_LAYERS, WORLD } from '../sim/config'
import { plantEnergyRatio, plantTotalEnergy } from '../sim/plant'
import type { AppMode, Genome, Plant, SavedGenome } from '../sim/types'

interface Props {
  plant: Plant | undefined
  collection: SavedGenome[]
  appMode: AppMode
  onSaveToCollection: (genome: Genome, name: string) => void
  onRemoveFromCollection: (id: string) => void
  onPlantFromCollection: (genome: Genome) => void
  onPlantFromPaste: (json: string) => void
  onExploreGenome?: () => void
}

export default function GenomePanel({
  plant,
  collection,
  appMode,
  onSaveToCollection,
  onRemoveFromCollection,
  onPlantFromCollection,
  onPlantFromPaste,
  onExploreGenome,
}: Props) {
  const [pasteText, setPasteText] = useState('')
  const [saveName, setSaveName] = useState('')

  const copyGenome = async () => {
    if (!plant) return
    const json = serializeGenome(plant.genome)
    await navigator.clipboard.writeText(json)
  }

  const handleSave = () => {
    if (!plant) return
    const name = saveName.trim() || `Растение #${plant.id}`
    onSaveToCollection(plant.genome, name)
    setSaveName('')
  }

  const handlePastePlant = () => {
    if (!pasteText.trim()) return
    onPlantFromPaste(pasteText)
    setPasteText('')
  }

  const handleRemove = (item: SavedGenome) => {
    if (!window.confirm(`Удалить «${item.name}» из коллекции?`)) return
    onRemoveFromCollection(item.id)
  }

  const collectionItem = (item: SavedGenome) => (
    <div key={item.id} className="collection-item">
      <span>{item.name}</span>
      <span className="collection-item__actions">
        <button type="button" onClick={() => onPlantFromCollection(item.genome)}>
          {appMode === 'LABORATORY' ? 'Посадить' : 'Выбрать место'}
        </button>
        <button type="button" className="btn-danger" onClick={() => handleRemove(item)}>
          Удалить
        </button>
      </span>
    </div>
  )

  const genomeCode = plant?.genome.code
  const lines = useMemo(
    () => (genomeCode ? disassemble({ code: genomeCode }) : []),
    [genomeCode],
  )
  const hex = useMemo(
    () => (genomeCode ? serializeGenome({ code: genomeCode }) : ''),
    [genomeCode],
  )

  if (!plant) {
    return (
      <div className="panel">
        <h2>Геном</h2>
        <p style={{ fontSize: '0.85rem', color: '#8a9a8a' }}>
          {appMode === 'LABORATORY'
            ? 'Выберите образец в панели лаборатории, введите геном вручную или кликните по растению.'
            : 'Кликните по растению на поле, чтобы посмотреть геном.'}
        </p>
        {(appMode === 'EVOLUTION' || appMode === 'LABORATORY') && (
          <>
            <h3>{appMode === 'LABORATORY' ? 'Подсадить геном' : 'Подсадить геном'}</h3>
            <textarea
              placeholder="Вставьте код генома (hex)..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button onClick={handlePastePlant}>Выбрать место</button>
          </>
        )}
        {collection.length > 0 && (appMode === 'EVOLUTION' || appMode === 'LABORATORY') && (
          <>
            <h3>Коллекция</h3>
            {collection.map(collectionItem)}
          </>
        )}
      </div>
    )
  }

  const g = plant.genome
  const energy = plantTotalEnergy(plant)
  const ratio = plantEnergyRatio(plant)

  return (
    <div className="panel">
      <h2>Геном #{plant.id}</h2>
      <div style={{ fontSize: '0.82rem', marginBottom: 8, color: '#aabaaa' }}>
        Возраст: {plant.age} | Энергия: {energy.toFixed(1)} ({(ratio * 100).toFixed(0)}%) | Клеток:{' '}
        {plant.cells.length}
      </div>

      <div style={{ fontSize: '0.8rem', marginBottom: 8 }}>
        <div>
          тип: {genomeOriginLabel(g)} | байт: {g.code.length} | maxAge: {genomeMaxAge(g)} | seedReserve:{' '}
          {genomeSeedReserve(g)}
        </div>
        <div>
          потолок высоты: ~{Math.round(genomeHeightCap(g) * WORLD.SOIL_Y)} кл. | глубина корней: ~
          {Math.round(genomeDepthCap(g) * (WORLD.H - WORLD.SOIL_Y))} кл.
        </div>
        <div>
          тень (&gt;{SHADED_SPROUT_LAYERS} сл.): {shadeSenescenceLabel(genomeShadeSenescence(g))}
        </div>
        <div>двойной рост: {doubleGrowthLabel(genomeDoubleGrowth(g))}</div>
      </div>

      <div className="controls-row">
        <button onClick={copyGenome}>Копировать геном</button>
        {onExploreGenome && (
          <button type="button" className="btn-explore" onClick={onExploreGenome}>
            Исследовать геном
          </button>
        )}
        <input
          type="text"
          placeholder="Имя в коллекции"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={handleSave}>В коллекцию</button>
      </div>

      <div className="gene-list">
        {lines.map((line) => (
          <div
            key={line.index}
            className={`gene-item${line.structural ? ' gene-item--structural' : ''}`}
          >
            <div className="gene-item__row">
              <span className="gene-item__ip">{line.index.toString().padStart(3, ' ')}</span>
              <code className="gene-item__hex">{line.bytesHex}</code>
              <span className="gene-item__text">{line.text}</span>
            </div>
            <div className="gene-item__human">{disasmLineHuman(line.text)}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '0.7rem',
          wordBreak: 'break-all',
          color: '#7a8a7a',
          margin: '6px 0',
        }}
      >
        {hex}
      </div>

      {(appMode === 'EVOLUTION' || appMode === 'LABORATORY') && (
        <>
          <h3>{appMode === 'LABORATORY' ? 'Подсадить другой геном' : 'Подсадить геном'}</h3>
          <textarea
            placeholder="Вставьте код генома (hex)..."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button onClick={handlePastePlant}>
            {appMode === 'LABORATORY' ? 'Посадить в лаборатории' : 'Подсадить'}
          </button>

          {collection.length > 0 && (
            <>
              <h3>Коллекция</h3>
              {collection.map(collectionItem)}
            </>
          )}
        </>
      )}
    </div>
  )
}
