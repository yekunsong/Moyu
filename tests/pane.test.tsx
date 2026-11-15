import { expect, mock, test } from 'claude-code/testing'
import { installBottom } from './helpers'

const PANE = {
  title: 'moyu',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}
const VIEWPORT = { columns: 100, rows: 24, isFullscreen: true }

const FILES: Record<string, string | true> = {
  '/lib': true,
  '/lib/01-night.txt': '第一章 夜航\n\n甲段。\n\n乙段。\n\n第二章 回港\n\n丙段。\n\n丁段。',
  '/lib/02-notes.md': '# 笔记\n\n一。\n\n二。',
  '/lib/cover.png': 'png',
  '/lib/nested': true,
  '/lib/nested/03-deep.text': '第三章 深处\n\n戊段。',
  '/outside.txt': '外面。',
}


async function start($: unknown): Promise<void> {
  await ($ as { session: { start: (e: unknown) => Promise<unknown> } }).session.start({
    cwd: 'D:/Study/transom',
    surface: 'terminal',
    isInteractive: true,
  })
}

async function command($: unknown, args: string): Promise<{ text?: string }> {
  return await ($ as { command: { run: (e: unknown) => Promise<{ text?: string }> } }).command.run({
    args,
    command: 'moyu',
  })
}

async function tool($: unknown, name: string, args: Record<string, unknown> = {}) {
  return await ($ as { tool: { call: (e: unknown) => Promise<{ text?: string }> } }).tool.call({
    tool: `mcp__moyu__${name}`,
    ...args,
  })
}

async function redraw(ui: { redraw: () => Promise<void> }): Promise<void> {
  await ui.redraw()
}

async function mount($: unknown, props: typeof PANE = PANE) {
  return await ($ as {
    ui: { mount: (e: unknown) => Promise<{ unmount: () => Promise<void>; find: Function; key: Function; press: Function; drawn: Function; redraw: () => Promise<void> }> }
  }).ui.mount({
    plugin: 'moyu',
    surface: 'terminal',
    component: 'Pane',
    props,
    requestId: 'moyu',
    viewport: VIEWPORT,
  })
}

test('the closed pane introduces itself and points at the command', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  const ui = await mount($)
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('Open a novel with /novel')
  expect(await ui.find({ type: 'Client', key: 'keys' })).toBeDefined()
  await ui.unmount()
})

test('the command opens a file and the pane draws its prose plainly', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  const opened = await command($, '01-night.txt')
  expect(opened.text ?? '').toContain('2 chapters')
  const ui = await mount($)
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('第一章 夜航')
  expect(tree).toContain('甲段。')
  expect(tree).toMatch(/\d+%/)
  expect(tree).not.toContain('gutter')
  await ui.unmount()
})

test('down and up turn pages and a chapter key moves between chapters', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  const narrow = { ...PANE, scroll: { offset: 0, bodyRows: 3 } }
  const ui = await mount($, narrow)
  await ui.key({ key: 'down', in: 'keys' })
  await tool($, 'read', {})
  await redraw(ui)
  expect(JSON.stringify(await ui.drawn())).toContain('第二章 回港')
  await ui.key({ key: 'p', in: 'keys' })
  await tool($, 'read', {})
  await redraw(ui)
  expect(JSON.stringify(await ui.drawn())).toContain('第一章 夜航')
  await ui.unmount()
})

test('clicking a paragraph selects it and a fills the prompt with a quote', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  const bottom = installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  const page = await tool($, 'read', {})
  const ref = /\[(p\d+)\] paragraph/.exec(page.text ?? '')?.[1]
  expect(ref).toBeDefined()
  const ui = await mount($)
  await ui.press({ key: ref })
  await tool($, 'read', {})
  await redraw(ui)
  expect(await ui.find({ type: 'Button', key: 'ask' }), 'ask about button').toBeDefined()
  await ui.key({ key: 'a', in: 'keys' })
  expect(bottom.fills).toEqual(['> 甲段。\n'])
  await ui.unmount()
})

test('the pane opens focused, transparent and closable with Escape', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  const bottom = installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  expect(bottom.opens[0]).toMatchObject({
    id: 'moyu',
    focus: true,
    closeOnEscape: true,
    backgroundColor: 'transparent',
  })
})

test('auto is the default theme and sets nothing on the session', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  const bottom = installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  expect(bottom.themes).toEqual([])
  expect(bottom.clears).toBe(0)
})

test('q hides at once and clears only a preset this plugin set', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  const bottom = installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  await command($, 'theme paper')
  expect(bottom.themes).toEqual(['paper'])
  const ui = await mount($)
  expect(await ui.find({ type: 'Button', key: 'quit' }), 'q hotkey').toBeDefined()
  await ui.key({ key: 'q', in: 'keys' })
  expect(bottom.clears).toBe(1)
  await ui.unmount()
})

