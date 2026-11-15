import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Ops } from '../engine/ops'
import type { Provider } from '../engine/provider'
import { EMPTY_VIEW, Hub, normaliseKey, type ViewModel } from '../hub/hub'
import { NovelProvider } from '../providers/novel/client'
import {
  armAutoHide,
  cancelAutoHide,
  hide,
  isHidden,
  PANE,
  refreshTheme,
  setThemeName,
  show,
  THEME_NAMES,
  themeName,
} from './boss'
import { registerTools } from './tools'

const view = atom({ plugin: 'moyu', key: 'view' } as const, EMPTY_VIEW as ViewModel)

type Settings = {
  /** The library root; relative paths resolve from the working directory. */
  libraryRoot: string
  /** Hide after this many idle seconds; 0 keeps it open. */
  autoHideSeconds: number
  /** `auto` follows the person's own theme; the others set a session preset. */
  theme: string
}

let settings: Settings = { libraryRoot: 'novels', autoHideSeconds: 0, theme: 'auto' }
let hub: Hub | undefined

function settingsOf(options: Record<string, unknown>): Settings {
  const root = typeof options.libraryRoot === 'string' && options.libraryRoot.trim()
    ? options.libraryRoot.trim()
    : 'novels'
  const seconds = Number(options.autoHideSeconds)
  const theme = typeof options.theme === 'string' ? options.theme : 'auto'
  return {
    libraryRoot: root,
    autoHideSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 0,
    theme,
  }
}

function providerFactory(ops: Ops, root: string): (id: string) => Provider {
  return () => new NovelProvider(ops, root)
}

function ensureHub(ops: Ops, options: Record<string, unknown>, refresh: () => void): Hub {
  if (!hub) {
    hub = new Hub(ops, options, { providerFactory: providerFactory(ops, settings.libraryRoot) })
    hub.onRefresh(refresh)
  }
  return hub
}

function clip(text: string, width: number): string {
  const max = Math.max(0, Math.floor(width))
  return text.length > max ? text.slice(0, max) : text
}

