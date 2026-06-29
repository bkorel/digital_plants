import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import {
  disassemble,
  genomeDepthCap,
  genomeDoubleGrowth,
  genomeHeightCap,
  genomeHue,
  genomeMaxAge,
  genomeSeedReserve,
  genomeShadeSenescence,
  genomeShootRange,
  serializeGenome,
  doubleGrowthLabel,
  shadeSenescenceLabel,
  deserializeGenome,
  hardyTemplateGenome,
  spikeShooterTemplateGenome,
  shyPlantTemplateGenome,
} from '../sim/genome'
import { assembleProgram, parseInstructionLine } from '../sim/genomeAssembler'
import {
  SNIPPETS,
  GENOME_BLOCKS,
  SNIPPET_CATEGORY_LABELS,
  getCompletions,
  hypothesisPairs,
  snippetsByCategory,
  type GenomeBlock,
  type GenomeSnippet,
} from '../sim/genomeSnippets'
import { disasmLineHelp, disasmLineHuman } from '../sim/genomeHelp'
import { SHADED_SPROUT_LAYERS, LAB_WORLD } from '../sim/config'
import type { Genome } from '../sim/types'
import type { LabGenomeCoverage } from '../sim/labSession'
import type { GenomeStepTraceView, StepLineHighlight, StepLineKind } from '../sim/genomeStepTrace'
import { Rng } from '../sim/rng'

export type EditorMode = 'asm' | 'hex'

export interface GenomeChangeOptions {
  replant?: boolean
}

interface EditorLine {
  id: string
  text: string
  error?: string
}

interface Props {
  appliedGenome: Genome
  onCommit: (genome: Genome) => void
  onDraftChange?: (genome: Genome) => void
  executionCoverage?: LabGenomeCoverage | null
  stepTrace?: GenomeStepTraceView | null
}

let lineIdSeq = 0
function nextLineId(): string {
  return `ln-${++lineIdSeq}`
}

function genomeToLines(genome: Genome): EditorLine[] {
  return disassemble(genome).map((l) => ({ id: nextLineId(), text: l.text }))
}

function assembleFromEditorLines(lines: EditorLine[]): Genome {
  return assembleProgram(lines.map((l) => l.text).join('\n')).genome
}

const COMPACT_ASM_LINES = 80

function linesToAsmText(lines: EditorLine[]): string {
  return lines.map((l) => l.text).join('\n')
}

function asmTextToLines(text: string): EditorLine[] {
  return text.split('\n').map((line) => ({ id: nextLineId(), text: line }))
}

function mergeStepEntry(
  map: Map<number, StepLineHighlight>,
  lineIndex: number,
  kind: StepLineKind,
  detail: string | undefined,
  cellId: number,
): void {
  const prev = map.get(lineIndex)
  if (!prev) {
    map.set(lineIndex, { kind, detail, cellIds: [cellId] })
    return
  }
  const priority: Record<StepLineKind, number> = { sense: 3, skipped: 2, executed: 1 }
  const mergedKind = priority[kind] > priority[prev.kind] ? kind : prev.kind
  const mergedDetail = mergedKind === kind && detail ? detail : prev.detail ?? detail
  const cellIds = prev.cellIds.includes(cellId) ? prev.cellIds : [...prev.cellIds, cellId]
  map.set(lineIndex, { kind: mergedKind, detail: mergedDetail, cellIds })
}

