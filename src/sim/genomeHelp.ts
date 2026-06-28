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
      return 'Задаёт направление роста и действий (GROW, BRANCH, SEED, SPIKE, SHOOT).'
    case 'GROW':
      return 'Вытягивает филамент в dir: дочерняя мерistema, родитель созревает в ROOT/STEM. Завершает прогон.'
    case 'BRANCH':
      return 'Ответвление в dir: дочерняя мерistema, родитель остаётся меристемой. Может повториться за тик.'
    case 'SEED':
      return 'Сбрасывает семя в dir. Аргумент — доля 0..1 от запаса семян генома. Завершает прогон.'
    case 'SPIKE':
      return 'Ставит шип в соседней клетке по dir. Родитель остаётся меристемой.'
    case 'SHOOT':
      return 'Шип на 2 клетки в dir + мерistema за ним («выстрел»). Завершает прогон.'
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
  }
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
    return `${opHelp('SEED')} Доля энергии семени: ${text.slice(5)}.`
  }
  return opHelp(op)
}
