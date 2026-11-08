import type { EngineInterface, On } from 'claude-code'

import type { Action } from '../engine/provider'
import { normaliseKey, type Hub } from '../hub/hub'

type ToolDeps = {
  hub: () => Hub
  openPane: () => Promise<void>
}

type ToolOutput = {
  result: { content: Array<Record<string, unknown>> }
  text: string
  isError?: true
}

function answer(text: string): ToolOutput {
  // A plugin tool with no output schema: the result is its plain text.
  return { result: text, text } as unknown as ToolOutput
}

function fail(text: string): ToolOutput {
  return { result: text, text, isError: true } as unknown as ToolOutput
}

const OPEN_SCHEMA = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'http or https URL to open in the pane.' },
  },
  required: ['url'],
}

const SNAPSHOT_SCHEMA = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      enum: ['viewport', 'document'],
      description: 'viewport (default) is the visible region; document is the whole page, still capped.',
    },
    sinceLast: {
      type: 'boolean',
      description:
        'Only report what changed since the previous snapshot: added, removed and changed refs with counts. Falls back to the full snapshot when there is no baseline or the URL changed.',
    },
  },
}

const FIND_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Case-insensitive match against node names and values.' },
    role: { type: 'string', description: 'Exact role filter, e.g. button, link, textbox, heading.' },
    interactiveOnly: { type: 'boolean', description: 'Only interactive nodes (buttons, inputs, links).' },
  },
}

const WAIT_SCHEMA = {
  type: 'object',
  properties: {
    selector: { type: 'string', description: 'CSS selector to wait for.' },
    text: { type: 'string', description: 'Text that must appear in the page body.' },
    timeoutMs: { type: 'number', description: 'Maximum wait in milliseconds, clamped to 500..10000 (default 5000).' },
    idleMs: { type: 'number', description: 'Wait until no network request has been in flight for this many milliseconds.' },
  },
}

const ACT_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['click', 'check', 'uncheck', 'clickAt', 'fill', 'select', 'press', 'scroll', 'hover', 'focus', 'navigate', 'back', 'forward', 'reload', 'wait'],
    },
    ref: { type: 'string', description: 'Node ref from the latest snapshot, e.g. "t12".' },
    x: { type: 'number', description: 'Viewport CSS pixel x for clickAt.' },
    y: { type: 'number', description: 'Viewport CSS pixel y for clickAt.' },
    text: { type: 'string', description: 'Text for fill, or the body text to wait for with kind wait.' },
    value: { type: 'string', description: 'Option value for select.' },
    key: { type: 'string', description: 'Key for press: Enter, Tab, Escape, arrows, PageDown, or a character.' },
    dx: { type: 'number', description: 'Horizontal scroll wheel clicks for scroll.' },
    dy: { type: 'number', description: 'Vertical scroll wheel clicks for scroll.' },
    url: { type: 'string', description: 'Target for navigate.' },
    selector: { type: 'string', description: 'CSS selector for kind wait.' },
    timeoutMs: { type: 'number', description: 'Wait timeout for kind wait, clamped to 500..10000.' },
    idleMs: { type: 'number', description: 'Network-idle window for kind wait.' },
  },
  required: ['kind'],
}

