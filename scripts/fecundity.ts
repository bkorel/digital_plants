import { World } from '../src/sim/world'
import { WORLD } from '../src/sim/config'

// Один шаблонный росток в пустом мире; считаем семена за всю жизнь.
const w = new World(3)
// очистить всё, оставить одно растение в центре
w.plants = []
w.seeds = []
w.fallingSeeds = []
w.occupancy = Array.from({ length: WORLD.H }, () => new Int32Array(WORLD.W))

import { createPlant } from '../src/sim/plant'
import { randomGenome } from '../src/sim/genome'
const g = randomGenome(w.rng)
const p = createPlant(g, 60, WORLD.SOIL_Y, 0, 8, 0)
w.plants.push(p)
w.occupancy[WORLD.SOIL_Y][60] = p.id

let totalSeeds = 0
let prevSeedTotal = 0
for (let t = 0; t < 250; t++) {
  w.tick()
  const seedTotal = w.seeds.length + w.fallingSeeds.length
  // считаем прирост семян (грубо)
  if (seedTotal > prevSeedTotal) totalSeeds += seedTotal - prevSeedTotal
  prevSeedTotal = seedTotal
  if (t % 25 === 24) {
    const live = w.plants.filter((x) => !x.dead)
    const cells = live.reduce((s, x) => s + x.cells.length, 0)
    const energy = live.reduce((s, x) => s + x.cells.reduce((a, c) => a + c.cellEnergy, 0), 0)
    let maxH = 0
    for (const x of live) for (const c of x.cells) if (c.y < WORLD.SOIL_Y) maxH = Math.max(maxH, WORLD.SOIL_Y - c.y)
    console.log(`t${t + 1}: live=${live.length} cells=${cells} E=${energy.toFixed(1)} maxH=${maxH} seedsDropped≈${totalSeeds}`)
  }
}
