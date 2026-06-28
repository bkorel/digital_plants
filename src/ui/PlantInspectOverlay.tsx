import { computePlantInspectStats } from '../sim/plant'
import type { Plant } from '../sim/types'

interface Props {
  plant: Plant
  showTakeButton: boolean
  onTakeToLaboratory: () => void
  onExploreGenome?: () => void
  onCompareGenomes?: () => void
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits)
}

export default function PlantInspectOverlay({
  plant,
  showTakeButton,
  onTakeToLaboratory,
  onExploreGenome,
  onCompareGenomes,
}: Props) {
  const s = computePlantInspectStats(plant)

  return (
    <div className="plant-inspect">
      <div className="plant-inspect__title">Растение #{plant.id}</div>
      <dl className="plant-inspect__grid">
        <dt>Высота</dt>
        <dd>{s.height} кл.</dd>
        <dt>Глубина корней</dt>
        <dd>{s.rootDepth} кл.</dd>
        <dt>Стебли</dt>
        <dd>{s.stems}</dd>
        <dt>Ростки</dt>
        <dd>{s.sprouts}</dd>
        <dt>Корни</dt>
        <dd>{s.roots}</dd>
        <dt>Возраст</dt>
        <dd>{s.age} тик.</dd>
        <dt>Вода (снабжение)</dt>
        <dd>{(s.waterLevel * 100).toFixed(0)}%</dd>
        <dt>Расход энергии</dt>
        <dd>{fmt(s.upkeepSpent)}</dd>
        <dt>Семян создано</dt>
        <dd>{s.seedsCreated}</dd>
        <dt>Энергия (фото)</dt>
        <dd>{fmt(s.photoEnergyGained)}</dd>
        <dt>Энергия (минералы)</dt>
        <dd>{fmt(s.mineralEnergyGained)}</dd>
        <dt>Энергия сейчас</dt>
        <dd>{fmt(s.totalEnergy)}</dd>
      </dl>
      <div className="plant-inspect__actions">
        {onExploreGenome && (
          <button type="button" className="plant-inspect__explore-btn" onClick={onExploreGenome}>
            Исследовать геном
          </button>
        )}
        {onCompareGenomes && (
          <button type="button" className="plant-inspect__compare-btn" onClick={onCompareGenomes}>
            Сравнить геномы
          </button>
        )}
        {showTakeButton && (
          <button type="button" className="plant-inspect__lab-btn" onClick={onTakeToLaboratory}>
            Забрать в лабораторию
          </button>
        )}
      </div>
    </div>
  )
}