function GenomeEditor({ appliedGenome, onCommit, onDraftChange, executionCoverage, stepTrace }: Props) {
  const initialLines = useMemo(() => genomeToLines(appliedGenome), [appliedGenome])
  const [mode, setMode] = useState<EditorMode>('asm')
  const [lines, setLines] = useState<EditorLine[]>(initialLines)
  const [asmView, setAsmView] = useState<'lines' | 'bulk'>(() =>
    initialLines.length > COMPACT_ASM_LINES ? 'bulk' : 'lines',
  )
  const [asmBulkText, setAsmBulkText] = useState(() => linesToAsmText(initialLines))
  const [hexText, setHexText] = useState(() => serializeGenome(appliedGenome))
  const [committedHex, setCommittedHex] = useState(() => serializeGenome(appliedGenome))
  const [expandedHelp, setExpandedHelp] = useState<number | null>(null)
  const [activeLineIdx, setActiveLineIdx] = useState<number | null>(null)
  const [anchorLineIdx, setAnchorLineIdx] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [completions, setCompletions] = useState<ReturnType<typeof getCompletions>>([])
  const [completionIdx, setCompletionIdx] = useState(0)
  const [snippetCategory, setSnippetCategory] = useState<GenomeSnippet['category'] | 'all'>('all')
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map())
  const bulkDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const draftGenome = useMemo(() => assembleFromEditorLines(lines), [lines])
  const isDirty = serializeGenome(draftGenome) !== committedHex

  const traits = useMemo(() => {
    const g = draftGenome
    return {
      maxAge: genomeMaxAge(g),
      seedReserve: genomeSeedReserve(g),
      heightCap: genomeHeightCap(g),
      depthCap: genomeDepthCap(g),
      shootRange: genomeShootRange(g),
      shade: shadeSenescenceLabel(genomeShadeSenescence(g)),
      doubleGrow: doubleGrowthLabel(genomeDoubleGrowth(g)),
      hue: genomeHue(g),
      bytes: g.code.length,
    }
  }, [draftGenome])

  const syncFromGenome = useCallback((g: Genome) => {
    const hex = serializeGenome(g)
    const nextLines = genomeToLines(g)
    setLines(nextLines)
    setAsmBulkText(linesToAsmText(nextLines))
    setAsmView(nextLines.length > COMPACT_ASM_LINES ? 'bulk' : 'lines')
    setHexText(hex)
    setCommittedHex(hex)
    setSelectedIds(new Set())
    setAnchorLineIdx(null)
    setExpandedHelp(null)
  }, [])

  useEffect(
    () => () => {
      if (bulkDebounceRef.current) clearTimeout(bulkDebounceRef.current)
    },
    [],
  )

  const applyDraftLines = useCallback(
    (newLines: EditorLine[], options?: GenomeChangeOptions) => {
      const parsed = newLines.map((l) => {
        const r = parseInstructionLine(l.text)
        return { ...l, error: r.error }
      })
      setLines(parsed)
      const assembled = assembleFromEditorLines(parsed)
      const hex = serializeGenome(assembled)
      setHexText(hex)
      setAsmBulkText(linesToAsmText(parsed))
      onDraftChange?.(assembled)
      if (options?.replant) {
        setCommittedHex(hex)
        setSelectedIds(new Set())
        onCommit(assembled)
      }
    },
    [onCommit, onDraftChange],
  )

  const applyBulkText = (text: string) => {
    applyDraftLines(asmTextToLines(text))
    setAsmBulkText(text)
  }

  const scheduleBulkApply = (text: string) => {
    setAsmBulkText(text)
    if (bulkDebounceRef.current) clearTimeout(bulkDebounceRef.current)
    bulkDebounceRef.current = setTimeout(() => applyBulkText(text), 250)
  }

  const flushBulkApply = () => {
    if (bulkDebounceRef.current) {
      clearTimeout(bulkDebounceRef.current)
      bulkDebounceRef.current = null
    }
    applyBulkText(asmBulkText)
  }

  const commitToLab = () => {
    if (asmView === 'bulk') {
      if (bulkDebounceRef.current) {
        clearTimeout(bulkDebounceRef.current)
        bulkDebounceRef.current = null
      }
      applyDraftLines(asmTextToLines(asmBulkText), { replant: true })
      return
    }
    applyDraftLines(lines, { replant: true })
  }

  const focusLine = (idx: number) => {
    setActiveLineIdx(idx)
    requestAnimationFrame(() => {
      const input = inputRefs.current.get(idx)
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
    })
  }

  const switchToAsm = () => {
    try {
      const g = deserializeGenome(hexText)
      syncFromGenome(g)
      onCommit(g)
    } catch {
      /* keep current */
    }
    setMode('asm')
  }

  const switchToHex = () => {
    setHexText(serializeGenome(draftGenome))
    setMode('hex')
  }

  const applyHex = () => {
    try {
      const g = deserializeGenome(hexText)
      syncFromGenome(g)
      onCommit(g)
    } catch {
      /* invalid hex */
    }
  }

  const updateLine = (idx: number, text: string, cursorPos?: number) => {
    const next = lines.map((l, i) => (i === idx ? { ...l, text } : l))
    if (cursorPos != null) {
      setCompletions(getCompletions(text, cursorPos))
      setCompletionIdx(0)
    }
    applyDraftLines(next)
  }

  const appendLines = (textLines: string[]) => {
    const extra = textLines.map((text) => ({ id: nextLineId(), text }))
    applyDraftLines([...lines, ...extra])
  }

  const replaceWithBlock = (block: GenomeBlock) => {
    const newLines = block.lines.map((text) => ({ id: nextLineId(), text }))
    applyDraftLines(newLines)
  }

  const insertSnippet = (snippet: GenomeSnippet) => {
    appendLines(snippet.lines)
  }

  const appendBlock = (block: GenomeBlock) => {
    appendLines(block.lines)
  }

  const applyHypothesis = (conditionLines: string[], actionLine: string, lineIdx: number) => {
    const cond = conditionLines.map((text) => ({ id: nextLineId(), text }))
    const action = { id: nextLineId(), text: actionLine }
    const before = lines.slice(0, lineIdx)
    const after = lines.slice(lineIdx + 1)
    applyDraftLines([...before, ...cond, action, ...after])
  }

  const addLine = (afterIdx: number) => {
    const nl = { id: nextLineId(), text: 'NOP' }
    const merged = [...lines.slice(0, afterIdx + 1), nl, ...lines.slice(afterIdx + 1)]
    applyDraftLines(merged)
    focusLine(afterIdx + 1)
  }

  const removeLinesById = (ids: Set<string>) => {
    if (ids.size === 0) return
    let remaining = lines.filter((l) => !ids.has(l.id))
    if (remaining.length === 0) {
      remaining = [{ id: nextLineId(), text: 'NOP' }]
    }
    const firstRemovedIdx = lines.findIndex((l) => ids.has(l.id))
    applyDraftLines(remaining)
    setSelectedIds(new Set())
    focusLine(Math.min(firstRemovedIdx, remaining.length - 1))
  }

  const removeLine = (idx: number) => {
    removeLinesById(new Set([lines[idx]!.id]))
  }

  const duplicateLine = (idx: number) => {
    const copy = { id: nextLineId(), text: lines[idx]!.text }
    const merged = [...lines.slice(0, idx + 1), copy, ...lines.slice(idx + 1)]
    applyDraftLines(merged)
    focusLine(idx + 1)
  }

  const toggleLineSelection = (idx: number, shiftKey: boolean) => {
    const id = lines[idx]!.id
    if (shiftKey && anchorLineIdx != null) {
      const a = Math.min(anchorLineIdx, idx)
      const b = Math.max(anchorLineIdx, idx)
      const rangeIds = lines.slice(a, b + 1).map((l) => l.id)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const rid of rangeIds) next.add(rid)
        return next
      })
      return
    }
    setAnchorLineIdx(idx)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllLines = () => {
    setSelectedIds(new Set(lines.map((l) => l.id)))
    setAnchorLineIdx(0)
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    setAnchorLineIdx(null)
  }

  const loadTemplate = (which: 'hardy' | 'shooter' | 'shy') => {
    const g =
      which === 'hardy'
        ? hardyTemplateGenome(new Rng(42))
        : which === 'shooter'
          ? spikeShooterTemplateGenome()
          : shyPlantTemplateGenome()
    syncFromGenome(g)
    onCommit(g)
  }

  const acceptCompletion = (idx: number) => {
    const item = completions[completionIdx]
    if (!item) return
    const line = lines[idx]!
    const input = inputRefs.current.get(idx)
    const cursor = input?.selectionStart ?? line.text.length
    const before = line.text.slice(0, cursor).replace(/\S+$/, '')
    const newText = before + item.insert
    updateLine(idx, newText)
    setCompletions([])
  }

  const visibleSnippets =
    snippetCategory === 'all' ? SNIPPETS : snippetsByCategory(snippetCategory)

  const errorCount = lines.filter((l) => l.error).length
  const selectedCount = selectedIds.size

  const disasmForHelp = useMemo(() => {
    if (expandedHelp === null) return []
    return disassemble(draftGenome)
  }, [draftGenome, expandedHelp])

  const executedLines = useMemo(
    () => new Set(executionCoverage?.hitLineIndices ?? []),
    [executionCoverage],
  )
  const structuralLines = useMemo(
    () => new Set(executionCoverage?.structuralLineIndices ?? []),
    [executionCoverage],
  )
  const stopLineIndex = executionCoverage?.stopLineIndex ?? null
  const stopTick = executionCoverage?.stopTick ?? -1

  const [stepAnimProgress, setStepAnimProgress] = useState(0)
  const stepPulseRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!stepTrace || stepTrace.sequence.length === 0) {
      setStepAnimProgress(0)
      return
    }
    setStepAnimProgress(stepTrace.sequence.length)
  }, [stepTrace])

  const stepLineHighlights = useMemo(() => {
    if (!stepTrace) return null
    const done = stepAnimProgress >= stepTrace.sequence.length
    if (done) return stepTrace.lineHighlights

    const map = new Map<number, StepLineHighlight>()
    for (let i = 0; i < stepAnimProgress; i++) {
      const entry = stepTrace.sequence[i]!
      mergeStepEntry(map, entry.lineIndex, entry.kind, entry.detail, entry.cellId)
    }
    return map
  }, [stepTrace, stepAnimProgress])

  const stepPulseLineIndex = useMemo(() => {
    if (!stepTrace || stepAnimProgress <= 0) return null
    if (stepAnimProgress >= stepTrace.sequence.length) return null
    return stepTrace.sequence[stepAnimProgress - 1]?.lineIndex ?? null
  }, [stepTrace, stepAnimProgress])

  useEffect(() => {
    if (stepPulseLineIndex == null) return
    stepPulseRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [stepPulseLineIndex])

  const showStepTrace =
    stepTrace != null &&
    ((stepLineHighlights != null && stepLineHighlights.size > 0) ||
      stepTrace.sequence.length > 0)
  const showBulkHighlight =
    asmView === 'bulk' &&
    (showStepTrace ||
      (!showStepTrace &&
        executionCoverage != null &&
        executionCoverage.hitLineIndices.length > 0))

  const bulkTextRef = useRef<HTMLTextAreaElement>(null)
  const bulkGutterRef = useRef<HTMLDivElement>(null)

  const syncBulkScroll = useCallback(() => {
    const gutter = bulkGutterRef.current
    const text = bulkTextRef.current
    if (gutter && text) gutter.scrollTop = text.scrollTop
  }, [])

  const bulkLineClass = useCallback(
    (idx: number): string => {
      if (showStepTrace) {
        const hl = stepLineHighlights?.get(idx)
        if (hl) return `genome-editor__bulk-line--step-${hl.kind}`
      }
      if (!showStepTrace && stopLineIndex === idx) return 'genome-editor__bulk-line--stop'
      if (!showStepTrace && structuralLines.has(idx)) return 'genome-editor__bulk-line--structural'
      if (!showStepTrace && executedLines.has(idx)) return 'genome-editor__bulk-line--executed'
      return ''
    },
    [
      showStepTrace,
      stepLineHighlights,
      stopLineIndex,
      structuralLines,
      executedLines,
    ],
  )

  return (
    <div className="genome-editor">
      <div className="genome-editor__toolbar">
        <div className="genome-editor__tabs">
          <button type="button" className={mode === 'asm' ? 'active' : ''} onClick={switchToAsm}>
            Ассемблер
          </button>
          <button type="button" className={mode === 'hex' ? 'active' : ''} onClick={switchToHex}>
            Hex
          </button>
        </div>
        <div className="genome-editor__templates">
          <button type="button" onClick={() => loadTemplate('hardy')}>
            Живучий
          </button>
          <button type="button" onClick={() => loadTemplate('shooter')}>
            Стрелок
          </button>
          <button type="button" onClick={() => loadTemplate('shy')}>
            Стеснитель
          </button>
        </div>
      </div>

      <div className="genome-editor__commit-bar">
        <button
          type="button"
          className="genome-editor__commit-btn"
          onClick={commitToLab}
          disabled={!isDirty}
          title="Пересадить растение с текущим кодом в лаборатории"
        >
          {isDirty ? '● Применить в лабораторию' : 'Код применён'}
        </button>
        {isDirty && (
          <span className="genome-editor__commit-hint">Симуляция не сбрасывается, пока не примените</span>
        )}
      </div>

      {stepTrace && stepTrace.sequence.length > 0 && (
        <div className="genome-editor__step-legend">
          <span className="genome-editor__step-tick">шаг · тик {stepTrace.tick}</span>
          <span className="genome-editor__coverage-chip genome-editor__coverage-chip--step-executed">
            сработало
          </span>
          <span className="genome-editor__coverage-chip genome-editor__coverage-chip--step-skipped">
            пропущено
          </span>
          <span className="genome-editor__coverage-chip genome-editor__coverage-chip--step-sense">
            SENSE
          </span>
          <span className="genome-editor__step-meta">
            {stepTrace.tracedCellCount} меристем
            {stepTrace.activeCellCount > 0 && ` · ${stepTrace.activeCellCount} с движением`}
            {stepAnimProgress < stepTrace.sequence.length &&
              ` · ${stepAnimProgress}/${stepTrace.sequence.length}`}
          </span>
        </div>
      )}

      {!showStepTrace && executionCoverage && executionCoverage.hitLineIndices.length > 0 && (
        <div className="genome-editor__coverage-legend">
          <span className="genome-editor__coverage-chip genome-editor__coverage-chip--executed">
            исполнено ({executionCoverage.hitLineIndices.length})
          </span>
          <span className="genome-editor__coverage-chip genome-editor__coverage-chip--structural">
            структура ({executionCoverage.structuralLineIndices.length})
          </span>
          {stopLineIndex != null && (
            <span className="genome-editor__coverage-chip genome-editor__coverage-chip--stop">
              стоп: строка {stopLineIndex + 1} · тик {stopTick}
            </span>
          )}
        </div>
      )}

      <div className="genome-editor__traits">
        <span>maxAge: {traits.maxAge}</span>
        <span>байт: {traits.bytes}</span>
        <span>высота: ~{Math.round(traits.heightCap * LAB_WORLD.SOIL_Y)} кл.</span>
        <span>корни: ~{Math.round(traits.depthCap * (LAB_WORLD.H - LAB_WORLD.SOIL_Y))} кл.</span>
        <span>SHOOT: {traits.shootRange}</span>
        <span>тень (&gt;{SHADED_SPROUT_LAYERS}): {traits.shade}</span>
        <span
          className="genome-editor__hue"
          style={{ background: `hsl(${traits.hue}, 55%, 45%)` }}
        />
      </div>

      {mode === 'hex' ? (
        <div className="genome-editor__hex">
          <textarea value={hexText} onChange={(e) => setHexText(e.target.value)} spellCheck={false} />
          <button type="button" onClick={applyHex}>
            Применить hex
          </button>
        </div>
      ) : asmView === 'bulk' ? (
        <div className="genome-editor__bulk">
          <div className="genome-editor__bulk-toolbar">
            <span>{lines.length} строк · компактный редактор</span>
            {showStepTrace && (
              <span className="genome-editor__bulk-coverage genome-editor__bulk-coverage--step">
                шаг · тик {stepTrace!.tick}
              </span>
            )}
            {!showStepTrace && executionCoverage && executionCoverage.hitLineIndices.length > 0 && (
              <span className="genome-editor__bulk-coverage">
                сработало {executionCoverage.hitLineIndices.length}/{lines.length}
                {stopLineIndex != null && ` · стоп: ${stopLineIndex + 1}`}
              </span>
            )}
            <button type="button" onClick={() => setAsmView('lines')} title="Построчный режим с подсветкой">
              Построчно
            </button>
          </div>
          {showBulkHighlight ? (
            <div className="genome-editor__bulk-split">
              <div
                ref={bulkGutterRef}
                className="genome-editor__bulk-gutter"
                aria-hidden
              >
                {lines.map((line, idx) => {
                  const gutterClass = bulkLineClass(idx)
                  return (
                  <div
                    key={line.id}
                    className={`genome-editor__bulk-line${gutterClass ? ` ${gutterClass}` : ''}`}
                    title={stepLineHighlights?.get(idx)?.detail}
                  >
                    {idx + 1}
                  </div>
                  )
                })}
              </div>
              <textarea
                ref={bulkTextRef}
                className="genome-editor__bulk-text genome-editor__bulk-text--with-gutter"
                value={asmBulkText}
                spellCheck={false}
                onScroll={syncBulkScroll}
                onChange={(e) => scheduleBulkApply(e.target.value)}
                onBlur={flushBulkApply}
              />
            </div>
          ) : (
            <textarea
              className="genome-editor__bulk-text"
              value={asmBulkText}
              spellCheck={false}
              onChange={(e) => scheduleBulkApply(e.target.value)}
              onBlur={flushBulkApply}
            />
          )}
        </div>
      ) : (
        <>
          <div className="genome-editor__line-toolbar">
            {lines.length > COMPACT_ASM_LINES && (
              <button type="button" onClick={() => setAsmView('bulk')}>
                Компактно ({lines.length} стр.)
              </button>
            )}
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => removeLinesById(selectedIds)}
            >
              Удалить{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
            <button type="button" onClick={selectAllLines}>
              Выделить всё
            </button>
            <button type="button" disabled={selectedCount === 0} onClick={clearSelection}>
              Снять выделение
            </button>
            <button
              type="button"
              onClick={() => applyDraftLines([{ id: nextLineId(), text: 'NOP' }])}
              title="Оставить одну пустую инструкцию"
            >
              Очистить
            </button>
            <span className="genome-editor__line-toolbar-hint">
              Shift+клик по № — диапазон · ⌫ на пустой строке — удалить · ⌘⌫ — удалить строку
            </span>
          </div>

          <div className="genome-editor__lines">
            {lines.map((line, idx) => {
              const selected = selectedIds.has(line.id)
              const stepHl = showStepTrace ? stepLineHighlights!.get(idx) : undefined
              const executed = !showStepTrace && executedLines.has(idx)
              const structural = !showStepTrace && structuralLines.has(idx)
              const isStop = !showStepTrace && stopLineIndex === idx
              const stepClass =
                stepHl?.kind === 'executed'
                  ? ' genome-editor__line--step-executed'
                  : stepHl?.kind === 'skipped'
                    ? ' genome-editor__line--step-skipped'
                    : stepHl?.kind === 'sense'
                      ? ' genome-editor__line--step-sense'
                      : ''
              const pulseClass = stepPulseLineIndex === idx ? ' genome-editor__line--step-pulse' : ''
              return (
                <div
                  key={line.id}
                  ref={stepPulseLineIndex === idx ? stepPulseRef : undefined}
                  className={`genome-editor__line${line.error ? ' genome-editor__line--error' : ''}${selected ? ' genome-editor__line--selected' : ''}${executed ? ' genome-editor__line--executed' : ''}${structural ? ' genome-editor__line--structural' : ''}${isStop ? ' genome-editor__line--stop' : ''}${stepClass}${pulseClass}`}
                  title={stepHl?.detail}
                >
                  <button
                    type="button"
                    className={`genome-editor__line-select${selected ? ' genome-editor__line-select--on' : ''}`}
                    title="Выделить строку (Shift — диапазон)"
                    onClick={(e) => toggleLineSelection(idx, e.shiftKey)}
                  >
                    {isStop ? '⏹' : idx + 1}
                  </button>
                  <input
                    ref={(el) => {
                      if (el) inputRefs.current.set(idx, el)
                    }}
                    type="text"
                    value={line.text}
                    spellCheck={false}
                    onFocus={() => {
                      setActiveLineIdx(idx)
                      setExpandedHelp(null)
                    }}
                    onChange={(e) => updateLine(idx, e.target.value, e.target.selectionStart ?? undefined)}
                    onKeyDown={(e) => {
                      if (completions.length > 0 && e.key === 'Tab') {
                        e.preventDefault()
                        acceptCompletion(idx)
                      }
                      if (completions.length > 0 && e.key === 'ArrowDown') {
                        e.preventDefault()
                        setCompletionIdx((i) => Math.min(i + 1, completions.length - 1))
                      }
                      if (
                        (e.key === 'Backspace' || e.key === 'Delete') &&
                        line.text === '' &&
                        lines.length > 1
                      ) {
                        e.preventDefault()
                        removeLine(idx)
                      }
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') {
                        e.preventDefault()
                        removeLine(idx)
                      }
                    }}
                  />
                  <span className="genome-editor__line-actions">
                    <button type="button" title="Добавить ниже" onClick={() => addLine(idx)}>
                      +
                    </button>
                    <button type="button" title="Дублировать" onClick={() => duplicateLine(idx)}>
                      ⧉
                    </button>
                    <button type="button" title="Удалить строку" onClick={() => removeLine(idx)}>
                      ×
                    </button>
                    <button
                      type="button"
                      title="Пояснение"
                      onClick={() => setExpandedHelp(expandedHelp === idx ? null : idx)}
                    >
                      ?
                    </button>
                  </span>
                  {stepHl?.detail && (
                    <span className={`genome-editor__step-detail genome-editor__step-detail--${stepHl.kind}`}>
                      {stepHl.detail}
                    </span>
                  )}
                  {line.error && <div className="genome-editor__line-error">{line.error}</div>}
                  {expandedHelp === idx && disasmForHelp[idx] && (
                    <div className="genome-editor__help">
                      <div>{disasmLineHuman(disasmForHelp[idx]!.text)}</div>
                      <div className="genome-editor__help-detail">{disasmLineHelp(disasmForHelp[idx]!.text)}</div>
                    </div>
                  )}
                  {activeLineIdx === idx && completions.length > 0 && (
                    <ul className="genome-editor__completions">
                      {completions.map((c, ci) => (
                        <li
                          key={c.label}
                          className={ci === completionIdx ? 'active' : ''}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setCompletionIdx(ci)
                            acceptCompletion(idx)
                          }}
                        >
                          <strong>{c.label}</strong>
                          {c.detail && <span>{c.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="genome-editor__blocks">
        <h3>Каркасы</h3>
        <p className="genome-editor__blocks-hint">
          Секции добавляются в черновик — нажмите «Применить в лабораторию», чтобы пересадить.
          {errorCount > 0 && (
            <span className="genome-editor__blocks-errors"> · ошибок в коде: {errorCount}</span>
          )}
        </p>
        <div className="genome-editor__block-grid">
          {GENOME_BLOCKS.map((block) => (
            <div key={block.id} className="genome-editor__block-card">
              <div className="genome-editor__block-title">{block.label}</div>
              <div className="genome-editor__block-desc">{block.description}</div>
              <div className="genome-editor__block-actions">
                <button type="button" onClick={() => replaceWithBlock(block)}>
                  Заменить
                </button>
                <button type="button" onClick={() => appendBlock(block)}>
                  + В конец
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="genome-editor__snippets">
        <h3>Сниппеты</h3>
        <p className="genome-editor__snippets-hint">В конец программы. Порядок важен — затем «Применить в лабораторию».</p>
        <div className="genome-editor__snippet-categories">
          <button
            type="button"
            className={snippetCategory === 'all' ? 'active' : ''}
            onClick={() => setSnippetCategory('all')}
          >
            Все
          </button>
          {(Object.keys(SNIPPET_CATEGORY_LABELS) as GenomeSnippet['category'][]).map((cat) => (
            <button
              key={cat}
              type="button"
              className={snippetCategory === cat ? 'active' : ''}
              onClick={() => setSnippetCategory(cat)}
            >
              {SNIPPET_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
        <div className="genome-editor__snippet-grid">
          {visibleSnippets.map((s) => (
            <button
              key={s.id}
              type="button"
              className="genome-editor__snippet"
              title={s.description}
              onClick={() => insertSnippet(s)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="genome-editor__hypotheses">
        <h3>Гипотезы</h3>
        {hypothesisPairs().map(({ base, alt }) => (
          <div key={base.id} className="genome-editor__hypothesis-pair">
            <span className="genome-editor__hypothesis-label">{base.label}</span>
            <button
              type="button"
              onClick={() => applyHypothesis(base.conditionLines, base.actionLine, activeLineIdx ?? lines.length - 1)}
            >
              A
            </button>
            <button
              type="button"
              onClick={() => applyHypothesis(alt.conditionLines, alt.actionLine, activeLineIdx ?? lines.length - 1)}
            >
              B
            </button>
            <span className="genome-editor__hypothesis-desc">{base.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(GenomeEditor, (prev, next) => {
  return (
    prev.appliedGenome === next.appliedGenome &&
    prev.executionCoverage === next.executionCoverage &&
    prev.stepTrace === next.stepTrace &&
    prev.onCommit === next.onCommit &&
    prev.onDraftChange === next.onDraftChange
  )
})
