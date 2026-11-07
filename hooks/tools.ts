import type { EngineInterface, On } from 'claude-code'

import type { Action } from '../providers/browser/contract'
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
  return { result: { content: [{ type: 'text', text }] }, text }
}

function fail(text: string): ToolOutput {
  return { result: { content: [{ type: 'text', text }] }, text, isError: true }
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
  },
}

const ACT_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['click', 'fill', 'select', 'press', 'scroll', 'hover', 'focus', 'navigate', 'back', 'forward', 'reload'],
    },
    ref: { type: 'string', description: 'Node ref from the latest snapshot, e.g. "t12".' },
    text: { type: 'string', description: 'Text for fill.' },
    value: { type: 'string', description: 'Option value for select.' },
    key: { type: 'string', description: 'Key for press: Enter, Tab, Escape, arrows, PageDown, or a character.' },
    dx: { type: 'number', description: 'Horizontal scroll wheel clicks for scroll.' },
    dy: { type: 'number', description: 'Vertical scroll wheel clicks for scroll.' },
    url: { type: 'string', description: 'Target for navigate.' },
  },
  required: ['kind'],
}

export async function registerToolSpecs($: EngineInterface): Promise<void> {
    await $.tool.register({
      name: 'browser_open',
      description:
        'Open the Transom browser pane at a URL. Starts the local headless browser on first use. Prefer this before browser_snapshot.',
      inputSchema: OPEN_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'browser_snapshot',
      description:
        'Return a structured snapshot of the page: URL, title, landmarks and ref-tagged nodes (role, name, value, state). Refs are valid until the next snapshot or navigation. Use viewport scope unless you need the whole page.',
      inputSchema: SNAPSHOT_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'browser_act',
      description:
        'Perform one action on the page by ref: click, fill, select, press, scroll, hover, focus, navigate, back, forward, reload. Returns the action result and an audit id. Retake the snapshot after stale-ref errors.',
      inputSchema: ACT_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'browser_screenshot',
      description: 'Capture the visible page as a PNG image (visual check; slower than a snapshot).',
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
  })

  on('tool.call', { tool: 'mcp__transom__browser_snapshot' }, async (_$, e) => {
    const scope = (e as unknown as { scope?: 'viewport' | 'document' }).scope
    if (hub().view.status === 'closed') return fail('No page is open. Call browser_open first.')
    const { text, auditId } = await hub().modelSnapshot(scope === 'document' ? 'document' : 'viewport')
    return answer(`${text}\n\naudit ${auditId}`)
  })

  on('tool.call', { tool: 'mcp__transom__browser_act' }, async (_$, e) => {
    const action = toAction(e as unknown as Record<string, unknown>)
    if (typeof action === 'string') return fail(action)
    if (hub().view.status === 'closed') return fail('No page is open. Call browser_open first.')
    const { result, auditId, denied } = await hub().act(action, 'model')
    const header = result.ok ? 'ok' : denied ? 'denied' : 'failed'
    return answer(`${header}: ${result.message}\naudit ${auditId}`)
  })

  on('tool.call', { tool: 'mcp__transom__browser_screenshot' }, async (_$, e) => {
    const input = e as unknown as { cols?: number; rows?: number }
    if (hub().view.status === 'closed') return fail('No page is open. Call browser_open first.')
    try {
      const shot = await hub().provider.screenshot(input.cols ?? 110, input.rows ?? 34)
      const entry = await hub().audit.log({
        actor: 'model', provider: 'browser', action: 'screenshot', url: hub().view.url,
        policy: 'read-only', ok: true, message: `${shot.cols}x${shot.rows}`,
      })
      return {
        result: {
          content: [
            { type: 'text', text: `screenshot ${shot.cols}x${shot.rows}, audit ${entry.id}` },
            { type: 'image', data: shot.pngBase64, mimeType: 'image/png' },
          ],
        },
        text: `screenshot ${shot.cols}x${shot.rows}, audit ${entry.id}`,
      }
    } catch (error) {
      return fail(String((error as Error).message ?? error))
    }
  })

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
  })
}

function toAction(input: Record<string, unknown>): Action | string {
  const kind = String(input.kind ?? '')
  const ref = input.ref === undefined ? undefined : String(input.ref)
  switch (kind) {
    case 'click':
      return ref ? { kind, ref } : 'ref is required for click'
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
    case 'back':
    case 'forward':
    case 'reload':
      return { kind }
    default:
      return `unknown kind ${kind}`
  }
}
