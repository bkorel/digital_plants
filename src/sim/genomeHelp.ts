import type { OpName, SensorName } from './genome'

/** Краткое пояснение опкода для подсказки в UI */
export function opHelp(op: OpName): string {
  switch (op) {
    case 'NOP':
      return 'Пустая операция — ничего не делает, только сдвигает указатель.'
    case 'PUSH':
      return 'Кладёт на стек литерал 0..1 (из аргумента: байт % 101 / 100). Используется как порог сравнения.'
    case 'SENSE':
      return 'Читает сенсор окружения клетки и кладёт значение 0..1 на стек.'
    case 'LT':
      return 'Снимает два значения со стека (a, b сверху) и кладёт 1, если b < a, иначе 0.'
    case 'GT':
      return 'Снимает два значения со стека (a, b сверху) и кладёт 1, если b > a, иначе 0.'
    case 'AND':
      return 'Логическое И: оба верхних значения ≥ 0.5 → 1, иначе 0.'
    case 'OR':
      return 'Логическое ИЛИ: хотя бы одно верхних значений ≥ 0.5 → 1, иначе 0.'
    case 'IF':
      return 'Если вершина стека < 0.5 — пропускает следующую инструкцию (с аргументом). Иначе продолжает.'
    case 'DIR':
      return 'Задаёт WHERE для GROW/SEED и сенсоров по DIR (FOREIGN, SHADE_DIR, MINERAL_DIR).'
    case 'GROW':
      return 'ACTION(WHERE, WHEN): WHERE — последний DIR; WHEN — порог IF (стек ≥ значение). Созревает родителя.'
    case 'BRANCH':
      return 'ACTION(WHERE, WHEN): WHERE — байт %8 (0–1 UP, 2 DOWN, 3–4 LEFT, 5–6 RIGHT, 7 GOTO); WHEN — порог IF.'
    case 'SEED':
      return 'ACTION(WHERE, WHEN): WHERE — DIR; арг1 — доля семени; arg2 WHEN — порог IF.'
    case 'SPIKE':
      return 'ACTION(WHERE, WHEN): шип в соседней клетке; WHERE и WHEN как у BRANCH.'
    case 'SHOOT':
      return 'ACTION(WHERE, WHEN): луч от шипа по направлению; попадание только в чужой побег или слабый ствол. Завершает прогон.'
  }
}

/** Пояснение сенсора для подсказки в UI */
export function sensorHelp(sensor: SensorName): string {
  switch (sensor) {
    case 'ENERGY':
      return 'Доля заполнения энергии всего растения (0 — пусто, 1 — полный запас).'
    case 'LIGHT':
      return 'Освещённость в текущей клетке (0 — тень, 1 — полный свет).'
    case 'WATER':
      return 'Вода: в почве/корне — локально, в воздухе — снабжение растения от корней.'
    case 'MINERALS':
      return 'Минералы в текущей клетке, нормализованы 0..1.'
    case 'DEPTH':
      return 'Глубина в почве (0 — у поверхности, 1 — максимальная глубина).'
    case 'HEIGHT':
      return 'Высота над землёй (0 — у поверхности, 1 — верх мира).'
    case 'AGE':
      return 'Возраст растения относительно genomeMaxAge (0 — молодое, 1 — старое).'
    case 'RANDOM':
      return 'Случайное значение 0..1 от генератора мира (для вероятностных веток).'
    case 'FOREIGN':
      return '1 — в клетке по текущему DIR чужое растение или семя; 0 — свободно или своя клетка.'
    case 'SHADE':
      return 'Уровень затенения в текущей клетке (0 — светло, 1 — глубокая тень).'
    case 'SHADE_DIR':
      return 'Затенение в соседней клетке по текущему DIR.'
    case 'MINERAL_DIR':
      return 'Минералы почвы в клетке по DIR (0, если там воздух).'
    case 'CROWD_ABOVE':
      return 'Доля чужих растений на 1 клетку выше в полосе ±5 по X.'
    case 'PREV_OK':
      return '1 — предыдущее структурное действие успешно; 0 — провалилось или не было.'
    case 'PREV_FAIL':
      return '1 — предыдущее структурное действие провалилось; 0 — успешно или не было.'
  }
}

const DIR_RU: Record<string, string> = {
  UP: '↑ вверх',
  DOWN: '↓ вниз',
  LEFT: '← влево',
  RIGHT: '→ вправо',
  UP_LEFT: '↖ вверх-влево',
  UP_RIGHT: '↗ вверх-вправо',
  DOWN_LEFT: '↙ вниз-влево',
  DOWN_RIGHT: '↘ вниз-вправо',
}

function whenHuman(whenPart: string): string {
  if (whenPart === 'WHEN prev ok') return 'если предыдущее действие успешно'
  if (whenPart === 'WHEN prev fail') return 'если предыдущее действие провалилось'
  if (whenPart.startsWith('WHEN≥')) {
    const thr = whenPart.slice(5)
    return `если условие на стеке ≥ ${thr}`
  }
  return whenPart
}

