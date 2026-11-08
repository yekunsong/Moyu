// Browser provider: a thin typed client over the bridge protocol.
import { fetchJson } from '../../engine/adapter'
import type { Ops } from '../../engine/ops'
import { Supervisor } from '../../engine/supervisor'
import type {
  Action,
  ActContext,
  ActResult,
  Capabilities,
  Frame,
  FramePoll,
  Provider,
  ProviderMeta,
  Snapshot,
  SnapshotRequest,
} from './contract'

const CAPS: Capabilities = {
  pointer: true,
  keys: true,
  scroll: true,
  images: true,
  text: true,
  minCols: 48,
  minRows: 10,
}

export class BrowserProvider implements Provider {
  readonly meta: ProviderMeta = {
    id: 'browser',
    label: 'Browser',
    capabilities: CAPS,
    allowSchemes: ['http:', 'https:'],
    defaultWidth: 100,
  }

  readonly supervisor: Supervisor

  constructor(private readonly ops: Ops) {
    this.supervisor = new Supervisor(ops)
  }

  async start(options?: { attachPort?: number }): Promise<void> {
    await this.supervisor.ensure(options)
  }

  async stop(): Promise<void> {
    await this.supervisor.stop()
  }

  async health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }> {
    const endpoint = this.supervisor.endpoint
    if (!endpoint) return { ok: false, error: 'browser not started' }
    try {
      const health = await fetchJson<{ ok: boolean; url?: string; title?: string; error?: string | null }>(
        this.ops,
        `${endpoint.url}/health`,
        endpoint.token,
      )
      return health
    } catch (error) {
      return { ok: false, error: String((error as Error).message ?? error) }
    }
  }

  async snapshot(request: SnapshotRequest): Promise<Snapshot> {
    const endpoint = await this.supervisor.ensure()
    const snapshot = await fetchJson<Snapshot>(this.ops, `${endpoint.url}/snapshot`, endpoint.token, {
      method: 'POST',
      body: request,
    })
    snapshot.viewport.cols = request.cols
    snapshot.viewport.rows = request.rows
    return snapshot
  }

  async act(action: Action, context: ActContext): Promise<ActResult> {
    const endpoint = await this.supervisor.ensure()
    try {
      const result = await fetchJson<ActResult>(this.ops, `${endpoint.url}/act`, endpoint.token, {
        method: 'POST',
        body: action,
      })
      return result
    } catch (error) {
      const message = String((error as Error).message ?? error)
      const stale = /stale/i.test(message)
      return { ok: false, stale, message }
    }
  }

  async screenshot(cols: number, rows: number): Promise<{ pngBase64: string; cols: number; rows: number }> {
    const endpoint = await this.supervisor.ensure()
    return await fetchJson(this.ops, `${endpoint.url}/shot`, endpoint.token, {
      method: 'POST',
      body: { cols, rows },
    })
  }

  async raster(cols: number, rows: number): Promise<{ cells: string; columns: number; rows: number }> {
    const endpoint = await this.supervisor.ensure()
    return await fetchJson(this.ops, `${endpoint.url}/raster`, endpoint.token, {
      method: 'POST',
      body: { cols, rows },
    })
  }

  async frame(cols: number, rows: number, detail = 2): Promise<Frame> {
    const endpoint = await this.supervisor.ensure()
    return await fetchJson<Frame>(this.ops, `${endpoint.url}/frame`, endpoint.token, {
      method: 'POST',
      body: { cols, rows, detail },
    })
  }

  async latestFrame(since: number): Promise<FramePoll> {
    const endpoint = await this.supervisor.ensure()
    const at = Math.max(0, Math.floor(Number(since) || 0))
    return await fetchJson<FramePoll>(this.ops, `${endpoint.url}/frame?since=${at}`, endpoint.token)
  }

  async stopFrame(): Promise<void> {
    // Never start a bridge just to undo a mode it did not enter.
    if (this.supervisor.phase !== 'ready') return
    const endpoint = await this.supervisor.ensure()
    await fetchJson(this.ops, `${endpoint.url}/frame/stop`, endpoint.token, { method: 'POST', body: {} })
  }

  async navigate(url: string): Promise<ActResult> {
    return await this.act({ kind: 'navigate', url }, { actor: 'model' })
  }
}
