import { useMemo, useState } from 'react'
import {
  buildDiffHunks,
  compareGenomes,
  explainGenomeDiff,
  getFullDiffRows,
  type AlignedDiffRow,
  type DiffGap,
  type DiffHunk,
} from '../sim/genomeDiff'
import { disasmLineHuman } from '../sim/genomeHelp'
import { shortGenomeKey, type GenomeLineageNode, type LineageRegistry } from '../sim/lineage'
import type { Genome } from '../sim/types'

interface Props {
  keyA: string
  keyB: string
  genomeA: Genome
  genomeB: Genome
  nodeA?: GenomeLineageNode
  nodeB?: GenomeLineageNode
  lineage: LineageRegistry
  onBack: () => void
  onSwap: () => void
}

function nodeMeta(
  key: string,
  node: GenomeLineageNode | undefined,
  lineage: LineageRegistry,
): string {
  if (!node) return '—'
  const active = lineage.isLineageActive(key)
  const status = active
    ? node.livingCount > 0
      ? `активен, ${node.livingCount} носит.`
      : 'ветвь жива'
    : 'вымер'
  return `${node.genome.code.length} байт · ${node.spawnCount} экз. · тики ${node.firstTick}–${node.lastActiveTick} · ${status}`
}

function gapLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} строка без изменений`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} строки без изменений`
  }
  return `${count} строк без изменений`
}

function DiffRow({ row, rowKey }: { row: AlignedDiffRow; rowKey: string }) {
  const aLine = row.aLine
  const bLine = row.bLine
  const paired = Boolean(aLine && bLine && row.kind === 'chg')
  const prefix =
    row.kind === 'del' ? '-' : row.kind === 'ins' ? '+' : row.kind === 'chg' ? '!' : ' '
  const cls = [
    'genome-diff__line',
    `genome-diff__line--${row.kind}`,
    paired ? 'genome-diff__line--paired' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div key={rowKey} className={cls}>
      <span className="genome-compare__col-prefix">{prefix}</span>
      <span className="genome-compare__col-side">{aLine ? 'A' : ''}</span>
      <span className="genome-compare__col-ip">
        {aLine != null ? aLine.index.toString().padStart(3, ' ') : ''}
      </span>
      <code className="genome-compare__col-hex">{aLine?.bytesHex ?? ''}</code>
      <span className="genome-compare__col-disasm">{aLine?.text ?? ''}</span>
      <span className="genome-compare__col-human">
        {aLine ? disasmLineHuman(aLine.text) : ''}
      </span>
      <span className="genome-compare__col-side">{bLine ? 'B' : ''}</span>
      <span className="genome-compare__col-ip">
        {bLine != null ? bLine.index.toString().padStart(3, ' ') : ''}
      </span>
      <code className="genome-compare__col-hex">{bLine?.bytesHex ?? ''}</code>
      <span className="genome-compare__col-disasm">{bLine?.text ?? ''}</span>
      <span className="genome-compare__col-human">
        {bLine ? disasmLineHuman(bLine.text) : ''}
      </span>
    </div>
  )
}

function GapRow({
  gap,
  expanded,
  onToggle,
}: {
  gap: DiffGap
  expanded: boolean
  onToggle: () => void
}) {
  if (expanded) {
    return (
      <>
        {gap.rows.map((row, i) => (
          <DiffRow key={`gap-${gap.id}-${i}`} row={row} rowKey={`gap-${gap.id}-${i}`} />
        ))}
      </>
    )
  }
  return (
    <button type="button" className="genome-diff__gap" onClick={onToggle}>
      ··· {gapLabel(gap.rowCount)} · развернуть
    </button>
  )
}

