import {
  DEFAULT_MAX_AGE,
  GENOME,
  MIN_AGE,
  MUTATION,
  MUTATION_RATE,
  SHOOT_RANGE_MAX,
  SHOOT_RANGE_MIN,
} from './config'
import type { Direction, Genome } from './types'
import { Rng } from './rng'

/**
 * Линейный геном-байткод и стек-машина роста.
 *
 * Геном — это просто массив байт. Каждый байт при исполнении превращается в
 * инструкцию: `опкод = байт % OPS.length`. Аргументы (PUSH/SENSE/DIR/SEED и
 * BRANCH/SPIKE/SHOOT) берутся из следующих байт. Структурные команды —
 * ACTION(WHERE, WHEN): WHERE задаёт направление (или GOTO), WHEN — порог
 * встроенного IF (вершина стека ≥ decodeLiteral(WHEN)). `DIR` — только для
 * GROW/SEED (WHERE) и сенсоров по DIR — относительно ориентации клетки; SEED — абсолютный мир.
 * Поэтому ЛЮБАЯ случайная
 * последовательность байт — корректная программа, а мутации никогда не ломают
 * структуру (нет указателей, которые надо чинить).
 *
 * Морфологией управляют сенсоры: одна и та же программа, читая глубину/высоту,
 * растит и корни (вниз/вбок в почве), и побег (вверх к свету).
 */

export const OPS = [
  'NOP',
  'PUSH',
  'SENSE',
  'LT',
  'GT',
  'AND',
  'OR',
  'IF',
  'DIR',
  'GROW',
  'BRANCH',
  'SEED',
  'SPIKE',
  'SHOOT',
] as const
export type OpName = (typeof OPS)[number]
export const OP_COUNT = OPS.length

export const SENSORS = [
  'ENERGY',
  'LIGHT',
  'WATER',
  'MINERALS',
  'DEPTH',
  'HEIGHT',
  'AGE',
  'RANDOM',
  /** 1 — в клетке по текущему DIR чужое растение или семя; 0 — свободно или своя клетка */
  'FOREIGN',
  /** Эффективный уровень затенения в текущей клетке (0 — светло, 1 — глубокая тень) */
  'SHADE',
  /** То же в соседней клетке по текущему DIR (куда растёт мерistema) */
  'SHADE_DIR',
  /** Минералы почвы в клетке по DIR (0 в воздухе) */
  'MINERAL_DIR',
  /** Доля чужих растений на 1 клетку выше в полосе ±CROWD_ABOVE_X_RADIUS по X */
  'CROWD_ABOVE',
  /** 1 — предыдущее структурное действие успешно; 0 — неуспешно или не было */
  'PREV_OK',
  /** 1 — предыдущее структурное действие неуспешно; 0 — успешно или не было */
  'PREV_FAIL',
] as const
export type SensorName = (typeof SENSORS)[number]
export const SENSOR_COUNT = SENSORS.length

export const DIRECTIONS: Direction[] = [
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'UP_LEFT',
  'UP_RIGHT',
  'DOWN_LEFT',
  'DOWN_RIGHT',
]

/** Структурные операции завершают шаг исполнения (одно действие за тик) */
export function isStructuralOp(op: OpName): boolean {
  return op === 'GROW' || op === 'BRANCH' || op === 'SEED' || op === 'SPIKE' || op === 'SHOOT'
}

/** Сколько байт-аргументов потребляет инструкция после своего байта */
export function opArgCount(op: OpName): number {
  if (op === 'PUSH' || op === 'SENSE' || op === 'DIR') return 1
  if (op === 'GROW') return 1
  if (op === 'SEED') return 2
  if (op === 'BRANCH' || op === 'SPIKE' || op === 'SHOOT') return 2
  return 0
}

/** WHEN: проверка «предыдущее действие успешно» (стек игнорируется) */
export const WHEN_PREV_OK = 250
/** WHEN: проверка «предыдущее действие неуспешно» (стек игнорируется) */
export const WHEN_PREV_FAIL = 251

export function readPrevOkSensor(lastActionOk: boolean | null): number {
  return lastActionOk === true ? 1 : 0
}

