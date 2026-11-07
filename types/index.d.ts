export type ViewRow = {
  ref: string
  role: string
  label: string
  value?: string
  href?: string
  options?: Array<{ value: string; label: string; selected?: boolean }>
  invalid?: boolean
  /** Validation text shown under an invalid row. */
  error?: string
  flags?: string
  submits?: boolean
  /** The section a row belongs to; a `role: 'section'` row is the heading itself. */
  section?: string
  /** Document depth, used for the pane's indent (capped when drawn). */
  depth?: number
}

export type TransomView = {
  status: 'closed' | 'starting' | 'ready' | 'error'
  url: string
  title: string
  error?: string
  rows: ViewRow[]
  truncated: number
  last?: string
  audit: string[]
  scope: 'viewport' | 'document'
  mode: 'text' | 'visual' | 'image'
}

declare module 'claude-code' {
  interface PluginState {
    transom: {
      view: TransomView
    }
  }
}