/** Register the pane's hooks; the hooks module adds tools and the command. */
export function registerPane(on: Parameters<Register>[0], options: Parameters<Register>[1]): void {
  // A fresh registration is a fresh session view. Settings live here, not in
  // session.start, so a refused start hook cannot leave the default root.
  hub = undefined
  cancelAutoHide()
  settings = settingsOf(options as Record<string, unknown>)
  if (!setThemeName(settings.theme)) setThemeName('auto')
  registerTools(on, { hub: () => hub! })

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
      readText: path => $.fs.read(path),
      listDir: path => $.fs.list(path),
      statPath: (path, resolve) => $.fs.stat(path, resolve === undefined ? undefined : { resolve }),
      fillPrompt: async text => {
        await $.prompt.fill({ text })
      },
    }
    ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    await hub!.start().catch(error => {
      ops.log(`provider start: ${String((error as Error).message ?? error)}`)
    })
    return next(e)
  })

  on('command.run', { command: 'moyu' }, async ($, e) => {
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
      readText: path => $.fs.read(path),
      listDir: path => $.fs.list(path),
      statPath: (path, resolve) => $.fs.stat(path, resolve === undefined ? undefined : { resolve }),
      fillPrompt: async text => {
        await $.prompt.fill({ text })
      },
    }
    const novel = ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    const raw = (e.args ?? '').trim()
    const [verb = '', ...rest] = raw.split(/\s+/)
    const target = rest.join(' ')

    if (verb === 'hide') {
      await hide($, ops)
      return { text: 'Novel hidden.' }
    }

    if (verb === 'show' || (!verb && isHidden())) {
      await show($, ops)
      if (novel.view.status !== 'closed') void novel.refresh()
      else {
        const resumed = await resumeShelf(novel)
        if (!resumed) return { text: 'moyu shown. /moyu <path> opens a book.' }
      }
      armAutoHide($, ops, settings.autoHideSeconds)
      return { text: 'moyu shown. q hides it again.' }
    }

    if (verb === 'theme') {
      if (!setThemeName(target)) return { text: `usage: /novel theme ${THEME_NAMES.join('|')}` }
      await refreshTheme($)
      return { text: `Theme: ${themeName()}.` }
    }

    if (verb === 'close') {
      cancelAutoHide()
      await novel.close()
      await hide($, ops)
      return { text: 'Novel closed.' }
    }

    if (!verb) {
      await hide($, ops)
      return { text: 'Novel hidden.' }
    }

    await show($, ops)
    const opened = await novel.open(raw)
    armAutoHide($, ops, settings.autoHideSeconds)
    return { text: opened.message }
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
      readText: path => $.fs.read(path),
      listDir: path => $.fs.list(path),
      statPath: (path, resolve) => $.fs.stat(path, resolve === undefined ? undefined : { resolve }),
      fillPrompt: async text => {
        await $.prompt.fill({ text })
      },
    }
    const data = e.data as { kind?: string; key?: string; ctrl?: boolean }
    if (data.kind !== 'key' || !data.key) return {}
    const novel = ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    armAutoHide($, ops, settings.autoHideSeconds)
    const key = data.key
    const plain = data.ctrl !== true
    // q is the boss key; ctrl+g stays as the old habit while the pane holds
    // the keys (the host binds it to its editor only in the Chat context).
    if (plain && key.toLowerCase() === 'q') {
      await hide($, ops)
      return {}
    }
    if (data.ctrl === true && key.toLowerCase() === 'g') {
      await hide($, ops)
      return {}
    }
    if (plain && key.toLowerCase() === 'a') {
      await askAbout(novel, ops)
      return {}
    }
    // less-like keys: space/b, j/k, g/G.
    const mapped =
      key === ' ' ? ' ' : key === 'b' ? 'b' : key === 'j' ? 'down' : key === 'k' ? 'up'
        : key === 'g' ? 'home' : key === 'G' ? 'end' : key
    const { result } = await novel.act({ kind: 'press', key: normaliseKey(mapped) }, 'person')
    if (!result.ok) ops.status(result.message)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Button, Client } = $.ui.resolve(e)
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
      readText: path => $.fs.read(path),
      listDir: path => $.fs.list(path),
      statPath: (path, resolve) => $.fs.stat(path, resolve === undefined ? undefined : { resolve }),
      fillPrompt: async text => {
        await $.prompt.fill({ text })
      },
    }
    const novel = ensureHub(ops, options as Record<string, unknown>, () => {
      void update($, view, () => hub!.view)
    })
    // An explicit raw get lets the host rule see the noun; read() subscribes.
    await $.state.get({ plugin: 'moyu', key: 'view' } as const)
    const model = await read($, view)
    const width = Math.max(20, e.props.bodyColumns)
    const rows = e.props.scroll.bodyRows || e.viewport?.rows || 24
    novel.setViewport(width, rows)
    const keys = e.props.isFocused ? (
      <Client key="keys" module="../providers/novel/keys.tsx" props={{ focused: true }} height={1} width={width} />
    ) : null
    const header = <Text dimColor>{clip(`${model.path || 'novel'} · ${model.percent}%`, width)}</Text>
    const hint = (text: string) => <Text key="hint" dimColor>{clip(text, width)}</Text>
    const quit = (
      <Button key="quit" hotkey="q" plain onPress={() => hide($, ops)}>
        <Text dimColor>q 隐藏</Text>
      </Button>
    )

    if (model.status === 'error') {
      return (
        <Box flexDirection="column" width="100%">
          {header}
          <Text color="error">error: {model.error ?? 'unknown'}</Text>
          {hint('/novel <path> tries again · /novel close ends the session view')}
          {keys}
        </Box>
      )
    }

    if (model.status === 'closed' || model.rows.length === 0) {
      const recent = await novel.recent()
      return (
        <Box flexDirection="column" width="100%">
          {header}
          <Text color="text">Open a novel with /novel &lt;path&gt;. /novel shows and hides the pane; /novel theme paper, ink.</Text>
          {e.props.placement === 'inline' ? (
            <Text color="inactive">mouse needs fullscreen: CLAUDE_CODE_NO_FLICKER=1 · keyboard: ctrl+x tab</Text>
          ) : null}
          {recent.slice(0, 5).map((path, index) => (
            <Button key={`r${index}`} plain onPress={() => novel.open(path)}>
              <Text color="subtle">↺ {clip(path, Math.max(0, width - 2))}</Text>
            </Button>
          ))}
          {keys}
        </Box>
      )
    }

    // One line per node; the header and footer keep the rest.
    const body = model.rows.slice(0, Math.max(1, rows - 3))
    const selected = model.rows.find(row => row.selected)
    const ask = selected ? (
      <Button key="ask" plain onPress={() => askAbout(novel, ops)}>
        <Text underline>ask about ¶</Text>
      </Button>
    ) : null
    return (
      <Box flexDirection="column" width="100%">
        {header}
        {body.map(row => {
          if (row.role === 'heading') {
            return <Text key={row.ref}>{row.label}</Text>
          }
          if (row.role === 'annotation') {
            return <Text key={row.ref} italic>{row.label}</Text>
          }
          if (row.role === 'file') {
            return (
              <Button key={row.ref} plain onPress={() => novel.open(row.value ?? row.label)}>
                <Text>{row.label}</Text>
              </Button>
            )
          }
          return (
            <Button key={row.ref} plain onPress={() => novel.act({ kind: 'click', ref: row.ref }, 'person')}>
              <Text underline={row.selected}>{row.label}</Text>
            </Button>
          )
        })}
        {ask ?? hint('空格/j/k 翻页 · n/p 章节 · a 引用 · q 隐藏')}
        {quit}
        {keys}
      </Box>
    )
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    // A pane closed by the person is a boss hide: keep the page, drop the theme.
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
      readText: path => $.fs.read(path),
      listDir: path => $.fs.list(path),
      statPath: (path, resolve) => $.fs.stat(path, resolve === undefined ? undefined : { resolve }),
      fillPrompt: async text => {
        await $.prompt.fill({ text })
      },
    }
    await hide($, ops, { keepPane: true })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    cancelAutoHide()
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
      readText: path => $.fs.read(path),
      listDir: path => $.fs.list(path),
      statPath: (path, resolve) => $.fs.stat(path, resolve === undefined ? undefined : { resolve }),
      fillPrompt: async text => {
        await $.prompt.fill({ text })
      },
    }
    await hide($, ops)
    if (hub) await hub.close()
    return next(e)
  })
}

/** Reopen the last book, else the library shelf. False when neither opens. */
async function resumeShelf(novel: Hub): Promise<boolean> {
  const last = await novel.lastPath()
  if (last) {
    const opened = await novel.open(last)
    if (opened.ok) return true
  }
  const shelf = await novel.open('.')
  return shelf.ok
}

/** Put the selected paragraph in the prompt as a quote, ready to ask about. */
async function askAbout(novel: Hub, ops: Ops): Promise<void> {
  const { result } = await novel.act({ kind: 'command', name: 'selected' }, 'person')
  if (!result.ok || !result.text) {
    ops.toast(result.message)
    return
  }
  await ops.fillPrompt(`> ${result.text}\n`)
  ops.status('paragraph put in the prompt')
}
