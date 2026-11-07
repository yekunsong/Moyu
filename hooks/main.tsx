import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ops } from '../engine/ops'
import { EMPTY_VIEW, Hub, normaliseKey, type ViewModel } from '../hub/hub'
import { negotiate } from '../hub/negotiate'
import { glyphFor, pressRow } from '../providers/browser/rows'
import { registerToolSpecs, registerTools } from './tools'

const PANE = 'transom'
const view = atom({ plugin: 'transom', key: 'view' } as const, EMPTY_VIEW as ViewModel)
// The last raster frame is a large blob; it lives for the drawing, not in
// state. A reload drops it and the pane falls back to the text tier.
let lastShot: { key: string; cells: string; columns: number; rows: number } = {
  key: '',
  cells: '',
  columns: 0,
  rows: 0,
}

let hub: Hub | undefined
let demo: { url: string } | undefined

function makeOps($: EngineInterface): Ops {
  return {
    root: $.plugin.root,
    ask: (question, options) => $.ui.ask(question, options),
    log: text => $.ui.log(text),
    status: text => $.ui.status(text),
    toast: text => $.ui.toast(text),
    fetch: (url, init) => $.http.fetch(url, init),
    spawn: request => $.process.spawn(request),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    every: (ms, fn) => $.clock.every(ms, fn),
    after: (ms, fn) => $.clock.after(ms, fn),
    openPane: args => $.ui.open(args),
    closePane: id => $.ui.close({ id }),
  }
}

function ensureHub(ops: Ops, options: Record<string, unknown>, refresh: () => void): Hub {
  if (!hub) {
    hub = new Hub(ops, options)
    hub.onRefresh(refresh)
  }
  return hub
}

