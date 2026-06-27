import { World } from '../src/sim/world'
import { WORLD } from '../src/sim/config'
import { createPlant, plantMaxHeight, plantTotalEnergy } from '../src/sim/plant'
import { genomeHeightCap, randomGenome } from '../src/sim/genome'

const w = new World(3)
w.plants = []
w.seeds = []
w.fallingSeeds = []
w.occupancy = Array.from({ length: WORLD.H }, () => new Int32Array(WORLD.W))
const g = randomGenome(w.rng)
console.log('heightCap', genomeHeightCap(g).toFixed(2), '≈', Math.round(genomeHeightCap(g) * WORLD.SOIL_Y), 'cells')
const p = createPlant(g, 60, WORLD.SOIL_Y, 0, 8, 0)
w.plants.push(p)
w.occupancy[WORLD.SOIL_Y][60] = p.id

for (let t = 0; t < 80; t++) {
  w.tick()
  if (!p.dead && (t + 1) % 10 === 0) {
    const airSprouts = p.cells.filter((c) => c.type === 'SPROUT' && c.y < WORLD.SOIL_Y).length
    const seedCells = p.cells.filter((c) => c.type === 'SEED').length
    console.log(
      `t${t + 1} H=${plantMaxHeight(p)} E=${plantTotalEnergy(p).toFixed(1)} cells=${p.cells.length} airSprouts=${airSprouts} seedCells=${seedCells} soilSeeds=${w.seeds.length}`,
    )
  }
}
