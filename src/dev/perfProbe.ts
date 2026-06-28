/** Включить: ?perf=1 в URL или localStorage.setItem('dp-perf', '1') */

export interface PerfBucket {
  count: number
  totalMs: number
  maxMs: number
}

export interface PerfReport {
  tick: PerfBucket
  draw: PerfBucket
  rafBatch: PerfBucket
  ticksPerFrame: PerfBucket
  lastAlive: number
  lastCells: number
  lastTick: number
}

function emptyBucket(): PerfBucket {
  return { count: 0, totalMs: 0, maxMs: 0 }
}

const state: PerfReport = {
  tick: emptyBucket(),
  draw: emptyBucket(),
  rafBatch: emptyBucket(),
  ticksPerFrame: emptyBucket(),
  lastAlive: 0,
  lastCells: 0,
  lastTick: 0,
}

let logTimer: ReturnType<typeof setInterval> | null = null

export function isPerfEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).has('perf')) return true
    return localStorage.getItem('dp-perf') === '1'
  } catch {
    return false
  }
}

function add(bucket: PerfBucket, ms: number): void {
  bucket.count++
  bucket.totalMs += ms
  if (ms > bucket.maxMs) bucket.maxMs = ms
}

export function recordTick(ms: number): void {
  if (!isPerfEnabled()) return
  add(state.tick, ms)
}

export function recordDraw(ms: number): void {
  if (!isPerfEnabled()) return
  add(state.draw, ms)
}

export function recordRafBatch(ms: number, tickCount: number): void {
  if (!isPerfEnabled()) return
  add(state.rafBatch, ms)
  add(state.ticksPerFrame, tickCount)
}

export function recordWorldMeta(tick: number, alive: number, cells: number): void {
  if (!isPerfEnabled()) return
  state.lastTick = tick
  state.lastAlive = alive
  state.lastCells = cells
}

function avg(b: PerfBucket): number {
  return b.count > 0 ? b.totalMs / b.count : 0
}

function formatBucket(name: string, b: PerfBucket, unit = 'ms'): string {
  if (b.count === 0) return `${name}: —`
  return `${name}: avg ${avg(b).toFixed(2)}${unit} max ${b.maxMs.toFixed(2)}${unit} (n=${b.count})`
}

function resetBuckets(): void {
  state.tick = emptyBucket()
  state.draw = emptyBucket()
  state.rafBatch = emptyBucket()
  state.ticksPerFrame = emptyBucket()
}

export function getPerfSummary(): string {
  const tpf = avg(state.ticksPerFrame)
  return (
    `t=${state.lastTick} alive=${state.lastAlive} cells=${state.lastCells} | ` +
    `${formatBucket('tick', state.tick)} | ${formatBucket('draw', state.draw)} | ` +
    `${formatBucket('raf', state.rafBatch)} | ticks/frame avg ${tpf.toFixed(1)}`
  )
}

function logReport(): void {
  exposePerfOnWindow()
  console.log(`[dp-perf] ${getPerfSummary()}`)
  resetBuckets()
}

export function startPerfProbe(): void {
  if (!isPerfEnabled() || logTimer != null) return
  console.info('[dp-perf] profiling on — logs every 3s. Disable: localStorage.removeItem("dp-perf")')
  exposePerfOnWindow()
  logTimer = setInterval(logReport, 3000)
}

declare global {
  interface Window {
    __dpPerf?: { summary: () => string }
  }
}

export function exposePerfOnWindow(): void {
  if (!isPerfEnabled() || typeof window === 'undefined') return
  window.__dpPerf = { summary: getPerfSummary }
}