export const register: Register = (on, options) => {
  registerTools(on, {
    hub: () => hub!,
    openPane: async () => {
      await hub!.showPane()
    },
  })

  on('session.start', async ($, e, next) => {
    const ops: Ops = {
      root: $.plugin.root,
      ask: (question, options) => $.ui.ask(question, options),
      log: text => $.ui.log(text),
      status: text => $.ui.status(text),
      toast: text => $.ui.toast(text),
      fetch: (url, init) => $.http.fetch(url, init),
      spawn: request => $.process.spawn(request),
      storeGet: key => $.store.get(key),
      storeSet: (key, value) => $.store.set(key, value),
      every: (ms, fn) => $.clock.every(ms, fn),
      after: (ms, fn) => $.clock.after(ms, fn),
      openPane: args => $.ui.open(args),
      closePane: id => $.ui.close({ id }),
    }
    ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    void hub!.provider.start().catch(error => {
      ops.log(`bridge start: ${String((error as Error).message ?? error)}`)
    })
    await registerToolSpecs($)
    await $.command.register({
      name: 'transom',
      description: 'Transom pane: open a URL, run the demo, inspect the audit, close',
      argumentHint: 'open <url> | demo | audit | close',
    })
    await update($, view, () => EMPTY_VIEW)
    lastShot = { key: '', cells: '', columns: 0, rows: 0 }
    return next(e)
  })

  on('command.run', { command: 'transom' }, async ($, e) => {
    const ops: Ops = {
      root: $.plugin.root,
      ask: (question, options) => $.ui.ask(question, options),
      log: text => $.ui.log(text),
      status: text => $.ui.status(text),
      toast: text => $.ui.toast(text),
      fetch: (url, init) => $.http.fetch(url, init),
      spawn: request => $.process.spawn(request),
      storeGet: key => $.store.get(key),
      storeSet: (key, value) => $.store.set(key, value),
      every: (ms, fn) => $.clock.every(ms, fn),
      after: (ms, fn) => $.clock.after(ms, fn),
      openPane: args => $.ui.open(args),
      closePane: id => $.ui.close({ id }),
    }
    const transom = ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    const args = (e.args ?? '').trim()
    const [verb = '', ...rest] = args.split(/\s+/)
    const target = rest.join(' ')

    if (verb === 'demo') {
      if (!demo) {
        const started = await startDemo(ops)
        if (!started) return { text: 'demo server failed to start' }
        demo = started
      }
      await showPane(ops)
      const opened = await transom.open(demo.url, transom.provider.meta.defaultWidth)
      return { text: opened.ok ? `demo open at ${demo.url}` : opened.message }
    }

    if (verb === 'close') {
      await transom.close()
      await ops.closePane(PANE)
      return { text: 'Transom closed.' }
    }

    if (verb === 'audit') {
      const rows = transom.audit.recent(20)
      if (!rows.length) return { text: 'No actions yet.' }
      return {
        text: rows
          .map(entry => `${entry.ok ? 'ok' : '!!'} ${new Date(entry.at).toISOString().slice(11, 19)} ${entry.actor} ${entry.action} ${entry.durationMs}ms ${entry.message ?? ''}`)
          .join('\n'),
      }
    }

    if (verb === 'open' && target) {
      await showPane(ops)
      const opened = await transom.open(target, transom.provider.meta.defaultWidth)
      return { text: opened.ok ? `opened ${transom.view.url}` : opened.message }
    }

    if (!verb) {
      await showPane(ops)
      return { text: 'Transom pane opened.' }
    }

    // Bare URL shortcut: /transom https://example.com
    if (/^https?:\/\//.test(verb)) {
      await showPane(ops)
      const opened = await transom.open(verb, transom.provider.meta.defaultWidth)
      return { text: opened.ok ? `opened ${transom.view.url}` : opened.message }
    }

    return { text: 'usage: /transom open <url> | demo | audit | close' }
  })

  on('ui.message', { requestId: PANE }, async ($, e) => {
    const ops: Ops = {
      root: $.plugin.root,
      ask: (question, options) => $.ui.ask(question, options),
      log: text => $.ui.log(text),
      status: text => $.ui.status(text),
      toast: text => $.ui.toast(text),
      fetch: (url, init) => $.http.fetch(url, init),
      spawn: request => $.process.spawn(request),
      storeGet: key => $.store.get(key),
      storeSet: (key, value) => $.store.set(key, value),
      every: (ms, fn) => $.clock.every(ms, fn),
      after: (ms, fn) => $.clock.after(ms, fn),
      openPane: args => $.ui.open(args),
      closePane: id => $.ui.close({ id }),
    }
    const data = e.data as { kind?: string; key?: string }
    if (data.kind === 'key' && data.key) {
      const transom = ensureHub(ops, options as Record<string, unknown>, () => {
        void update($, view, () => hub!.view)
      })
      await transom.act({ kind: 'press', key: normaliseKey(data.key) }, 'person')
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Button, Client, Raster } = $.ui.resolve(e)
    const ops: Ops = {
      root: $.plugin.root,
      ask: (question, options) => $.ui.ask(question, options),
      log: text => $.ui.log(text),
      status: text => $.ui.status(text),
      toast: text => $.ui.toast(text),
      fetch: (url, init) => $.http.fetch(url, init),
      spawn: request => $.process.spawn(request),
      storeGet: key => $.store.get(key),
      storeSet: (key, value) => $.store.set(key, value),
      every: (ms, fn) => $.clock.every(ms, fn),
      after: (ms, fn) => $.clock.after(ms, fn),
      openPane: args => $.ui.open(args),
      closePane: id => $.ui.close({ id }),
    }
    const transom = ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    // An explicit raw get lets the host rule see the noun; read() subscribes.
    await $.state.get({ plugin: 'transom', key: 'view' } as const)
    const model = await read($, view)
    const shot = lastShot
    const width = Math.max(20, e.props.bodyColumns)
    const room = Math.max(3, (e.viewport?.rows ?? 28) - 9)
    const rows = e.viewport?.rows ?? 28
    const degradation = negotiate(transom.provider.meta.capabilities, width, rows, false)

    const header = (
      <Box flexDirection="column">
        <Text bold>Transom · {model.title || 'no page'}</Text>
        <Text dimColor>{model.url || 'open a URL with /transom open <url> · local hosts only by default'}</Text>
        {degradation.mode === 'summary' ? (
          <Text color="yellow">degraded: {degradation.reason}</Text>
        ) : model.last ? (
          <Text dimColor>{model.last}</Text>
        ) : null}
      </Box>
    )

    const toolbar = (
      <Box flexDirection="row" gap={1}>
        <Button key="snap" plain onPress={() => void transom.refresh('viewport')}>
          <Text dimColor>refresh</Text>
        </Button>
        <Button key="doc" plain onPress={() => void transom.refresh('document')}>
          <Text dimColor>whole page</Text>
        </Button>
        <Button key="back" plain onPress={() => void transom.act({ kind: 'back' }, 'person')}>
          <Text dimColor>back</Text>
        </Button>
        <Button key="reload" plain onPress={() => void transom.act({ kind: 'reload' }, 'person')}>
          <Text dimColor>reload</Text>
        </Button>
        <Button key="up" plain onPress={() => void transom.act({ kind: 'scroll', dx: 0, dy: -4 }, 'person')}>
          <Text dimColor>pgup</Text>
        </Button>
        <Button key="down" plain onPress={() => void transom.act({ kind: 'scroll', dx: 0, dy: 4 }, 'person')}>
          <Text dimColor>pgdn</Text>
        </Button>
        <Button key="visual" plain onPress={() => showVisual($, ops, transom, width, rows, model.mode)}>
          <Text dimColor>{model.mode === 'visual' ? 'text mode' : 'visual'}</Text>
        </Button>
        <Button key="enter" plain onPress={() => void transom.act({ kind: 'press', key: 'Enter' }, 'person')}>
          <Text dimColor>enter</Text>
        </Button>
      </Box>
    )

    if (model.status === 'error') {
      return (
        <Box flexDirection="column" width="100%">
          {header}
          <Text color="red">error: {model.error ?? 'unknown'}</Text>
          <Button key="retry" onPress={() => void transom.refresh(model.scope)}>Retry</Button>
          {toolbar}
          {model.audit.map((line, index) => (
            <Text key={`a${index}`} dimColor>{line}</Text>
          ))}
        </Box>
      )
    }

    if (model.status === 'closed' || model.rows.length === 0) {
      const recent = await transom.recent()
      return (
        <Box flexDirection="column" width="100%">
          {header}
          <Text dimColor>
            {model.status === 'starting' ? 'starting the browser…' : 'No page yet. /transom demo starts a local fixture.'}
          </Text>
          <Button key="demo" onPress={() => void runDemo(ops, transom)}>Open the demo app</Button>
          {recent.slice(0, 5).map((url, index) => (
            <Button key={`r${index}`} plain onPress={() => void transom.open(url, transom.provider.meta.defaultWidth)}>
              <Text dimColor>↺ {url}</Text>
            </Button>
          ))}
          {toolbar}
          <Client key="keys" module="../providers/browser/keys.tsx" props={{ focused: e.props.isFocused }} height={1} width={width} />
        </Box>
      )
    }

    if (model.mode === 'visual' && shot.cells && shot.columns > 0 && shot.rows > 0) {
      const rasterRows = shot.rows
      const rasterCols = shot.columns
      return (
        <Box flexDirection="column" width="100%">
          {header}
          {toolbar}
          <Raster key="shot" columns={rasterCols} rows={rasterRows} cells={shot.cells} />
          <Client key="keys" module="../providers/browser/keys.tsx" props={{ focused: e.props.isFocused }} height={1} width={width} />
        </Box>
      )
    }

    const shown = model.rows.slice(0, room)
    return (
      <Box flexDirection="column" width="100%">
        {header}
        {toolbar}
        {shown.map(row =>
          row.role === 'text' || row.role === 'heading' ? (
            <Text key={row.ref} dimColor={row.role === 'text'} bold={row.role === 'heading'}>
              {row.role === 'heading' ? '#' : '·'} {row.label}
            </Text>
          ) : (
            <Button key={row.ref} plain onPress={() => void pressRow(ops, transom, row)}>
              <Text dimColor={row.flags?.includes('disabled')}>
                {glyphFor(row)} {row.label}
                {row.value ? <Text dimColor> = {row.value}</Text> : null}
                {row.flags ? <Text dimColor> [{row.flags}]</Text> : null}
              </Text>
            </Button>
          ),
        )}
        {model.rows.length > shown.length ? (
          <Text dimColor>… {model.rows.length - shown.length} more below</Text>
        ) : null}
        <Client key="keys" module="../providers/browser/keys.tsx" props={{ focused: e.props.isFocused }} height={1} width={width} />
        {model.audit.length ? <Text dimColor>{model.audit[0]}</Text> : null}
      </Box>
    )
  })

  on('ui.close', { id: PANE }, async (_$, e, next) => {
    if (hub) await hub.close()
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (hub) await hub.close()
    return next(e)
  })
}

