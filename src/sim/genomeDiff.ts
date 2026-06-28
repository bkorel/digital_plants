import { WORLD } from './config'
import {
  disassemble,
  genomeDepthCap,
  genomeDoubleGrowth,
  genomeHeightCap,
  genomeMaxAge,
  genomeSeedReserve,
  genomeShadeSenescence,
  doubleGrowthLabel,
  shadeSenescenceLabel,
  type DisasmLine,
} from './genome'
import { disasmLineHuman } from './genomeHelp'
import { shortGenomeKey } from './lineage'
import type { Genome } from './types'

export type ByteDiffKind = 'equal' | 'insert' | 'delete' | 'replace'

export interface ByteDiffSegment {
  kind: ByteDiffKind
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

export type DiffLineKind = 'equal' | 'del' | 'ins' | 'chg' | 'ctx'

export interface AlignedDiffRow {
  kind: DiffLineKind
  aLine?: DisasmLine
  bLine?: DisasmLine
  /** Префикс git-style: ' ', '-', '+', '!' */
  prefix: ' ' | '-' | '+' | '!'
}

export interface GenomeCompareResult {
  byteSegments: ByteDiffSegment[]
  alignedRows: AlignedDiffRow[]
  aLength: number
  bLength: number
  changedByteCount: number
  changedInstructionCount: number
}

export interface ExplainContext {
  genomeKeyA?: string
  genomeKeyB?: string
  parentChild?: { parentKey: string; childKey: string }
}

export interface TraitDiff {
  label: string
  a: string
  b: string
}

/** LCS diff на массивах — возвращает сегменты equal/insert/delete/replace */
export function diffBytes(a: Uint8Array, b: Uint8Array): ByteDiffSegment[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const segments: ByteDiffSegment[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      const startA = i
      const startB = j
      while (i < n && j < m && a[i] === b[j]) {
        i++
        j++
      }
      segments.push({ kind: 'equal', aStart: startA, aEnd: i, bStart: startB, bEnd: j })
    } else if (j < m && (i >= n || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
      const startB = j
      while (j < m && (i >= n || dp[i + 1]![j]! >= dp[i]![j + 1]!)) j++
      segments.push({ kind: 'insert', aStart: i, aEnd: i, bStart: startB, bEnd: j })
    } else if (i < n && (j >= m || dp[i + 1]![j]! < dp[i]![j + 1]!)) {
      const startA = i
      while (i < n && (j >= m || dp[i + 1]![j]! < dp[i]![j + 1]!)) i++
      segments.push({ kind: 'delete', aStart: startA, aEnd: i, bStart: j, bEnd: j })
    } else {
      break
    }
  }

  // Слить соседние delete+insert в replace
  const merged: ByteDiffSegment[] = []
  for (const seg of segments) {
    const prev = merged[merged.length - 1]
    if (prev?.kind === 'delete' && seg.kind === 'insert') {
      merged[merged.length - 1] = {
        kind: 'replace',
        aStart: prev.aStart,
        aEnd: prev.aEnd,
        bStart: seg.bStart,
        bEnd: seg.bEnd,
      }
    } else if (prev?.kind === 'insert' && seg.kind === 'delete') {
      merged[merged.length - 1] = {
        kind: 'replace',
        aStart: seg.aStart,
        aEnd: seg.aEnd,
        bStart: prev.bStart,
        bEnd: prev.bEnd,
      }
    } else {
      merged.push(seg)
    }
  }
  return merged
}

function lcsAlign<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Array<{ a?: T; b?: T }> {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[i]!, b[j]!)
        ? 1 + dp[i + 1]![j + 1]!
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const result: Array<{ a?: T; b?: T }> = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && eq(a[i]!, b[j]!)) {
      result.push({ a: a[i], b: b[j] })
      i++
      j++
    } else if (j < m && (i >= n || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
      result.push({ b: b[j] })
      j++
    } else {
      result.push({ a: a[i] })
      i++
    }
  }
  return result
}

/** Выравнивание инструкций дизассемблера для side-by-side / unified diff */
export function alignDisasm(a: Genome, b: Genome): AlignedDiffRow[] {
  const linesA = disassemble(a)
  const linesB = disassemble(b)
  const aligned = lcsAlign(linesA, linesB, (x, y) => x.text === y.text && x.bytesHex === y.bytesHex)

  return aligned.map(({ a: aLine, b: bLine }) => {
    if (aLine && bLine) {
      const same = aLine.text === bLine.text && aLine.bytesHex === bLine.bytesHex
      return {
        kind: same ? ('equal' as const) : ('chg' as const),
        aLine,
        bLine,
        prefix: same ? (' ' as const) : ('!' as const),
      }
    }
    if (aLine) {
      return { kind: 'del' as const, aLine, prefix: '-' as const }
    }
    return { kind: 'ins' as const, bLine, prefix: '+' as const }
  })
}

function countChangedBytes(segments: ByteDiffSegment[]): number {
  let n = 0
  for (const s of segments) {
    if (s.kind === 'equal') continue
    if (s.kind === 'insert') n += s.bEnd - s.bStart
    else if (s.kind === 'delete') n += s.aEnd - s.aStart
    else n += Math.max(s.aEnd - s.aStart, s.bEnd - s.bStart)
  }
  return n
}

