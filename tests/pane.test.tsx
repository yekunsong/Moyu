import { atom, update } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Register } from 'claude-code'

import { register } from '../hooks/main'
import { installBottom } from './helpers'

const PANE = {
  title: 'Transom',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}
const VIEWPORT = { columns: 100, rows: 24, isFullscreen: true }

function load(on: Parameters<Register>[0]): void {
  register(on, { allowedHosts: 'localhost', writePolicy: 'confirm' } as Parameters<Register>[1])
}

async function start($: unknown): Promise<void> {
  await ($ as { session: { start: (e: unknown) => Promise<unknown> } }).session.start({
    cwd: 'D:/Study/transom',
    surface: 'terminal',
    isInteractive: true,
  })
}

async function tool($: unknown, name: string, args: Record<string, unknown> = {}) {
  return await ($ as { tool: { call: (e: unknown) => Promise<{ text?: string }> } }).tool.call({
    tool: `mcp__transom__${name}`,
    ...args,
  })
}

test('closed pane draws the intro and toolbar', async ($, on) => {
  installBottom(on)
  load(on)
  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    props: PANE,
    requestId: 'transom',
    viewport: VIEWPORT,
  })

  const tree = await ui.drawn()
  expect(JSON.stringify(tree)).toContain('Transom')
  expect(await ui.find({ type: 'Button', key: 'demo' }), 'demo button').toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'keys' }), 'keys client').toBeDefined()
  await ui.unmount()
})

test('open, snapshot and act work end to end against the fake bridge', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)

  const opened = await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })
  expect(opened.text ?? '').toContain('Demo page')

  const acted = await tool($, 'browser_act', { kind: 'click', ref: 't1' })
  expect(acted.text ?? '').toContain('ok')
  expect(bottom.fetches).toContain('POST http://127.0.0.1:1/act')
  expect(bottom.page.count).toBe(1)

  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    props: PANE,
    requestId: 'transom',
    viewport: VIEWPORT,
  })
  expect(await ui.find({ type: 'Button', key: 't1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /hello|Increase count/ })).toBeDefined()
  await ui.unmount()

  const snap = await tool($, 'browser_snapshot', {})
  expect(snap.text ?? '').toContain('count 1')
})

test('a person press runs without a confirmation prompt', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    props: PANE,
    requestId: 'transom',
    viewport: VIEWPORT,
  })
  await ui.press({ key: 't1' })
  expect(bottom.asks.length).toBe(0)
  expect(bottom.page.count).toBe(1)
  await ui.unmount()
})

test('visual mode draws a Raster and toggles back to text', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    props: PANE,
    requestId: 'transom',
    viewport: VIEWPORT,
  })
  await ui.press({ key: 'visual' })
  expect(bottom.fetches.some(one => one.includes('/raster')), 'raster fetch').toBe(true)
  expect(await ui.find({ type: 'Raster', key: 'shot' }), 'raster').toBeDefined()
  await ui.press({ key: 'visual' })
  await bottom.advance(16)
  expect(await ui.find({ type: 'Raster', key: 'shot' })).toBeUndefined()
  expect(bottom.fetches.some(one => one.includes('/raster'))).toBe(true)
  await ui.unmount()
})

test('a narrow pane reports degradation', async ($, on) => {
  installBottom(on)
  load(on)
  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    props: { ...PANE, bodyColumns: 30 },
    requestId: 'transom',
    viewport: { columns: 30, rows: 20, isFullscreen: true },
  })
  expect(await ui.find({ type: 'Text', text: /degraded/ })).toBeDefined()
  await ui.unmount()
})

test('a denied model write does not run', async ($, on) => {
  const bottom = installBottom(on)
  bottom.answerAsk('Deny')
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const denied = await tool($, 'browser_act', { kind: 'fill', ref: 't2', text: 'a@b.c' })
  expect(denied.text ?? '').toContain('denied')
  expect(bottom.page.fills['t2']).toBeUndefined()
  expect(bottom.asks.at(-1) ?? '').toContain('fill')
})

test('allow-all sticks for the session', async ($, on) => {
  const bottom = installBottom(on)
  bottom.answerAsk('Allow all this session')
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  await tool($, 'browser_act', { kind: 'click', ref: 't1' })
  const before = bottom.asks.length
  await tool($, 'browser_act', { kind: 'click', ref: 't1' })
  expect(bottom.asks.length).toBe(before)
  expect(bottom.page.count).toBe(2)
})

test('audit records model actions', async ($, on) => {
  const bottom = installBottom(on)
  bottom.answerAsk('Allow')
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })
  await tool($, 'browser_act', { kind: 'click', ref: 't1' })

  const audit = await tool($, 'browser_audit', { limit: 10 })
  expect(audit.text ?? '').toContain('model')
  expect(audit.text ?? '').toContain('click')
})

test('a model open of an unlisted host asks before starting', async ($, on) => {
  const bottom = installBottom(on)
  bottom.answerAsk('Deny')
  load(on)
  await start($)

  const opened = await tool($, 'browser_open', { url: 'https://elsewhere.test/' })
  expect(opened.text ?? '').toContain('denied')
  expect(bottom.asks.at(-1) ?? '').toContain('navigating')
  expect(bottom.spawns).toBe(0)
})

test('the act tool refuses an unknown kind', async ($, on) => {
  installBottom(on)
  load(on)
  await start($)
  const outcome = await tool($, 'browser_act', { kind: 'wiggle' })
  expect(outcome.text ?? '').toContain('unknown kind')
})

test('navigating to a non-listed host asks, and denial keeps the URL', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  bottom.answerAsk('Deny')
  const denied = await tool($, 'browser_act', { kind: 'navigate', url: 'https://elsewhere.test/' })
  expect(denied.text ?? '').toContain('denied')
  expect(bottom.page.url).toBe('http://127.0.0.1:1/')
})
