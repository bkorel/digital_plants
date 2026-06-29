import { useEffect, useMemo, useRef, useState } from 'react'
import { genomeColor } from '../sim/genome'
import {
  genomeKey,
  shortGenomeKey,
  type GenomeLineageNode,
} from '../sim/lineage'
import { World } from '../sim/world'
import { formatSpeed } from './speed'

interface Props {
  world: World
  frame: number
  paused: boolean
  speed: number
  onPauseToggle: () => void
  onStep: () => void
  onBack: () => void
  onCompare: (firstKey: string, secondKey: string) => void
}

const RECENT_TICK_WINDOW = 50

function isSurvivor(
  node: GenomeLineageNode,
  seedCountByKey: Map<string, number>,
  hasLivingDescendants: (key: string) => boolean,
): boolean {
  if (node.livingCount > 0) return true
  if ((seedCountByKey.get(node.genomeKey) ?? 0) > 0) return true
  return hasLivingDescendants(node.genomeKey)
}

interface TreeRow {
  node: GenomeLineageNode
  depth: number
  childCount: number
}

function originLabel(origin: GenomeLineageNode['origin']): string {
  switch (origin) {
    case 'initial':
      return 'старт'
    case 'germination':
      return 'семя'
    case 'manual':
      return 'посадка'
    case 'laboratory':
      return 'лаб.'
  }
}

function buildTreeRows(
  roots: GenomeLineageNode[],
  childrenOf: (key: string) => GenomeLineageNode[],
  depthOf: (key: string) => number,
  collapsed: Set<string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const visited = new Set<string>()
  const walk = (node: GenomeLineageNode, depth: number) => {
    if (visited.has(node.genomeKey)) return
    visited.add(node.genomeKey)
    const kids = childrenOf(node.genomeKey).sort(
      (a, b) => a.firstTick - b.firstTick || a.genomeKey.localeCompare(b.genomeKey),
    )
    rows.push({ node, depth, childCount: kids.length })
    if (!collapsed.has(node.genomeKey)) {
      for (const child of kids) walk(child, depth + 1)
    }
  }
  for (const root of roots.sort((a, b) => a.firstTick - b.firstTick)) {
    walk(root, depthOf(root.genomeKey))
  }
  return rows
}

function buildFlatRows(
  nodes: GenomeLineageNode[],
  childrenOf: (key: string) => GenomeLineageNode[],
  depthOf: (key: string) => number,
): TreeRow[] {
  return [...nodes]
    .sort(
      (a, b) =>
        depthOf(a.genomeKey) - depthOf(b.genomeKey) ||
        a.firstTick - b.firstTick ||
        a.genomeKey.localeCompare(b.genomeKey),
    )
    .map((node) => ({
      node,
      depth: depthOf(node.genomeKey),
      childCount: childrenOf(node.genomeKey).length,
    }))
}

function buildLivingDescendantCheck(
  lineage: World['lineage'],
  seedCountByKey: Map<string, number>,
) {
  const cache = new Map<string, boolean>()
  const hasLivingDescendants = (key: string, visiting = new Set<string>()): boolean => {
    const cached = cache.get(key)
    if (cached != null) return cached
    if (visiting.has(key)) return false
    visiting.add(key)
    for (const child of lineage.childrenOf(key)) {
      if (child.livingCount > 0) {
        cache.set(key, true)
        return true
      }
      if ((seedCountByKey.get(child.genomeKey) ?? 0) > 0) {
        cache.set(key, true)
        return true
      }
      if (hasLivingDescendants(child.genomeKey, visiting)) {
        cache.set(key, true)
        return true
      }
    }
    visiting.delete(key)
    cache.set(key, false)
    return false
  }
  return hasLivingDescendants
}

function isExtinctWithoutLivingDescendants(
  node: GenomeLineageNode,
  seedCountByKey: Map<string, number>,
  hasLivingDescendants: (key: string) => boolean,
): boolean {
  if (node.livingCount > 0) return false
  if ((seedCountByKey.get(node.genomeKey) ?? 0) > 0) return false
  return !hasLivingDescendants(node.genomeKey)
}

