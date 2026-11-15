// Novel provider: reads a file library under one root and serves viewport
// pages as snapshot nodes. Text only: no process, no browser, no images.
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
import { listNovels, resolveInsideRoot, type NovelEntry } from './library'
import { pageAt, parseNovel, type Novel, type Page, type PageHint } from './parse'

const CAPS: Capabilities = {
  pointer: true,
  keys: true,
  scroll: true,
  text: true,
  minCols: 20,
  minRows: 5,
}

const ANNOTATION_MAX = 600
const NOTES_PER_PARAGRAPH = 50
const ANNOTATIONS_PER_PAGE = 50
const FIND_LIMIT = 20
const FIND_EXCERPT = 60

const META: ProviderMeta = {
  id: 'novel',
  label: 'Novel',
  capabilities: CAPS,
  allowSchemes: [],
  defaultWidth: 100,
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high))
}

function int(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : fallback
}

type Progress = { chapterIndex: number; offset: number }

export class NovelProvider implements Provider {
  readonly meta = META
  readonly #ops: Ops
  readonly #root: string
  #path = ''
  #title = ''
  #lastError: string | null = null
  #text = ''
  #novel: Novel | undefined
  #chapterIndex = 0
  #offset = 0
  /** The paragraph the person clicked; rendered selected and used by "ask". */
  #selected: number | undefined
  #listing: NovelEntry[] | undefined
  #annotations = new Map<number, string[]>()
  #cols = 100
  #rows = 30
  #maxChars = 8000

  constructor(ops: Ops, root = 'novels') {
    this.#ops = ops
    this.#root = root
  }

  async start(): Promise<void> {
    /* no process to start */
  }

  async stop(): Promise<void> {
    // A close drops the book; reopening reads the saved position back.
    this.#novel = undefined
    this.#listing = undefined
    this.#text = ''
    this.#path = ''
    this.#title = ''
    this.#selected = undefined
    this.#annotations.clear()
    this.#chapterIndex = 0
    this.#offset = 0
    this.#lastError = null
  }

