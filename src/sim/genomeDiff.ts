import { WORLD } from './config'
import {
  disassemble,
  genomeDepthCap,
  genomeDoubleGrowth,
  genomeHeightCap,
  genomeMaxAge,
  genomeSeedReserve,
  genomeShadeSenescence,
  genomeShootRange,
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

export interface DiffHunk {
  id: number
  header: string
  rows: AlignedDiffRow[]
  hiddenBefore: number
  hiddenAfter: number
  gapBeforeId?: number
  startIndex: number
  endIndex: number
}

export interface DiffGap {
  id: number
  rowCount: number
  rows: AlignedDiffRow[]
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

function disasmLineEqual(a: DisasmLine, b: DisasmLine): boolean {
  return a.text === b.text && a.bytesHex === b.bytesHex
}

function disasmLineKey(line: DisasmLine): string {
  return `${line.text}\0${line.bytesHex}`
}

/** LIS по bi при partners, отсортированных по ai (patience diff). */
function patienceAnchorChain(partners: Array<{ ai: number; bi: number }>): Array<{ ai: number; bi: number }> {
  if (partners.length === 0) return []
  const tail: number[] = []
  const prev = new Array<number>(partners.length).fill(-1)
  for (let i = 0; i < partners.length; i++) {
    const bi = partners[i]!.bi
    let lo = 0
    let hi = tail.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (partners[tail[mid]!]!.bi < bi) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tail[lo - 1]!
    tail[lo] = i
  }
  const chain: number[] = []
  let k = tail.length > 0 ? tail[tail.length - 1]! : -1
  while (k >= 0) {
    chain.push(k)
    k = prev[k]!
  }
  chain.reverse()
  return chain.map((i) => partners[i]!)
}

/**
 * Patience diff: якоря — инструкции, встречающиеся ровно один раз в обоих геномах.
 * Между якорями — editAlign (короткие участки с повторяющимися LT/GT/AND).
 */
function patienceAlign<T>(
  a: T[],
  b: T[],
  key: (x: T) => string,
  eq: (x: T, y: T) => boolean,
): Array<{ a?: T; b?: T }> {
  if (a.length === 0) return b.map((line) => ({ b: line }))
  if (b.length === 0) return a.map((line) => ({ a: line }))

  const countA = new Map<string, number>()
  const countB = new Map<string, number>()
  for (const line of a) countA.set(key(line), (countA.get(key(line)) ?? 0) + 1)
  for (const line of b) countB.set(key(line), (countB.get(key(line)) ?? 0) + 1)

  const bPosByKey = new Map<string, number>()
  for (let j = 0; j < b.length; j++) {
    const k = key(b[j]!)
    if (countB.get(k) === 1) bPosByKey.set(k, j)
  }

  const partners: Array<{ ai: number; bi: number }> = []
  for (let i = 0; i < a.length; i++) {
    const k = key(a[i]!)
    if (countA.get(k) !== 1 || countB.get(k) !== 1) continue
    const j = bPosByKey.get(k)
    if (j != null) partners.push({ ai: i, bi: j })
  }

  if (partners.length === 0) return editAlign(a, b, eq)

  const anchors = patienceAnchorChain(partners)
  const result: Array<{ a?: T; b?: T }> = []
  let aStart = 0
  let bStart = 0
  for (const { ai, bi } of anchors) {
    if (ai > aStart || bi > bStart) {
      result.push(...patienceAlign(a.slice(aStart, ai), b.slice(bStart, bi), key, eq))
    }
    result.push({ a: a[ai], b: b[bi] })
    aStart = ai + 1
    bStart = bi + 1
  }
  if (aStart < a.length || bStart < b.length) {
    result.push(...patienceAlign(a.slice(aStart), b.slice(bStart), key, eq))
  }
  return result
}

/** Короткий edit-distance diff (fallback между patience-якорями). */
function editAlign<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Array<{ a?: T; b?: T }> {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((line) => ({ b: line }))
  if (m === 0) return a.map((line) => ({ a: line }))

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const sub = 1 + dp[i + 1]![j + 1]!
      dp[i]![j] = Math.min(1 + dp[i + 1]![j]!, 1 + dp[i]![j + 1]!, sub)
    }
  }

  const result: Array<{ a?: T; b?: T }> = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && dp[i]![j] === dp[i + 1]![j + 1]! + 1) {
      result.push(eq(a[i]!, b[j]!) ? { a: a[i], b: b[j] } : { a: a[i], b: b[j] })
      i++
      j++
    } else if (j < m && (i >= n || dp[i]![j] === dp[i]![j + 1]! + 1)) {
      result.push({ b: b[j] })
      j++
    } else {
      result.push({ a: a[i] })
      i++
    }
  }
  return result
}