export function compareGenomes(a: Genome, b: Genome): GenomeCompareResult {
  const byteSegments = diffBytes(a.code, b.code)
  const alignedRows = alignDisasm(a, b)
  const changedInstructionCount = alignedRows.filter((r) => r.kind !== 'equal').length
  return {
    byteSegments,
    alignedRows,
    aLength: a.code.length,
    bLength: b.code.length,
    changedByteCount: countChangedBytes(byteSegments),
    changedInstructionCount,
  }
}

function traitDiffs(a: Genome, b: Genome): TraitDiff[] {
  const pairs: { label: string; a: string; b: string }[] = []
  const add = (label: string, va: string | number, vb: string | number) => {
    const sa = String(va)
    const sb = String(vb)
    if (sa !== sb) pairs.push({ label, a: sa, b: sb })
  }
  add('maxAge', genomeMaxAge(a), genomeMaxAge(b))
  add('seedReserve', genomeSeedReserve(a), genomeSeedReserve(b))
  add(
    'потолок высоты',
    `~${Math.round(genomeHeightCap(a) * WORLD.SOIL_Y)} кл.`,
    `~${Math.round(genomeHeightCap(b) * WORLD.SOIL_Y)} кл.`,
  )
  add(
    'глубина корней',
    `~${Math.round(genomeDepthCap(a) * (WORLD.H - WORLD.SOIL_Y))} кл.`,
    `~${Math.round(genomeDepthCap(b) * (WORLD.H - WORLD.SOIL_Y))} кл.`,
  )
  add('двойной рост', doubleGrowthLabel(genomeDoubleGrowth(a)), doubleGrowthLabel(genomeDoubleGrowth(b)))
  add(
    'тень',
    shadeSenescenceLabel(genomeShadeSenescence(a)),
    shadeSenescenceLabel(genomeShadeSenescence(b)),
  )
  return pairs
}

/** Человекочитаемое резюме различий */
export function explainGenomeDiff(
  a: Genome,
  b: Genome,
  ctx?: ExplainContext,
): { summary: string[]; traits: TraitDiff[] } {
  const cmp = compareGenomes(a, b)
  const summary: string[] = []

  if (cmp.aLength === cmp.bLength && cmp.changedByteCount === 0) {
    summary.push('Геномы идентичны побайтово.')
    return { summary, traits: [] }
  }

  const lenDelta = cmp.bLength - cmp.aLength
  if (lenDelta > 0) summary.push(`Геном B длиннее на ${lenDelta} байт (${cmp.aLength} → ${cmp.bLength}).`)
  else if (lenDelta < 0) summary.push(`Геном B короче на ${-lenDelta} байт (${cmp.aLength} → ${cmp.bLength}).`)
  else summary.push(`Одинаковая длина (${cmp.aLength} байт), но содержимое отличается.`)

  summary.push(
    `Изменено ~${cmp.changedByteCount} байт, ${cmp.changedInstructionCount} инструкций в дизассемблере.`,
  )

  if (ctx?.parentChild) {
    const { parentKey, childKey } = ctx.parentChild
    summary.push(
      `Геном ${shortGenomeKey(childKey)} — потомок ${shortGenomeKey(parentKey)} в генеалогии.`,
    )
  } else if (ctx?.genomeKeyA != null && ctx?.genomeKeyB != null) {
    summary.push(
      `Сравнение генов ${shortGenomeKey(ctx.genomeKeyA)} и ${shortGenomeKey(ctx.genomeKeyB)}.`,
    )
  }

  const instructionChanges = cmp.alignedRows.filter((r) => r.kind !== 'equal').slice(0, 8)
  for (const row of instructionChanges) {
    if (row.kind === 'del' && row.aLine) {
      summary.push(`Удалено: ${disasmLineHuman(row.aLine.text)} (${row.aLine.bytesHex})`)
    } else if (row.kind === 'ins' && row.bLine) {
      summary.push(`Добавлено: ${disasmLineHuman(row.bLine.text)} (${row.bLine.bytesHex})`)
    } else if (row.kind === 'chg' && row.aLine && row.bLine) {
      summary.push(
        `Изменено: ${disasmLineHuman(row.aLine.text)} → ${disasmLineHuman(row.bLine.text)}`,
      )
    }
  }
  if (cmp.changedInstructionCount > 8) {
    summary.push(`… и ещё ${cmp.changedInstructionCount - 8} отличий в инструкциях.`)
  }

  const traits = traitDiffs(a, b)
  for (const t of traits) {
    summary.push(`Черта «${t.label}»: ${t.a} → ${t.b}.`)
  }

  return { summary, traits }
}

/** Строки unified diff с контекстом (как git diff -U3) */
export function unifiedDiffRows(
  cmp: GenomeCompareResult,
  contextLines = 2,
): AlignedDiffRow[] {
  const rows = cmp.alignedRows
  const changed = new Set<number>()
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.kind !== 'equal') changed.add(i)
  }
  if (changed.size === 0) return rows

  const include = new Set<number>()
  for (const idx of changed) {
    for (let k = Math.max(0, idx - contextLines); k <= Math.min(rows.length - 1, idx + contextLines); k++) {
      include.add(k)
    }
  }

  const result: AlignedDiffRow[] = []
  let prev = -2
  for (let i = 0; i < rows.length; i++) {
    if (!include.has(i)) continue
    if (prev >= 0 && i > prev + 1) {
      result.push({ kind: 'ctx', prefix: ' ', })
    }
    result.push(rows[i]!)
    prev = i
  }
  return result
}
