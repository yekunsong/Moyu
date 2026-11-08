import { expect, test } from 'claude-code/testing'

import type { Ops } from '../engine/ops'
import { detectImageTier } from '../hub/negotiate'

// Only `env` is read by detection; the rest of Ops stays unreachable here.
function ops(env: Record<string, string | undefined>): Ops {
  const read = (name: string) => async () => env[name]
  return {
    env: {
      term: read('TERM'),
      termProgram: read('TERM_PROGRAM'),
      wtSession: read('WT_SESSION'),
      tmux: read('TMUX'),
    },
  } as unknown as Ops
}

test('WezTerm reads a PNG file itself', async () => {
  const tier = await detectImageTier(ops({ TERM_PROGRAM: 'WezTerm' }))
  expect(tier.supported).toBe(true)
  expect(tier.source).toBe('file')
  expect(tier.reason).toBe('')
})

test('kitty in TERM reads a PNG file itself', async () => {
  const tier = await detectImageTier(ops({ TERM: 'xterm-kitty' }))
  expect(tier.supported).toBe(true)
  expect(tier.source).toBe('file')
})

test('Ghostty reads a PNG file itself', async () => {
  const tier = await detectImageTier(ops({ TERM_PROGRAM: 'ghostty' }))
  expect(tier.supported).toBe(true)
  expect(tier.source).toBe('file')
})

test('iTerm2 3.5+ takes inline PNG bytes', async () => {
  const program = await detectImageTier(ops({ TERM_PROGRAM: 'iTerm.app' }))
  expect(program.supported).toBe(true)
  expect(program.source).toBe('png')
  const term = await detectImageTier(ops({ TERM: 'iterm2' }))
  expect(term.supported).toBe(true)
  expect(term.source).toBe('png')
})

test('tmux on iTerm2 offers inline PNG and names the required options', async () => {
  const tier = await detectImageTier(ops({ TERM_PROGRAM: 'iTerm.app', TMUX: '/tmp/tmux-1/default,1,0' }))
  expect(tier.supported).toBe(true)
  expect(tier.source).toBe('png')
  expect(tier.reason).toContain('allow-passthrough')
  expect(tier.reason).toContain('focus-events')
})

test('tmux on kitty, Ghostty and WezTerm offers inline PNG', async () => {
  for (const program of ['kitty', 'ghostty', 'WezTerm']) {
    const tier = await detectImageTier(ops({ TERM_PROGRAM: program, TMUX: '/tmp/tmux-1/default,1,0' }))
    expect(tier.supported, program).toBe(true)
    expect(tier.source, program).toBe('png')
  }
})

test('tmux alone stays on the text tier but still names the options', async () => {
  const tier = await detectImageTier(ops({ TERM: 'screen-256color', TMUX: '/tmp/tmux-1/default,1,0' }))
  expect(tier.supported).toBe(false)
  expect(tier.reason).toContain('allow-passthrough')
  expect(tier.reason).toContain('focus-events')
})

test('tmux blocks the file source even on a file terminal inside tmux', async () => {
  // TERM inside tmux is the multiplexer's; the outer program decides.
  const tier = await detectImageTier(ops({ TERM: 'tmux-256color', TMUX: '/tmp/tmux-1/default,1,0' }))
  expect(tier.supported).toBe(false)
  expect(tier.source).not.toBe('file')
})

test('Windows Terminal stays on the text tier', async () => {
  const tier = await detectImageTier(ops({ WT_SESSION: 'session-1', TERM_PROGRAM: 'Windows_Terminal' }))
  expect(tier.supported).toBe(false)
  expect(tier.reason).toContain('Windows Terminal')
})

test('an unknown terminal stays on the text tier', async () => {
  const tier = await detectImageTier(ops({ TERM: 'xterm-256color' }))
  expect(tier.supported).toBe(false)
  expect(tier.source).toBe('file')
  expect(tier.reason).toContain('xterm-256color')

  const bare = await detectImageTier(ops({}))
  expect(bare.supported).toBe(false)
  expect(bare.reason).toContain('unknown terminal')
})
