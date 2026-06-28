import { cloneGenome, genomesEqual, serializeGenome } from './genome'
import type { Genome } from './types'

export type LineageOrigin = 'initial' | 'germination' | 'manual' | 'laboratory'

/** Уникальный геном в генеалогии (не отдельное растение). */
export interface GenomeLineageNode {
  genomeKey: string
  genome: Genome
  /** Родительские геномы, от которых произошёл этот вариант */
  parentGenomeKeys: string[]
  firstTick: number
  lastActiveTick: number
  /** Сколько раз этот геном появился в новых растениях */
  spawnCount: number
  /** Сколько растений с этим геномом живы сейчас */
  livingCount: number
  origin: LineageOrigin
  /** true — байткод отличается от родителя при прорастании */
  mutatedFromParent: boolean
  /** Сколько раз геном подсаживали вручную / из лаборатории */
  manualSpawnCount: number
  lastManualTick?: number
}

export interface LineageSnapshot {
  nodes: GenomeLineageNode[]
  revision?: number
}

export interface LineageSyncInput {
  plants: { genome: Genome; dead: boolean }[]
  seeds?: { genome: Genome }[]
  fallingSeeds?: { genome: Genome }[]
  tick: number
}

/** Стабильный ключ генома (hex). */
export function genomeKey(genome: Genome): string {
  return serializeGenome(genome)
}

export function shortGenomeKey(key: string, len = 6): string {
  return key.length <= len ? key : key.slice(0, len)
}

export class LineageRegistry {
  private nodes = new Map<string, GenomeLineageNode>()
  private _revision = 0

  get revision(): number {
    return this._revision
  }

  private bump(): void {
    this._revision++
  }

  /** Гарантировать запись генома (родитель, семя в почве). */
  ensureGenome(
    genome: Genome,
    tick: number,
    defaults: { origin?: LineageOrigin } = {},
  ): string {
    const key = genomeKey(genome)
    const existing = this.nodes.get(key)
    if (existing) {
      existing.lastActiveTick = tick
      return key
    }
    this.nodes.set(key, {
      genomeKey: key,
      genome: cloneGenome(genome),
      parentGenomeKeys: [],
      firstTick: tick,
      lastActiveTick: tick,
      spawnCount: 0,
      livingCount: 0,
      origin: defaults.origin ?? 'germination',
      mutatedFromParent: false,
      manualSpawnCount: 0,
    })
    this.bump()
    return key
  }

  registerPlant(params: {
    genome: Genome
    tick: number
    origin: LineageOrigin
    parentGenome?: Genome
  }): string {
    const { genome, tick, origin, parentGenome } = params
    const key = genomeKey(genome)
    const parentKey = parentGenome
      ? this.ensureGenome(parentGenome, tick, { origin: 'germination' })
      : undefined
    const mutated =
      parentGenome != null && !genomesEqual(genome, parentGenome)
    const isManual = origin === 'manual' || origin === 'laboratory'

    const existing = this.nodes.get(key)
    if (existing) {
      existing.spawnCount++
      existing.livingCount++
      existing.lastActiveTick = tick
      if (isManual) {
        existing.manualSpawnCount++
        existing.lastManualTick = tick
      }
      if (parentKey && !existing.parentGenomeKeys.includes(parentKey)) {
        existing.parentGenomeKeys.push(parentKey)
        if (mutated) existing.mutatedFromParent = true
      }
      this.bump()
      return key
    }

    this.nodes.set(key, {
      genomeKey: key,
      genome: cloneGenome(genome),
      parentGenomeKeys: parentKey ? [parentKey] : [],
      firstTick: tick,
      lastActiveTick: tick,
      spawnCount: 1,
      livingCount: 1,
      origin,
      mutatedFromParent: mutated,
      manualSpawnCount: isManual ? 1 : 0,
      lastManualTick: isManual ? tick : undefined,
    })
    this.bump()
    return key
  }

  plantDied(genome: Genome, tick: number): void {
    const node = this.nodes.get(genomeKey(genome))
    if (!node) return
    node.livingCount = Math.max(0, node.livingCount - 1)
    node.lastActiveTick = tick
    this.bump()
  }

  get(key: string): GenomeLineageNode | undefined {
    const node = this.nodes.get(key)
    if (!node) return undefined
    return { ...node, genome: cloneGenome(node.genome), parentGenomeKeys: [...node.parentGenomeKeys] }
  }

  getByGenome(genome: Genome): GenomeLineageNode | undefined {
    return this.get(genomeKey(genome))
  }

  all(): GenomeLineageNode[] {
    return [...this.nodes.values()].map((n) => ({
      ...n,
      genome: cloneGenome(n.genome),
      parentGenomeKeys: [...n.parentGenomeKeys],
    }))
  }

