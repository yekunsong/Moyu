import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Ops } from '../engine/ops'
import { EMPTY_VIEW, Hub, hostOfUrl, normaliseKey, type ViewModel, type ViewRow } from '../hub/hub'
import { detectImageTier, negotiate, type ImageTier } from '../hub/negotiate'
import type { Frame, Provider } from '../engine/provider'
import { BrowserProvider } from '../providers/browser/client'
import { ReaderProvider } from '../providers/reader/client'
import { glyphFor, pressRow } from '../providers/browser/rows'
import { registerToolSpecs, registerTools } from './tools'

const PANE = 'transom'
const view = atom({ plugin: 'transom', key: 'view' } as const, EMPTY_VIEW as ViewModel)
// The last raster frame is a large blob; it lives for the drawing, not in
// state. A reload drops it and the pane falls back to the text tier.
let lastShot: { key: string; cells: string; columns: number; rows: number; url: string } = {
  key: '',
  cells: '',
  columns: 0,
  rows: 0,
  url: '',
}

// The HQ image tier: a file path the terminal reads itself. Chrome streams
// frames into one rolling file and the pane polls for a newer generation every
// 250 ms while focused (1 s otherwise); a still page gets one sharp capture.
// Like lastShot, it lives in a module variable rather than state: a reload
// drops it and the pane falls back to text.
let lastFrame: {
  file: string
  generation: number
  columns: number
  rows: number
  pageWidth: number
  pageHeight: number
  url: string
} = {
  file: '',
  generation: 0,
  columns: 0,
  rows: 0,
  pageWidth: 0,
  pageHeight: 0,
  url: '',
}
let imageTier: ImageTier = { supported: false, reason: '' }
let frameTimer: Timer | undefined
let frameBusy = false
let frameActive = false
let frameFailures = 0
/** Whether a frame capture left the page on the hq viewport. */
let frameMetricsHeld = false
let frameSize = { columns: 0, rows: 0 }
// Streaming state: the poll runs on a 250 ms tick and only fires every tick
// while the pane is focused; unfocused panes and non-streaming providers keep
// the 1 s cadence. A stale stream gets one sharp still, re-armed only after a
// newer streamed frame arrives.
let frameFocused = false
let frameStreaming = false
let frameTicks = 0
let frameSharpTimer: Timer | undefined
let frameSharpTaken = false
const FRAME_TICK_MS = 250
const FRAME_SHARP_AFTER_MS = 2000

let hub: Hub | undefined
let demo: { url: string } | undefined
let demoStream: AsyncGenerator<unknown, unknown> | undefined

// The engine's Select wants at least one option with unique values; the page's
// options are neither guaranteed unique nor non-empty.
function selectOptions(row: ViewRow): Array<{ value: string; label: string }> {
  const seen = new Set<string>()
  const options: Array<{ value: string; label: string }> = []
  for (const option of row.options ?? []) {
    if (seen.has(option.value)) continue
    seen.add(option.value)
    options.push({ value: option.value, label: option.label || option.value })
  }
  return options
}

function shortHref(href: string): string {
  return href.length > 64 ? `${href.slice(0, 61)}…` : href
}

/** Cut a line to the pane's width without wrapping. */
function clip(text: string, width: number): string {
  const max = Math.max(0, Math.floor(width))
  return text.length > max ? text.slice(0, max) : text
}

/** A cell inside the image maps to the CSS pixel at the center of that cell. */
function clickPixel(cell: number, cells: number, pixels: number): number {
  const raw = cells > 0 ? Math.round(((cell + 0.5) / cells) * pixels) : 0
  return Math.max(0, Math.min(raw, Math.max(0, Math.round(pixels) - 1)))
}

/** A session host argument: a bare hostname or an http(s) URL. */
const HOST_PATTERN = /^(\*\.)?[a-z0-9.-]+$/

function parseHost(input: string): string | undefined {
  const raw = input.trim()
  if (!raw) return undefined
  let host = raw
  if (raw.includes('://')) {
    try {
      host = new URL(raw).hostname
    } catch {
      return undefined
    }
  }
  host = host.toLowerCase()
  return HOST_PATTERN.test(host) ? host : undefined
}

