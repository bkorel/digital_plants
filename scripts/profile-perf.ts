/**
 * Замер CPU-времени world.tick() в Node (без отрисовки).
 * Запуск: npx tsx scripts/profile-perf.ts
 */
import { performance } from 'node:perf_hooks'
import { World } from '../src/sim/world'

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length
  const total = sorted.reduce((s, v) => s + v, 0)
  const pct = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))] ?? 0
  return {
    n,
    avg: total / n,
    p50: pct(0.5),
    p95: pct(0.95),
    max: sorted[n - 1] ?? 0,
    total,
  }
}

function aliveCount(w: World): number {
  return w.plants.filter((p) => !p.dead).length
}

function cellCount(w: World): number {
  let n = 0
  for (const p of w.plants) {
    if (p.dead) continue
    n += p.cells.length
  }
  return n
}

function benchTicks(w: World, count: number, warmup = 20): ReturnType<typeof stats> & { label: string } {
  for (let i = 0; i < warmup; i++) w.tick()
  const samples: number[] = []
  for (let i = 0; i < count; i++) {
    const t0 = performance.now()
    w.tick()
    samples.push(performance.now() - t0)
  }
  return { label: '', ...stats(samples) }
}

function runScenario(seed: number) {
  const w = new World(seed)
  const checkpoints: {
    tick: number
    alive: number
    cells: number
    bench: ReturnType<typeof benchTicks>
  }[] = []

  const capture = () => {
    const b = benchTicks(w, 80, 15)
    checkpoints.push({
      tick: w.tickCount,
      alive: aliveCount(w),
      cells: cellCount(w),
      bench: b,
    })
  }

  capture() // t=0
  while (w.tickCount < 2500) {
    w.tick()
    if (w.tickCount === 50 || w.tickCount === 150 || w.tickCount === 300 || w.tickCount === 600) {
      capture()
    }
    if (aliveCount(w) === 0 && w.seeds.length === 0 && w.tickCount > 100) {
      capture()
      break
    }
  }

  return checkpoints
}

console.log('=== profile-perf: world.tick() (Node, без Canvas) ===\n')

for (const seed of [42, 7]) {
  console.log(`--- seed ${seed} ---`)
  const checkpoints = runScenario(seed)
  for (const cp of checkpoints) {
    const b = cp.bench
    console.log(
      `t=${String(cp.tick).padStart(4)} | alive=${String(cp.alive).padStart(2)} cells=${String(cp.cells).padStart(5)} | ` +
        `tick avg=${b.avg.toFixed(2)}ms p95=${b.p95.toFixed(2)}ms max=${b.max.toFixed(2)}ms (${b.n} samples)`,
    )
  }
  console.log()
}

// Сравнение: один тик vs пакет из 10 (как при speed=10)
{
  const w = new World(42)
  for (let i = 0; i < 300; i++) w.tick()
  const single = benchTicks(w, 200, 10)
  const batchSamples: number[] = []
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now()
    for (let j = 0; j < 10; j++) w.tick()
    batchSamples.push(performance.now() - t0)
  }
  const batch = stats(batchSamples)
  console.log('--- пакет как speed=10 (после t≈300) ---')
  console.log(`1 tick:  avg=${single.avg.toFixed(2)}ms p95=${single.p95.toFixed(2)}ms`)
  console.log(`10 ticks: avg=${batch.avg.toFixed(2)}ms p95=${batch.p95.toFixed(2)}ms (≈${(batch.avg / 10).toFixed(2)}ms/tick)`)
  console.log(`бюджет кадра App 14ms → ~${Math.floor(14 / single.avg)} тиков/кадр при 1x`)
}
