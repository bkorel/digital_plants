import { describe, expect, it } from 'vitest'
import { growCostRelative, resolveRelativeDir, worldToRelativeDir } from './direction'
import { GROW_COST } from './config'
import type { Direction } from './types'

const ALL_DIRS: Direction[] = [
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'UP_LEFT',
  'UP_RIGHT',
  'DOWN_LEFT',
  'DOWN_RIGHT',
]

describe('resolveRelativeDir', () => {
  it('identity when orientation is UP', () => {
    for (const rel of ALL_DIRS) {
      expect(resolveRelativeDir('UP', rel)).toBe(rel)
    }
  })

  it('known pairs for orientation RIGHT', () => {
    expect(resolveRelativeDir('RIGHT', 'UP')).toBe('RIGHT')
    expect(resolveRelativeDir('RIGHT', 'LEFT')).toBe('UP')
    expect(resolveRelativeDir('RIGHT', 'RIGHT')).toBe('DOWN')
    expect(resolveRelativeDir('RIGHT', 'DOWN')).toBe('LEFT')
  })

  it('known pairs for orientation DOWN', () => {
    expect(resolveRelativeDir('DOWN', 'UP')).toBe('DOWN')
    expect(resolveRelativeDir('DOWN', 'LEFT')).toBe('RIGHT')
    expect(resolveRelativeDir('DOWN', 'RIGHT')).toBe('LEFT')
  })

  it('diagonals rotate with orientation', () => {
    expect(resolveRelativeDir('RIGHT', 'UP_LEFT')).toBe('UP_RIGHT')
    expect(resolveRelativeDir('DOWN', 'UP_RIGHT')).toBe('DOWN_LEFT')
  })

  it('LEFT then RIGHT returns forward for each orientation', () => {
    for (const ori of ALL_DIRS) {
      const forward = resolveRelativeDir(ori, 'UP')
      expect(resolveRelativeDir(resolveRelativeDir(ori, 'LEFT'), 'RIGHT')).toBe(forward)
      expect(resolveRelativeDir(resolveRelativeDir(ori, 'RIGHT'), 'LEFT')).toBe(forward)
    }
  })

  it('full 8x8 matrix is invertible via worldToRelativeDir', () => {
    for (const ori of ALL_DIRS) {
      for (const rel of ALL_DIRS) {
        const world = resolveRelativeDir(ori, rel)
        expect(worldToRelativeDir(ori, world)).toBe(rel)
      }
    }
  })
})

describe('growCostRelative', () => {
  it('matches relative slot pricing', () => {
    expect(growCostRelative('UP')).toBe(GROW_COST * 0.7)
    expect(growCostRelative('DOWN')).toBe(GROW_COST * 1.0)
    expect(growCostRelative('LEFT')).toBe(GROW_COST * 0.85)
    expect(growCostRelative('UP_LEFT')).toBe(GROW_COST * 1.05)
  })
})