/** A section header with rules filling the pane's width: ── COUNTER ─────. */
function sectionRule(label: string, width: number): string {
  const name = ` ${label} `
  const dashes = Math.max(0, Math.floor(width) - 2 - name.length)
  return clip(`──${name}${'─'.repeat(dashes)}`, width)
}

/** Rows indent by their document depth, capped so they stay readable. */
function indentFor(row: ViewRow): string {
  return ' '.repeat(Math.min(Math.max(row.depth ?? 0, 0), 3))
}

/** The fixed status line: mode, the visible window, and the last audit entry. */
function statusLine(model: ViewModel, shown: number, width: number): string {
  return clip(`${model.mode} · ${shown}/${model.rows.length} shown · ${model.audit[0] ?? 'no actions yet'}`, width)
}

function providerFactory(ops: Ops): (id: string) => Provider {
  return id => (id === 'reader' ? new ReaderProvider(ops) : new BrowserProvider(ops))
}

function ensureHub(ops: Ops, options: Record<string, unknown>, refresh: () => void): Hub {
  if (!hub) {
    hub = new Hub(ops, options, { providerFactory: providerFactory(ops) })
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
      env: {
        term: () => $.env.get('TERM'),
        termProgram: () => $.env.get('TERM_PROGRAM'),
        wtSession: () => $.env.get('WT_SESSION'),
        tmux: () => $.env.get('TMUX'),
      },
    }
    ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    try {
      imageTier = await detectImageTier(ops)
    } catch {
      imageTier = { supported: false, reason: 'terminal detection failed' }
    }
    stopFrames()
    lastFrame = { file: '', generation: 0, columns: 0, rows: 0, pageWidth: 0, pageHeight: 0, url: '' }
    void hub!.start().catch(error => {
      ops.log(`provider start: ${String((error as Error).message ?? error)}`)
    })
    await registerToolSpecs($)
    await $.command.register({
      name: 'transom',
      description:
        'Transom pane: open a URL, read one as text without a browser, run the demo, attach to Chrome, allow or deny a host for the session, inspect the audit, switch to hq, close',
      argumentHint: 'open <url> | reader <url> | demo | attach <port> | allow <host> | deny <host> | audit | hq | close',
    })
    await update($, view, () => EMPTY_VIEW)
    lastShot = { key: '', cells: '', columns: 0, rows: 0, url: '' }
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
      env: {
        term: () => $.env.get('TERM'),
        termProgram: () => $.env.get('TERM_PROGRAM'),
        wtSession: () => $.env.get('WT_SESSION'),
        tmux: () => $.env.get('TMUX'),
      },
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

    if (verb === 'attach') {
      const port = Number(target)
      if (!/^\d+$/.test(target) || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { text: 'usage: /transom attach <port> (an integer from 1 to 65535)' }
      }
      await showPane(ops)
      const attached = await transom.attach(port)
      return { text: attached.ok ? `attached to Chrome on port ${port}` : attached.message }
    }

    if (verb === 'allow' || verb === 'deny') {
      const host = parseHost(target)
      if (!host) {
        return {
          text: `usage: /transom ${verb} <host|url> (for example example.com or https://example.com/path)`,
        }
      }
      const allowed = verb === 'allow'
      await transom.grantHost(host, allowed)
      return { text: `${allowed ? 'Allowed' : 'Denied'} ${host} for this session.` }
    }

    if (verb === 'close') {
      stopFrames()
      lastFrame = { file: '', generation: 0, columns: 0, rows: 0, pageWidth: 0, pageHeight: 0, url: '' }
      await transom.close()
      await ops.closePane(PANE)
      stopDemo()
      return { text: 'Transom closed.' }
    }

    if (verb === 'hq') {
      // Re-check here as well: the terminal may have changed (a new tab, tmux).
      try {
        imageTier = await detectImageTier(ops)
      } catch {
        imageTier = { supported: false, reason: 'terminal detection failed' }
      }
      if (!imageTier.supported) return { text: `hq unavailable: ${imageTier.reason}` }
      await showPane(ops)
      const started = await startImage($, ops, transom, transom.provider.meta.defaultWidth, 24)
      return {
        text: started
          ? 'hq on: the pane shows the real page, read-only. /transom hq again or text mode to edit.'
          : 'hq could not capture a frame; the pane stays in text mode.',
      }
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

    if (verb === 'reader') {
      if (!target) return { text: 'usage: /transom reader <http(s) url>' }
      let protocol: string
      try {
        protocol = new URL(target).protocol
      } catch {
        return { text: `not a URL: ${target}` }
      }
      if (protocol !== 'http:' && protocol !== 'https:') return { text: `reader accepts http and https only (got ${protocol})` }
      // Switching providers ends a browser image mode that the reader cannot
      // continue; stop its clock and restore the owned page before the switch.
      stopFrames()
      await showPane(ops)
      const opened = await transom.reader(target)
      return { text: opened.ok ? `reading ${transom.view.url} (text only, no browser)` : opened.message }
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

    return { text: 'usage: /transom open <url> | reader <url> | demo | attach <port> | allow <host> | deny <host> | audit | hq | close' }
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
      env: {
        term: () => $.env.get('TERM'),
        termProgram: () => $.env.get('TERM_PROGRAM'),
        wtSession: () => $.env.get('WT_SESSION'),
        tmux: () => $.env.get('TMUX'),
      },
    }
    const data = e.data as { kind?: string; key?: string; x?: number; y?: number }
    if (data.kind === 'key' && data.key) {
      const transom = ensureHub(ops, options as Record<string, unknown>, () => {
        void update($, view, () => hub!.view)
      })
      await transom.act({ kind: 'press', key: normaliseKey(data.key) }, 'person')
    }
    // The HQ overlay only exists while image frames are live; ignore stray
    // cell posts from a stale client otherwise.
    if (data.kind === 'cell' && frameActive && lastFrame.columns > 0 && lastFrame.rows > 0) {
      const cellX = Number(data.x)
      const cellY = Number(data.y)
      if (Number.isFinite(cellX) && Number.isFinite(cellY)) {
        const transom = ensureHub(ops, options as Record<string, unknown>, () => {
          void update($, view, () => hub!.view)
        })
        const x = clickPixel(cellX, lastFrame.columns, lastFrame.pageWidth)
        const y = clickPixel(cellY, lastFrame.rows, lastFrame.pageHeight)
        await transom.act({ kind: 'clickAt', x, y }, 'person')
      }
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Button, Input, Select, Client, Raster, Image } = $.ui.resolve(e)
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
      env: {
        term: () => $.env.get('TERM'),
        termProgram: () => $.env.get('TERM_PROGRAM'),
        wtSession: () => $.env.get('WT_SESSION'),
        tmux: () => $.env.get('TMUX'),
      },
    }
    const transom = ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    // An explicit raw get lets the host rule see the noun; read() subscribes.
    await $.state.get({ plugin: 'transom', key: 'view' } as const)
    const model = await read($, view)
    // The stream polls faster while the pane holds the focus; the timer itself
    // stays on its 250 ms tick and gates the unfocused asks.
    frameFocused = !!e.props.isFocused
    const shot = lastShot
    const width = Math.max(20, e.props.bodyColumns)
    const rows = e.props.scroll.bodyRows || e.viewport?.rows || 28
    const room = Math.max(3, rows - 9)
    transom.setViewport(width, rows)
    const degradation = negotiate(transom.provider.meta.capabilities, width, rows, false)

    const header = (
      <Box flexDirection="column">
        <Text bold>Transom · {model.title || 'no page'}</Text>
        <Text dimColor>{model.url || 'open a URL with /transom open <url> · local hosts only by default'}</Text>
        {!imageTier.supported && imageTier.reason && model.rows.length === 0 ? (
          <Text dimColor>hq unavailable: {imageTier.reason}</Text>
        ) : null}
        {e.props.placement === 'inline' ? (
          <Text dimColor>mouse needs fullscreen: CLAUDE_CODE_NO_FLICKER=1 · keyboard: ctrl+x tab</Text>
        ) : null}
        {degradation.mode === 'summary' ? (
          <Text color="yellow">degraded: {degradation.reason}</Text>
        ) : model.last ? (
          <Text dimColor>{model.last}</Text>
        ) : null}
      </Box>
    )

    // Page actions first, view actions after a dim rule: one row, no new verbs.
    const toolbar = (
      <Box flexDirection="row" gap={1}>
        {degradation.navigation ? (
          <>
            <Button key="back" plain onPress={() => void transom.act({ kind: 'back' }, 'person')}>
              <Text dimColor>back</Text>
            </Button>
            <Button key="reload" plain onPress={() => void transom.act({ kind: 'reload' }, 'person')}>
              <Text dimColor>reload</Text>
            </Button>
          </>
        ) : null}
        {degradation.scroll ? (
          <>
            <Button key="up" plain onPress={() => void transom.act({ kind: 'scroll', dx: 0, dy: -4 }, 'person')}>
              <Text dimColor>pgup</Text>
            </Button>
            <Button key="down" plain onPress={() => void transom.act({ kind: 'scroll', dx: 0, dy: 4 }, 'person')}>
              <Text dimColor>pgdn</Text>
            </Button>
          </>
        ) : null}
        {degradation.keys ? (
          <Button key="enter" plain onPress={() => void transom.act({ kind: 'press', key: 'Enter' }, 'person')}>
            <Text dimColor>enter</Text>
          </Button>
        ) : null}
        <Text key="sep" dimColor>│</Text>
        <Button key="snap" plain onPress={() => void transom.refresh('viewport')}>
          <Text dimColor>refresh</Text>
        </Button>
        <Button key="doc" plain onPress={() => void transom.refresh('document')}>
          <Text dimColor>whole page</Text>
        </Button>
        {degradation.images && transom.provider.raster ? (
          <Button key="visual" plain onPress={() => showVisual($, ops, transom, width, rows, model.mode)}>
            <Text dimColor>{model.mode === 'visual' ? 'text mode' : 'visual'}</Text>
          </Button>
        ) : null}
        {degradation.images && imageTier.supported && transom.provider.frame ? (
          <Button key="hq" plain onPress={() => void toggleImage($, ops, transom, width, rows, model.mode)}>
            <Text dimColor>{model.mode === 'image' ? 'text mode' : 'hq'}</Text>
          </Button>
        ) : null}
      </Box>
    )

    // A page script that leaves the allowlist gets a visible, auditable banner
    // with two ways out: undo the navigation, or trust the host for this session.
    const warning = model.warning ? (
      <Box flexDirection="row" gap={1}>
        <Text color="yellow">! {clip(model.warning, Math.max(0, width - 24))}</Text>
        <Button key="warn-back" plain onPress={() => void transom.act({ kind: 'back' }, 'person')}>
          <Text dimColor>back</Text>
        </Button>
        <Button
          key="warn-allow"
          plain
          onPress={() => {
            const host = hostOfUrl(model.url)
            if (host) void transom.grantHost(host, true)
          }}
        >
          <Text dimColor>allow host</Text>
        </Button>
      </Box>
    ) : null

    if (model.status === 'error') {
      return (
        <Box flexDirection="column" width="100%">
          {header}
          <Text color="red">error: {model.error ?? 'unknown'}</Text>
          <Button key="retry" onPress={() => void retry(ops, transom)}>Retry</Button>
          {warning}
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
            {model.status === 'starting' ? `starting the ${transom.provider.meta.label.toLowerCase()}…` : 'No page yet. /transom demo starts a local fixture.'}
          </Text>
          <Button key="demo" onPress={() => void runDemo(ops, transom)}>Open the demo app</Button>
          {recent.slice(0, 5).map((url, index) => (
            <Button key={`r${index}`} plain onPress={() => void transom.open(url, transom.provider.meta.defaultWidth)}>
              <Text dimColor>↺ {url}</Text>
            </Button>
          ))}
          {warning}
          {toolbar}
          <Text key="status" dimColor>{statusLine(model, 0, width)}</Text>
          {degradation.keys ? <Client key="keys" module="../providers/browser/keys.tsx" props={{ focused: e.props.isFocused }} height={1} width={width} /> : null}
        </Box>
      )
    }

    if (model.mode === 'visual' && shot.cells && shot.columns > 0 && shot.rows > 0 && shot.url === model.url) {
      const rasterRows = shot.rows
      const rasterCols = shot.columns
      return (
        <Box flexDirection="column" width="100%">
          {header}
          {warning}
          {toolbar}
          <Raster key="shot" columns={rasterCols} rows={rasterRows} cells={shot.cells} />
          <Text key="status" dimColor>{statusLine(model, model.rows.length, width)}</Text>
          {degradation.keys ? <Client key="keys" module="../providers/browser/keys.tsx" props={{ focused: e.props.isFocused }} height={1} width={width} /> : null}
        </Box>
      )
    }

    if (model.mode === 'image' && lastFrame.file) {
      const frameRows = Math.max(5, rows - 9)
      return (
        <Box flexDirection="column" width="100%">
          {header}
          {warning}
          {toolbar}
          <Box position="relative" width={width} height={frameRows}>
            <Image
              key="frame"
              source={{ file: lastFrame.file, format: 'png', generation: lastFrame.generation }}
              columns={width}
              rows={frameRows}
              alt="page screenshot"
            />
            <Box position="absolute" top={0} left={0} width="100%" height="100%">
              <Client
                key="hq-pointer"
                module="../providers/browser/hq-pointer.tsx"
                width="100%"
                height="100%"
              />
            </Box>
          </Box>
          <Text dimColor>read-only · click the image to click the page · text mode to edit</Text>
          <Text key="status" dimColor>{statusLine(model, model.rows.length, width)}</Text>
          {degradation.keys ? <Client key="keys" module="../providers/browser/keys.tsx" props={{ focused: e.props.isFocused }} height={1} width={width} /> : null}
        </Box>
      )
    }

    // Error lines consume a body line too, so the window never overflows.
    const shown: ViewRow[] = []
    let usedLines = 0
    for (const row of model.rows) {
      const cost = 1 + (row.invalid && row.error ? 1 : 0)
      if (usedLines + cost > room) break
      usedLines += cost
      shown.push(row)
    }
    const rowError = (row: ViewRow) =>
      row.invalid && row.error ? (
        <Text key={`${row.ref}-error`} dimColor>! {clip(row.error, Math.max(0, width - 2))}</Text>
      ) : null
    const firstSection = shown.find(one => one.role === 'section')?.ref
    return (
      <Box flexDirection="column" width="100%">
        {header}
        {warning}
        {toolbar}
        {shown.map(row => {
          if (row.role === 'section') {
            return (
              <Box key={row.ref} flexDirection="column">
                {row.ref === firstSection ? null : <Text dimColor>{clip('─'.repeat(width), width)}</Text>}
                <Text bold>{sectionRule(row.label, width)}</Text>
              </Box>
            )
          }
          if (row.role === 'text' || row.role === 'heading') {
            return [
              <Text key={row.ref} dimColor={row.role === 'text'} bold={row.role === 'heading'}>
                {indentFor(row)}{row.role === 'heading' ? '#' : '·'} {row.label}
              </Text>,
              rowError(row),
            ]
          }
          if (row.role === 'textbox' || row.role === 'searchbox') {
            return [
              <Input
                key={row.ref}
                label={`${indentFor(row)}${glyphFor(row)} ${row.label}`}
                placeholder="type and press Enter"
                value={row.value ?? ''}
                onSubmit={text => {
                  void transom.act({ kind: 'fill', ref: row.ref, text }, 'person')
                }}
              />,
              rowError(row),
            ]
          }
          const options = row.role === 'combobox' || row.role === 'listbox' ? selectOptions(row) : []
          if (options.length) {
            return [
              <Select
                key={row.ref}
                label={`${indentFor(row)}${glyphFor(row)} ${row.label}`}
                options={options}
                value={row.value}
                onSelect={value => {
                  void transom.act({ kind: 'select', ref: row.ref, value }, 'person')
                }}
              />,
              rowError(row),
            ]
          }
          if (!degradation.pointer) {
            return [
              <Text key={row.ref} dimColor>
                {indentFor(row)}{glyphFor(row)} {row.label}
                {row.href ? ` → ${shortHref(row.href)}` : ''}
              </Text>,
              rowError(row),
            ]
          }
          return [
            <Button key={row.ref} plain onPress={() => void pressRow(ops, transom, row)}>
              <Text dimColor={row.flags?.includes('disabled')}>
                {indentFor(row)}{glyphFor(row)} {row.label}
                {row.value ? <Text dimColor> = {row.value}</Text> : null}
                {row.href ? <Text dimColor> → {shortHref(row.href)}</Text> : null}
                {row.flags ? <Text dimColor> [{row.flags}]</Text> : null}
              </Text>
            </Button>,
            rowError(row),
          ]
        })}
        {degradation.scroll && model.rows.length > shown.length ? (
          <Button key="next" plain onPress={() => void transom.act({ kind: 'scroll', dx: 0, dy: room }, 'person')}>
            <Text dimColor>↓ next block ({model.rows.length - shown.length} more)</Text>
          </Button>
        ) : null}
        <Text key="status" dimColor>{statusLine(model, shown.length, width)}</Text>
        {degradation.keys ? <Client key="keys" module="../providers/browser/keys.tsx" props={{ focused: e.props.isFocused }} height={1} width={width} /> : null}
      </Box>
    )
  })

  on('ui.close', { id: PANE }, async (_$, e, next) => {
    stopFrames()
    if (hub) await hub.close()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    // The end-of-session budget is short; fire and let the bridge's own
    // /stop and idle shutdown do the cleanup if this does not land.
    stopFrames()
    if (hub) void hub.close()
    stopDemo()
    return next(e)
  })
}

