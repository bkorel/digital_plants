import { World } from '../src/sim/world'
import { WORLD } from '../src/sim/config'

const w = new World(7)

function snap(label: string) {
  let above = 0
  let maxH = 0
  let maxD = 0
  let roots = 0
  let sprouts = 0
  let stems = 0
  for (const p of w.plants) {
    if (p.dead) continue
    for (const c of p.cells) {
      if (c.type === 'ROOT') roots++
      if (c.type === 'SPROUT') sprouts++
      if (c.type === 'STEM') stems++
      if (c.y < WORLD.SOIL_Y) {
        above++
        maxH = Math.max(maxH, WORLD.SOIL_Y - c.y)
      } else maxD = Math.max(maxD, c.y - WORLD.SOIL_Y)
    }
  }
  const alive = w.plants.filter((p) => !p.dead).length
  const energies = w.seeds.map((s) => s.energy)
  const avgE = energies.length ? (energies.reduce((a, b) => a + b, 0) / energies.length).toFixed(1) : '-'
  const minE = energies.length ? Math.min(...energies).toFixed(1) : '-'
  console.log(
    `${label}: alive=${alive} total=${w.plants.length} seeds=${w.seeds.length}(E~${avgE},min${minE}) roots=${roots} stems=${stems} above=${above} maxH=${maxH} maxD=${maxD}`,
  )
}

let minAlive = Infinity
for (let t = 0; t < 1600; t++) {
  w.tick()
  const a = w.plants.filter((p) => !p.dead).length
  if (t > 30) minAlive = Math.min(minAlive, a)
  if ([20, 50, 100, 200, 300, 350, 400, 450, 500, 700, 1000, 1599].includes(t)) snap(`t${t + 1}`)
}
console.log('minAlive(after t30):', minAlive)

let roots = 0
let stems = 0
let sprouts = 0
let seeds = 0
let lateralRoots = 0
let aboveGround = 0
let maxHeight = 0
let maxDepth = 0

for (const p of w.plants) {
  if (p.dead) continue
  const cols = new Map<number, number[]>()
  for (const c of p.cells) {
    if (c.type === 'ROOT') roots++
    if (c.type === 'STEM') stems++
    if (c.type === 'SPROUT') sprouts++
    if (c.type === 'SEED') seeds++
    if (c.y < WORLD.SOIL_Y) {
      aboveGround++
      maxHeight = Math.max(maxHeight, WORLD.SOIL_Y - c.y)
    }
    if (c.y >= WORLD.SOIL_Y) maxDepth = Math.max(maxDepth, c.y - WORLD.SOIL_Y)
    const arr = cols.get(c.y) ?? []
    arr.push(c.x)
    cols.set(c.y, arr)
  }
  // боковые корни: в одном ряду почвы больше одной клетки
  for (const [y, xs] of cols) {
    if (y >= WORLD.SOIL_Y && xs.length > 1) lateralRoots += xs.length - 1
  }
}

const alive = w.plants.filter((p) => !p.dead).length
const s = w.stats()
console.log(JSON.stringify({
  tick: w.tickCount,
  alive,
  species: s.speciesEstimate,
  seedsInSoil: s.seedsInSoil,
  roots, stems, sprouts, seeds,
  aboveGround,
  maxHeight,
  maxDepth,
  lateralRoots,
  avgHeight: Number(s.avgHeight.toFixed(2)),
}, null, 2))
