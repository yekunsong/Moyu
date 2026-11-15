import { expect, test } from 'claude-code/testing'

import type { Ops } from '../engine/ops'
import type { ActContext, Action, ActResult, Capabilities, Provider, Snapshot } from '../engine/provider'
import { Hub } from '../hub/hub'

const CAPS: Capabilities = {
  pointer: false, keys: false, scroll: false, text: true,
  minCols: 20, minRows: 5,
}

class StubProvider implements Provider {
  readonly meta = {
    id: 'stub',
    label: 'Stub',
    capabilities: CAPS,
    allowSchemes: ['http:', 'https:'],
    defaultWidth: 80,
  }
  stopCalls = 0

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.stopCalls += 1
  }
  async health() {
    return { ok: true }
  }
  async snapshot(): Promise<Snapshot> {
    return {
      url: 'https://stub.test/',
      title: 'Stub page',
      capturedAt: Date.now(),
      viewport: { cols: 80, rows: 24, scrollX: 0, scrollY: 0, width: 640, height: 384, docWidth: 640, docHeight: 1 },
      landmarks: [],
      nodes: [{ ref: 'r1', role: 'text', name: 'stub body', depth: 0, bounds: { x: 0, y: 0, w: 1, h: 1 } }],
      truncated: { nodes: 0, chars: 0, scope: 'viewport' },
    }
  }
  async act(_action: Action, _context: ActContext): Promise<ActResult> {
    return { ok: true, changed: false, message: 'acted' }
  }
}

function fakeOps(): Ops {
  return {
    root: '.',
    ask: async () => 'Allow',
    log: () => undefined,
    status: () => undefined,
    toast: () => undefined,
    fetch: async () => ({ status: 200, ok: true, headers: {}, text: '{}' }),
    spawn: (() => {}) as unknown as Ops['spawn'],
    storeGet: async () => undefined,
    storeSet: async () => undefined,
    every: () => ({ cancel: () => undefined }) as never,
    after: () => ({ cancel: () => undefined }) as never,
    openPane: async () => ({ isPlaced: true }) as never,
    closePane: async () => undefined,
    readText: async () => '',
    listDir: async () => [],
    statPath: async () => ({ kind: 'file', size: 0, mtimeMs: 0, isLink: false }),
    fillPrompt: async () => undefined,
  }
}

async function stubHub(): Promise<{ hub: Hub; stub: StubProvider; made: string[] }> {
  const made: string[] = []
  const stub = new StubProvider()
  const hub = new Hub(fakeOps(), {}, {
    providerFactory: id => {
      made.push(id)
      return stub
    },
  })
  await hub.useProvider('stub')
  await hub.start()
  await hub.refresh()
  return { hub, stub, made }
}

test('a provider without pointer, keys or scroll refuses those actions', async () => {
  const { hub } = await stubHub()
  const cases: Action[] = [
    { kind: 'click', ref: 'r1' },
    { kind: 'press', key: 'Enter' },
    { kind: 'scroll', dx: 0, dy: 4 },
  ]
  for (const action of cases) {
    const { result } = await hub.act(action, 'model')
    expect(result.ok, action.kind).toBe(false)
    expect(result.message, action.kind).toContain('does not support')
  }
  // A refused action never prompted or reached the provider.
  const audit = hub.audit.recent(20)
  expect(audit.length).toBe(cases.length)
  expect(audit.every(entry => entry.provider === 'stub' && entry.policy === 'unsupported')).toBe(true)
})

test('snapshots still work and audit rows carry the provider id', async () => {
  const { hub } = await stubHub()
  const { text } = await hub.modelSnapshot('viewport')
  expect(text).toContain('stub body')
  expect(hub.audit.recent(1)[0]?.provider).toBe('stub')
})

test('commands always reach the provider', async () => {
  const { hub } = await stubHub()
  const { result } = await hub.act({ kind: 'command', name: 'page', args: { delta: 1 } }, 'model')
  expect(result.ok).toBe(true)
  expect(hub.audit.recent(1)[0]?.action).toContain('command page')
})

test('switching providers stops the previous one and clears the snapshot', async () => {
  const { hub, stub, made } = await stubHub()
  expect(hub.lastSnapshot()).toBeDefined()
  await hub.useProvider('other')
  expect(stub.stopCalls).toBe(1)
  expect(hub.lastSnapshot()).toBeUndefined()
  expect(made.at(-1)).toBe('other')
})
