import { World } from './world'
import {
  applyWorldSnapshot,
  captureWorldSnapshot,
  transferablesFromSnapshot,
  type WorldSnapshot,
} from './worldSnapshot'

export type WorkerInMessage =
  | { type: 'tick'; count: number; tracePlantId: number | null }
  | { type: 'restart'; seed: number; randomGenomes: boolean }
  | { type: 'restore'; snapshot: WorldSnapshot }
  | { type: 'setTracePlant'; tracePlantId: number | null }

export type WorkerOutMessage =
  | { type: 'snapshot'; snapshot: WorldSnapshot }
  | { type: 'error'; message: string }

let world: World | null = null

function postSnapshot(): void {
  if (!world) return
  const snapshot = captureWorldSnapshot(world)
  const transfer = transferablesFromSnapshot(snapshot)
  const msg: WorkerOutMessage = { type: 'snapshot', snapshot }
  self.postMessage(msg, { transfer })
}

self.onmessage = (ev: MessageEvent<WorkerInMessage>) => {
  try {
    const msg = ev.data
    switch (msg.type) {
      case 'tick': {
        if (!world) return
        world.tracePlantId = msg.tracePlantId
        for (let i = 0; i < msg.count; i++) {
          world.tick()
        }
        postSnapshot()
        break
      }
      case 'restart': {
        if (!world) world = new World(msg.seed)
        world.restart(msg.seed, msg.randomGenomes)
        postSnapshot()
        break
      }
      case 'restore': {
        if (!world) world = new World(42)
        applyWorldSnapshot(world, msg.snapshot)
        postSnapshot()
        break
      }
      case 'setTracePlant': {
        if (!world) return
        world.tracePlantId = msg.tracePlantId
        break
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    self.postMessage({ type: 'error', message } satisfies WorkerOutMessage)
  }
}
