// Boss key: the pane's visibility, and the one session theme it borrows while
// shown. The default is "auto": nothing is set, so the pane paints with the
// person's own theme keys and looks like the rest of the session. A preset is
// opt-in and is cleared only when this plugin applied it.
import type { EngineInterface, PaneOpenArgs, ThemeColors } from 'claude-code'

import type { Ops } from '../engine/ops'

export const PANE = 'moyu'

export const THEME_NAMES = ['auto', 'mono', 'paper', 'ink'] as const
export type ThemeName = (typeof THEME_NAMES)[number]

// Greys like CLI output; warm sepia; and a light page. Only used when named.
const PRESETS: Record<Exclude<ThemeName, 'auto'>, ThemeColors> = {
  mono: {
    v: 1,
    label: 'mono',
    inputs: {
      dark: { text: '#c9c9c9', subtle: '#7d7d7d', claude: '#c9955f', promptBorder: '#4d4d4d', inactive: '#6a6a6a' },
      light: { text: '#2b2b2b', subtle: '#6b6b6b', claude: '#a8663a', promptBorder: '#b0b0b0', inactive: '#8a8a8a' },
    },
  },
  paper: {
    v: 1,
    label: 'paper',
    inputs: {
      dark: { text: '#dccbaa', subtle: '#a08d6d', claude: '#c99a5e', promptBorder: '#5d4f3a', inactive: '#8d7c60' },
      light: { text: '#43351f', subtle: '#7a684d', claude: '#9a6b32', promptBorder: '#c8b48d', inactive: '#9c8a6b' },
    },
  },
  ink: {
    v: 1,
    label: 'ink',
    inputs: {
      dark: { text: '#e2e2e2', subtle: '#9a9a9a', claude: '#7aa7c7', promptBorder: '#5a5a5a', inactive: '#707070' },
      light: { text: '#1b1b1b', subtle: '#5a5a5a', claude: '#2f6f8f', promptBorder: '#9a9a9a', inactive: '#7a7a7a' },
    },
  },
}

// The pane opens focused (a request; the prompt may refuse), Escape closes it
// as a person's close, and the body stays transparent so it reads as output.
const OPEN: Omit<PaneOpenArgs, 'title'> = {
  id: PANE,
  rows: 24,
  columns: 100,
  focus: true,
  closeOnEscape: true,
  backgroundColor: 'transparent',
}

let hidden = true
let theme: ThemeName = 'auto'
/** Whether this plugin set a session theme that still stands. */
let applied = false
let autoTimer: { cancel: () => void } | undefined
/** Bumped by show/hide so an awaited close never lands on a newer pane. */
let epoch = 0

export function isHidden(): boolean {
  return hidden
}

export function themeName(): ThemeName {
  return theme
}

/** Set the preset by name; false for an unknown name. */
export function setThemeName(name: string): boolean {
  if (!(THEME_NAMES as readonly string[]).includes(name)) return false
  theme = name as ThemeName
  return true
}

async function applyTheme($: EngineInterface): Promise<void> {
  if (theme === 'auto') return
  try {
    await $.theme.set({ colors: PRESETS[theme] })
    applied = true
  } catch {
    /* the pane still reads with the app's own colors */
  }
}

async function clearTheme($: EngineInterface): Promise<void> {
  if (!applied) return
  applied = false
  try {
    // One theme stands for the session; a clear is the session's.
    await $.theme.clear()
  } catch {
    /* nothing to clear */
  }
}

async function openPane(ops: Ops, title: string): Promise<void> {
  try {
    const opened = await ops.openPane({ ...OPEN, title })
    if (!opened.isPlaced) ops.status(`moyu: pane waits for a wider terminal (${opened.reason ?? 'not placed'})`)
  } catch (error) {
    ops.status(`moyu: pane failed to open (${String((error as Error).message ?? error)})`)
  }
}

/** Show the pane, focus it and take the theme if a preset was chosen. */
export async function show($: EngineInterface, ops: Ops): Promise<void> {
  epoch += 1
  const wasHidden = hidden
  hidden = false
  if (!wasHidden) {
    await openPane(ops, 'moyu')
    return
  }
  await applyTheme($)
  await openPane(ops, 'moyu')
}

/**
 * Hide the pane at once and drop the theme this plugin set. `keepPane` is for
 * a close that is already under way (the `ui.close` hook): never close twice.
 */
export async function hide($: EngineInterface, ops: Ops, options: { keepPane?: boolean } = {}): Promise<void> {
  cancelAutoHide()
  const wasHidden = hidden
  const at = ++epoch
  hidden = true
  if (!options.keepPane && !wasHidden) {
    try {
      // Close first: the pane disappears before any theme work.
      await ops.closePane(PANE)
    } catch {
      /* the session may already be gone */
    }
  }
  // A show that landed during the close keeps its pane and its theme.
  if (hidden && epoch === at) await clearTheme($)
}

export async function toggle($: EngineInterface, ops: Ops): Promise<void> {
  if (hidden) await show($, ops)
  else await hide($, ops)
}

/** Apply a preset change now, or drop a preset when `auto` is picked. */
export async function refreshTheme($: EngineInterface): Promise<void> {
  if (hidden) return
  if (theme === 'auto') await clearTheme($)
  else await applyTheme($)
}

export function cancelAutoHide(): void {
  autoTimer?.cancel()
  autoTimer = undefined
}

/** Hide after `seconds` of quiet; any key or turn re-arms it. */
export function armAutoHide($: EngineInterface, ops: Ops, seconds: number): void {
  cancelAutoHide()
  if (seconds <= 0 || hidden) return
  autoTimer = ops.after(seconds * 1000, () => {
    autoTimer = undefined
    void hide($, ops)
  })
}