test('ctrl+g still hides while the pane holds the keys', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  const bottom = installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  await command($, 'theme ink')
  const ui = await mount($)
  await ui.key({ key: 'g', ctrl: true, in: 'keys' })
  expect(bottom.clears).toBe(1)
  await ui.unmount()
})

test('a bare command toggles visibility, and hide then show keep the page', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  expect((await command($, '')).text).toContain('shown')
  expect((await command($, '')).text).toContain('hidden')
  expect((await command($, 'show')).text).toContain('shown')
  expect((await command($, 'hide')).text).toContain('hidden')
})

test('the theme command takes the three presets and refuses others', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  const bottom = installBottom(on, { files: FILES })
  await start($)
  await command($, '')
  expect((await command($, 'theme paper')).text).toContain('Theme: paper')
  expect(bottom.themes).toEqual(['paper'])
  expect((await command($, 'theme auto')).text).toContain('Theme: auto')
  expect(bottom.clears).toBe(1)
  expect((await command($, 'theme neon')).text).toContain('usage')
})

test('autoHideSeconds hides after idle and a key re-arms it', { options: { libraryRoot: '/lib', autoHideSeconds: 5 } }, async ($, on) => {
  const bottom = installBottom(on, { files: FILES })
  const clock = mock.clock(on)
  await start($)
  await command($, '01-night.txt')
  await command($, 'theme paper')
  const ui = await mount($)
  await clock.advance(4000)
  await ui.key({ key: 'down', in: 'keys' })
  expect(bottom.clears).toBe(0)
  await clock.advance(5000)
  expect(bottom.clears).toBeGreaterThan(0)
  await ui.unmount()
})

test('annotations render in place after their paragraph', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  const page = await tool($, 'read', {})
  const ref = /\[(p\d+)\] paragraph/.exec(page.text ?? '')?.[1]
  expect(ref).toBeDefined()
  await tool($, 'annotate', { ref, text: '注意这里' })
  const ui = await mount($)
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('· AI 注意这里')
  await ui.unmount()
})

test('novel_read next turns a page before reading', { options: { libraryRoot: '/lib', snapshotMaxChars: 400 } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  const first = await tool($, 'read', {})
  expect(first.text ?? '').toContain('PAGE CONTENT')
  const next = await tool($, 'read', { scope: 'next' })
  expect(next.text ?? '').not.toBe(first.text)
})

test('novel_find returns excerpts and novel_turn reports the move', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  const found = await tool($, 'find', { text: '段' })
  expect(found.text ?? '').toContain('matches')
  const turned = await tool($, 'turn', { delta: 1 })
  expect(turned.text ?? '').toMatch(/ok: (page|chapter) \d+\/\d+/)
})

test('hide and show keep the same page, and a close resumes it from disk', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  const before = await tool($, 'read', {})
  expect(before.text ?? '').toContain('offset')
  const ui = await mount($)
  await ui.key({ key: 'down', in: 'keys' })
  const moved = await tool($, 'read', {})
  const offset = /offset (\d+)/.exec(moved.text ?? '')?.[1]
  expect(offset).toBeDefined()
  await ui.key({ key: 'q', in: 'keys' })
  await command($, 'show')
  const shown = await tool($, 'read', {})
  expect(/offset (\d+)/.exec(shown.text ?? '')?.[1]).toBe(offset)
  await command($, 'close')
  const resumed = await command($, '')
  expect(resumed.text ?? '').toContain('shown')
  const after = await tool($, 'read', {})
  expect(/offset (\d+)/.exec(after.text ?? '')?.[1]).toBe(offset)
  await ui.unmount()
})

test('novel_boss hides and shows through the tool', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  await command($, '01-night.txt')
  expect((await tool($, 'boss', { visible: false })).text).toBe('hidden')
  expect((await tool($, 'boss', { visible: true })).text).toBe('shown')
})

test('a directory lists its readable entries and clicking one opens it', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  await command($, '.')
  const ui = await mount($)
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('nested/')
  expect(tree).not.toContain('cover.png')
  await ui.press({ key: 'f0' })
  await tool($, 'read', {})
  await redraw(ui)
  expect(JSON.stringify(await ui.drawn())).toContain('第一章 夜航')
  await ui.unmount()
})

test('an outside path fails and the pane shows the reason', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  const opened = await command($, '../outside.txt')
  expect(opened.text ?? '').toContain('outside')
  const ui = await mount($)
  expect(JSON.stringify(await ui.drawn())).toContain('outside the library root')
  await ui.unmount()
})

test('the reader tools refuse when no novel is open', { options: { libraryRoot: '/lib' } }, async ($, on) => {
  installBottom(on, { files: FILES })
  await start($)
  expect((await tool($, 'read', {})).text).toContain('novel_open')
  expect((await tool($, 'annotate', { ref: 'p0', text: 'x' })).text).toContain('No novel')
})
