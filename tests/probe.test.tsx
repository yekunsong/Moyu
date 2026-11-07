import { expect, test } from 'claude-code/testing'
import type { Register } from 'claude-code'

import { register } from '../hooks/main'

const PANE = {
  title: 'Transom probe',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}
const VIEWPORT = { columns: 100, rows: 24, isFullscreen: true }

function load(on: Parameters<Register>[0]): void {
  register(on, {} as Parameters<Register>[1])
}

test('probe pane draws and reports pointer cells', async ($, on) => {
  load(on)
  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    props: PANE,
    requestId: 'transom-probe',
    viewport: VIEWPORT,
  })

  expect(await ui.find({ type: 'Text', text: /M0 probe/ })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'probe-client' })).toBeDefined()

  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  const header = await ui.find({ type: 'Text', text: /down/ })
  expect(header?.text).toContain('down @ 3,2')

  await ui.unmount()
})

test('probe pane reports keys', async ($, on) => {
  load(on)
  const ui = await $.ui.mount({
    plugin: 'transom',
    surface: 'terminal',
    component: 'Pane',
    props: PANE,
    requestId: 'transom-probe',
    viewport: VIEWPORT,
  })

  await ui.key({ key: 'escape', in: 'probe-client' })
  expect((await ui.find({ type: 'Text', text: /key/ }))?.text).toContain('escape')

  await ui.unmount()
})
