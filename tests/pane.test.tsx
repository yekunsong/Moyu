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

function load(on: Parameters<Register>[0], options: Record<string, unknown> = {}): void {
  register(on, { allowedHosts: 'localhost', writePolicy: 'confirm', ...options } as Parameters<Register>[1])
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

test('the pane sends the configured hqDetail on /frame', { options: { hqDetail: 3 } }, async ($, on) => {
  const bottom = installBottom(on, { env: { TERM_PROGRAM: 'WezTerm' } })
  load(on, { hqDetail: 3 })
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

  await ui.press({ key: 'hq' })
  expect(await ui.find({ type: 'Image', key: 'frame' }), 'Image key frame').toBeDefined()
  expect(bottom.frameBodies.length).toBeGreaterThan(0)
  expect(bottom.frameBodies[0]?.detail).toBe(3)
  await ui.unmount()
})

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

test('inline textbox Input fills and combobox Select picks without a dialog', async ($, on) => {
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

  expect(await ui.find({ type: 'Input', key: 't2' }), 'textbox Input').toBeDefined()
  const select = await ui.find({ type: 'Select', key: 't4' })
  expect(select, 'combobox Select').toBeDefined()
  expect(JSON.stringify(select?.props.options)).toContain('team')

  await ui.input({ key: 't2', text: 'a@b.c' })
  expect(bottom.page.fillCalls).toContainEqual({ ref: 't2', text: 'a@b.c' })
  expect(bottom.page.fills['t2']).toBe('a@b.c')

  await ui.select({ key: 't4', value: 'team' })
  expect(bottom.page.selectCalls).toContainEqual({ ref: 't4', value: 'team' })
  expect(bottom.page.selects['t4']).toBe('team')

  // Neither inline act opened a modal dialog.
  expect(bottom.asks.length).toBe(0)

  // The model's snapshot carries the new fields.
  const snap = await tool($, 'browser_snapshot', {})
  expect(snap.text ?? '').toContain('options=[')
  expect(snap.text ?? '').toContain('team=Team*')
  expect(snap.text ?? '').toContain('href=')
  expect(snap.text ?? '').toContain('frame.html')
  await ui.unmount()
})

test('sections, status bar and the next-block button render', async ($, on) => {
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

  const section = await ui.find({ type: 'Text', text: /COUNTER/ })
  expect(section, 'section divider').toBeDefined()
  expect(section?.text ?? '').toContain('COUNTER')
  expect(section?.text ?? '').toContain('─')

  const status = await ui.find({ type: 'Text', text: /shown/ })
  expect(status, 'status bar').toBeDefined()
  expect(status?.text ?? '').toContain('shown')
  // A fresh page has no finished actions; an open in flight is an audit line.
  expect(status?.text ?? '').toMatch(/no actions yet|open|you|model/)

  const next = await ui.find({ type: 'Button', key: 'next' })
  expect(next, 'next block button').toBeDefined()
  expect(next?.text ?? '').toContain('next block')

  await ui.press({ key: 'next' })
  expect(bottom.page.scrollCalls.some(call => call.dy > 0), 'scroll recorded').toBe(true)
  await ui.unmount()
})

test('hq draws an Image from the frame file on WezTerm', async ($, on) => {
  const bottom = installBottom(on, { env: { TERM_PROGRAM: 'WezTerm' } })
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

  expect(await ui.find({ type: 'Button', key: 'hq' }), 'hq button').toBeDefined()
  await ui.press({ key: 'hq' })
  expect(bottom.fetches.some(one => one.endsWith('/frame')), '/frame fetched').toBe(true)

  const image = await ui.find({ type: 'Image', key: 'frame' })
  expect(image, 'Image key frame').toBeDefined()
  expect(JSON.stringify(image?.props.source)).toContain('/tmp/transom-test-frame.png')
  expect(image?.props.alt ?? '').toContain('screenshot')
  expect(await ui.find({ type: 'Text', text: /read-only/ }), 'read-only hint').toBeDefined()

  // The 1 fps clock keeps fetching while image mode is active.
  const framesBefore = bottom.fetches.filter(one => one.endsWith('/frame')).length
  await bottom.advance(1100)
  const framesAfter = bottom.fetches.filter(one => one.endsWith('/frame')).length
  expect(framesAfter, 'refresh tick captured a frame').toBeGreaterThan(framesBefore)
  expect(await ui.find({ type: 'Image', key: 'frame' }), 'still image mode').toBeDefined()

  // The same button returns to the editable text tier, stops the clock and
  // puts the cell-box viewport back.
  await ui.press({ key: 'hq' })
  expect(await ui.find({ type: 'Image', key: 'frame' })).toBeUndefined()
  await bottom.advance(1)
  expect(bottom.fetches.some(one => one.endsWith('/frame/stop')), 'viewport restored').toBe(true)
  await ui.unmount()
})

test('hq rides out a dropped frame and gives up only after repeats', async ($, on) => {
  const bottom = installBottom(on, { env: { TERM_PROGRAM: 'WezTerm' } })
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
  await ui.press({ key: 'hq' })
  expect(await ui.find({ type: 'Image', key: 'frame' }), 'image mode').toBeDefined()

  // A covered window drops frames; two in a row must not end the mode.
  bottom.frameFailures = 2
  await bottom.advance(1100)
  await bottom.advance(1100)
  expect(await ui.find({ type: 'Image', key: 'frame' }), 'survived two drops').toBeDefined()

  // The registry fails until a third consecutive frame: then the mode stops.
  bottom.frameFailures = 5
  await bottom.advance(1100)
  await bottom.advance(1100)
  await bottom.advance(1100)
  expect(await ui.find({ type: 'Image', key: 'frame' }), 'gave up on the mode').toBeUndefined()
  await ui.unmount()
})

test('the hq pointer overlay maps a click to page pixels', async ($, on) => {
  const bottom = installBottom(on, { env: { TERM_PROGRAM: 'WezTerm' } })
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    // 81x11 cells keeps both axes odd, so the center cell maps exactly to the
    // center CSS pixel; the fake /frame reports 8x16 px per cell.
    props: { ...PANE, bodyColumns: 81 },
    requestId: 'transom',
    viewport: VIEWPORT,
  })

  await ui.press({ key: 'hq' })
  expect(await ui.find({ type: 'Client', key: 'hq-pointer' }), 'pointer overlay').toBeDefined()

  const columns = 81
  const rows = 11
  const cell = { x: Math.floor(columns / 2), y: Math.floor(rows / 2) }
  await ui.pointer({ type: 'down', ...cell, button: 'left', in: 'hq-pointer' })
  await ui.pointer({ type: 'up', ...cell, button: 'left', in: 'hq-pointer' })
  await bottom.advance(16)

  expect(bottom.page.clickAtCalls.length, 'clickAt recorded').toBeGreaterThan(0)
  const call = bottom.page.clickAtCalls.at(-1)!
  expect(Math.abs(call.x - (columns * 8) / 2), `x ${call.x}`).toBeLessThanOrEqual(2)
  expect(Math.abs(call.y - (rows * 16) / 2), `y ${call.y}`).toBeLessThanOrEqual(2)
  // A person's click is direct: the overlay never opens a confirmation.
  expect(bottom.asks.length).toBe(0)
  await ui.unmount()
})