async function showVisual(
  $: EngineInterface,
  ops: Ops,
  transom: Hub,
  width: number,
  rows: number,
  mode: 'text' | 'visual',
): Promise<void> {
  if (mode === 'visual') {
    await update($, view, model => ({ ...model, mode: 'text' as const }))
    void $.ui.invalidate('ui.render')
    return
  }
  const cols = Math.max(20, Math.min(width, 160))
  const height = Math.max(5, Math.min(rows - 9, 40))
  try {
    const shot = await transom.provider.raster(cols, height)
    lastShot = { key: String(Date.now()), ...shot }
    await update($, view, model => ({ ...model, mode: 'visual' as const, last: `visual ${shot.columns}x${shot.rows}` }))
    void $.ui.invalidate('ui.render')
  } catch (error) {
    ops.toast(`visual: ${String((error as Error).message ?? error)}`)
  }
}

async function showPane(ops: Ops): Promise<void> {
  const opened = await ops.openPane({
    id: PANE,
    title: 'Transom',
    rows: 24,
    columns: hub?.provider.meta.defaultWidth ?? 100,
  })
  if (!opened.isPlaced) {
    ops.status(`transom: pane waits for a wider terminal (${opened.reason ?? 'not placed'})`)
  }
}

async function runDemo(ops: Ops, transom: Hub): Promise<void> {
  if (!demo) {
    const started = await startDemo(ops)
    if (!started) {
      ops.toast('demo server failed to start')
      return
    }
    demo = started
  }
  await transom.open(demo.url, transom.provider.meta.defaultWidth)
}

async function startDemo(ops: Ops): Promise<{ url: string } | undefined> {
  try {
    const stream = ops.spawn({
      argv: ['node', `${ops.root}/demo/server.mjs`],
      env: { PORT: '0' },
    })
    let settled = false
    const line = await new Promise<string | undefined>(resolve => {
      const timer = ops.after(8000, () => {
        if (settled) return
        settled = true
        resolve(undefined)
      })
      void (async () => {
        let buffer = ''
        try {
          // The loop must outlive the first line or the server is killed.
          for await (const chunk of stream) {
            if (chunk.stream !== 'stdout') continue
            buffer += chunk.text
            const match = buffer.match(/demo on (http:\/\/\S+)/)
            if (match && !settled) {
              settled = true
              timer.cancel()
              resolve(match[1])
            }
          }
        } catch {
          if (!settled) {
            settled = true
            timer.cancel()
            resolve(undefined)
          }
        }
      })()
    })
    if (!line) {
      ops.log('demo server did not report a URL')
      return undefined
    }
    return { url: line }
  } catch (error) {
    ops.log(`demo server: ${String((error as Error).message ?? error)}`)
    return undefined
  }
}