async function showVisual(
  $: EngineInterface,
  ops: Ops,
  transom: Hub,
  width: number,
  rows: number,
  mode: 'text' | 'visual' | 'image',
): Promise<void> {
  // From visual or image, any mode button returns to the editable text tier.
  if (mode !== 'text') {
    stopFrames()
    await update($, view, model => ({ ...model, mode: 'text' as const }))
    void $.ui.invalidate('ui.render')
    return
  }
  const cols = Math.max(20, Math.min(width, 160))
  const height = Math.max(5, Math.min(rows - 9, 40))
  try {
    const shot = await transom.raster(cols, height)
    lastShot = { key: String(Date.now()), ...shot, url: transom.view.url }
    await update($, view, model => ({ ...model, mode: 'visual' as const, last: `visual ${shot.columns}x${shot.rows}` }))
    void $.ui.invalidate('ui.render')
  } catch (error) {
    ops.toast(`visual: ${String((error as Error).message ?? error)}`)
  }
}

function stopFrames(): void {
  frameActive = false
  frameTimer?.cancel()
  frameTimer = undefined
  frameSharpTimer?.cancel()
  frameSharpTimer = undefined
  frameTicks = 0
  frameFocused = false
  frameSharpTaken = false
  frameBusy = false
  // Image mode changes the owned page's viewport; going back to text puts the
  // cell-box metrics back so snapshots match the pane again.
  if (frameMetricsHeld) {
    frameMetricsHeld = false
    if (hub) void hub.stopFrame().catch(() => undefined)
  }
}