function whereHuman(wherePart: string): string {
  if (wherePart === 'UP') return '↑'
  if (wherePart === 'DOWN') return '↓'
  if (wherePart === 'LEFT') return '←'
  if (wherePart === 'RIGHT') return '→'
  if (wherePart.startsWith('GOTO +')) return `перейти на ip+${wherePart.slice(6)}`
  return wherePart
}

/** Короткая человекочитаемая строка для списка байткода */
export function disasmLineHuman(text: string): string {
  const parts = text.split(' ')
  const op = parts[0] as OpName

  if (op === 'NOP') return 'ничего не делать'
  if (op === 'PUSH') return `на стек → ${parts[1]}`
  if (op === 'SENSE') {
    const s = parts[1] as SensorName
    const labels: Partial<Record<SensorName, string>> = {
      ENERGY: 'энергия растения',
      LIGHT: 'свет',
      WATER: 'вода',
      MINERALS: 'минералы',
      DEPTH: 'глубина в почве',
      HEIGHT: 'высота над землёй',
      AGE: 'возраст',
      RANDOM: 'случайность',
      FOREIGN: 'чужая клетка по DIR',
      SHADE: 'затенение здесь',
      SHADE_DIR: 'затенение по DIR',
      MINERAL_DIR: 'минералы по DIR',
      CROWD_ABOVE: 'толпа сверху',
      PREV_OK: 'прошлое действие OK',
      PREV_FAIL: 'прошлое действие FAIL',
    }
    return `сенсор: ${labels[s] ?? s}`
  }
  if (op === 'LT') return 'сравнить: ниже порога? (b < a)'
  if (op === 'GT') return 'сравнить: выше порога? (b > a)'
  if (op === 'AND') return 'оба условия на стеке true?'
  if (op === 'OR') return 'хотя бы одно условие true?'
  if (op === 'IF') return 'если false — пропустить следующую инструкцию'
  if (op === 'DIR') return `направление DIR = ${DIR_RU[parts[1]!] ?? parts[1]}`

  if (op === 'GROW') {
    const when = parts.slice(1).join(' ')
    return `▶ ВЫРАСТИ по последнему DIR, ${whenHuman(when)}`
  }

  if (op === 'SEED') {
    const frac = parts[1]
    const when = parts.slice(2).join(' ')
    return `▶ СЕМЯ ${frac}, ${whenHuman(when)}`
  }

  if (op === 'BRANCH' || op === 'SPIKE' || op === 'SHOOT') {
    const where = whereHuman(parts[1]!)
    const when = whenHuman(parts.slice(2).join(' '))
    const verbs: Record<string, string> = {
      BRANCH: 'ОТВЕТВИТЬ',
      SPIKE: 'ШИП',
      SHOOT: 'ВЫСТРЕЛ',
    }
    return `▶ ${verbs[op]} ${where}, ${when}`
  }

  return text
}

/** Человекочитаемое описание строки дизассемблера */
export function disasmLineHelp(text: string): string {
  const op = text.split(' ')[0] as OpName
  if (text.startsWith('SENSE ')) {
    const sensor = text.slice(6) as SensorName
    return `${opHelp('SENSE')} Сенсор: ${sensorHelp(sensor)}`
  }
  if (text.startsWith('PUSH ')) {
    return `${opHelp('PUSH')} Значение: ${text.slice(5)}.`
  }
  if (text.startsWith('DIR ')) {
    return `${opHelp('DIR')} Направление: ${text.slice(4)}.`
  }
  if (text.startsWith('SEED ')) {
    return `${opHelp('SEED')} ${text.slice(5)}.`
  }
  if (text.startsWith('BRANCH ') || text.startsWith('SPIKE ') || text.startsWith('SHOOT ')) {
    const opName = text.split(' ')[0] as OpName
    return `${opHelp(opName)} WHERE и WHEN: ${text.slice(opName.length + 1)}.`
  }
  if (text.startsWith('GROW ')) {
    return `${opHelp('GROW')} ${text.slice(5)}.`
  }
  return opHelp(op)
}

/** Пояснение шага трассировки VM (note + флаги) */
export function vmStepSummary(step: {
  text: string
  note: string
  stackBefore: number[]
  stackAfter: number[]
  dir: string
  skippedNext?: boolean
  structuralAttempt?: boolean
  structuralSuccess?: boolean
  runEnded?: boolean
}): string {
  const lines: string[] = [step.note]
  if (step.stackBefore.length !== step.stackAfter.length || step.stackBefore.some((v, i) => v !== step.stackAfter[i])) {
    lines.push(
      `Стек: ${formatStack(step.stackBefore)} → ${formatStack(step.stackAfter)}`,
    )
  }
  lines.push(`DIR: ${step.dir}`)
  if (step.skippedNext) lines.push('Следующая инструкция пропущена (IF).')
  if (step.structuralAttempt) {
    lines.push(step.structuralSuccess ? 'Структурное действие выполнено.' : 'Структурное действие не прошло.')
  }
  if (step.runEnded) lines.push('Прогон мерistemы завершён.')
  return lines.join('\n')
}

export function formatStack(stack: number[]): string {
  if (stack.length === 0) return '(пусто)'
  return stack.map((v) => v.toFixed(2)).join(', ')
}