interface LifespanBarProps {
  firstTick: number
  lastActiveTick: number
  currentTick: number
  minTick: number
  maxTick: number
  color: string
  alive: boolean
  size?: 'sm' | 'md'
}

function LifespanBar({
  firstTick,
  lastActiveTick,
  currentTick,
  minTick,
  maxTick,
  color,
  alive,
  size = 'sm',
}: LifespanBarProps) {
  const span = Math.max(maxTick - minTick, 1)
  const endTick = alive ? Math.max(lastActiveTick, currentTick) : lastActiveTick
  const leftPct = ((firstTick - minTick) / span) * 100
  const widthPct = Math.max(((endTick - firstTick) / span) * 100, 1.5)
  const nowPct = Math.min(100, Math.max(0, ((currentTick - minTick) / span) * 100))
  const title = alive
    ? `тики ${firstTick}–${currentTick} (жив)`
    : `тики ${firstTick}–${lastActiveTick}`

  return (
    <span className={`genealogy__lifespan genealogy__lifespan--${size}`} title={title}>
      <span className="genealogy__lifespan-track">
        <span
          className={`genealogy__lifespan-bar${alive ? ' genealogy__lifespan-bar--alive' : ''}`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color }}
        />
        <span className="genealogy__lifespan-now" style={{ left: `${nowPct}%` }} aria-hidden />
      </span>
    </span>
  )
}