  childrenOf(parentKey: string): GenomeLineageNode[] {
    return this.all().filter((n) => n.parentGenomeKeys.includes(parentKey))
  }

  roots(): GenomeLineageNode[] {
    const all = this.all()
    if (all.length === 0) return []
    const keys = new Set(all.map((n) => n.genomeKey))
    const explicit = all.filter(
      (n) =>
        n.parentGenomeKeys.length === 0 ||
        n.parentGenomeKeys.every((p) => !keys.has(p)),
    )
    if (explicit.length > 0) return explicit
    let minDepth = Infinity
    for (const n of all) {
      minDepth = Math.min(minDepth, this.generationDepth(n.genomeKey))
    }
    return all.filter((n) => this.generationDepth(n.genomeKey) === minDepth)
  }

  isLineageActive(key: string): boolean {
    return this.nodes.has(key)
  }

  generationDepth(key: string, seen = new Set<string>()): number {
    if (seen.has(key)) return 0
    seen.add(key)
    const node = this.nodes.get(key)
    if (!node || node.parentGenomeKeys.length === 0) return 0
    let min = Infinity
    for (const pk of node.parentGenomeKeys) {
      if (this.nodes.has(pk)) {
        min = Math.min(min, this.generationDepth(pk, seen) + 1)
      }
    }
    return min === Infinity ? 0 : min
  }

  manuallyPlanted(): GenomeLineageNode[] {
    return this.all()
      .filter((n) => n.manualSpawnCount > 0)
      .sort((a, b) => (b.lastManualTick ?? 0) - (a.lastManualTick ?? 0))
  }

  /**
   * Синхронизировать livingCount и оставить активные ветви:
   * живые растения, семена, предки и потомки.
   */
  syncAndPrune(input: LineageSyncInput): void {
    const { plants, seeds = [], fallingSeeds = [], tick } = input

    const anchorKeys = new Set<string>()
    for (const p of plants) {
      if (!p.dead) anchorKeys.add(genomeKey(p.genome))
    }
    for (const s of seeds) anchorKeys.add(genomeKey(s.genome))
    for (const s of fallingSeeds) anchorKeys.add(genomeKey(s.genome))

    if (anchorKeys.size === 0) {
      this.nodes.clear()
      this.bump()
      return
    }

    for (const node of this.nodes.values()) {
      node.livingCount = 0
    }

    for (const p of plants) {
      if (p.dead) continue
      const key = genomeKey(p.genome)
      let node = this.nodes.get(key)
      if (!node) {
        this.nodes.set(key, {
          genomeKey: key,
          genome: cloneGenome(p.genome),
          parentGenomeKeys: [],
          firstTick: tick,
          lastActiveTick: tick,
          spawnCount: 1,
          livingCount: 0,
          origin: 'germination',
          mutatedFromParent: false,
          manualSpawnCount: 0,
        })
        node = this.nodes.get(key)!
        this.bump()
      }
      node.livingCount++
      node.lastActiveTick = tick
    }

    for (const s of [...seeds, ...fallingSeeds]) {
      this.ensureGenome(s.genome, tick, { origin: 'germination' })
    }

    const keep = new Set<string>()
    const stack = [...anchorKeys]
    while (stack.length > 0) {
      const key = stack.pop()!
      if (keep.has(key)) continue
      keep.add(key)
      const node = this.nodes.get(key)
      if (!node) continue
      for (const pk of node.parentGenomeKeys) {
        if (!keep.has(pk)) stack.push(pk)
      }
    }

    const downStack = [...keep]
    while (downStack.length > 0) {
      const parentKey = downStack.pop()!
      for (const node of this.nodes.values()) {
        if (!node.parentGenomeKeys.includes(parentKey)) continue
        if (keep.has(node.genomeKey)) continue
        keep.add(node.genomeKey)
        downStack.push(node.genomeKey)
      }
    }

    for (const key of [...this.nodes.keys()]) {
      if (!keep.has(key)) this.nodes.delete(key)
    }

    for (const node of this.nodes.values()) {
      node.parentGenomeKeys = node.parentGenomeKeys.filter((pk) => keep.has(pk))
    }

    this.bump()
  }

  hasLivingCarriers(key: string): boolean {
    return (this.nodes.get(key)?.livingCount ?? 0) > 0
  }

  clear(): void {
    this.nodes.clear()
    this.bump()
  }

  capture(): LineageSnapshot {
    return { nodes: this.all(), revision: this._revision }
  }

  restore(snapshot: LineageSnapshot): void {
    this.nodes.clear()
    for (const node of snapshot.nodes) {
      this.nodes.set(node.genomeKey, {
        ...node,
        genome: cloneGenome(node.genome),
        parentGenomeKeys: [...node.parentGenomeKeys],
        manualSpawnCount: node.manualSpawnCount ?? 0,
      })
    }
    this._revision = snapshot.revision ?? 0
    this.bump()
  }
}