function toRow(aLine?: DisasmLine, bLine?: DisasmLine): AlignedDiffRow {
  if (aLine && bLine) {
    const same = disasmLineEqual(aLine, bLine)
    return { kind: same ? 'equal' : 'chg', aLine, bLine, prefix: same ? ' ' : '!' }
  }
  if (aLine) return { kind: 'del', aLine, prefix: '-' }
  return { kind: 'ins', bLine: bLine!, prefix: '+' }
}

/** Склеить del/ins в одну строку side-by-side (GitHub split view) */
export function pairDeleteInsertRows(rows: AlignedDiffRow[]): AlignedDiffRow[] {
  const result: AlignedDiffRow[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]!
    if (row.kind === 'equal' || row.kind === 'chg') {
      result.push(row)
      i++
      continue
    }
    const runStart = i
    while (i < rows.length && (rows[i]!.kind === 'del' || rows[i]!.kind === 'ins')) {
      i++
    }
    const run = rows.slice(runStart, i)
    const dels = run.filter((r) => r.kind === 'del').map((r) => r.aLine!)
    const inses = run.filter((r) => r.kind === 'ins').map((r) => r.bLine!)
    const maxLen = Math.max(dels.length, inses.length)
    for (let k = 0; k < maxLen; k++) {
      const aLine = dels[k]
      const bLine = inses[k]
      if (aLine && bLine) {
        result.push(toRow(aLine, bLine))
      } else if (aLine) {
        result.push({ kind: 'del', aLine, prefix: '-' })
      } else if (bLine) {
        result.push({ kind: 'ins', bLine, prefix: '+' })
      }
    }
  }
  return result
}

