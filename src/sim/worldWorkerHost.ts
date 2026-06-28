import type { World } from './world'
import type { WorldSnapshot } from './worldSnapshot'
import { applyWorldSnapshot, captureWorldSnapshot } from './worldSnapshot'
import type { WorkerInMessage, WorkerOutMessage } from './worldWorker'

export type WorkerTickCallback = (ticksRun: number, snapshot: WorldSnapshot) => void

/** Хост Web Worker для симуляции в режиме EVOLUTION. */
export class WorldWorkerHost {
  private worker: Worker | null = null
  private pendingTicks = 0
  private lastSentTicks = 0
  private lastTracePlantId: number | null = null
  private busy = false
  private onSnapshot: WorkerTickCallback
  private displayWorld: World

  constructor(displayWorld: World, onSnapshot: WorkerTickCallback) {
    this.displayWorld = displayWorld
    this.onSnapshot = onSnapshot
  }

  start(): void {
    if (this.worker) return
    this.worker = new Worker(new URL('./worldWorker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => {
      const msg = ev.data
      if (msg.type === 'error') {
        console.error('[worldWorker]', msg.message)
        this.busy = false
        return
      }
      if (msg.type === 'snapshot') {
        applyWorldSnapshot(this.displayWorld, msg.snapshot)
        const ran = this.lastSentTicks
        this.lastSentTicks = 0
        this.busy = false
        this.onSnapshot(ran, msg.snapshot)
        if (this.pendingTicks > 0) {
          this.flushTicks(this.lastTracePlantId)
        }
      }
    }
    this.busy = true
    const snapshot = captureWorldSnapshot(this.displayWorld)
    this.worker.postMessage({ type: 'restore', snapshot })
  }

  stop(): void {
    this.worker?.terminate()
    this.worker = null
    this.busy = false
    this.pendingTicks = 0
  }

  isBusy(): boolean {
    return this.busy
  }

  queueTicks(count: number, tracePlantId: number | null): void {
    if (!this.worker || count <= 0) return
    this.lastTracePlantId = tracePlantId
    this.pendingTicks += count
    if (!this.busy) this.flushTicks(tracePlantId)
  }

  flushTicks(tracePlantId: number | null): void {
    if (!this.worker || this.busy || this.pendingTicks <= 0) return
    this.lastSentTicks = this.pendingTicks
    this.pendingTicks = 0
    this.busy = true
    this.worker.postMessage({
      type: 'tick',
      count: this.lastSentTicks,
      tracePlantId,
    } satisfies WorkerInMessage)
  }

  restart(seed: number, randomGenomes: boolean): void {
    if (!this.worker) return
    this.busy = true
    this.pendingTicks = 0
    this.worker.postMessage({
      type: 'restart',
      seed,
      randomGenomes,
    } satisfies WorkerInMessage)
  }

  restoreFromDisplay(): void {
    if (!this.worker) return
    const snapshot = captureWorldSnapshot(this.displayWorld)
    this.busy = true
    this.worker.postMessage({ type: 'restore', snapshot })
  }

  setTracePlant(tracePlantId: number | null): void {
    this.worker?.postMessage({
      type: 'setTracePlant',
      tracePlantId,
    } satisfies WorkerInMessage)
  }
}

/** Worker отключён по умолчанию: полный snapshot каждый тик медленнее sync на main thread. */
export const ENABLE_WORKER_SIM = false

/** Симуляция в worker доступна только в браузере (не в Node profile). */
export function isWorkerSimulationAvailable(): boolean {
  return ENABLE_WORKER_SIM && typeof Worker !== 'undefined'
}
