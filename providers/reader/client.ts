// Read-only provider: fetch a document with `ops.fetch`, parse it and serve a
// text snapshot. No process, no DOM: only the plugin's own HTTP capability.
import type { Ops } from '../../engine/ops'
import type {
  Action,
  ActContext,
  ActResult,
  Capabilities,
  Provider,
  ProviderMeta,
  Snapshot,
  SnapshotNode,
  SnapshotRequest,
} from '../../engine/provider'
import { parseDocument, type ParsedDocument } from './parse'

/** Bodies beyond this are parsed truncated; the cap keeps memory bounded. */
export const READER_MAX_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 10_000

const CAPS: Capabilities = {
  pointer: false,
  keys: false,
  scroll: false,
  images: false,
  text: true,
  navigation: true,
  minCols: 20,
  minRows: 5,
}

export class ReaderProvider implements Provider {
  readonly meta: ProviderMeta = {
    id: 'reader',
    label: 'Reader',
    capabilities: CAPS,
    allowSchemes: ['http:', 'https:'],
    defaultWidth: 100,
  }

  #url = ''
  #title = ''
  #lastError: string | null = null
  #history: string[] = []
  #index = -1
  #documents = new Map<string, ParsedDocument>()

  constructor(private readonly ops: Ops) {}

  async start(): Promise<void> {
    /* no process to start */
  }

  async stop(): Promise<void> {
    /* nothing owns a process; the cache is cheap to keep */
  }

  async health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }> {
    return { ok: this.#lastError === null, url: this.#url, title: this.#title, error: this.#lastError }
  }

  async snapshot(request: SnapshotRequest): Promise<Snapshot> {
    if (!this.#url) throw new Error('reader: no URL; navigate first')
    const document = this.#documents.get(this.#url) ?? (await this.#fetch(this.#url))
    return this.#build(document, request)
  }

  async act(action: Action, _context: ActContext): Promise<ActResult> {
    switch (action.kind) {
      case 'navigate':
        return await this.#navigate(action.url)
      case 'back':
        return await this.#move(-1)
      case 'forward':
        return await this.#move(1)
      case 'reload':
        return this.#url ? await this.#retrieve(this.#url) : { ok: false, message: 'reader: nothing to reload' }
      default:
        return { ok: false, message: `the reader is text-only: ${action.kind} is not supported` }
    }
  }

  async #navigate(url: string): Promise<ActResult> {
    const previousIndex = this.#index
    const previousLength = this.#history.length
    if (url !== this.#url) {
      this.#history.splice(this.#index + 1)
      this.#history.push(url)
      this.#index = this.#history.length - 1
    }
    const result = await this.#retrieve(url)
    if (!result.ok) {
      this.#history.length = previousLength
      this.#index = previousIndex
    }
    return result
  }

  async #move(delta: number): Promise<ActResult> {
    const next = this.#history[this.#index + delta]
    if (!next) return { ok: false, message: `reader: no history ${delta < 0 ? 'before' : 'after'} this page` }
    const previousIndex = this.#index
    this.#index += delta
    const result = await this.#retrieve(next)
    if (!result.ok) this.#index = previousIndex
    return result
  }

  async #retrieve(url: string): Promise<ActResult> {
    try {
      // A navigation always refetches, even when this URL was read before.
      this.#documents.delete(url)
      const document = await this.#fetch(url)
      this.#url = url
      return {
        ok: true,
        changed: true,
        message: `read ${this.#title || url} (${document.nodes.length} nodes)`,
        url,
      }
    } catch (error) {
      return { ok: false, message: this.#error(error) }
    }
  }

  async #fetch(url: string): Promise<ParsedDocument> {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw new Error(`not a URL: ${url}`)
    }
    if (!this.meta.allowSchemes.includes(parsedUrl.protocol)) {
      throw new Error(`scheme ${parsedUrl.protocol} is not allowed by the reader`)
    }
    const cached = this.#documents.get(url)
    if (cached) return cached
    let timer: { cancel(): void } | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = this.ops.after(FETCH_TIMEOUT_MS, () => reject(new Error('reader: fetch timed out after 10 s')))
    })
    try {
      const response = await Promise.race([this.ops.fetch(url), timeout])
      if (!response.ok) throw new Error(`reader: HTTP ${response.status}`)
      const html = response.text.slice(0, READER_MAX_BYTES)
      const document = parseDocument(html, url)
      this.#documents.set(url, document)
      this.#title = document.title
      this.#lastError = null
      return document
    } catch (error) {
      throw new Error(this.#error(error))
    } finally {
      timer?.cancel()
    }
  }

  #error(error: unknown): string {
    const message = String((error as Error).message ?? error)
    this.#lastError = message.slice(0, 300)
    return this.#lastError
  }

  #build(document: ParsedDocument, request: SnapshotRequest): Snapshot {
    const cols = Math.max(1, request.cols)
    const rows = Math.max(1, request.rows)
    const nodes: SnapshotNode[] = []
    let used = 0
    for (const node of document.nodes) {
      const cost = node.name.length + 1
      if (used + cost > request.maxChars) break
      used += cost
      nodes.push({
        ...node,
        value: node.value,
        bounds: { x: 0, y: nodes.length, w: 1, h: 1 },
      })
    }
    return {
      url: this.#url,
      title: document.title,
      capturedAt: Date.now(),
      viewport: {
        cols,
        rows,
        scrollX: 0,
        scrollY: 0,
        width: cols * 8,
        height: rows * 16,
        docWidth: cols * 8,
        docHeight: Math.max(rows, nodes.length),
      },
      landmarks: document.landmarks,
      nodes,
      truncated: {
        nodes: document.nodes.length - nodes.length,
        chars: used,
        scope: request.scope,
      },
    }
  }
}
