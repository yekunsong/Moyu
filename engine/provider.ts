export type Capabilities = {
  pointer: boolean
  keys: boolean
  scroll: boolean
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
  interactive?: boolean
  /** A provider-specific target, e.g. the real path of a library entry. */
  value?: string
  state?: {
    selected?: boolean
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

/** What both a person and the model may ask a provider to do. */
export type Action =
  | { kind: 'click'; ref: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; dx: number; dy: number }
  /** A provider-specific verb with its own arguments; the novel is all commands. */
  | { kind: 'command'; name: string; args?: Record<string, unknown> }

export type ActResult = {
  ok: boolean
  changed?: boolean
  stale?: boolean
  message: string
  url?: string
  /** A provider's textual answer, e.g. find results. */
  text?: string
}

/** A provider may own a supervised process; the hub attaches lifecycle listeners. */
export type ProviderSupervisor = {
  onFatal(fn: (reason?: string) => void): void
  onIdle(fn: () => void): void
}

export type ProviderStartOptions = {
  attachPort?: number
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
  /** Present only for providers that own a child process. */
  readonly supervisor?: ProviderSupervisor
  start(options?: ProviderStartOptions): Promise<void>
  stop(): Promise<void>
  health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }>
  /** Open a provider-specific path; the novel provider opens its library. */
  open?(path: string): Promise<ActResult>
  snapshot(request: SnapshotRequest): Promise<Snapshot>
  act(action: Action, context: ActContext): Promise<ActResult>
}