test('a denied model clickAt does not run', async ($, on) => {
  const bottom = installBottom(on)
  bottom.answerAsk('Deny')
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const denied = await tool($, 'browser_act', { kind: 'clickAt', x: 100, y: 50 })
  expect(denied.text ?? '').toContain('denied')
  expect(bottom.page.clickAtCalls.length).toBe(0)
  expect(bottom.asks.at(-1) ?? '').toContain('click at 100,50')
})

test('hq is hidden and explained on Windows Terminal', async ($, on) => {
  installBottom(on, { env: { WT_SESSION: 'session-1' } })
  load(on)
  await start($)

  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    props: PANE,
    requestId: 'transom',
    viewport: VIEWPORT,
  })

  expect(await ui.find({ type: 'Button', key: 'hq' }), 'no hq button').toBeUndefined()
  const notice = await ui.find({ type: 'Text', text: /hq unavailable/ })
  expect(notice, 'reason notice').toBeDefined()
  expect(notice?.text ?? '').toContain('Windows Terminal')
  await ui.unmount()
})

test('browser_find returns matching refs without a refresh', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })
  const snapshotsBefore = bottom.fetches.filter(one => one.endsWith('/snapshot')).length

  const found = await tool($, 'browser_find', { text: 'increase' })
  expect(found.text ?? '').toContain('[t1] button "Increase count"')
  expect(found.text ?? '').toContain('1 matches of')

  // It reads the existing snapshot: no extra /snapshot request.
  expect(bottom.fetches.filter(one => one.endsWith('/snapshot')).length).toBe(snapshotsBefore)

  const buttons = await tool($, 'browser_find', { role: 'button', interactiveOnly: true })
  expect(buttons.text ?? '').toContain('[t1]')
  expect(buttons.text ?? '').not.toContain('[t2]')

  const none = await tool($, 'browser_find', { text: 'zzz-not-here' })
  expect(none.text ?? '').toContain('no matches')
})

test('browser_snapshot sinceLast reports a per-ref diff', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const unchanged = await tool($, 'browser_snapshot', { sinceLast: true })
  expect(unchanged.text ?? '').toContain('no changes since the last snapshot')

  // The fake page changes underneath without the hub refreshing its view.
  bottom.page.count = 1
  const changed = await tool($, 'browser_snapshot', { sinceLast: true })
  expect(changed.text ?? '').toContain('0 added, 0 removed, 1 changed')
  expect(changed.text ?? '').toContain('~ [t3] text "count 0" -> "count 1"')
  expect(changed.text ?? '').not.toContain('# PAGE CONTENT BELOW')

  bottom.page.fills['t2'] = 'a@b.c'
  const filled = await tool($, 'browser_snapshot', { sinceLast: true })
  expect(filled.text ?? '').toContain('0 added, 0 removed, 1 changed')
  expect(filled.text ?? '').toContain('~ [t2] textbox value:')
  expect(filled.text ?? '').toContain('a@b.c')

  // Without sinceLast the full snapshot is unchanged in shape.
  const full = await tool($, 'browser_snapshot', {})
  expect(full.text ?? '').toContain('# PAGE CONTENT BELOW')
  expect(full.text ?? '').toContain('count 1')
})