export async function registerToolSpecs($: EngineInterface): Promise<void> {
    await $.tool.register({
      name: 'browser_open',
      description:
        'Open the Transom pane at a URL. Starts the local provider on first use. Prefer this before browser_snapshot.',
      inputSchema: OPEN_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'browser_snapshot',
      description:
        'Return a structured snapshot of the open page: URL, title, landmarks and ref-tagged nodes (role, name, value, state). Refs are valid until the next snapshot or navigation. Use viewport scope unless you need the whole page. Pass sinceLast: true to receive only added, removed and changed refs.',
      inputSchema: SNAPSHOT_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'browser_find',
      description:
        'Find nodes in the current snapshot without re-reading the open page: filter by text (case-insensitive, matches names and values), exact role, and interactiveOnly. Returns snapshot-format lines with refs, capped at 40.',
      inputSchema: FIND_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'browser_act',
      description:
        'Perform one action on the open page: click, check, uncheck, clickAt, fill, select, press, scroll, hover, focus, navigate, back, forward, reload. check/uncheck drive a checkbox (or check a radio) and no-op when the state already matches. clickAt uses viewport CSS pixels (x, y) instead of a ref. A text-only provider refuses pointer and key actions with a clear message. Returns the action result and an audit id. Retake the snapshot after stale-ref errors.',
      inputSchema: ACT_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'browser_wait',
      description:
        'Wait (read-only) for a CSS selector, for body text, or for network idle on the open page. Returns ok with what was found, or ok: false on timeout; a timeout is a normal result, not an error. Supply at least one of selector, text or idleMs.',
      inputSchema: WAIT_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'browser_screenshot',
      description: 'Capture the visible part of the open page as a PNG image (visual check; slower than a snapshot). A provider without screenshots refuses with a clear message.',
      inputSchema: {
        type: 'object',
        properties: { cols: { type: 'number' }, rows: { type: 'number' } },
      },
    })
    await $.tool.register({
      name: 'browser_audit',
      description: 'List the most recent Transom actions, who took them, and their outcome.',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    })
}

export function registerTools(on: On, deps: ToolDeps): void {
  const { hub } = deps

  on('tool.call', { tool: 'mcp__transom__browser_open' }, async (_$, e) => {
    const url = (e as unknown as { url?: string }).url
    if (!url) return fail('url is required')
    try {
      await deps.openPane()
      const opened = await hub().open(url, 100, 'model')
      if (!opened.ok) return fail(opened.message)
      const { text } = await hub().modelSnapshot('viewport')
      return answer(`Opened. audit follows.\n\n${text}`)
    } catch (error) {
      return fail(String((error as Error).message ?? error))
    }
  }).catch(() => fail('transom: the tool failed internally'))

  on('tool.call', { tool: 'mcp__transom__browser_snapshot' }, async (_$, e) => {
    const input = e as unknown as { scope?: 'viewport' | 'document'; sinceLast?: boolean }
    if (hub().view.status === 'closed') return fail('No page is open. Call browser_open first.')
    const { text, auditId } = await hub().modelSnapshot(
      input.scope === 'document' ? 'document' : 'viewport',
      input.sinceLast === true,
    )
    return answer(`${text}\n\naudit ${auditId}`)
  }).catch(() => fail('transom: the tool failed internally'))

  on('tool.call', { tool: 'mcp__transom__browser_find' }, async (_$, e) => {
    const input = e as unknown as { text?: unknown; role?: unknown; interactiveOnly?: unknown }
    if (hub().view.status === 'closed') return fail('No page is open. Call browser_open first.')
    const { text, auditId } = await hub().modelFind({
      text: typeof input.text === 'string' ? input.text : undefined,
      role: typeof input.role === 'string' ? input.role : undefined,
      interactiveOnly: input.interactiveOnly === true,
    })
    return answer(`${text}\n\naudit ${auditId}`)
  }).catch(() => fail('transom: the tool failed internally'))

  on('tool.call', { tool: 'mcp__transom__browser_wait' }, async (_$, e) => {
    const action = toAction({ ...(e as unknown as Record<string, unknown>), kind: 'wait' })
    if (typeof action === 'string') return fail(action)
    if (hub().view.status === 'closed') return fail('No page is open. Call browser_open first.')
    const { result, auditId, denied } = await hub().act(action, 'model')
    const header = result.ok ? 'ok' : denied ? 'denied' : 'failed'
    return answer(`${header}: ${result.message}\naudit ${auditId}`)
  }).catch(() => fail('transom: the tool failed internally'))

  on('tool.call', { tool: 'mcp__transom__browser_act' }, async (_$, e) => {
    const action = toAction(e as unknown as Record<string, unknown>)
    if (typeof action === 'string') return fail(action)
    if (hub().view.status === 'closed') return fail('No page is open. Call browser_open first.')
    const { result, auditId, denied } = await hub().act(action, 'model')
    const header = result.ok ? 'ok' : denied ? 'denied' : 'failed'
    return answer(`${header}: ${result.message}\naudit ${auditId}`)
  }).catch(() => fail('transom: the tool failed internally'))

  on('tool.call', { tool: 'mcp__transom__browser_screenshot' }, async (_$, e) => {
    const input = e as unknown as { cols?: number; rows?: number }
    if (hub().view.status === 'closed') return fail('No page is open. Call browser_open first.')
    if (!hub().provider.screenshot) return fail(`the ${hub().provider.meta.label} provider has no screenshots`)
    try {
      const shot = await hub().screenshot(input.cols ?? 110, input.rows ?? 34)
      const entry = await hub().audit.log({
        actor: 'model', provider: hub().provider.meta.id, action: 'screenshot', url: hub().view.url,
        policy: 'read-only', ok: true, message: `${shot.cols}x${shot.rows}`,
      })
      return answer(`screenshot ${shot.cols}x${shot.rows} captured, audit ${entry.id} (image available in the pane)`)
    } catch (error) {
      return fail(String((error as Error).message ?? error))
    }
  }).catch(() => fail('transom: the tool failed internally'))

  on('tool.call', { tool: 'mcp__transom__browser_audit' }, async (_$, e) => {
    const input = e as unknown as { limit?: number }
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100)
    const rows = hub().audit.recent(limit)
    if (!rows.length) return answer('No actions yet.')
    return answer(
      rows
        .map(entry => `${entry.ok ? 'ok' : '!!'} ${new Date(entry.at).toISOString().slice(11, 19)} ${entry.actor} ${entry.action} ${entry.durationMs}ms ${entry.message ?? ''}`)
        .join('\n'),
    )
  }).catch(() => fail('transom: the tool failed internally'))
}

