import {
  DOUBLE_GROW_COST_MULT,
  MAX_SHADE_LAYERS,
  SHADE_SCATTER_INTERVAL,
  SHADED_SPROUT_LAYERS,
  STEM_PHOTO_GAIN_FACTOR,
} from '../sim/config'

export default function WorldRulesPanel() {
  return (
    <div className="panel world-rules-panel">
      <h2>Правила мира</h2>
      <ul className="world-rules-list">
        <li>
          Фотосинтез пропадает при более чем <strong>{MAX_SHADE_LAYERS}</strong> эффективных
          слоях тени. Ниже последней клетки-затенителя в колонке каждые{' '}
          <strong>{SHADE_SCATTER_INTERVAL}</strong> клеток тень ослабевает вдвое (рассеивание
          света). У ствола (STEM) выход в <strong>{STEM_PHOTO_GAIN_FACTOR * 100}%</strong> от
          мерistemы (SPROUT).
        </li>
        <li>
          Мерistemа в воздухе (SPROUT) при более чем <strong>{SHADED_SPROUT_LAYERS}</strong>{' '}
          слоях тени по геному: <em>лигнификация</em> (→ ствол) или <em>минерализация</em>{' '}
          (клетка освобождается). Отвалившаяся ветка целиком превращается в минералы.
        </li>
        <li>
          По геному — <em>двойной рост</em>: одно действие GROW вытягивает на 2 клетки за{' '}
          <strong>{DOUBLE_GROW_COST_MULT}×</strong> обычной стоимости (если хватает энергии и
          места; иначе обычный рост на 1 клетку).
        </li>
      </ul>
    </div>
  )

}