test('browser_wait maps to a read-only wait action', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const waited = await tool($, 'browser_wait', { selector: '#count', timeoutMs: 1000 })
  expect(waited.text ?? '').toContain('ok')
  expect(waited.text ?? '').toContain('found selector #count')
  const call = bottom.page.waitCalls.at(-1)
  expect(call?.kind, 'fake bridge saw kind wait').toBe('wait')
  expect(call?.selector).toBe('#count')
  expect(call?.timeoutMs).toBe(1000)
  // A wait is a read: no confirmation prompt.
  expect(bottom.asks.length).toBe(0)

  const idle = await tool($, 'browser_wait', { idleMs: 250 })
  expect(idle.text ?? '').toContain('ok')
  expect(bottom.page.waitCalls.at(-1)?.idleMs).toBe(250)

  const missing = await tool($, 'browser_wait', {})
  expect(missing.text ?? '').toContain('wait requires at least one of selector, text or idleMs')
})

async function command($: unknown, args: string) {
  return await ($ as { command: { run: (e: unknown) => Promise<{ text?: string }> } }).command.run({
    command: 'transom',
    args,
  })
}

test('a session allow grant navigates without an ask', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const granted = await command($, 'allow elsewhere.test')
  expect(granted.text ?? '').toContain('Allowed elsewhere.test')

  const navigated = await tool($, 'browser_act', { kind: 'navigate', url: 'https://elsewhere.test/path' })
  expect(navigated.text ?? '').toContain('ok')
  expect(bottom.page.url).toBe('https://elsewhere.test/path')
  expect(bottom.asks.length).toBe(0)
})

test('a session deny grant refuses navigation without an ask', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const denied = await command($, 'deny https://blocked.test/secret')
  expect(denied.text ?? '').toContain('Denied blocked.test')

  const navigated = await tool($, 'browser_act', { kind: 'navigate', url: 'https://blocked.test/' })
  expect(navigated.text ?? '').toContain('host is denied for this session')
  expect(bottom.page.url).toBe('http://127.0.0.1:1/')
  expect(bottom.asks.length).toBe(0)
})

test('allow and deny reject a malformed host', async ($, on) => {
  installBottom(on)
  load(on)
  await start($)
  const bad = await command($, 'allow not a host!')
  expect(bad.text ?? '').toContain('usage: /transom allow')
})

test('a click confirmation names the link target', async ($, on) => {
  const bottom = installBottom(on)
  bottom.answerAsk('Deny')
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const clicked = await tool($, 'browser_act', { kind: 'click', ref: 't5' })
  expect(clicked.text ?? '').toContain('denied')
  expect(bottom.asks.at(-1) ?? '').toContain('frame.html')
  expect(bottom.asks.at(-1) ?? '').toContain('Frame page')
})

test('check and uncheck record the action and no-op when already set', async ($, on) => {
  const bottom = installBottom(on)
  load(on)
  await start($)
  await tool($, 'browser_open', { url: 'http://127.0.0.1:1/' })

  const checked = await tool($, 'browser_act', { kind: 'check', ref: 't6' })
  expect(checked.text ?? '').toContain('ok')
  expect(bottom.page.checkCalls.at(-1)).toEqual({ kind: 'check', ref: 't6' })
  expect(bottom.page.checked['t6']).toBe(true)
  expect(bottom.asks.at(-1) ?? '').toContain('check t6')

  const again = await tool($, 'browser_act', { kind: 'check', ref: 't6' })
  expect(again.text ?? '').toContain('already checked')
  expect(bottom.page.checkCalls.length).toBe(2)

  const unchecked = await tool($, 'browser_act', { kind: 'uncheck', ref: 't6' })
  expect(unchecked.text ?? '').toContain('ok')
  expect(bottom.page.checkCalls.at(-1)).toEqual({ kind: 'uncheck', ref: 't6' })
  expect(bottom.page.checked['t6']).toBe(false)
})

test('check requires a ref', async ($, on) => {
  installBottom(on)
  load(on)
  await start($)
  const outcome = await tool($, 'browser_act', { kind: 'check' })
  expect(outcome.text ?? '').toContain('ref is required for check')
})

test('an invalid field draws its error text under the row', async ($, on) => {
  installBottom(on)
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

  const error = await ui.find({ type: 'Text', text: /We need an email/ })
  expect(error, 'error text').toBeDefined()
  expect(error?.text ?? '').toContain('! We need an email')
  // The field itself stays an Input, never a Button.
  expect(await ui.find({ type: 'Input', key: 't2' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 't2' })).toBeUndefined()
  await ui.unmount()
})