export function readPrevFailSensor(lastActionOk: boolean | null): number {
  return lastActionOk === false ? 1 : 0
}

/** Встроенный IF: стек ≥ порога, либо WHEN prev ok/fail */
export function passesWhen(
  stack: number[],
  whenByte: number,
  lastActionOk: boolean | null,
): boolean {
  if (whenByte === WHEN_PREV_OK) return lastActionOk === true
  if (whenByte === WHEN_PREV_FAIL) return lastActionOk === false
  const v = stack.length > 0 ? stack[stack.length - 1]! : 0
  return v >= decodeLiteral(whenByte)
}

export function formatWhenArg(byte: number): string {
  if (byte === WHEN_PREV_OK) return 'WHEN prev ok'
  if (byte === WHEN_PREV_FAIL) return 'WHEN prev fail'
  return `WHEN≥${decodeLiteral(byte).toFixed(2)}`
}

/** BRANCH/SPIKE/SHOOT WHERE: %8 → 0–1 UP, 2 DOWN, 3–4 LEFT, 5–6 RIGHT, 7 GOTO */
export function formatStructuralArg(byte: number): string {
  const mode = byte % 8
  if (mode <= 1) return 'UP'
  if (mode === 2) return 'DOWN'
  if (mode <= 4) return 'LEFT'
  if (mode <= 6) return 'RIGHT'
  return `GOTO +${byte}`
}

export function isStructuralGoto(byte: number): boolean {
  return byte % 8 === 7
}

export function structuralGotoIp(ip: number, whereArg: number, codeLength: number): number {
  if (codeLength <= 0) return 0
  return (ip + 2 + whereArg) % codeLength
}

/** Направление из аргумента BRANCH/SPIKE/SHOOT; null — режим GOTO (%8===7) */
export function decodeStructuralDir(byte: number): Direction | null {
  const mode = byte % 8
  if (mode <= 1) return 'UP'
  if (mode === 2) return 'DOWN'
  if (mode <= 4) return 'LEFT'
  if (mode <= 6) return 'RIGHT'
  return null
}

export function encodeStructuralDir(d: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'): number {
  switch (d) {
    case 'UP':
      return 0
    case 'DOWN':
      return 2
    case 'LEFT':
      return 3
    case 'RIGHT':
      return 5
  }
}

export function decodeOp(byte: number): OpName {
  return OPS[byte % OP_COUNT]
}

export function decodeSensor(byte: number): SensorName {
  return SENSORS[byte % SENSOR_COUNT]
}

export function decodeDir(byte: number): Direction {
  return DIRECTIONS[byte % DIRECTIONS.length]
}

