import { World } from '../src/sim/world'
import { WORLD } from '../src/sim/config'
import { SEED_OCC } from '../src/sim/occupancy'

const w = new World(7)

let overlapTicks = 0
let occMismatchTicks = 0
let seedOverlapTicks = 0
let airTouchTicks = 0
let firstOverlap = ''
let firstMismatch = ''
let firstSeedOverlap = ''
let firstAirTouch = ''

const NEIGHBORS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const

function check(t: number): void {
  const at = new Map<string, { plantId: number; type: string }[]>()
  for (const p of w.plants) {
    if (p.dead) continue
    for (const c of p.cells) {
      const key = `${c.x},${c.y}`
      const arr = at.get(key) ?? []
      arr.push({ plantId: p.id, type: c.type })
      at.set(key, arr)
    }
  }

  let overlap = false
  for (const [key, arr] of at) {
    if (arr.length > 1) {
      overlap = true
      if (!firstOverlap) {
        firstOverlap = `t${t}: ${key} — ${arr.length} клеток, растения [${[...new Set(arr.map((a) => a.plantId))].join(', ')}]`
      }
    }
  }
  if (overlap) overlapTicks++

  // семена в почве не должны делить ячейку с растениями/другими семенами
  for (const seed of w.seeds) {
    const key = `${seed.x},${seed.y}`
    const cells = at.get(key)
    if (cells && cells.length > 0) {
      seedOverlapTicks++
      if (!firstSeedOverlap) firstSeedOverlap = `t${t}: семя в ${key} + клетка растения`
    }
    const occ = w.occupancy[seed.y][seed.x]
    if (occ !== SEED_OCC) {
      occMismatchTicks++
      if (!firstMismatch) firstMismatch = `t${t}: семя ${key} без метки SEED_OCC (occ=${occ})`
    }
  }

  // растения в воздухе не соприкасаются чужими клетками
  for (const p of w.plants) {
    if (p.dead) continue
    for (const c of p.cells) {
      if (c.y >= WORLD.SOIL_Y) continue
      for (const [dx, dy] of NEIGHBORS) {
        const nx = c.x + dx
        const ny = c.y + dy
        if (ny >= WORLD.SOIL_Y) continue
        const occ = w.occupancy[ny]?.[nx]
        if (occ != null && occ > 0 && occ !== p.id) {
          airTouchTicks++
          if (!firstAirTouch) firstAirTouch = `t${t}: касание ${p.id}↔${occ} в ${nx},${ny}`
          break
        }
      }
    }
  }

  let mismatch = false
  for (let y = 0; y < WORLD.H; y++) {
    for (let x = 0; x < WORLD.W; x++) {
      const id = w.occupancy[y][x]
      const real = at.get(`${x},${y}`)
      if (id > 0) {
        if (!real || !real.some((r) => r.plantId === id)) {
          mismatch = true
          if (!firstMismatch) firstMismatch = `t${t}: occupancy[${y}][${x}]=${id}, клетки нет`
        }
      } else if (id === 0 && real && real.length > 0) {
        mismatch = true
        if (!firstMismatch) firstMismatch = `t${t}: клетка в ${x},${y}, occupancy=0`
      }
    }
  }
  if (mismatch) occMismatchTicks++
}

for (let t = 0; t < 1600; t++) {
  w.tick()
  check(t + 1)
}

// разброс высот живых растений
const heights: number[] = []
for (const p of w.plants) {
  if (p.dead) continue
  let maxH = 0
  for (const c of p.cells) {
    if (c.y < WORLD.SOIL_Y) maxH = Math.max(maxH, WORLD.SOIL_Y - c.y)
  }
  heights.push(maxH)
}
heights.sort((a, b) => a - b)
const minH = heights[0] ?? 0
const maxH = heights[heights.length - 1] ?? 0
const medH = heights[Math.floor(heights.length / 2)] ?? 0

console.log('Тиков с наложением клеток:', overlapTicks)
console.log('Тиков с наложением семя+растение:', seedOverlapTicks)
console.log('Тиков с касанием в воздухе:', airTouchTicks)
console.log('Тиков с рассинхроном occupancy:', occMismatchTicks)
if (firstOverlap) console.log('Первое наложение:', firstOverlap)
if (firstSeedOverlap) console.log('Первое семя+растение:', firstSeedOverlap)
if (firstAirTouch) console.log('Первое касание в воздухе:', firstAirTouch)
if (firstMismatch) console.log('Первый рассинхрон:', firstMismatch)
console.log(`Высоты живых: min=${minH} med=${medH} max=${maxH} (n=${heights.length})`)
if (!overlapTicks && !seedOverlapTicks && !airTouchTicks && !occMismatchTicks) {
  console.log('OK: все инварианты занятости соблюдены')
}
