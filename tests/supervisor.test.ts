import { expect, test } from 'claude-code/testing'

import type { Ops } from '../engine/ops'
import { Supervisor } from '../engine/supervisor'

type Timer = { cancel: () => void; fire: () => void }

function fakeOps(state: { spawns: number; fail: boolean; killed?: boolean; spawnEnvs?: Array<Record<string, string>> }) {
  const every: Timer[] = []
  const after: Timer[] = []
  const timer = (list: Timer[], fn: () => void): Timer => {
    const held: Timer = {
      cancel: () => {
        const index = list.indexOf(held)
        if (index >= 0) list.splice(index, 1)
      },
      fire: () => {
        held.cancel()
        fn()
      },
    }
    list.push(held)
    return held
  }
  const stream = () => ({
    [Symbol.asyncIterator]: async function* () {
      state.spawns += 1
      yield { stream: 'stdout' as const, text: '{"ready":true,"port":1}\n' }
      await new Promise<void>(() => {})
    },
    result: new Promise(() => {}),
  })
  const ops = {
    root: 'D:/Study/transom',
    ask: async () => 'Allow',
    log: () => {},
    status: () => {},
    toast: () => {},
    fetch: async (url: string) => {
      if (url.endsWith('/health')) {
        const ok = !state.fail
        return { status: ok ? 200 : 503, ok, headers: {}, text: JSON.stringify({ ok, error: ok ? null : 'down' }) }
      }
      return { status: 200, ok: true, headers: {}, text: '{"ok":true}' }
    },
    spawn: (request: { env?: Record<string, string> }) => {
      state.spawnEnvs?.push(request.env ?? {})
      return stream() as never
    },
    storeGet: async () => undefined,
    storeSet: async () => {},
    every: (ms: number, fn: () => void) => timer(every, fn) as never,
    after: (ms: number, fn: () => void) => timer(after, fn) as never,
    openPane: async () => ({ isPlaced: true }) as never,
    closePane: async () => {},
  } as unknown as Ops
  return { ops, every, after, fireAfter: () => { for (const held of [...after]) held.fire() } }
}

const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

test('supervisor starts once and reports ready', async () => {
  const state = { spawns: 0, fail: false }
  const { ops } = fakeOps(state)
  const supervisor = new Supervisor(ops)
  const endpoint = await supervisor.ensure()
  expect(endpoint.port).toBe(1)
  expect(supervisor.phase).toBe('ready')
  await supervisor.ensure()
  expect(state.spawns).toBe(1)
})

test('a failing health check restarts the bridge', async () => {
  const state = { spawns: 0, fail: false }
  const { ops, after } = fakeOps(state)
  const fatal: string[] = []
  const supervisor = new Supervisor(ops)
  supervisor.onFatal(reason => fatal.push(reason))
  await supervisor.ensure()

  state.fail = true
  await supervisor.probe()
  expect(supervisor.phase).toBe('failed')
  expect(after.length).toBe(1)

  state.fail = false
  after[0]!.fire()
  await settle()
  expect(state.spawns).toBe(2)
  expect(supervisor.phase).toBe('ready')
  expect(fatal).toEqual([])
})

test('ensure({ attachPort }) passes the debugging port to the bridge', async () => {
  const state = { spawns: 0, fail: false, spawnEnvs: [] as Array<Record<string, string>> }
  const { ops } = fakeOps(state)
  const supervisor = new Supervisor(ops)
  await supervisor.ensure({ attachPort: 9222 })
  expect(supervisor.phase).toBe('ready')
  expect(state.spawnEnvs.length).toBe(1)
  expect(state.spawnEnvs[0]?.TRANSOM_ATTACH_PORT).toBe('9222')
  // A plain close clears the mode: the next start launches fresh.
  await supervisor.stop()
  await supervisor.ensure()
  expect(state.spawnEnvs.length).toBe(2)
  expect(state.spawnEnvs[1]?.TRANSOM_ATTACH_PORT).toBeUndefined()
})

test('stop asks the bridge to shut down', async () => {
  const state = { spawns: 0, fail: false }
  const { ops } = fakeOps(state)
  const supervisor = new Supervisor(ops)
  await supervisor.ensure()
  await supervisor.stop()
  expect(supervisor.phase).toBe('stopped')
})

test('stop during start kills the child and leaves no live endpoint', async () => {
  const state: { spawns: number; fail: boolean; killed?: boolean } = { spawns: 0, fail: false }
  const { ops, after, fireAfter } = fakeOps(state)
  const supervisor = new Supervisor(ops)
  const starting = supervisor.ensure()
  await settle()
  await supervisor.stop()
  expect(supervisor.endpoint, 'endpoint cleared').toBeUndefined()
  fireAfter()
  await settle()
  await starting.catch(() => {})
  expect(supervisor.phase).toBe('stopped')
  expect(supervisor.endpoint).toBeUndefined()
  // A later explicit start is a fresh child, not the abandoned launch.
  await supervisor.ensure()
  expect(state.spawns).toBe(2)
})

test('a pending backoff after stop does not spawn again', async () => {
  const state = { spawns: 0, fail: false }
  const { ops, fireAfter } = fakeOps(state)
  const supervisor = new Supervisor(ops)
  await supervisor.ensure()
  state.fail = true
  await supervisor.probe()
  expect(supervisor.phase, 'phase after failed probe').toBe('failed')

  await supervisor.stop()
  fireAfter()
  await settle()
  expect(state.spawns).toBe(1)
  expect(supervisor.phase).toBe('stopped')
})