  async health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }> {
    return { ok: this.#lastError === null, url: this.#path, title: this.#title, error: this.#lastError }
  }

  async open(path: string): Promise<ActResult> {
    const resolved = await resolveInsideRoot(this.#ops, this.#root, path)
    if (!resolved.ok) return this.#fail(resolved.message)
    if (resolved.kind === 'dir') {
      try {
        this.#listing = await listNovels(this.#ops, this.#root, resolved.realPath)
      } catch (error) {
        return this.#fail(this.#error(error))
      }
      this.#novel = undefined
      this.#text = ''
      this.#selected = undefined
      this.#annotations.clear()
      this.#path = resolved.realPath
      this.#title = baseName(resolved.realPath)
      this.#lastError = null
      const count = this.#listing.length
      return { ok: true, changed: true, message: count > 0 ? `listing ${count} entries` : 'empty directory' }
    }
    let text: string
    try {
      text = await this.#ops.readText(resolved.realPath)
    } catch (error) {
      return this.#fail(this.#error(error))
    }
    const novel = parseNovel(text)
    const saved = await this.#ops.storeGet(`moyu.progress.${novel.hash}`)
    this.#listing = undefined
    this.#novel = novel
    this.#text = text
    const progress = this.#validProgress(saved, novel)
    this.#annotations.clear()
    this.#path = resolved.realPath
    this.#title = novel.title || baseName(resolved.realPath)
    this.#chapterIndex = progress.chapterIndex
    this.#offset = progress.offset
    this.#selected = undefined
    this.#lastError = null
    // Write the settled position back: a saved offset past the chapter end is
    // clamped here, and the next open should not read the stale one.
    await this.#persist()
    return {
      ok: true,
      changed: true,
      message: `${this.#title} (${novel.chapters.length} chapters)`,
    }
  }

  async snapshot(request: SnapshotRequest): Promise<Snapshot> {
    const cols = Math.max(1, request.cols)
    const rows = Math.max(1, request.rows)
    if (this.#listing) return this.#listingSnapshot(request, cols, rows)
    const novel = this.#novel
    if (!novel) throw new Error('novel: no file open')
    this.#cols = cols
    this.#rows = rows
    this.#maxChars = Math.max(1, request.maxChars)
    const chapter = novel.chapters[this.#chapterIndex]!
    const chapterStart = chapter.paragraphs[0]?.offset ?? chapter.headingOffset
    const page =
      request.scope === 'document'
        ? pageAt(novel, { chapterIndex: this.#chapterIndex, offset: chapterStart }, cols, 1_000_000, request.maxChars)
        : pageAt(novel, this.#progress(), cols, rows, request.maxChars)
    if (request.scope !== 'document') {
      // A snapshot may clamp the position into the chapter; persist whenever
      // the in-memory position moved, so hiding or reloading never loses it.
      if (page.offset !== this.#offset) {
        this.#offset = page.offset
        await this.#persist()
      }
    }

    const nodes: SnapshotNode[] = []
    let row = 0
    let annotated = 0
    for (const node of page.nodes) {
      node.bounds = { x: 0, y: row, w: 1, h: 1 }
      if (node.role === 'paragraph' && int(node.ref.slice(1), -1) === this.#selected) {
        node.state = { selected: true }
      }
      nodes.push(node)
      row += 1
      if (node.role !== 'paragraph') continue
      const notes = this.#annotations.get(int(node.ref.slice(1), -1)) ?? []
      for (const note of notes) {
        if (annotated >= ANNOTATIONS_PER_PAGE) break
        nodes.push({
          ref: `a${node.ref.slice(1)}:${annotated}`,
          role: 'annotation',
          name: `· AI ${note}`,
          depth: 1,
          interactive: false,
          bounds: { x: 0, y: row, w: 1, h: 1 },
        })
        row += 1
        annotated += 1
      }
    }

    const title = chapter.title || novel.title || this.#title
    return {
      url: this.#path,
      title,
      capturedAt: Date.now(),
      viewport: {
        cols,
        rows,
        scrollX: 0,
        scrollY: page.offset,
        width: cols * 8,
        height: rows * 16,
        docWidth: cols * 8,
        docHeight: Math.max(rows, this.#text.length),
      },
      landmarks: chapter.title ? [{ role: 'heading', name: chapter.title }] : [],
      nodes,
      truncated: { nodes: 0, chars: request.maxChars, scope: request.scope },
    }
  }

  async act(action: Action, _context: ActContext): Promise<ActResult> {
    switch (action.kind) {
      case 'click':
        return await this.#click(action.ref)
      case 'press':
        return await this.#press(action.key)
      case 'scroll':
        return await this.#turn(int(action.dy, 0))
      case 'command':
        return await this.#command(action.name, action.args ?? {})
      default:
        return { ok: false, message: `the novel is text-only: ${(action as { kind: string }).kind} is not supported` }
    }
  }

  #listingSnapshot(request: SnapshotRequest, cols: number, rows: number): Snapshot {
    const entries = this.#listing ?? []
    const nodes: SnapshotNode[] = []
    let used = 0
    for (const entry of entries) {
      const name = entry.kind === 'dir' ? `${entry.name}/` : entry.name
      if (used + name.length > request.maxChars && nodes.length > 0) break
      used += name.length
      nodes.push({
        ref: `f${nodes.length}`,
        role: 'file',
        name,
        value: entry.realPath,
        depth: 0,
        interactive: true,
        bounds: { x: 0, y: nodes.length, w: 1, h: 1 },
      })
    }
    return {
      url: this.#path,
      title: `Library — ${this.#title}`,
      capturedAt: Date.now(),
      viewport: {
        cols,
        rows,
        scrollX: 0,
        scrollY: 0,
        width: cols * 8,
        height: rows * 16,
        docWidth: cols * 8,
        docHeight: Math.max(rows, entries.length),
      },
      landmarks: [],
      nodes,
      truncated: { nodes: entries.length - nodes.length, chars: used, scope: request.scope },
    }
  }

  async #click(ref: string): Promise<ActResult> {
    if (ref.startsWith('f')) {
      const entry = this.#listing?.[int(ref.slice(1), -1)]
      if (!entry) return { ok: false, message: `unknown file ref ${ref}` }
      return await this.open(entry.realPath)
    }
    if (ref.startsWith('p')) {
      const offset = int(ref.slice(1), -1)
      if (!this.#novel || offset < 0) return { ok: false, message: `unknown paragraph ref ${ref}` }
      this.#selected = offset
      // The page stays put, but the selected mark does not: let the pane redraw.
      return { ok: true, changed: true, message: `selected ¶${offset}` }
    }
    const chapter = /^c(\d+)$/.exec(ref)
    if (chapter) return await this.#moveTo(int(chapter[1], 0), this.#chapterStart(int(chapter[1], 0)))
    return { ok: false, message: `unknown ref ${ref}` }
  }

  async #press(rawKey: string): Promise<ActResult> {
    const novel = this.#novel
    if (!novel) return { ok: false, message: 'no file open' }
    // Engine key names arrive as `ArrowUp`/`PageDown` or as plain characters.
    const key = rawKey.toLowerCase().replace(/^arrow/, '')
    switch (key) {
      case 'down':
      case 'right':
      case 'j':
      case ' ':
        return await this.#turn(1)
      case 'up':
      case 'left':
      case 'k':
      case 'b':
        return await this.#turn(-1)
      case 'pagedown':
        return await this.#turn(this.#rows)
      case 'pageup':
        return await this.#turn(-this.#rows)
      case 'home':
        return await this.#moveTo(this.#chapterIndex, this.#chapterStart(this.#chapterIndex), 'chapter start')
      case 'end':
        return await this.#moveTo(this.#chapterIndex, this.#chapterEnd(this.#chapterIndex), 'chapter end')
      case 'n':
        return await this.#chapterMove(1)
      case 'p':
        return await this.#chapterMove(-1)
      default:
        return { ok: false, message: `no binding for ${key}` }
    }
  }

  async #command(name: string, args: Record<string, unknown>): Promise<ActResult> {
    const novel = this.#novel
    if (!novel) return { ok: false, message: 'no file open' }
    switch (name) {
      case 'page':
      case 'turn':
        return await this.#turn(int(args.delta, 1))
      case 'next':
        return await this.#turn(1)
      case 'prev':
        return await this.#turn(-1)
      case 'selected':
        return this.#selectedText()
      case 'chapter':
        if (args.index !== undefined) return await this.#moveTo(int(args.index, 0), this.#chapterStart(int(args.index, 0)))
        return await this.#chapterMove(int(args.delta, 1))
      case 'goto': {
        const offset = clamp(int(args.offset, this.#offset), 0, Math.max(0, this.#text.length - 1))
        const chapterIndex = novel.chapters.findIndex(chapter => {
          const last = chapter.paragraphs[chapter.paragraphs.length - 1]
          const end = last ? last.offset + last.text.length : chapter.headingOffset
          return offset <= end
        })
        const target = chapterIndex < 0 ? novel.chapters.length - 1 : chapterIndex
        return await this.#moveTo(target, clamp(offset, this.#chapterStart(target), this.#chapterEnd(target)))
      }
      case 'find':
        return this.#find(String(args.text ?? ''))
      case 'annotate':
        return this.#annotate(String(args.ref ?? ''), String(args.text ?? ''))
      default:
        return { ok: false, message: `unknown command ${name}` }
    }
  }

  #selectedText(): ActResult {
    const novel = this.#novel
    if (!novel || this.#selected === undefined) return { ok: false, message: 'no paragraph selected' }
    for (const chapter of novel.chapters) {
      const paragraph = chapter.paragraphs.find(one => one.offset === this.#selected)
      if (paragraph) return { ok: true, changed: false, message: `¶${this.#selected}`, text: paragraph.text }
    }
    this.#selected = undefined
    return { ok: false, message: 'the selected paragraph is gone' }
  }

  #find(text: string): ActResult {
    const needle = text.trim()
    if (!needle) return { ok: false, message: 'find needs text' }
    const lower = this.#text.toLowerCase()
    const target = needle.toLowerCase()
    const excerpts: string[] = []
    let from = 0
    while (excerpts.length < FIND_LIMIT) {
      const at = lower.indexOf(target, from)
      if (at < 0) break
      const start = Math.max(0, at - FIND_EXCERPT)
      const end = Math.min(this.#text.length, at + needle.length + FIND_EXCERPT)
      excerpts.push(this.#text.slice(start, end).replace(/\s+/g, ' ').trim())
      from = at + target.length
    }
    return {
      ok: true,
      changed: false,
      message: `${excerpts.length} match${excerpts.length === 1 ? '' : 'es'} for "${needle}"`,
      text: excerpts.join('\n'),
    }
  }

  #annotate(ref: string, text: string): ActResult {
    const match = /^p(\d+)$/.exec(ref)
    const offset = match ? int(match[1], -1) : -1
    const note = text.trim().slice(0, ANNOTATION_MAX)
    if (!this.#novel || offset < 0) return { ok: false, message: `annotate needs a paragraph ref` }
    if (!note) return { ok: false, message: 'annotate needs text' }
    const notes = this.#annotations.get(offset) ?? []
    if (notes.length >= NOTES_PER_PARAGRAPH) return { ok: false, message: `${NOTES_PER_PARAGRAPH} notes at ¶${offset}` }
    notes.push(note)
    this.#annotations.set(offset, notes)
    return { ok: true, changed: true, message: `annotated ¶${offset}` }
  }

  async #turn(delta: number): Promise<ActResult> {
    const novel = this.#novel
    if (!novel) return { ok: false, message: 'no file open' }
    if (delta === 0) return { ok: true, changed: false, message: 'no move' }
    let chapterIndex = this.#chapterIndex
    let offset = this.#offset
    const forward = delta > 0
    for (let step = 0; step < Math.abs(delta); step++) {
      const page = pageAt(novel, { chapterIndex, offset }, this.#cols, this.#rows, this.#maxChars)
      if (forward) {
        if (page.end >= this.#chapterEnd(chapterIndex)) {
          if (chapterIndex >= novel.chapters.length - 1) return { ok: false, changed: false, message: 'end of the novel' }
          chapterIndex += 1
          offset = this.#chapterStart(chapterIndex)
        } else {
          offset = page.end
        }
      } else {
        const previous = this.#previousOffset(chapterIndex, page.offset)
        if (previous !== undefined) {
          offset = previous
        } else if (chapterIndex > 0) {
          chapterIndex -= 1
          offset = this.#lastPageOffset(chapterIndex)
        } else {
          return { ok: false, changed: false, message: 'start of the novel' }
        }
      }
    }
    const label = chapterIndex !== this.#chapterIndex ? `${this.#chapterLabel(chapterIndex)}` : undefined
    return await this.#moveTo(chapterIndex, offset, label)
  }

  async #chapterMove(delta: number): Promise<ActResult> {
    const novel = this.#novel
    if (!novel) return { ok: false, message: 'no file open' }
    const target = clamp(this.#chapterIndex + delta, 0, novel.chapters.length - 1)
    if (target === this.#chapterIndex) {
      return { ok: false, changed: false, message: delta < 0 ? 'first chapter' : 'last chapter' }
    }
    return await this.#moveTo(target, this.#chapterStart(target), this.#chapterLabel(target))
  }

  async #moveTo(chapterIndex: number, offset: number, label?: string): Promise<ActResult> {
    const novel = this.#novel
    if (!novel) return { ok: false, message: 'no file open' }
    const chapter = clamp(chapterIndex, 0, novel.chapters.length - 1)
    const before = pageAt(novel, this.#progress(), this.#cols, this.#rows, this.#maxChars)
    this.#chapterIndex = chapter
    this.#offset = clamp(offset, this.#chapterStart(chapter), this.#chapterEnd(chapter))
    this.#selected = undefined
    const page = pageAt(novel, this.#progress(), this.#cols, this.#rows, this.#maxChars)
    await this.#persist()
    const moved = before.chapterIndex !== page.chapterIndex || before.offset !== page.offset
    return {
      ok: true,
      changed: moved,
      message: label ?? this.#position(page),
    }
  }

  #progress(): PageHint {
    return { chapterIndex: this.#chapterIndex, offset: this.#offset }
  }

  async #persist(): Promise<void> {
    const novel = this.#novel
    if (!novel) return
    const progress: Progress = { chapterIndex: this.#chapterIndex, offset: this.#offset }
    try {
      await this.#ops.storeSet(`moyu.progress.${novel.hash}`, progress)
    } catch {
      /* reading must not fail because the store could not be written */
    }
  }

  #chapterStart(chapterIndex: number): number {
    const chapter = this.#novel?.chapters[chapterIndex]
    if (!chapter) return 0
    return chapter.paragraphs[0]?.offset ?? chapter.headingOffset
  }

  #chapterEnd(chapterIndex: number): number {
    const chapter = this.#novel?.chapters[chapterIndex]
    if (!chapter) return 0
    const last = chapter.paragraphs[chapter.paragraphs.length - 1]
    return last ? last.offset : chapter.headingOffset
  }

  #chapterLabel(chapterIndex: number): string {
    const novel = this.#novel
    if (!novel) return ''
    const chapter = novel.chapters[chapterIndex]
    return `chapter ${chapterIndex + 1}/${novel.chapters.length}${chapter?.title ? ` — ${chapter.title}` : ''}`
  }

  /** The page start before `offset`, or undefined at the chapter start. */
  #previousOffset(chapterIndex: number, offset: number): number | undefined {
    const novel = this.#novel
    if (!novel) return undefined
    let cursor = this.#chapterStart(chapterIndex)
    if (cursor >= offset) return undefined
    let previous = cursor
    while (true) {
      const page = pageAt(novel, { chapterIndex, offset: cursor }, this.#cols, this.#rows, this.#maxChars)
      if (page.end >= offset) return previous
      previous = page.end
      if (page.end <= cursor) return previous
      cursor = page.end
    }
  }

  #lastPageOffset(chapterIndex: number): number {
    const novel = this.#novel
    if (!novel) return 0
    let cursor = this.#chapterStart(chapterIndex)
    let previous = cursor
    while (true) {
      const page = pageAt(novel, { chapterIndex, offset: cursor }, this.#cols, this.#rows, this.#maxChars)
      if (page.end <= cursor) return previous
      previous = page.end
      if (!page.hasNext) return previous
      cursor = page.end
    }
  }

  /** "page i/n" within the chapter, counting pages from its start. */
  #position(page: Page): string {
    let cursor = this.#chapterStart(page.chapterIndex)
    let index = 1
    let total = 1
    for (let guard = 0; guard < 100_000; guard++) {
      const held = pageAt(this.#novel!, { chapterIndex: page.chapterIndex, offset: cursor }, this.#cols, this.#rows, this.#maxChars)
      if (cursor < page.offset) index += 1
      if (held.hasNext && held.end > cursor) {
        cursor = held.end
        total += 1
      } else {
        break
      }
    }
    return `page ${index}/${total}`
  }

  #validProgress(saved: unknown, novel: Novel): Progress {
    const record = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
    const chapterIndex = clamp(int(record.chapterIndex, 0), 0, Math.max(0, novel.chapters.length - 1))
    const offset = clamp(int(record.offset, this.#chapterStart(chapterIndex)), this.#chapterStart(chapterIndex), this.#chapterEnd(chapterIndex))
    return { chapterIndex, offset }
  }

  #fail(message: string): ActResult {
    this.#lastError = message.slice(0, 300)
    return { ok: false, message }
  }

  #error(error: unknown): string {
    return String((error as Error).message ?? error).slice(0, 300)
  }
}
