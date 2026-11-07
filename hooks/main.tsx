import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const PANE = 'transom-probe'
const probe = atom(
  { plugin: 'transom', key: 'probe' } as const,
  { last: '(no events yet)', ticks: 0, lines: [] as string[] },
)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'transom',
      description: 'Open the Transom probe pane (pointer, keys, child process stream)',
    })
    void update($, probe, s => ({ ...s, ticks: 0 }))
    return next(e)
  })

  on('command.run', { command: 'transom' }, async $ => {
    const opened = await $.ui.open({
      id: PANE,
      title: 'Transom probe',
      focus: true,
      closeOnEscape: true,
      rows: 20,
      columns: 110,
    })
    if (opened.isPlaced) void startEcho($)
    return { text: opened.isPlaced ? 'Probe pane opened.' : `Not placed: ${opened.reason}` }
  })

  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data as { type?: string; x?: number; y?: number; key?: string }
    const x = typeof data.x === 'number' ? Math.round(data.x * 10) / 10 : '?'
    const y = typeof data.y === 'number' ? Math.round(data.y * 10) / 10 : '?'
    await update($, probe, s => ({
      ...s,
      last:
        data.type === 'key'
          ? `key ${JSON.stringify(data.key)}`
          : `${data.type ?? 'message'} @ ${x},${y}`,
    }))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Client } = $.ui.resolve(e)
    const state = await read($, probe)
    const bodyRows = e.viewport?.rows ?? 24

    return (
      <Box flexDirection="column" width="100%" height="100%">
        <Text bold>Transom M0 probe — {state.last}</Text>
        <Text dimColor>
          ticks {state.ticks} · child output {state.lines.length} lines
        </Text>
        <Box flexGrow={1} width="100%">
          <Client
            key="probe-client"
            module="../providers/browser/probe.tsx"
            props={{ ticks: state.ticks }}
            width="100%"
            height={Math.max(3, bodyRows - 4)}
          />
        </Box>
        <Text dimColor>{state.lines.slice(-2).join(' | ') || '(spawn idle)'}</Text>
      </Box>
    )
  })
}

async function startEcho($: EngineInterface): Promise<void> {
  const stream = $.process.spawn({ argv: ['node', 'bridge/echo.mjs'] })
  const timer = $.clock.every(1000, () => {
    void update($, probe, s => ({ ...s, ticks: s.ticks + 1 }))
  })
  try {
    for await (const chunk of stream) {
      const line = chunk.text.trim()
      if (line === '') continue
      await update($, probe, s => ({ ...s, lines: [...s.lines, line].slice(-8) }))
    }
  } finally {
    timer.cancel()
  }
}