function toAction(input: Record<string, unknown>): Action | string {
  const kind = String(input.kind ?? '')
  const ref = input.ref === undefined ? undefined : String(input.ref)
  switch (kind) {
    case 'click':
      return ref ? { kind, ref } : 'ref is required for click'
    case 'check':
    case 'uncheck':
      return ref ? { kind, ref } : `ref is required for ${kind}`
    case 'clickAt': {
      const x = input.x
      const y = input.y
      return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
        ? { kind, x, y }
        : 'x and y are required for clickAt'
    }
    case 'fill':
      return ref ? { kind, ref, text: String(input.text ?? '') } : 'ref is required for fill'
    case 'select':
      return ref ? { kind, ref, value: String(input.value ?? '') } : 'ref is required for select'
    case 'focus':
    case 'hover':
      return ref ? { kind, ref } : `ref is required for ${kind}`
    case 'press': {
      const key = String(input.key ?? '')
      return key ? { kind, key: normaliseKey(key) } : 'key is required for press'
    }
    case 'scroll':
      return { kind, dx: Number(input.dx) || 0, dy: Number(input.dy) || 0 }
    case 'navigate':
      return input.url ? { kind, url: String(input.url) } : 'url is required for navigate'
    case 'wait': {
      const selector = typeof input.selector === 'string' && input.selector ? input.selector : undefined
      const text = typeof input.text === 'string' && input.text ? input.text : undefined
      const idleMs = Number(input.idleMs)
      const idle = Number.isFinite(idleMs) && idleMs > 0 ? idleMs : undefined
      if (!selector && !text && idle === undefined) {
        return 'wait requires at least one of selector, text or idleMs'
      }
      const timeoutMs = Number(input.timeoutMs)
      return {
        kind,
        ...(selector ? { selector } : {}),
        ...(text ? { text } : {}),
        ...(idle !== undefined ? { idleMs: idle } : {}),
        ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
      }
    }
    case 'back':
    case 'forward':
    case 'reload':
      return { kind }
    default:
      return `unknown kind ${kind}`
  }
}