export default function GenealogyScreen({
  world,
  frame,
  paused,
  speed,
  onPauseToggle,
  onStep,
  onBack,
  onCompare,
}: Props) {
  const [lineageRevision, setLineageRevision] = useState(() => world.lineage.revision)
  const entryTickRef = useRef(world.tickCount)
  const listWrapRef = useRef<HTMLDivElement>(null)
  const prevNewCountRef = useRef(0)

  useEffect(() => {
    world.syncLineage()
    setLineageRevision(world.lineage.revision)
  }, [world, frame])

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [compareFirstKey, setCompareFirstKey] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [flatView, setFlatView] = useState(true)
  const [hideDeadLeaves, setHideDeadLeaves] = useState(true)
  const [showOnlySurvivors, setShowOnlySurvivors] = useState(false)

  const aliveCount = useMemo(
    () => world.plants.filter((p) => !p.dead).length,
    [world, frame, lineageRevision],
  )

  const pendingSeedCount = useMemo(
    () => world.seeds.length + world.fallingSeeds.length,
    [world, frame],
  )

  const seedCountByKey = useMemo(() => {
    const counts = new Map<string, number>()
    const bump = (genome: GenomeLineageNode['genome']) => {
      const key = genomeKey(genome)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const s of world.seeds) bump(s.genome)
    for (const s of world.fallingSeeds) bump(s.genome)
    return counts
  }, [world, frame])

  const nodes = useMemo(
    () => world.lineage.all(),
    [world, lineageRevision, frame],
  )

  const childrenOf = (key: string) => world.lineage.childrenOf(key)
  const depthOf = (key: string) => world.lineage.generationDepth(key)

  const roots = useMemo(() => world.lineage.roots(), [nodes, world.lineage, lineageRevision])

  const hasLivingDescendants = useMemo(
    () => buildLivingDescendantCheck(world.lineage, seedCountByKey),
    [world.lineage, seedCountByKey, lineageRevision, nodes],
  )

  const timelineRange = useMemo(() => {
    const currentTick = world.tickCount
    if (nodes.length === 0) return { min: 0, max: Math.max(currentTick, 1) }
    let min = currentTick
    let max = currentTick
    for (const n of nodes) {
      min = Math.min(min, n.firstTick)
      max = Math.max(max, n.lastActiveTick, currentTick)
    }
    return { min, max: Math.max(max, min + 1) }
  }, [nodes, world.tickCount])

  const rows = useMemo(() => {
    if (nodes.length === 0) return []
    let built: TreeRow[]
    if (flatView) {
      built = buildFlatRows(nodes, childrenOf, depthOf)
    } else {
      const treeRows = buildTreeRows(roots, childrenOf, depthOf, collapsed)
      if (treeRows.length >= nodes.length) {
        built = treeRows
      } else {
        const seen = new Set(treeRows.map((r) => r.node.genomeKey))
        const extras = buildFlatRows(
          nodes.filter((n) => !seen.has(n.genomeKey)),
          childrenOf,
          depthOf,
        )
        built = [...treeRows, ...extras]
      }
    }
    if (!hideDeadLeaves) return built
    let filtered = built.filter(
      ({ node }) =>
        !isExtinctWithoutLivingDescendants(node, seedCountByKey, hasLivingDescendants),
    )
    if (showOnlySurvivors) {
      filtered = filtered.filter(({ node }) =>
        isSurvivor(node, seedCountByKey, hasLivingDescendants),
      )
    }
    return filtered
  }, [
    nodes,
    roots,
    collapsed,
    flatView,
    hideDeadLeaves,
    showOnlySurvivors,
    seedCountByKey,
    hasLivingDescendants,
    lineageRevision,
  ])

  const selected = selectedKey != null ? world.lineage.get(selectedKey) : undefined

  const stats = useMemo(() => {
    const totalLiving = nodes.reduce((s, n) => s + n.livingCount, 0)
    const carriers = nodes.filter((n) => n.livingCount > 0).length
    const withSeeds = nodes.filter((n) => (seedCountByKey.get(n.genomeKey) ?? 0) > 0).length
    const withChildren = nodes.filter(
      (n) => world.lineage.childrenOf(n.genomeKey).length > 0,
    ).length
    const survivors = nodes.filter((n) =>
      isSurvivor(n, seedCountByKey, hasLivingDescendants),
    ).length
    const newSinceEntry = nodes.filter((n) => n.firstTick >= entryTickRef.current).length
    const recentBirths = nodes.filter(
      (n) => world.tickCount - n.firstTick <= RECENT_TICK_WINDOW,
    ).length
    return {
      genes: nodes.length,
      carriers,
      withSeeds,
      withChildren,
      totalLiving,
      survivors,
      newSinceEntry,
      recentBirths,
    }
  }, [nodes, seedCountByKey, world.lineage, world.tickCount, hasLivingDescendants, lineageRevision])

  const newGenomes = useMemo(
    () =>
      [...nodes]
        .filter((n) => n.firstTick >= entryTickRef.current)
        .sort((a, b) => b.firstTick - a.firstTick || a.genomeKey.localeCompare(b.genomeKey))
        .slice(0, 12),
    [nodes, lineageRevision, world.tickCount],
  )

  useEffect(() => {
    if (newGenomes.length <= prevNewCountRef.current) {
      prevNewCountRef.current = newGenomes.length
      return
    }
    prevNewCountRef.current = newGenomes.length
    const el = listWrapRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [newGenomes.length])

  const roleLabel = (node: GenomeLineageNode): string => {
    if (node.livingCount > 0) return 'носитель'
    const seeds = seedCountByKey.get(node.genomeKey) ?? 0
    if (seeds > 0) return `семя (${seeds})`
    if (childrenOf(node.genomeKey).length > 0) return 'предок'
    return 'вымер'
  }

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const collapseAll = () => {
    setFlatView(false)
    setCollapsed(new Set(nodes.filter((n) => childrenOf(n.genomeKey).length > 0).map((n) => n.genomeKey)))
  }

  const expandAll = () => {
    setFlatView(false)
    setCollapsed(new Set())
  }

  const handleCompareClick = (key: string) => {
    if (compareFirstKey == null) {
      setCompareFirstKey(key)
      setSelectedKey(key)
    } else if (compareFirstKey === key) {
      setCompareFirstKey(null)
    } else {
      onCompare(compareFirstKey, key)
      setCompareFirstKey(null)
    }
  }

  if (aliveCount === 0 && pendingSeedCount === 0) {
    return (
      <div className="genealogy genealogy--empty">
        <div className="genome-explorer__toolbar">
          <button type="button" onClick={onBack}>← Назад</button>
          <span className="genome-explorer__title">Генеология генов</span>
        </div>
        <p className="genome-explorer__empty-msg">
          Нет живых растений и семян — дождитесь рестарта или вернитесь в эволюцию.
        </p>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="genealogy genealogy--empty">
        <div className="genome-explorer__toolbar">
          <button type="button" onClick={onBack}>← Назад</button>
          <span className="genome-explorer__title">Генеология генов</span>
        </div>
        <p className="genome-explorer__empty-msg">
          На поле {aliveCount} растений
          {pendingSeedCount > 0 ? ` и ${pendingSeedCount} семян` : ''}, но реестр генов пуст.
          Подождите несколько тиков — геномы появятся по мере эволюции.
        </p>
      </div>
    )
  }

  return (
    <div className="genealogy">
      <div className="genome-explorer__toolbar">
        <button type="button" onClick={onBack}>← Назад</button>
        <span className="genome-explorer__title">
          Генеология · тик {world.tickCount} · {stats.genes} генов · {stats.survivors} выживших линий
        </span>
        <span
          className={`genealogy__live${paused ? ' genealogy__live--paused' : ''}`}
          title={paused ? 'Симуляция на паузе' : 'Эволюция идёт'}
        >
          <span className="genealogy__live-dot" aria-hidden />
          {paused ? 'пауза' : formatSpeed(speed)}
        </span>
        <button type="button" onClick={onPauseToggle}>
          {paused ? '▶' : '⏸'}
        </button>
        <button type="button" onClick={onStep} title="Шаг (пробел)">
          Шаг
        </button>
        <button type="button" onClick={expandAll}>Развернуть</button>
        <button type="button" onClick={collapseAll}>Свернуть</button>
        <button
          type="button"
          className={flatView ? 'active' : ''}
          onClick={() => setFlatView((v) => !v)}
        >
          {flatView ? 'Дерево' : 'Список'}
        </button>
        <label className="genealogy__filter" title="Только носители, семена и линии с живыми потомками">
          <input
            type="checkbox"
            checked={showOnlySurvivors}
            onChange={(e) => setShowOnlySurvivors(e.target.checked)}
          />
          Только выжившие
        </label>
        <label className="genealogy__filter" title="Не показывать вымерших без живых потомков">
          <input
            type="checkbox"
            checked={hideDeadLeaves}
            onChange={(e) => setHideDeadLeaves(e.target.checked)}
          />
          Скрыть вымерших
        </label>
        {compareFirstKey != null && (
          <span className="genealogy__pick-hint">
            2-й геном для сравнения (1-й: {shortGenomeKey(compareFirstKey)})
            <button type="button" onClick={() => setCompareFirstKey(null)}>Отмена</button>
          </span>
        )}
      </div>

      {(stats.newSinceEntry > 0 || !paused) && (
        <div className="genealogy__evolution-strip">
          <div className="genealogy__evolution-stats">
            <span>{aliveCount} растений</span>
            <span>{pendingSeedCount} семян</span>
            <span>{stats.carriers} носителей</span>
            <span className="genealogy__evolution-stats-new">
              +{stats.newSinceEntry} новых генов
              {stats.recentBirths > 0 ? ` (${stats.recentBirths} за ${RECENT_TICK_WINDOW} тиков)` : ''}
            </span>
          </div>
          {newGenomes.length > 0 && (
            <div className="genealogy__recent">
              <span className="genealogy__recent-label">Новые геномы:</span>
              <div className="genealogy__recent-chips">
                {newGenomes.map((node) => {
                  const { hue, sat, light } = genomeColor(node.genome)
                  const isFresh = world.tickCount - node.firstTick <= RECENT_TICK_WINDOW
                  return (
                    <button
                      key={node.genomeKey}
                      type="button"
                      className={`genealogy__recent-chip${isFresh ? ' genealogy__recent-chip--fresh' : ''}`}
                      style={{ borderColor: `hsl(${hue}, ${sat}%, ${light}%)` }}
                      title={`тик ${node.firstTick}${node.mutatedFromParent ? ', мутация' : ''}`}
                      onClick={() => setSelectedKey(node.genomeKey)}
                    >
                      <span
                        className="genealogy__recent-chip-swatch"
                        style={{ background: `hsl(${hue}, ${sat}%, ${light}%)` }}
                      />
                      {shortGenomeKey(node.genomeKey)}
                      {node.mutatedFromParent ? '*' : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="genealogy__layout genealogy__layout--compact">
        <div className="genealogy__list-wrap" ref={listWrapRef}>
          <div className="genealogy__list-head">
            <span />
            <span>Геном</span>
            <span>Б</span>
            <span>Роль</span>
            <span>Живых</span>
            <span className="genealogy__list-head-lifespan">Жизнь</span>
            <span>Тики</span>
          </div>
          <ul className="genealogy__list">
            {rows.length === 0 && (
              <li className="genealogy__empty-row">
                {hideDeadLeaves
                  ? 'Все геномы скрыты фильтром — снимите «Скрыть вымерших».'
                  : 'Нет геномов для отображения.'}
              </li>
            )}
            {rows.map(({ node, depth, childCount }) => {
              const { hue, sat, light } = genomeColor(node.genome)
              const isCollapsed = collapsed.has(node.genomeKey)
              const isSelected = selectedKey === node.genomeKey
              const isPick = compareFirstKey === node.genomeKey
              const isCarrier = node.livingCount > 0
              const pendingSeeds = seedCountByKey.get(node.genomeKey) ?? 0
              const isActive = isCarrier || pendingSeeds > 0
              const isManual = node.manualSpawnCount > 0
              const isExtinct = !isActive && childCount === 0
              const isNewSinceEntry = node.firstTick >= entryTickRef.current
              const isRecentBirth = world.tickCount - node.firstTick <= RECENT_TICK_WINDOW
              const short = shortGenomeKey(node.genomeKey)
              const barColor = `hsl(${hue}, ${sat}%, ${light}%)`

              return (
                <li
                  key={node.genomeKey}
                  className={`genealogy__row${isManual ? ' genealogy__row--manual' : ''}${isSelected ? ' genealogy__row--selected' : ''}${isPick ? ' genealogy__row--pick' : ''}${isActive ? ' genealogy__row--carrier' : ''}${!isActive && childCount > 0 ? ' genealogy__row--ancestor' : ''}${isExtinct ? ' genealogy__row--extinct' : ''}${isNewSinceEntry ? ' genealogy__row--new' : ''}${isRecentBirth ? ' genealogy__row--fresh' : ''}`}
                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                  onClick={() => setSelectedKey(node.genomeKey)}
                >
                  <span className="genealogy__row-toggle">
                    {!flatView && childCount > 0 ? (
                      <button
                        type="button"
                        className="genealogy__toggle-btn"
                        aria-label={isCollapsed ? 'Развернуть' : 'Свернуть'}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleCollapse(node.genomeKey)
                        }}
                      >
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                    ) : (
                      <span className="genealogy__toggle-spacer" />
                    )}
                  </span>
                  <span
                    className="genealogy__swatch"
                    style={{ background: `hsl(${hue}, ${sat}%, ${light}%)` }}
                    title={node.genomeKey}
                  />
                  <code className="genealogy__row-key" title={node.genomeKey}>
                    {short}
                    {node.mutatedFromParent ? '*' : ''}
                    {isNewSinceEntry ? ' новый' : ''}
                    {childCount > 0 ? ` →${childCount}` : ''}
                  </code>
                  <span className="genealogy__row-bytes">{node.genome.code.length}</span>
                  <span className={`genealogy__row-status${isActive ? ' genealogy__row-status--active' : ''}`}>
                    {isManual ? originLabel(node.origin === 'laboratory' ? 'laboratory' : 'manual') : roleLabel(node)}
                  </span>
                  <span className="genealogy__row-spawns">{node.livingCount}</span>
                  <span className="genealogy__row-lifespan">
                    <LifespanBar
                      firstTick={node.firstTick}
                      lastActiveTick={node.lastActiveTick}
                      currentTick={world.tickCount}
                      minTick={timelineRange.min}
                      maxTick={timelineRange.max}
                      color={barColor}
                      alive={isCarrier}
                    />
                  </span>
                  <span className="genealogy__row-ticks">{node.firstTick}–{node.lastActiveTick}</span>
                </li>
              )
            })}
          </ul>
        </div>

        {selected && (() => {
          const selColor = genomeColor(selected.genome)
          const selBarColor = `hsl(${selColor.hue}, ${selColor.sat}%, ${selColor.light}%)`
          return (
          <aside className="genealogy__detail panel">
            <h3>Геном {shortGenomeKey(selected.genomeKey, 8)}</h3>
            <dl className="genealogy__detail-grid">
              <dt>Ключ</dt>
              <dd><code className="genealogy__hex">{selected.genomeKey.slice(0, 32)}…</code></dd>
              <dt>Родители</dt>
              <dd>
                {selected.parentGenomeKeys.length === 0
                  ? '—'
                  : selected.parentGenomeKeys.map((k) => shortGenomeKey(k)).join(', ')}
              </dd>
              <dt>Потомки</dt>
              <dd>
                {childrenOf(selected.genomeKey).length === 0
                  ? '—'
                  : childrenOf(selected.genomeKey)
                      .map((c) => shortGenomeKey(c.genomeKey))
                      .join(', ')}
              </dd>
              <dt>Происхождение</dt>
              <dd>{originLabel(selected.origin)}</dd>
              <dt>Мутация</dt>
              <dd>{selected.mutatedFromParent ? 'да' : 'нет'}</dd>
              <dt>Байт</dt>
              <dd>{selected.genome.code.length}</dd>
              <dt>Живых носителей</dt>
              <dd>{selected.livingCount}</dd>
              <dt>Всего экземпляров</dt>
              <dd>{selected.spawnCount}</dd>
              {selected.manualSpawnCount > 0 && (
                <>
                  <dt>Подсадок</dt>
                  <dd>{selected.manualSpawnCount} (тик {selected.lastManualTick})</dd>
                </>
              )}
              <dt>Тики</dt>
              <dd>{selected.firstTick} – {selected.lastActiveTick}</dd>
              <dt>Жизнь на шкале</dt>
              <dd className="genealogy__detail-lifespan">
                <LifespanBar
                  firstTick={selected.firstTick}
                  lastActiveTick={selected.lastActiveTick}
                  currentTick={world.tickCount}
                  minTick={timelineRange.min}
                  maxTick={timelineRange.max}
                  color={selBarColor}
                  alive={selected.livingCount > 0}
                  size="md"
                />
                <span className="genealogy__detail-lifespan-labels">
                  <span>{timelineRange.min}</span>
                  <span>сейчас {world.tickCount}</span>
                  <span>{timelineRange.max}</span>
                </span>
              </dd>
              <dt>Роль</dt>
              <dd>{roleLabel(selected)}</dd>
            </dl>
            <div className="genealogy__detail-actions">
              <button type="button" onClick={() => handleCompareClick(selected.genomeKey)}>
                {compareFirstKey === selected.genomeKey
                  ? 'Отменить выбор'
                  : compareFirstKey != null
                    ? `Сравнить с ${shortGenomeKey(compareFirstKey)}`
                    : 'Сравнить с…'}
              </button>
            </div>
          </aside>
          )
        })()}
      </div>
    </div>
  )
}
