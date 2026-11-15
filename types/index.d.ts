export type ViewRow = {
  ref: string
  role: string
  label: string
  /** A provider-specific target, e.g. a library file's real path. */
  value?: string
  /** The paragraph the person clicked, drawn as selected. */
  selected?: boolean
}

export type MoyuView = {
  status: 'closed' | 'starting' | 'ready' | 'error'
  /** The open file or directory. */
  path: string
  title: string
  error?: string
  rows: ViewRow[]
  truncated: number
  last?: string
  audit: string[]
  scope: 'viewport' | 'document'
  /** How far through the document the page starts, 0 to 100. */
  percent: number
}

declare module 'claude-code' {
  interface PluginState {
    moyu: {
      view: MoyuView
    }
  }
}