/** PUSH/порог: байт → значение 0..1 */
export function decodeLiteral(byte: number): number {
  return (byte % 101) / 100
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function cloneGenome(genome: Genome): Genome {
  return { code: Uint8Array.from(genome.code) }
}

export function genomesEqual(a: Genome, b: Genome): boolean {
  if (a.code.length !== b.code.length) return false
  for (let i = 0; i < a.code.length; i++) {
    if (a.code[i] !== b.code[i]) return false
  }
  return true
}

// ── Сериализация: компактная hex-строка ──────────────────────────────────────

export function serializeGenome(genome: Genome): string {
  let s = ''
  for (const b of genome.code) s += b.toString(16).padStart(2, '0')
  return s
}

export function deserializeGenome(text: string): Genome {
  const clean = text.trim().replace(/[^0-9a-fA-F]/g, '')
  const n = Math.floor(clean.length / 2)
  const code = new Uint8Array(Math.max(1, n))
  for (let i = 0; i < n; i++) {
    code[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) & 0xff
  }
  if (n === 0) code[0] = OPS.indexOf('NOP')
  return { code }
}

// ── Дизассемблер для UI ──────────────────────────────────────────────────────

export interface DisasmLine {
  index: number
  text: string
  structural: boolean
  /** Сколько байт занимает инструкция (опкод + аргументы) */
  byteLength: number
  /** Hex байтов инструкции, напр. `08 a3 32` */
  bytesHex: string
}

export function disassemble(genome: Genome): DisasmLine[] {
  const code = genome.code
  const lines: DisasmLine[] = []
  let i = 0
  while (i < code.length) {
    const op = decodeOp(code[i]!)
    let text: string = op
    const argN = opArgCount(op)
    const byteLength = 1 + argN
    const slice = code.slice(i, i + byteLength)
    const bytesHex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
    const a0 = argN > 0 && i + 1 < code.length ? code[i + 1]! : 0
    const a1 = argN > 1 && i + 2 < code.length ? code[i + 2]! : 0
    if (op === 'PUSH') text = `PUSH ${decodeLiteral(a0).toFixed(2)}`
    else if (op === 'SENSE') text = `SENSE ${decodeSensor(a0)}`
    else if (op === 'DIR') text = `DIR ${decodeDir(a0)}`
    else if (op === 'SEED') text = `SEED ${decodeLiteral(a0).toFixed(2)} ${formatWhenArg(a1)}`
    else if (op === 'GROW') text = `GROW ${formatWhenArg(a0)}`
    else if (op === 'BRANCH' || op === 'SPIKE' || op === 'SHOOT') {
      text = `${op} ${formatStructuralArg(a0)} ${formatWhenArg(a1)}`
    }
    lines.push({ index: i, text, structural: isStructuralOp(op), byteLength, bytesHex })
    i += byteLength
  }
  return lines
}

// ── Производные параметры (выводятся прямо из кода) ───────────────────────────

function codeSum(code: Uint8Array): number {
  let s = 0
  for (const b of code) s = (s + b) >>> 0
  return s
}

export function genomeMaxAge(genome: Genome): number {
  const span = DEFAULT_MAX_AGE - MIN_AGE
  return MIN_AGE + (codeSum(genome.code) % (span + 1))
}

export function genomeSeedReserve(genome: Genome): number {
  let s = 0
  for (let i = 0; i < genome.code.length; i++) s += genome.code[i] * (i + 1)
  return 14 + (s % 10)
}

/** Потолок высоты побега (норм. 0..1), читается из порога HEIGHT в байткоде */
export function genomeHeightCap(genome: Genome): number {
  const code = genome.code
  for (let i = 0; i < code.length - 3; i++) {
    if (decodeOp(code[i]) !== 'SENSE' || decodeSensor(code[i + 1]) !== 'HEIGHT') continue
    for (let j = i + 2; j < Math.min(i + 10, code.length - 1); j++) {
      if (decodeOp(code[j]) === 'PUSH') return decodeLiteral(code[j + 1])
    }
  }
  return 0.06 + (codeSum(code) % 87) / 100
}

/** Потолок глубины корней (норм. 0..1) */
export function genomeDepthCap(genome: Genome): number {
  const code = genome.code
  for (let i = 0; i < code.length - 3; i++) {
    if (decodeOp(code[i]) !== 'SENSE' || decodeSensor(code[i + 1]) !== 'DEPTH') continue
    for (let j = i + 2; j < Math.min(i + 10, code.length - 1); j++) {
      if (decodeOp(code[j]) === 'PUSH') {
        const v = decodeLiteral(code[j + 1])
        if (v > 0.05) return v
      }
    }
  }
  return 0.08 + ((codeSum(code) >>> 4) % 40) / 100
}

/** Дальность луча SHOOT в клетках (3..50), детерминированно от кода генома. */
export function genomeShootRange(genome: Genome): number {
  const span = SHOOT_RANGE_MAX - SHOOT_RANGE_MIN
  return SHOOT_RANGE_MIN + (codeSum(genome.code) % (span + 1))
}

/** Маркеры метаданных в хвосте шаблонного генома (VM обычно до них не доходит). */
export const GENOME_META_DOUBLE_GROW = 0xfc
export const GENOME_META_SHADE_LIGNIFY = 0xfd
export const GENOME_META_SHADE_MINERALIZE = 0xfe

function scanGenomeMeta(code: Uint8Array): { doubleGrow: boolean; shade?: ShadeSenescenceMode } {
  let doubleGrow = false
  let shade: ShadeSenescenceMode | undefined
  for (let i = Math.max(0, code.length - 2); i < code.length; i++) {
    const b = code[i]
    if (b === GENOME_META_DOUBLE_GROW) doubleGrow = true
    if (b === GENOME_META_SHADE_LIGNIFY) shade = 'lignify'
    if (b === GENOME_META_SHADE_MINERALIZE) shade = 'mineralize'
  }
  return { doubleGrow, shade }
}

export function genomeDoubleGrowth(genome: Genome): boolean {
  const meta = scanGenomeMeta(genome.code)
  if (meta.doubleGrow) return true
  return (codeSum(genome.code) >> 3) % 4 === 0
}

export function doubleGrowthLabel(enabled: boolean): string {
  return enabled ? 'да (×3 энергии)' : 'нет'
}

/** Реакция затенённой мерistemы на отмирание: ствол или минерализация. */
export type ShadeSenescenceMode = 'lignify' | 'mineralize'

export function genomeShadeSenescence(genome: Genome): ShadeSenescenceMode {
  const meta = scanGenomeMeta(genome.code)
  if (meta.shade) return meta.shade
  return (codeSum(genome.code) >> 2) % 3 === 0 ? 'mineralize' : 'lignify'
}

export function shadeSenescenceLabel(mode: ShadeSenescenceMode): string {
  return mode === 'lignify' ? 'лигнификация (ствол)' : 'минерализация'
}

/** Маркер в конце шаблонного генома (не исполняется — VM доходит до конца без действий). */
function shadeTag(mode: ShadeSenescenceMode): number {
  return mode === 'mineralize' ? GENOME_META_SHADE_MINERALIZE : GENOME_META_SHADE_LIGNIFY
}

function doubleGrowTag(): number {
  return GENOME_META_DOUBLE_GROW
}

function metaSuffix(opts: { doubleGrow?: boolean; shade: ShadeSenescenceMode }): number[] {
  const tags: number[] = []
  if (opts.doubleGrow) tags.push(doubleGrowTag())
  tags.push(shadeTag(opts.shade))
  return tags
}

// ── Генерация геномов ─────────────────────────────────────────────────────────

const OP = (name: OpName): number => OPS.indexOf(name)
const SENS = (name: SensorName): number => SENSORS.indexOf(name)
const DIRB = (d: Direction): number => DIRECTIONS.indexOf(d)
const SD = (d: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'): number => encodeStructuralDir(d)
/** Порог встроенного WHEN (стек ≥ значение); по умолчанию 0.5 как у IF */
const WHEN = (t = 0.5): number => LIT(t)
const LIT = (v: number): number => Math.round(clamp01(v) * 100)

/** Удобный сборщик байткода из читаемых токенов */
function asm(tokens: number[]): number[] {
  return tokens
}

/** Стартовый геном при рестарте: только случайный байткод (воспроизводимо от сида ГПСЧ). */
export function randomGenome(rng: Rng): Genome {
  return fullyRandomGenome(rng)
}

/** Полностью случайные байты — без шаблона «живучего» генома */
export function fullyRandomGenome(rng: Rng): Genome {
  const len = rng.nextInt(GENOME.MIN_BYTES, GENOME.MAX_BYTES)
  const code = new Uint8Array(len)
  for (let i = 0; i < len; i++) code[i] = rng.nextInt(0, 255)
  return { code }
}

/** Эвристика: старый «живучий» шаблон с маркером тени в хвосте (длина ~300+ байт). */
export function looksLikeTemplateGenome(genome: Genome): boolean {
  const code = genome.code
  if (code.length < 100) return false
  const last = code[code.length - 1]
  return last === GENOME_META_SHADE_LIGNIFY || last === GENOME_META_SHADE_MINERALIZE
}

export function genomeOriginLabel(genome: Genome): string {
  return looksLikeTemplateGenome(genome) ? 'шаблон роста' : 'случайный байткод'
}

/**
 * Жизнеспособный «живучий» шаблон: сначала корни и рост, семена — только
 * при запасе энергии. Без ранних слабых семян и без дорогих шипов.
 */
function viableTemplateGenome(rng: Rng): Genome {
  const depthThr = clamp01(rng.next() * 0.22 + 0.55)
  const rootBranchP = clamp01(rng.next() * 0.18 + 0.38)
  const rootBranchDeepP = clamp01(rng.next() * 0.15 + 0.28)
  const crownMax = clamp01(rng.next() * 0.08 + 0.78)
  const heightThr = crownMax
  const crownSideLow = clamp01(rng.next() * 0.06 + 0.10)
  const crownSideTop = clamp01(crownMax * 0.92)
  const sideBranchP = clamp01(rng.next() * 0.2 + 0.32)
  const seedEnergyThr = 0.01
  const seedHeight = clamp01(rng.next() * 0.02 + 0.02)
  const growEnergyThr = clamp01(rng.next() * 0.05 + 0.10)
  const seedAgeLate = clamp01(rng.next() * 0.15 + 0.45)

  const code: number[] = asm([
    // якорь у поверхности — нужен для опоры перед ростом в воздух
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.04), OP('LT'),
    OP('AND'),
    OP('BRANCH'), SD('DOWN'), WHEN(0.5),
    // первый побег в воздух (низкая высота — один раз выйти из почвы)
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('AND'),
    OP('GROW'), WHEN(0.5),
    // главный корень вниз (вперёд для dir=DOWN)
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.01), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.04), OP('GT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(depthThr), OP('LT'),
    OP('AND'), OP('AND'),
    OP('GROW'), WHEN(0.5),
    // боковые корни — после стержневого
    OP('DIR'), DIRB('LEFT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.01), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.05), OP('GT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(rootBranchP), OP('LT'),
    OP('AND'), OP('AND'),
    OP('BRANCH'), SD('RIGHT'), WHEN(0.5),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.01), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.05), OP('GT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(rootBranchP), OP('LT'),
    OP('AND'), OP('AND'),
    OP('BRANCH'), SD('LEFT'), WHEN(0.5),
    // семя — до продолжения роста вверх (иначе GROW съедает прогон каждый тик)
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(seedEnergyThr), OP('GT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(seedHeight), OP('GT'),
    OP('AND'),
    OP('SEED'), LIT(0.28), WHEN(0.5),
    // повторное семя на кроне — когда рост вверх уже не нужен
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.15), OP('GT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.01), OP('GT'),
    OP('AND'),
    OP('SEED'), LIT(0.20), WHEN(0.5),
    // продолжение роста вверх — чуть ниже «крыши», только при запасе энергии
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(heightThr), OP('LT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(growEnergyThr), OP('GT'),
    OP('AND'), OP('AND'),
    OP('GROW'), WHEN(0.5),
    // позднее семя при возрасте
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('AGE'), OP('PUSH'), LIT(seedAgeLate), OP('GT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.01), OP('GT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.05), OP('GT'),
    OP('AND'), OP('AND'),
    OP('SEED'), LIT(0.35), WHEN(0.5),
    // боковая крона — умеренно, при достаточной энергии
    OP('DIR'), DIRB('LEFT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(crownSideLow), OP('GT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(crownSideTop), OP('LT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.14), OP('GT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(sideBranchP), OP('LT'),
    OP('AND'), OP('AND'), OP('AND'), OP('AND'),
    OP('BRANCH'), SD('LEFT'), WHEN(0.5),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(crownSideLow), OP('GT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(crownSideTop), OP('LT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.14), OP('GT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(sideBranchP), OP('LT'),
    OP('AND'), OP('AND'), OP('AND'), OP('AND'),
    OP('BRANCH'), SD('RIGHT'), WHEN(0.5),
    // второй побег вверх — в пределах кроны, не у самой крыши
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(crownSideLow), OP('GT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(crownMax), OP('LT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.28), OP('GT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(0.28), OP('LT'),
    OP('AND'), OP('AND'), OP('AND'), OP('AND'),
    OP('BRANCH'), SD('UP'), WHEN(0.5),
    // глубокие боковые корни
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.01), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.14), OP('GT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.68), OP('LT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(rootBranchDeepP), OP('LT'),
    OP('AND'), OP('AND'), OP('AND'),
    OP('BRANCH'), SD('RIGHT'), WHEN(0.5),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.01), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.14), OP('GT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.68), OP('LT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(rootBranchDeepP), OP('LT'),
    OP('AND'), OP('AND'), OP('AND'),
    OP('BRANCH'), SD('LEFT'), WHEN(0.5),
    ...metaSuffix({ doubleGrow: rng.chance(0.28), shade: 'lignify' }),
  ])

  return { code: Uint8Array.from(code) }
}

/** То же, что стартовый шаблон — для явной посадки / лаборатории */
export function hardyTemplateGenome(rng: Rng): Genome {
  return viableTemplateGenome(rng)
}

/** Пример: корни, стебель, боковые шипы и «выстрелы» SHOOT вверх и в стороны. */
export function spikeShooterTemplateGenome(_rng?: Rng): Genome {
  const code: number[] = asm([
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.04), OP('LT'),
    OP('AND'),
    OP('BRANCH'), SD('DOWN'), WHEN(0.5),
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.01), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.04), OP('GT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.7), OP('LT'),
    OP('AND'), OP('AND'),
    OP('GROW'), WHEN(0.5),
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.38), OP('LT'),
    OP('AND'),
    OP('GROW'), WHEN(0.5),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.05), OP('GT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.08), OP('GT'),
    OP('AND'),
    OP('SPIKE'), SD('LEFT'), WHEN(0.5),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.05), OP('GT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.08), OP('GT'),
    OP('AND'),
    OP('SPIKE'), SD('RIGHT'), WHEN(0.5),
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('FOREIGN'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.07), OP('GT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.07), OP('GT'),
    OP('AND'), OP('AND'),
    OP('SHOOT'), SD('UP'), WHEN(0.5),
    OP('DIR'), DIRB('LEFT'),
    OP('SENSE'), SENS('FOREIGN'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.09), OP('GT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.08), OP('GT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(0.55), OP('LT'),
    OP('AND'), OP('AND'), OP('AND'),
    OP('SHOOT'), SD('LEFT'), WHEN(0.5),
    OP('DIR'), DIRB('RIGHT'),
    OP('SENSE'), SENS('FOREIGN'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.09), OP('GT'),
    OP('SENSE'), SENS('ENERGY'), OP('PUSH'), LIT(0.08), OP('GT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(0.55), OP('LT'),
    OP('AND'), OP('AND'), OP('AND'),
    OP('SHOOT'), SD('RIGHT'), WHEN(0.5),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.01), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.1), OP('GT'),
    OP('SENSE'), SENS('RANDOM'), OP('PUSH'), LIT(0.35), OP('LT'),
    OP('AND'), OP('AND'),
    OP('BRANCH'), SD('UP'), WHEN(0.5),
    ...metaSuffix({ doubleGrow: true, shade: 'mineralize' }),
  ])

  return { code: Uint8Array.from(code) }
}

/**
 * Не тянется вверх/в стороны, если в соседней клетке (LEFT/RIGHT/UP по DIR) чужое растение.
 * Сенсор FOREIGN читает клетку в направлении последнего DIR (относительно ориентации клетки).
 */
export function shyPlantTemplateGenome(_rng?: Rng): Genome {
  const code: number[] = asm([
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.04), OP('LT'),
    OP('AND'),
    OP('BRANCH'), SD('DOWN'), WHEN(0.5),
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.01), OP('LT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.04), OP('GT'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.65), OP('LT'),
    OP('AND'), OP('AND'),
    OP('GROW'), WHEN(0.5),
    OP('DIR'), DIRB('LEFT'),
    OP('SENSE'), SENS('FOREIGN'),
    OP('DIR'), DIRB('RIGHT'),
    OP('SENSE'), SENS('FOREIGN'),
    OP('OR'),
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('FOREIGN'),
    OP('OR'),
    OP('PUSH'), LIT(0.5),
    OP('LT'),
    OP('IF'),
    OP('DIR'), DIRB('UP'),
    OP('SENSE'), SENS('FOREIGN'),
    OP('PUSH'), LIT(0.5),
    OP('LT'),
    OP('IF'),
    OP('SENSE'), SENS('DEPTH'), OP('PUSH'), LIT(0.03), OP('LT'),
    OP('SENSE'), SENS('HEIGHT'), OP('PUSH'), LIT(0.35), OP('LT'),
    OP('AND'),
    OP('GROW'), WHEN(0.5),
    ...metaSuffix({ shade: 'mineralize' }),
  ])

  return { code: Uint8Array.from(code) }
}

/** Id встроенного образца «Стрелок (шипы)» в коллекции */
export const SPIKE_SHOOTER_PRESET_ID = 'preset-spike-shooter'

/** Id образца «Стеснитель» — не растёт, если рядом чужая клетка */
export const SHY_PLANT_PRESET_ID = 'preset-shy-plant'

// ── Мутации ────────────────────────────────────────────────────────────────────

function scaleP(base: number): number {
  return Math.min(1, base * MUTATION_RATE)
}

/**
 * Мутации работают прямо над массивом байт и всегда дают валидный геном:
 *  - точечная замена байта,
 *  - вставка случайного байта,
 *  - удаление байта,
 *  - дупликация участка (источник новых «органов»),
 *  - инверсия участка.
 */
export function mutate(genome: Genome, rng: Rng): Genome {
  let code = Array.from(genome.code)

  // точечные замены
  for (let i = 0; i < code.length; i++) {
    if (rng.chance(scaleP(MUTATION.P_POINT))) {
      // небольшой сдвиг значения чаще, чем полностью случайный байт
      if (rng.chance(0.6)) {
        code[i] = (code[i] + rng.nextInt(-12, 12) + 256) & 0xff
      } else {
        code[i] = rng.nextInt(0, 255)
      }
    }
  }

  // вставка
  if (rng.chance(scaleP(MUTATION.P_INS)) && code.length < GENOME.MAX_BYTES) {
    const pos = rng.nextInt(0, code.length)
    code.splice(pos, 0, rng.nextInt(0, 255))
  }

  // удаление
  if (rng.chance(scaleP(MUTATION.P_DEL)) && code.length > GENOME.MIN_BYTES) {
    const pos = rng.nextInt(0, code.length - 1)
    code.splice(pos, 1)
  }

  // дупликация участка
  if (rng.chance(scaleP(MUTATION.P_DUP)) && code.length < GENOME.MAX_BYTES) {
    const start = rng.nextInt(0, code.length - 1)
    const maxLen = Math.min(8, code.length - start, GENOME.MAX_BYTES - code.length)
    if (maxLen > 0) {
      const len = rng.nextInt(1, maxLen)
      const slice = code.slice(start, start + len)
      code.splice(start + len, 0, ...slice)
    }
  }

  // инверсия участка
  if (rng.chance(scaleP(MUTATION.P_INV)) && code.length > 3) {
    const start = rng.nextInt(0, code.length - 2)
    const len = rng.nextInt(2, Math.min(8, code.length - start))
    const slice = code.slice(start, start + len).reverse()
    for (let k = 0; k < len; k++) code[start + k] = slice[k]
  }

  if (code.length === 0) code = [OP('NOP')]
  if (code.length > GENOME.MAX_BYTES) code = code.slice(0, GENOME.MAX_BYTES)

  return { code: Uint8Array.from(code) }
}

// ── Идентичность/цвет вида ────────────────────────────────────────────────────

/** Хэш кода → стабильный отпечаток для цвета и оценки видов */
function codeHash(code: Uint8Array): number {
  let h = 2166136261 >>> 0
  for (const b of code) {
    h ^= b
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function genomeHue(genome: Genome): number {
  return codeHash(genome.code) % 360
}

export function genomeColor(genome: Genome): { hue: number; sat: number; light: number } {
  const h = codeHash(genome.code)
  return {
    hue: h % 360,
    sat: 50 + ((h >>> 9) % 28),
    light: 46,
  }
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

export function estimateSpecies(plants: { genome: Genome; dead: boolean }[]): number {
  const alive = plants.filter((p) => !p.dead)
  if (alive.length === 0) return 0
  const hues = alive.map((p) => genomeHue(p.genome))
  const clusters: number[] = []
  for (const h of hues) {
    const found = clusters.find((c) => hueDistance(c, h) < 18)
    if (found === undefined) clusters.push(h)
  }
  return clusters.length
}