async function toggleImage(
  $: EngineInterface,
  ops: Ops,
  transom: Hub,
  width: number,
  rows: number,
  mode: 'text' | 'visual' | 'image',
): Promise<void> {
  if (mode === 'image') {
    stopFrames()
    await update($, view, model => ({ ...model, mode: 'text' as const }))
    void $.ui.invalidate('ui.render')
    return
  }
  await startImage($, ops, transom, width, rows)
}

/**
 * Enter the image tier: one frame now, then one per second while the mode is
 * image. The timer's `$` is this call site's, so no module ever receives `$`.
 */
async function startImage(
  $: EngineInterface,
  ops: Ops,
  transom: Hub,
  width: number,
  rows: number,
): Promise<boolean> {
  stopFrames()
  const provider = transom.provider
  if (!provider.frame) {
    ops.toast('hq: this provider has no frame capture')
    return false
  }
  frameSize = {
    columns: Math.max(1, Math.floor(width)),
    rows: Math.max(5, Math.floor(rows) - 9),
  }
  let frame: Frame
  frameMetricsHeld = true
  try {
    frame = await transom.frame(frameSize.columns, frameSize.rows)
  } catch (error) {
    stopFrames()
    ops.toast(`hq: ${String((error as Error).message ?? error)}`)
    await update($, view, model => ({ ...model, mode: 'text' as const }))
    void $.ui.invalidate('ui.render')
    return false
  }
  applyFrame(frame, transom)
  frameStreaming = typeof provider.latestFrame === 'function'
  frameActive = true
  frameFailures = 0
  frameTicks = 0
  frameSharpTaken = false
  await update($, view, model => ({
    ...model,
    mode: 'image' as const,
    last: `image ${frame.columns}x${frame.rows}`,
  }))
  void $.ui.invalidate('ui.render')
  // The mode lives in engine state, not in Hub.view; `frameActive` is the
  // module-level truth the clock reads, so it stops on every exit path.
  frameTimer = ops.every(FRAME_TICK_MS, () => {
    if (!frameActive) {
      stopFrames()
      return
    }
    frameTicks += 1
    // Streaming while focused asks every tick; unfocused and the still
    // fallback keep the 1 s cadence.
    if ((!frameStreaming || !frameFocused) && frameTicks % (1000 / FRAME_TICK_MS) !== 0) return
    void refreshFrame($, ops, transom)
  })
  return true
}

