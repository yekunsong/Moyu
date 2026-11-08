import type { Ops } from '../engine/ops'
import type { Capabilities } from '../engine/provider'

export type Degradation = {
  mode: 'full' | 'text' | 'summary'
  pointer: boolean
  keys: boolean
  scroll: boolean
  images: boolean
  navigation: boolean
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
      navigation: false,
      reason: `pane too small (${cols}x${rows}, needs ${caps.minCols}x${caps.minRows})`,
    }
  }
  const images = caps.images && !isTmux
  return { mode: 'text', pointer: caps.pointer, keys: caps.keys, scroll: caps.scroll, images, navigation: caps.navigation }
}

export function detectTmux(): boolean {
  // The module environment has no process; a provider may pass its own probe.
  return false
}

export type ImageTier = {
  supported: boolean
  /** How frames reach the terminal: a PNG path it reads, or inline bytes. */
  source: 'file' | 'png'
  reason: string
}

const IMAGE_PROGRAMS = new Set(['wezterm', 'ghostty', 'kitty'])
const TMUX_OPTIONS = '`set -g allow-passthrough on` and `set -g focus-events on`'

/** Whether this terminal (term + program names, lowercased) reads a PNG path. */
function fileProgram(termName: string, programName: string): boolean {
  return termName.includes('kitty') || termName.includes('ghostty') || termName.includes('wezterm') || IMAGE_PROGRAMS.has(programName)
}

/** Whether this program can show inline PNG bytes (iTerm2 3.5+). */
function inlineProgram(termName: string, programName: string): boolean {
  return programName === 'iterm.app' || termName.includes('iterm')
}

/**
 * Whether this terminal can draw an `Image`, and how.
 *
 * File source: kitty, Ghostty and WezTerm read a PNG path themselves; tmux
 * blocks that protocol, so inside tmux only inline bytes are offered. Inline
 * PNG: iTerm2 3.5+, and tmux when the outer program is one of those four (the
 * person opts in by enabling tmux passthrough and focus events). Windows
 * Terminal and unknown terminals stay on the text tier. The env names are read
 * by the `Ops` literal, so the validator sees each string at its call site.
 */
export async function detectImageTier(ops: Ops): Promise<ImageTier> {
  const [term, program, wt, tmux] = await Promise.all([
    ops.env.term(),
    ops.env.termProgram(),
    ops.env.wtSession(),
    ops.env.tmux(),
  ])
  const termName = (term ?? '').toLowerCase()
  const programName = (program ?? '').toLowerCase()
  if (tmux) {
    // tmux cannot be probed without a process; keep the name it inherits.
    if (fileProgram(termName, programName) || inlineProgram(termName, programName)) {
      return {
        supported: true,
        source: 'png',
        reason: `tmux inline images need ${TMUX_OPTIONS}`,
      }
    }
    return {
      supported: false,
      source: 'png',
      reason: `tmux needs the outer terminal to be kitty, Ghostty, WezTerm or iTerm2 3.5+, with ${TMUX_OPTIONS}`,
    }
  }
  if (wt) {
    return { supported: false, source: 'file', reason: 'Windows Terminal cannot draw images; kitty, Ghostty, WezTerm or iTerm2 3.5+ is required' }
  }
  if (fileProgram(termName, programName)) {
    return { supported: true, source: 'file', reason: '' }
  }
  if (inlineProgram(termName, programName)) {
    return { supported: true, source: 'png', reason: '' }
  }
  const named = program || term
  return {
    supported: false,
    source: 'file',
    reason: named
      ? `terminal "${named}" cannot draw images; kitty, Ghostty, WezTerm or iTerm2 3.5+ is required`
      : 'unknown terminal; kitty, Ghostty, WezTerm or iTerm2 3.5+ is required',
  }
}
