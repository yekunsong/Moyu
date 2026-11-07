// Test bottoms: fake the engine nouns the plugin calls. The kit has no
// network/process, so the bridge protocol is an in-memory page here.
//
// Every test gets its own `on`, and every hook here closes over that test's
// page: nothing is shared across tests.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export type FakePage = {
  url: string
  title: string
  count: number
  fills: Record<string, string>
}

export type Bottom = {
  page: FakePage
  asks: string[]
  fetches: string[]
  answerAsk: (answer: string | undefined) => void
}

export function installBottom(on: On): Bottom {
  const page: FakePage = { url: 'http://127.0.0.1:1/', title: 'Demo page', count: 0, fills: {} }
  const asks: string[] = []
  const fetches: string[] = []
  let askAnswer: string | undefined = 'Allow'

  mock.clock(on)
  mock.store(on)
  const states = new Map<string, unknown>()

  const value = <T,>(v: T) => ({ value: v }) as never

  on('session.start', { isInteractive: true }, ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  on('tool.register', ((_$: unknown, e: { name: string }) => value({ tool: `mcp__transom__${e.name}` })) as never)
  on('command.register', (() => value({ command: 'transom' })) as never)
  on('ui.log', (() => value(undefined)) as never)
  on('ui.status', (() => value(undefined)) as never)
  on('ui.toast', (() => value(undefined)) as never)
  on('ui.open', (() => value({ isPlaced: true })) as never)
  on('ui.close', (() => value({})) as never)

  on('tool.call', { tool: 'AskUserQuestion' }, ((_$: unknown, e: { questions: Array<{ question: string }> }) => {
    const question = e.questions?.[0]?.question ?? ''
    asks.push(question)
    return { result: { questions: e.questions, answers: { [question]: askAnswer } } }
  }) as never)

  on('state.get', ((_$: unknown, e: { plugin: string; key: string; id?: string }) => {
    const key = `${e.plugin}/${e.key}${e.id ? `#${e.id}` : ''}`
    return value({ value: states.get(key), version: 1 })
  }) as never)
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; id?: string; value: unknown }) => {
    const key = `${e.plugin}/${e.key}${e.id ? `#${e.id}` : ''}`
    states.set(key, e.value)
    return value({ isSet: true, version: 2 })
  }) as never)

  on('process.spawn', (async function* () {
    yield { stream: 'stdout', text: '{"ready":true,"port":1}\n' }
    await new Promise<void>(() => {})
  }) as never)

  on('http.fetch', (async (_$: unknown, e: { url: string; init?: { method?: string; body?: string } }) => {
    const init = e.init ?? {}
    fetches.push(`${init.method ?? 'GET'} ${e.url}`)
    const path = new URL(e.url).pathname
    const body = init.body ? JSON.parse(init.body) : {}
    if (path === '/health') {
      return value({ status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, url: page.url, title: page.title }) })
    }
    if (path === '/snapshot') {
      const text = JSON.stringify({
        url: page.url,
        title: page.title,
        capturedAt: Date.now(),
        viewport: { cols: 110, rows: 34, scrollX: 0, scrollY: 0, width: 880, height: 544, docWidth: 880, docHeight: 600 },
        landmarks: [{ role: 'heading', name: page.title }],
        nodes: [
          { ref: 't1', role: 'button', name: 'Increase count', depth: 1, interactive: true, bounds: { x: 0, y: 0, w: 10, h: 2 } },
          { ref: 't2', role: 'textbox', name: 'Email', depth: 1, interactive: true, value: page.fills['t2'] ?? '', bounds: { x: 0, y: 2, w: 10, h: 2 } },
          { ref: 't3', role: 'text', name: `count ${page.count}`, depth: 1, bounds: { x: 0, y: 4, w: 10, h: 1 } },
        ],
        truncated: { nodes: 0, chars: 0, scope: 'viewport' },
      })
      return value({ status: 200, ok: true, headers: {}, text })
    }
    if (path === '/act') {
      if (body.kind === 'click' && body.ref === 't1') page.count += 1
      if (body.kind === 'fill') page.fills[body.ref] = body.text
      if (body.kind === 'navigate') page.url = body.url
      return value({ status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, changed: true, message: `did ${body.kind}` }) })
    }
    if (path === '/stop') return value({ status: 200, ok: true, headers: {}, text: '{"ok":true}' })
    return value({ status: 404, ok: false, headers: {}, text: '{"error":"no route"}' })
  }) as never)

  return {
    page,
    asks,
    fetches,
    answerAsk: answer => {
      askAnswer = answer
    },
  }
}