async function refreshFrame($: EngineInterface, ops: Ops, transom: Hub): Promise<void> {
  if (frameBusy) return
  const provider = transom.provider
  if (!provider.frame) return
  frameBusy = true
  frameMetricsHeld = true
  try {
    if (frameStreaming) {
      const answer = await transom.latestFrame(lastFrame.generation)
      if (!frameActive) return
      // A provider that lost its stream mid-mode falls back to stills.
      if (!answer) {
        frameStreaming = false
        return
      }
      // The live payload also carries `same: false`, so the flag's value (not
      // its presence) tells the two apart.
      if ((answer as { same?: boolean }).same === true) {
        // A target that refused the screencast says so here; the pane then
        // returns to the one-second still path instead of waiting forever.
        if ((answer as { streaming?: boolean }).streaming === false) {
          frameStreaming = false
          frameFailures = 0
          return
        }
        frameFailures = 0
        armSharpStill($, ops, transom)
        return
      }
      const frame = answer as Frame
      frameFailures = 0
      frameSharpTimer?.cancel()
      frameSharpTimer = undefined
      frameSharpTaken = false
      applyFrame(frame, transom)
      void $.ui.invalidate('ui.render')
      return
    }
    const frame = await transom.frame(frameSize.columns, frameSize.rows)
    frameFailures = 0
    applyFrame(frame, transom)
    void $.ui.invalidate('ui.render')
  } catch (error) {
    // An occluded window or a busy page can drop one frame; only give up on
    // the mode after the failure repeats.
    if (frameFailures < 2) {
      frameFailures += 1
      return
    }
    // One toast, then leave image mode: the text tier stays usable.
    frameFailures = 0
    stopFrames()
    ops.toast(`hq: ${String((error as Error).message ?? error)}`)
    await update($, view, model => ({ ...model, mode: 'text' as const }))
    void $.ui.invalidate('ui.render')
  } finally {
    frameBusy = false
  }
}

