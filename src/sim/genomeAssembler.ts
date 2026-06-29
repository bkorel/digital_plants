import type { Direction, Genome } from './types'
import {
  DIRECTIONS,
  OPS,
  SENSORS,
  WHEN_PREV_FAIL,
  WHEN_PREV_OK,
  encodeStructuralDir,
  type OpName,
  type SensorName,
} from './genome'

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function encodeLiteral(v: number): number {
  return Math.round(clamp01(v) * 100)
}

export function encodeWhen(text: string): number | null {
  const t = text.trim()
  if (t === 'WHEN prev ok' || t === 'prev ok') return WHEN_PREV_OK
  if (t === 'WHEN prev fail' || t === 'prev fail') return WHEN_PREV_FAIL
  const m = t.match(/^WHEN≥([\d.]+)$/)
  if (m) return encodeLiteral(parseFloat(m[1]!))
  return null
}

export function encodeOpcode(name: string): number | null {
  const idx = OPS.indexOf(name as OpName)
  return idx >= 0 ? idx : null
}

export function encodeSensor(name: string): number | null {
  const idx = SENSORS.indexOf(name as SensorName)
  return idx >= 0 ? idx : null
}

export function encodeDirection(name: string): number | null {
  const idx = DIRECTIONS.indexOf(name as Direction)
  return idx >= 0 ? idx : null
}

export function encodeStructural(where: string): number | null {
  const w = where.trim()
  if (w === 'UP' || w === 'DOWN' || w === 'LEFT' || w === 'RIGHT') {
    return encodeStructuralDir(w)
  }
  const goto = w.match(/^GOTO\s+\+(\d+)$/i)
  if (goto) {
    const n = parseInt(goto[1]!, 10)
    if (n >= 0 && n <= 255) return n
  }
  return null
}

export interface ParseInstructionResult {
  bytes: number[]
  error?: string
}

export function parseInstructionLine(line: string): ParseInstructionResult {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return { bytes: [] }
  }

  const tokens = trimmed.split(/\s+/)
  const opName = tokens[0]!.toUpperCase()
  const opByte = encodeOpcode(opName)
  if (opByte === null) {
    return { bytes: [], error: `Неизвестный опкод: ${tokens[0]}` }
  }

  const op = OPS[opByte]!

  switch (op) {
    case 'NOP':
    case 'LT':
    case 'GT':
    case 'AND':
    case 'OR':
    case 'IF':
      return { bytes: [opByte] }

    case 'PUSH': {
      if (tokens.length < 2) return { bytes: [], error: 'PUSH требует литерал 0..1' }
      const v = parseFloat(tokens[1]!)
      if (Number.isNaN(v)) return { bytes: [], error: `Некорректный литерал: ${tokens[1]}` }
      return { bytes: [opByte, encodeLiteral(v)] }
    }

    case 'SENSE': {
      if (tokens.length < 2) return { bytes: [], error: 'SENSE требует имя сенсора' }
      const sens = encodeSensor(tokens[1]!.toUpperCase())
      if (sens === null) return { bytes: [], error: `Неизвестный сенсор: ${tokens[1]}` }
      return { bytes: [opByte, sens] }
    }

    case 'DIR': {
      if (tokens.length < 2) return { bytes: [], error: 'DIR требует направление' }
      const dir = encodeDirection(tokens[1]!.toUpperCase())
      if (dir === null) return { bytes: [], error: `Неизвестное направление: ${tokens[1]}` }
      return { bytes: [opByte, dir] }
    }

    case 'GROW': {
      const whenPart = tokens.slice(1).join(' ')
      const whenByte = encodeWhen(whenPart)
      if (whenByte === null) return { bytes: [], error: `Некорректный WHEN: ${whenPart || '(пусто)'}` }
      return { bytes: [opByte, whenByte] }
    }

    case 'SEED': {
      if (tokens.length < 2) return { bytes: [], error: 'SEED требует долю 0..1' }
      const frac = parseFloat(tokens[1]!)
      if (Number.isNaN(frac)) return { bytes: [], error: `Некорректная доля: ${tokens[1]}` }
      const whenPart = tokens.slice(2).join(' ')
      const whenByte = encodeWhen(whenPart)
      if (whenByte === null) return { bytes: [], error: `Некорректный WHEN: ${whenPart || '(пусто)'}` }
      return { bytes: [opByte, encodeLiteral(frac), whenByte] }
    }

    case 'BRANCH':
    case 'SPIKE':
    case 'SHOOT': {
      if (tokens.length < 2) return { bytes: [], error: `${op} требует WHERE` }
      let whereStr = tokens[1]!
      if (whereStr.toUpperCase() === 'GOTO' && tokens.length >= 3) {
        whereStr = `GOTO ${tokens[2]!}`
      }
      const whereByte = encodeStructural(whereStr)
      if (whereByte === null) return { bytes: [], error: `Некорректный WHERE: ${whereStr}` }
      const whenStart = whereStr.startsWith('GOTO') ? 3 : 2
      const whenPart = tokens.slice(whenStart).join(' ')
      const whenByte = encodeWhen(whenPart)
      if (whenByte === null) return { bytes: [], error: `Некорректный WHEN: ${whenPart || '(пусто)'}` }
      return { bytes: [opByte, whereByte, whenByte] }
    }

    default:
      return { bytes: [], error: `Опкод не поддерживается: ${opName}` }
  }
}

export interface ParseError {
  line: number
  text: string
  message: string
}

export function assembleFromLines(lines: string[]): Genome {
  const bytes: number[] = []
  for (const line of lines) {
    const { bytes: inst } = parseInstructionLine(line)
    for (const b of inst) bytes.push(b)
  }
  if (bytes.length === 0) bytes.push(encodeOpcode('NOP')!)
  return { code: Uint8Array.from(bytes) }
}

export function assembleProgram(text: string): { genome: Genome; errors: ParseError[] } {
  const lines = text.split('\n')
  const bytes: number[] = []
  const errors: ParseError[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const result = parseInstructionLine(line)
    if (result.error) {
      errors.push({ line: i + 1, text: line.trim(), message: result.error })
      continue
    }
    for (const b of result.bytes) bytes.push(b)
  }

  if (bytes.length === 0) bytes.push(encodeOpcode('NOP')!)
  return { genome: { code: Uint8Array.from(bytes) }, errors }
}

/** Собрать текст программы из дизассемблированных строк */
export function linesToProgram(lines: { text: string }[]): string {
  return lines.map((l) => l.text).join('\n')
}

/** Проверка эквивалентности двух геномов по дизассемблированному тексту */
export function genomesDisasmEqual(a: Genome, b: Genome, disassemble: (g: Genome) => { text: string }[]): boolean {
  const ta = disassemble(a).map((l) => l.text).join('\n')
  const tb = disassemble(b).map((l) => l.text).join('\n')
  return ta === tb
}
