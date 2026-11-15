// Test bottoms for the novel pane: an in-memory library behind `$.fs`, a
// recorder for prompt fills and theme calls, and the kit's own store.
//
// Every test gets its own `on`; the hooks here close over that test's library.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

import { foldPath } from '../providers/novel/library'

export type FakeEntry = string | true

export type Bottom = {
  files: Map<string, FakeEntry>
  /** Every text handed to `$.prompt.fill`, in order. */
  fills: string[]
  /** Theme presets set, and how many times a theme was cleared. */
  themes: string[]
  clears: number
  /** Paths opened through `$.fs.stat`, for guard assertions. */
  stats: string[]
  /** Every `$.ui.open` argument, in order. */
  opens: Array<Record<string, unknown>>
}

export type BottomOptions = {
  files?: Readonly<Record<string, FakeEntry>>
}

export function installBottom(on: On, options: BottomOptions = {}): Bottom {
  const files = new Map<string, FakeEntry>()
  for (const [path, value] of Object.entries(options.files ?? {})) files.set(foldPath(path), value)
  const bottom: Bottom = {
    files,
    fills: [],
    themes: [],
    clears: 0,
    stats: [],
    opens: [],
  }
  const value = <T,>(v: T) => ({ value: v }) as never

  mock.store(on)
  // The bottom's answer for the event; the plugin's own session.start is above it.
  on('session.start', { isInteractive: true }, ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  on('tool.register', ((_$: unknown, e: { name: string }) => value({ tool: `mcp__moyu__${e.name}` })) as never)
  on('command.register', (() => value({ command: 'moyu' })) as never)
  on('ui.log', (() => value(undefined)) as never)
  on('ui.status', (() => value(undefined)) as never)
  on('ui.toast', (() => value(undefined)) as never)
  on('ui.open', ((_$: unknown, e: Record<string, unknown>) => {
    bottom.opens.push(e)
    return value({ isPlaced: true })
  }) as never)
  on('ui.close', (() => value({})) as never)

  on('prompt.fill', ((_$: unknown, e: { text: string }) => {
    bottom.fills.push(e.text)
    // The kit reads this event's answer directly, not as a `$` value.
    return { isFilled: true } as never
  }) as never)
  on('theme.set', ((_$: unknown, e: { colors?: { label?: string } }) => {
    bottom.themes.push(e.colors?.label ?? '')
    return value({ isDrawn: false, reason: 'the kit draws no theme' })
  }) as never)
  on('theme.clear', (() => {
    bottom.clears += 1
    return value({ isDrawn: false, reason: 'the kit draws no theme' })
  }) as never)

  const state = new Map<string, { value: unknown; version: number }>()
  on('state.get', ((_$: unknown, e: { plugin: string; key: string; id?: string }) => {
    const key = `${e.plugin}/${e.key}${e.id ? `#${e.id}` : ''}`
    const held = state.get(key)
    return value({ value: held?.value, version: held?.version ?? 0 })
  }) as never)
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; id?: string; value: unknown }) => {
    const key = `${e.plugin}/${e.key}${e.id ? `#${e.id}` : ''}`
    const version = (state.get(key)?.version ?? 0) + 1
    state.set(key, { value: e.value, version })
    return value({ isSet: true, version })
  }) as never)

  const need = (path: string): FakeEntry => {
    const entry = files.get(foldPath(path))
    if (entry === undefined) throw new Error(`ENOENT: ${path}`)
    return entry
  }

  on('fs.read', ((_$: unknown, e: { path: string }) => {
    const entry = need(e.path)
    if (entry === true) throw new Error(`EISDIR: ${e.path}`)
    return value(entry)
  }) as never)
  on('fs.stat', ((_$: unknown, e: { path: string; resolve: boolean }) => {
    bottom.stats.push(foldPath(e.path))
    const entry = need(e.path)
    return value({
      kind: entry === true ? 'dir' : 'file',
      size: entry === true ? 0 : entry.length,
      mtimeMs: 0,
      isLink: false,
      ...(e.resolve ? { realPath: foldPath(e.path) } : {}),
    })
  }) as never)
  on('fs.list', ((_$: unknown, e: { path: string }) => {
    const dir = foldPath(e.path)
    const prefix = dir.endsWith('/') ? dir : `${dir}/`
    const entries = []
    for (const [child, entry] of files) {
      if (!child.startsWith(prefix) || child.slice(prefix.length).includes('/')) continue
      entries.push({
        name: child.slice(prefix.length),
        kind: entry === true ? 'dir' : 'file',
        size: entry === true ? 0 : entry.length,
        mtimeMs: 0,
        isLink: false,
      })
    }
    return value(entries)
  }) as never)

  return bottom
}
