export type Capabilities = {
  pointer: boolean
  keys: boolean
  scroll: boolean
  images: boolean
  text: boolean
  minCols: number
  minRows: number
}

export type SnapshotRequest = {
  scope: 'viewport' | 'document'
  maxChars: number
  cols: number
  rows: number
}

export type SnapshotNode = {
  ref: string
  role: string
  name: string
  depth: number
  value?: string
  href?: string
  options?: Array<{ value: string; label: string; selected?: boolean }>
  invalid?: boolean
  interactive?: boolean
  submits?: boolean
  state?: {
    disabled?: true
    checked?: boolean
    expanded?: boolean
    selected?: boolean
    focused?: true
  }
  bounds: { x: number; y: number; w: number; h: number }
}

export type Snapshot = {
  url: string
  title: string
  capturedAt: number
  viewport: {
    cols: number
    rows: number
    scrollX: number
    scrollY: number
    width: number
    height: number
    docWidth: number
    docHeight: number
  }
  landmarks: Array<{ role: string; name: string; ref?: string }>
  nodes: SnapshotNode[]
  truncated: { nodes: number; chars: number; scope: 'viewport' | 'document' }
}

export type Action =
  | { kind: 'click'; ref: string }
  | { kind: 'fill'; ref: string; text: string }
  | { kind: 'select'; ref: string; value: string }
  | { kind: 'focus'; ref: string }
  | { kind: 'hover'; ref: string }
  | { kind: 'press'; key: string; modifiers?: number }
  | { kind: 'scroll'; dx: number; dy: number }
  | { kind: 'clickAt'; x: number; y: number }
  | { kind: 'navigate'; url: string }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'reload' }

export type ActResult = {
  ok: boolean
  changed?: boolean
  stale?: boolean
  message: string
  url?: string
}

export type Frame = {
  /** Absolute path of a PNG the terminal reads itself. */
  file: string
  /** Increases with every capture; the same path may hold new bytes. */
  generation: number
  columns: number
  rows: number
  /** The capture's CSS pixel size (the terminal scales it to the cell box). */
  pageWidth: number
  pageHeight: number
}

export type ActContext = {
  actor: 'person' | 'model'
  signal?: AbortSignal
}

export type ProviderMeta = {
  id: string
  label: string
  capabilities: Capabilities
  allowSchemes: string[]
  defaultWidth: number
}

export type Provider = {
  readonly meta: ProviderMeta
  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }>
  snapshot(request: SnapshotRequest): Promise<Snapshot>
  act(action: Action, context: ActContext): Promise<ActResult>
  screenshot(cols: number, rows: number): Promise<{ pngBase64: string; cols: number; rows: number }>
  raster(cols: number, rows: number): Promise<{ cells: string; columns: number; rows: number }>
  /** A real-pixel PNG on disk, for terminals that can draw a file source. */
  frame?(cols: number, rows: number): Promise<Frame>
}