/** Выравнивание инструкций: patience diff (якоря по уникальным строкам) + edit fallback. */
export function alignDisasm(a: Genome, b: Genome): AlignedDiffRow[] {
  const linesA = disassemble(a)
  const linesB = disassemble(b)
  const aligned = patienceAlign(linesA, linesB, disasmLineKey, disasmLineEqual)
  return aligned.map(({ a: aLine, b: bLine }) => toRow(aLine, bLine))
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
  add('дальность SHOOT', `${genomeShootRange(a)} кл.`, `${genomeShootRange(b)} кл.`)
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

function formatHunkHeader(
  aStartIp: number | undefined,
  aEndIp: number | undefined,
  bStartIp: number | undefined,
  bEndIp: number | undefined,
): string {
  const aPart =
    aStartIp != null && aEndIp != null ? `A ip ${aStartIp}–${aEndIp}` : 'A —'
  const bPart =
    bStartIp != null && bEndIp != null ? `B ip ${bStartIp}–${bEndIp}` : 'B —'
  return `@@ ${aPart} · ${bPart} @@`
}

export function getFullDiffRows(cmp: GenomeCompareResult): AlignedDiffRow[] {
  return cmp.alignedRows
}

/** Hunks с контекстом (как GitHub / git diff -U3) */
export function buildDiffHunks(
  cmp: GenomeCompareResult,
  contextLines = 3,
): { hunks: DiffHunk[]; gaps: DiffGap[]; fullRows: AlignedDiffRow[]; trailingGapId?: number } {
  const rows = cmp.alignedRows
  const fullRows = rows

  if (rows.length === 0) {
    return { hunks: [], gaps: [], fullRows }
  }

  const changed = new Set<number>()
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.kind !== 'equal') changed.add(i)
  }

  if (changed.size === 0) {
    return {
      hunks: [
        {
          id: 0,
          header: '@@ весь геном @@',
          rows,
          hiddenBefore: 0,
          hiddenAfter: 0,
          startIndex: 0,
          endIndex: rows.length - 1,
        },
      ],
      gaps: [],
      fullRows,
    }
  }

  const include = new Set<number>()
  for (const idx of changed) {
    for (
      let k = Math.max(0, idx - contextLines);
      k <= Math.min(rows.length - 1, idx + contextLines);
      k++
    ) {
      include.add(k)
    }
  }

  const sorted = [...include].sort((a, b) => a - b)
  const ranges: Array<[number, number]> = []
  let rangeStart = sorted[0]!
  let prev = sorted[0]!
  for (let i = 1; i < sorted.length; i++) {
    const idx = sorted[i]!
    if (idx > prev + 1) {
      ranges.push([rangeStart, prev])
      rangeStart = idx
    }
    prev = idx
  }
  ranges.push([rangeStart, prev])

  const gaps: DiffGap[] = []
  const hunks: DiffHunk[] = []
  let gapId = 0

  const addGap = (gapStart: number, gapEnd: number): number | undefined => {
    if (gapEnd < gapStart) return undefined
    const gap: DiffGap = {
      id: gapId++,
      rowCount: gapEnd - gapStart + 1,
      rows: rows.slice(gapStart, gapEnd + 1),
    }
    gaps.push(gap)
    return gap.id
  }

  for (let h = 0; h < ranges.length; h++) {
    const [start, end] = ranges[h]!
    const gapBeforeId =
      h === 0
        ? start > 0
          ? addGap(0, start - 1)
          : undefined
        : addGap(ranges[h - 1]![1] + 1, start - 1)

    const hunkRows = rows.slice(start, end + 1)
    const aStartIp = hunkRows.find((r) => r.aLine)?.aLine?.index
    const aEndIp = [...hunkRows].reverse().find((r) => r.aLine)?.aLine?.index
    const bStartIp = hunkRows.find((r) => r.bLine)?.bLine?.index
    const bEndIp = [...hunkRows].reverse().find((r) => r.bLine)?.bLine?.index

    hunks.push({
      id: h,
      header: formatHunkHeader(aStartIp, aEndIp, bStartIp, bEndIp),
      rows: hunkRows,
      hiddenBefore: start,
      hiddenAfter: h < ranges.length - 1 ? 0 : rows.length - 1 - end,
      gapBeforeId,
      startIndex: start,
      endIndex: end,
    })
  }

  const lastEnd = ranges[ranges.length - 1]![1]
  const trailingGapId =
    lastEnd < rows.length - 1 ? addGap(lastEnd + 1, rows.length - 1) : undefined

  return { hunks, gaps, fullRows, trailingGapId }
}

/** @deprecated Используйте buildDiffHunks */
export function unifiedDiffRows(
  cmp: GenomeCompareResult,
  contextLines = 2,
): AlignedDiffRow[] {
  const { hunks, gaps } = buildDiffHunks(cmp, contextLines)
  const result: AlignedDiffRow[] = []
  for (const hunk of hunks) {
    if (hunk.gapBeforeId != null) {
      result.push({ kind: 'ctx', prefix: ' ' })
    }
    result.push(...hunk.rows)
  }
  if (gaps.length > 0 && hunks.length > 0) {
    const lastHunkEnd = hunks[hunks.length - 1]!.endIndex
    if (lastHunkEnd < cmp.alignedRows.length - 1) {
      result.push({ kind: 'ctx', prefix: ' ' })
    }
  }
  return result
}