export default function GenomeCompareScreen({
  keyA,
  keyB,
  genomeA,
  genomeB,
  nodeA,
  nodeB,
  lineage,
  onBack,
  onSwap,
}: Props) {
  const cmp = useMemo(() => compareGenomes(genomeA, genomeB), [genomeA, genomeB])
  const { hunks, gaps, trailingGapId } = useMemo(() => buildDiffHunks(cmp, 3), [cmp])
  const [showFullGenome, setShowFullGenome] = useState(false)
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(() => new Set())

  const gapById = useMemo(() => new Map(gaps.map((g) => [g.id, g])), [gaps])

  const toggleGap = (gapId: number) => {
    setExpandedGaps((prev) => {
      const next = new Set(prev)
      if (next.has(gapId)) next.delete(gapId)
      else next.add(gapId)
      return next
    })
  }

  const parentChild =
    nodeA && nodeB && nodeB.parentGenomeKeys.includes(keyA)
      ? { parentKey: keyA, childKey: keyB }
      : nodeA && nodeB && nodeA.parentGenomeKeys.includes(keyB)
        ? { parentKey: keyB, childKey: keyA }
        : undefined

  const labelA = shortGenomeKey(keyA, 8)
  const labelB = shortGenomeKey(keyB, 8)

  const { summary, traits } = useMemo(
    () =>
      explainGenomeDiff(genomeA, genomeB, {
        genomeKeyA: keyA,
        genomeKeyB: keyB,
        parentChild,
      }),
    [genomeA, genomeB, keyA, keyB, parentChild],
  )

  const renderHunkView = () => (
    <>
      {hunks.map((hunk: DiffHunk) => (
        <div key={`hunk-${hunk.id}`} className="genome-diff__hunk">
          {hunk.gapBeforeId != null && gapById.has(hunk.gapBeforeId) && (
            <GapRow
              gap={gapById.get(hunk.gapBeforeId)!}
              expanded={expandedGaps.has(hunk.gapBeforeId)}
              onToggle={() => toggleGap(hunk.gapBeforeId!)}
            />
          )}
          <div className="genome-diff__hunk-header">{hunk.header}</div>
          {hunk.rows.map((row, i) => (
            <DiffRow key={`hunk-${hunk.id}-row-${i}`} row={row} rowKey={`hunk-${hunk.id}-row-${i}`} />
          ))}
        </div>
      ))}
      {trailingGapId != null && gapById.has(trailingGapId) && (
        <GapRow
          gap={gapById.get(trailingGapId)!}
          expanded={expandedGaps.has(trailingGapId)}
          onToggle={() => toggleGap(trailingGapId)}
        />
      )}
    </>
  )

  return (
    <div className="genome-compare">
      <div className="genome-explorer__toolbar">
        <button type="button" onClick={onBack}>
          ← Назад
        </button>
        <span className="genome-explorer__title">
          Сравнение {labelA} vs {labelB}
        </span>
        <button type="button" onClick={onSwap}>
          Поменять местами
        </button>
      </div>

      <div className="genome-compare__meta genome-explorer__meta">
        <div className="genome-explorer__meta-row">
          <span>A {labelA}: {nodeMeta(keyA, nodeA, lineage)}</span>
          <span>B {labelB}: {nodeMeta(keyB, nodeB, lineage)}</span>
        </div>
      </div>

      <section className="genome-compare__summary">
        <h3>Объяснение</h3>
        <ul>
          {summary.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </section>

      {traits.length > 0 && (
        <section className="genome-compare__traits">
          <h3>Отличия в чертах</h3>
          <table className="genome-compare__trait-table">
            <thead>
              <tr>
                <th>Черта</th>
                <th>{labelA}</th>
                <th>{labelB}</th>
              </tr>
            </thead>
            <tbody>
              {traits.map((t) => (
                <tr key={t.label}>
                  <td>{t.label}</td>
                  <td>{t.a}</td>
                  <td>{t.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="genome-compare__diff">
        <div className="genome-diff__toolbar">
          <h3>Diff инструкций (как GitHub)</h3>
          <button
            type="button"
            onClick={() => {
              setShowFullGenome((v) => !v)
              setExpandedGaps(new Set())
            }}
          >
            {showFullGenome ? 'Свернуть' : 'Развернуть весь геном'}
          </button>
        </div>
        <div className="genome-compare__diff-head">
          <span className="genome-compare__col-prefix" />
          <span className="genome-compare__col-side">A</span>
          <span className="genome-compare__col-ip">ip</span>
          <span className="genome-compare__col-hex">hex</span>
          <span className="genome-compare__col-disasm">инструкция</span>
          <span className="genome-compare__col-human">расшифровка</span>
          <span className="genome-compare__col-side">B</span>
          <span className="genome-compare__col-ip">ip</span>
          <span className="genome-compare__col-hex">hex</span>
          <span className="genome-compare__col-disasm">инструкция</span>
          <span className="genome-compare__col-human">расшифровка</span>
        </div>
        <div className="genome-compare__diff-body">
          {showFullGenome
            ? getFullDiffRows(cmp).map((row, i) => (
                <DiffRow key={`full-${i}`} row={row} rowKey={`full-${i}`} />
              ))
            : renderHunkView()}
        </div>
      </section>
    </div>
  )
}