function applyFrame(frame: Frame, transom: Hub): void {
  lastFrame = {
    file: frame.file,
    generation: frame.generation,
    columns: frame.columns,
    rows: frame.rows,
    pageWidth: frame.pageWidth,
    pageHeight: frame.pageHeight,
    url: transom.view.url,
  }
}

// One sharp still after the stream has been quiet for ~2 s: a static page is
// then readable at the configured density. Motion cancels the pending still and
// re-arms the one-shot; a new frame arriving does the same.
function armSharpStill($: EngineInterface, ops: Ops, transom: Hub): void {
  if (frameSharpTaken || frameSharpTimer) return
  frameSharpTimer = ops.after(FRAME_SHARP_AFTER_MS, () => {
    frameSharpTimer = undefined
    void takeSharpStill($, transom)
  })
}

async function takeSharpStill($: EngineInterface, transom: Hub): Promise<void> {
  if (!frameActive || frameBusy) return
  frameBusy = true
  frameMetricsHeld = true
  try {
    const frame = await transom.frame(frameSize.columns, frameSize.rows)
    frameSharpTaken = true
    frameFailures = 0
    applyFrame(frame, transom)
    void $.ui.invalidate('ui.render')
  } catch {
    // The stream is still alive; the next quiet poll re-arms the still.
  } finally {
    frameBusy = false
  }
}

async function retry(ops: Ops, transom: Hub): Promise<void> {
  try {
    await transom.start()
    await transom.refresh()
  } catch (error) {
    ops.toast(`retry: ${String((error as Error).message ?? error)}`)
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

function stopDemo(): void {
  demo = undefined
  const stream = demoStream
  demoStream = undefined
  if (!stream) return
  try {
    void stream.return(undefined)
  } catch {
    /* already ended */
  }
}

async function startDemo(ops: Ops): Promise<{ url: string } | undefined> {
  try {
    const stream = ops.spawn({
      argv: ['node', `${ops.root}/demo/server.mjs`],
      env: { PORT: '0' },
    })
    demoStream = stream as unknown as AsyncGenerator<unknown, unknown>
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
