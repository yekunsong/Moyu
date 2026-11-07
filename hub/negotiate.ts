import type { Ops } from '../engine/ops'
import type { Capabilities } from '../providers/browser/contract'

export type Degradation = {
  mode: 'full' | 'text' | 'summary'
  pointer: boolean
  keys: boolean
  scroll: boolean
  images: boolean
  reason?: string
}

export function negotiate(caps: Capabilities, cols: number, rows: number, isTmux: boolean): Degradation {
  if (cols < caps.minCols || rows < caps.minRows) {
    return {
      mode: 'summary',
      pointer: false,
      keys: false,
      scroll: false,
      images: false,
      reason: `pane too small (${cols}x${rows}, needs ${caps.minCols}x${caps.minRows})`,
    }
  }
  const images = caps.images && !isTmux
  return { mode: 'text', pointer: caps.pointer, keys: caps.keys, scroll: caps.scroll, images }
}

export function detectTmux(): boolean {
  // The module environment has no process; a provider may pass its own probe.
  return false
}

export type ImageTier = {
  supported: boolean
  reason: string
}

const IMAGE_PROGRAMS = new Set(['wezterm', 'ghostty', 'kitty'])

/**
 * Whether this terminal can draw an `Image` from a file source.
 *
 * B1 supports only terminals that read a PNG path themselves: kitty, Ghostty
 * and WezTerm. iTerm2 needs inline bytes (planned for B2), and tmux and
 * Windows Terminal cannot show the picture at all. The env names are read by
 * the `Ops` literal, so the validator sees each string at its call site.
 */
export async function detectImageTier(ops: Ops): Promise<ImageTier> {
  const [term, program, wt, tmux] = await Promise.all([
    ops.env.term(),
    ops.env.termProgram(),
    ops.env.wtSession(),
    ops.env.tmux(),
  ])
  if (tmux) {
    return { supported: false, reason: 'tmux blocks the terminal image protocol; use a direct terminal for hq' }
  }
  if (wt) {
    return { supported: false, reason: 'Windows Terminal cannot draw images; kitty, Ghostty or WezTerm is required' }
  }
  const termName = (term ?? '').toLowerCase()
  const programName = (program ?? '').toLowerCase()
  if (termName.includes('kitty') || termName.includes('ghostty') || IMAGE_PROGRAMS.has(programName)) {
    return { supported: true, reason: '' }
  }
  if (programName === 'iterm.app' || termName.includes('iterm')) {
    return { supported: false, reason: 'iTerm2 needs an inline image payload, which this version does not send' }
  }
  const named = program || term
  return {
    supported: false,
    reason: named
      ? `terminal "${named}" cannot draw images; kitty, Ghostty or WezTerm is required`
      : 'unknown terminal; kitty, Ghostty or WezTerm is required',
  }
}
