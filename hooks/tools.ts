import type { EngineInterface, On, ToolSpec } from 'claude-code'

import type { Ops } from '../engine/ops'
import type { Action } from '../engine/provider'
import { hide, show, toggle, isHidden } from './boss'
import type { Hub } from '../hub/hub'

type ToolDeps = {
  hub: () => Hub
}

type ToolOutput = {
  result: string
  text: string
  isError?: true
}

function answer(text: string): ToolOutput {
  // A plugin tool with no output schema: the result is its plain text.
  return { result: text, text }
}

function fail(text: string): ToolOutput {
  return { result: text, text, isError: true }
}

function opsOf($: EngineInterface): Ops {
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
    readText: path => $.fs.read(path),
    listDir: path => $.fs.list(path),
    statPath: (path, resolve) => $.fs.stat(path, resolve === undefined ? undefined : { resolve }),
    fillPrompt: async text => {
      await $.prompt.fill({ text })
    },
  }
}

const OPEN_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'A novel file or a directory under the library root.' },
  },
  required: ['path'],
}

const READ_SCHEMA = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      enum: ['page', 'next', 'prev', 'chapter'],
      description: 'page (default) is what the person sees; next/prev turn one page; chapter moves to the next chapter.',
    },
  },
}

const FIND_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Case-insensitive text to find in the open novel.' },
  },
  required: ['text'],
}

const ANNOTATE_SCHEMA = {
  type: 'object',
  properties: {
    ref: { type: 'string', description: 'Paragraph ref from a snapshot, e.g. "p120".' },
    text: { type: 'string', description: 'The note, up to 600 characters. It shows after the paragraph.' },
  },
  required: ['ref', 'text'],
}

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    delta: { type: 'number', description: 'Pages to turn: positive forward, negative back.' },
  },
  required: ['delta'],
}

const BOSS_SCHEMA = {
  type: 'object',
  properties: {
    visible: { type: 'boolean', description: 'true shows the pane, false hides it; absent toggles.' },
  },
}

// Specs are data: the hooks module lists the `$.tool.register` call itself, so
// the host's scan sees a tool registration in a hooks module.
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'open',
    description:
      'Open the moyu pane at a library path (a text file, or a directory to list it). Starts the pane on first use. Prefer this before read.',
    inputSchema: OPEN_SCHEMA,
    isDeferred: false,
  },
  {
    name: 'read',
    description:
      'Return the current page of the open novel with ref-tagged paragraphs. scope page reads what the person sees; next/prev turn a page first; chapter moves to the next chapter. Refs are valid until the next snapshot or turn.',
    inputSchema: READ_SCHEMA,
    isDeferred: false,
  },
  {
    name: 'find',
    description: 'Find text in the whole open novel (case-insensitive) and return up to 20 excerpts with their surrounding context.',
    inputSchema: FIND_SCHEMA,
    isDeferred: false,
  },
  {
    name: 'annotate',
    description:
      'Attach a note to a paragraph of the open novel. The note renders in the same style as the prose, prefixed "· AI", after the anchor paragraph.',
    inputSchema: ANNOTATE_SCHEMA,
    isDeferred: false,
  },
  {
    name: 'turn',
    description: 'Turn pages in the open novel: positive delta forward, negative back. Returns the new position.',
    inputSchema: TURN_SCHEMA,
    isDeferred: false,
  },
  {
    name: 'boss',
    description: 'Show, hide or toggle the moyu pane. Hiding also restores the normal Claude Code theme; the page stays where it was.',
    inputSchema: BOSS_SCHEMA,
    isDeferred: false,
  },
]

export function registerTools(on: On, deps: ToolDeps): void {
  const { hub } = deps

  on('tool.call', { tool: 'mcp__moyu__open' }, async ($, e) => {
    const path = (e as unknown as { path?: string }).path
    if (!path) return fail('path is required')
    const ops = opsOf($)
    try {
      await show($, ops)
      const opened = await hub().open(path, 'model')
      if (!opened.ok) return fail(opened.message)
      const { text, auditId } = await hub().modelSnapshot('viewport')
      return answer(`Opened. audit ${auditId}\n\n${text}`)
    } catch (error) {
      return fail(String((error as Error).message ?? error))
    }
  }).catch(() => fail('moyu: the tool failed internally'))

  on('tool.call', { tool: 'mcp__moyu__read' }, async (_$, e) => {
    const scope = (e as unknown as { scope?: string }).scope
    if (hub().view.status === 'closed') return fail('No novel is open. Call novel_open first.')
    if (scope === 'next' || scope === 'prev' || scope === 'chapter') {
      const action: Action = scope === 'chapter'
        ? { kind: 'command', name: 'chapter', args: { delta: 1 } }
        : { kind: 'command', name: 'page', args: { delta: scope === 'next' ? 1 : -1 } }
      const { result } = await hub().act(action, 'model')
      if (!result.ok) return fail(result.message)
    }
    const { text, auditId } = await hub().modelSnapshot('viewport')
    return answer(`${text}\n\naudit ${auditId}`)
  }).catch(() => fail('moyu: the tool failed internally'))

  on('tool.call', { tool: 'mcp__moyu__find' }, async (_$, e) => {
    const text = (e as unknown as { text?: string }).text
    if (!text) return fail('text is required')
    if (hub().view.status === 'closed') return fail('No novel is open. Call novel_open first.')
    const { result, auditId } = await hub().act({ kind: 'command', name: 'find', args: { text } }, 'model')
    const header = result.ok ? result.message : 'failed'
    return answer(`${header}${result.text ? `\n\n${result.text}` : ''}\naudit ${auditId}`)
  }).catch(() => fail('moyu: the tool failed internally'))

  on('tool.call', { tool: 'mcp__moyu__annotate' }, async (_$, e) => {
    const input = e as unknown as { ref?: string; text?: string }
    if (!input.ref) return fail('ref is required')
    if (!input.text) return fail('text is required')
    if (hub().view.status === 'closed') return fail('No novel is open. Call novel_open first.')
    const { result, auditId } = await hub().act(
      { kind: 'command', name: 'annotate', args: { ref: input.ref, text: input.text } },
      'model',
    )
    return answer(`${result.ok ? 'ok' : 'failed'}: ${result.message}\naudit ${auditId}`)
  }).catch(() => fail('moyu: the tool failed internally'))

  on('tool.call', { tool: 'mcp__moyu__turn' }, async (_$, e) => {
    const delta = Number((e as unknown as { delta?: number }).delta)
    if (!Number.isFinite(delta) || delta === 0) return fail('delta is required and non-zero')
    if (hub().view.status === 'closed') return fail('No novel is open. Call novel_open first.')
    const { result, auditId } = await hub().act({ kind: 'command', name: 'page', args: { delta } }, 'model')
    return answer(`${result.ok ? 'ok' : 'failed'}: ${result.message}\naudit ${auditId}`)
  }).catch(() => fail('moyu: the tool failed internally'))

  on('tool.call', { tool: 'mcp__moyu__boss' }, async ($, e) => {
    const visible = (e as unknown as { visible?: boolean }).visible
    const ops = opsOf($)
    try {
      if (visible === true) await show($, ops)
      else if (visible === false) await hide($, ops)
      else await toggle($, ops)
      return answer(isHidden() ? 'hidden' : 'shown')
    } catch (error) {
      return fail(String((error as Error).message ?? error))
    }
  }).catch(() => fail('moyu: the tool failed internally'))
}
