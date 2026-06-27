import { World } from '../src/sim/world'
import {
  GERMINATION_NEIGHBOR_BLOCK,
  MAX_GERMINATIONS_PER_TICK,
  MIN_SEED_ENERGY,
  SEED_GERMINATION_TICKS,
  WORLD,
} from '../src/sim/config'

const w = new World(7)

let totalDropped = 0
let totalGerminated = 0
let totalDied = 0
let peakSeeds = 0

// причины отказа в прорастании (за один тик, суммарно)
const failReasons = {
  tooYoung: 0,
  lowEnergy: 0,
  surfaceOccupied: 0,
  neighborBlocked: 0,
  capReached: 0,
  rngFail: 0,
  germinated: 0,
  died: 0,
}

function getBlockedColumns(world: World): Set<number> {
  const blocked = new Set<number>()
  for (const plant of world.plants) {
    if (plant.dead) continue
    const surfaceColumns = new Set<number>()
    for (const cell of plant.cells) {
      if (cell.y <= WORLD.SOIL_Y) surfaceColumns.add(cell.x)
    }
    for (const px of surfaceColumns) {
      for (let d = 1; d <= GERMINATION_NEIGHBOR_BLOCK; d++) {
        if (px - d >= 0) blocked.add(px - d)
        if (px + d < WORLD.W) blocked.add(px + d)
      }
    }
  }
  return blocked
}

for (let t = 0; t < 800; t++) {
  const beforeSeeds = w.seeds.length
  w.tick()
  const afterSeeds = w.seeds.length

  if (afterSeeds > peakSeeds) peakSeeds = afterSeeds

  // грубая оценка: прирост семян
  if (afterSeeds > beforeSeeds) totalDropped += afterSeeds - beforeSeeds

  const blocked = getBlockedColumns(w)
  let germinatedThisTick = 0

  for (const seed of w.seeds) {
    if (seed.energy <= 0) {
      totalDied++
      failReasons.died++
      continue
    }
    if (seed.ticksInSoil < SEED_GERMINATION_TICKS) {
      failReasons.tooYoung++
      continue
    }
    if (seed.energy < MIN_SEED_ENERGY) {
      failReasons.lowEnergy++
      continue
    }
    if (w.occupancy[WORLD.SOIL_Y][seed.x] !== 0) {
      failReasons.surfaceOccupied++
      continue
    }
    if (blocked.has(seed.x)) {
      failReasons.neighborBlocked++
      continue
    }
    if (germinatedThisTick >= MAX_GERMINATIONS_PER_TICK) {
      failReasons.capReached++
      continue
    }
    // 30% шанс — считаем как «могло бы»; реальный успех не знаем без rng
    failReasons.rngFail++
    germinatedThisTick++
  }

  if ((t + 1) % 100 === 0) {
    const alive = w.plants.filter((p) => !p.dead).length
    const deep = w.seeds.filter((s) => s.y > WORLD.SOIL_Y).length
    const atSurface = w.seeds.filter((s) => s.y === WORLD.SOIL_Y).length
    const blockedCols = blocked.size
    console.log(
      `t${t + 1}: alive=${alive} seeds=${w.seeds.length} (поверхн=${atSurface} глубок=${deep}) blockedCols=${blockedCols}`,
    )
  }
}

console.log('\n--- Итог ---')
console.log('Пик семян в почве:', peakSeeds)
console.log('Сейчас в почве:', w.seeds.length)
console.log(
  'Глубокие семена (y > SOIL_Y):',
  w.seeds.filter((s) => s.y > WORLD.SOIL_Y).length,
)
console.log(
  'Средний возраст семян:',
  w.seeds.length
    ? (w.seeds.reduce((s, x) => s + x.ticksInSoil, 0) / w.seeds.length).toFixed(1)
    : 0,
)

// распределение по возрасту
const ageBuckets = new Map<string, number>()
for (const s of w.seeds) {
  const b =
    s.ticksInSoil < SEED_GERMINATION_TICKS
      ? '0-9 ждут'
      : s.energy < MIN_SEED_ENERGY
        ? 'готовы, но мало энергии'
        : 'могут прорасти'
  ageBuckets.set(b, (ageBuckets.get(b) ?? 0) + 1)
}
console.log('Возраст семян:', Object.fromEntries(ageBuckets))

// топ причин «готовых» семян не прорастают прямо сейчас
const blocked = getBlockedColumns(w)
let surf = 0
let neigh = 0
let free = 0
for (const seed of w.seeds) {
  if (seed.ticksInSoil < SEED_GERMINATION_TICKS || seed.energy < MIN_SEED_ENERGY) continue
  if (w.occupancy[WORLD.SOIL_Y][seed.x] !== 0) surf++
  else if (blocked.has(seed.x)) neigh++
  else free++
}
console.log(`Готовые к прорастанию: поверхность занята=${surf}, сосед заблокирован=${neigh}, свободны=${free}`)
