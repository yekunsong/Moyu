export type ViewRow = {
  ref: string
  role: string
  label: string
  value?: string
  flags?: string
  submits?: boolean
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
  mode: 'text' | 'visual'
}

declare module 'claude-code' {
  interface PluginState {
    transom: {
      view: TransomView
    }
  }
}
