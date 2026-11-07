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
