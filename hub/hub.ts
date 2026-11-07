// The single action path shared by people and the model: permission decision,
// confirmation, audit, execution, refresh. Serial by construction.
import { ask, storeGet, storeSet } from '../engine/adapter'
import type { Ops } from '../engine/ops'
import type { Action, ActResult, Snapshot } from '../providers/browser/contract'
import { BrowserProvider } from '../providers/browser/client'
import { Audit } from './audit'
import { configOf, decide, describeAction, newGrant, type Config, type SessionGrant } from './permissions'

export type ViewRow = {
  ref: string
  role: string
  label: string
  value?: string
  flags?: string
  submits?: boolean
}

export type ViewModel = {
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

export const EMPTY_VIEW: ViewModel = {
  status: 'closed',
  url: '',
  title: '',
  rows: [],
  truncated: 0,
  audit: [],
  scope: 'viewport',
  mode: 'text',
}

const RECENT_KEY = 'recent.v1'

export class Hub {
  readonly provider: BrowserProvider
  readonly audit: Audit
  readonly config: Config
  readonly grant: SessionGrant = newGrant()
  #queue: Promise<unknown> = Promise.resolve()
  #lastSnapshot: Snapshot | undefined
  #refresh: (() => void) | undefined
  #view: ViewModel = { ...EMPTY_VIEW }

  constructor(private readonly ops: Ops, options: Record<string, unknown>) {
    this.provider = new BrowserProvider(ops)
    this.audit = new Audit(ops)
    this.config = configOf(options)
    this.provider.supervisor.onFatal(reason => {
      if (!reason) return
      this.#setView({ status: 'error', error: reason, rows: [], audit: this.audit.recent(6).map(shortAudit) })
    })
  }

  get view(): ViewModel {
    return this.#view
  }

  async showPane(): Promise<void> {
    const opened = await this.ops.openPane({ id: 'transom', title: 'Transom', rows: 24, columns: this.provider.meta.defaultWidth })
    if (!opened.isPlaced) {
      this.#setView({
        last: `pane waits for a wider terminal (${opened.reason ?? 'not placed'})`,
      })
    }
  }

  onRefresh(fn: () => void): void {
    this.#refresh = fn
  }

  #setView(patch: Partial<ViewModel>): void {
    this.#view = { ...this.#view, ...patch }
    this.#refresh?.()
  }

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work)
    this.#queue = next.catch(() => undefined)
    return next
  }

  async open(url: string, width: number): Promise<{ ok: boolean; message: string }> {
    return await this.enqueue(async () => {
      const auditId = await this.audit.begin('person', 'browser', { kind: 'navigate', url }, 'open', url)
      const started = Date.now()
      this.#setView({ status: 'starting', error: undefined, url, title: '', rows: [], last: `opening ${url}` })
      try {
        await this.provider.start()
        let target = url
        if (target) {
          const decision = decide(this.config, { kind: 'navigate', url: target }, 'person', this.grant)
          if (decision.effect === 'deny') throw new Error(decision.reason)
          const result = await this.provider.act({ kind: 'navigate', url: target }, { actor: 'person' })
          if (!result.ok) throw new Error(result.message)
          await this.#remember(target)
        }
        await this.refresh()
        await this.audit.end(auditId, true, 'opened', Date.now() - started)
        this.#setView({ status: 'ready' })
        return { ok: true, message: `opened ${this.#view.url}` }
      } catch (error) {
        const message = String((error as Error).message ?? error)
        await this.audit.end(auditId, false, message, Date.now() - started)
        this.#setView({ status: 'error', error: message })
        return { ok: false, message }
      }
    })
  }

  async close(): Promise<void> {
    await this.enqueue(async () => {
      await this.provider.stop()
      this.#view = { ...EMPTY_VIEW }
      this.#refresh?.()
    })
  }

  async act(action: Action, actor: 'person' | 'model', submitFlag = false): Promise<{ result: ActResult; auditId: string; denied?: boolean }> {
    const decision = decide(this.config, action, actor, this.grant)
    if (decision.effect === 'deny') {
      const entry = await this.audit.log({
        actor, provider: 'browser', action: describeAction(action), url: this.#view.url,
        policy: 'deny', ok: false, message: decision.reason,
      })
      return { result: { ok: false, message: decision.reason }, auditId: entry.id, denied: true }
    }

    let policy: string = decision.effect
    if (decision.effect === 'confirm') {
      const answer = await ask(
        this.ops,
        `Transom: allow ${describeAction(action)} on “${this.#view.title || this.#view.url}”? (${decision.reason})`,
        ['Allow', 'Allow all this session', 'Deny'],
      )
      if (answer === undefined || answer === 'Deny') {
        const entry = await this.audit.log({
          actor, provider: 'browser', action: describeAction(action), url: this.#view.url,
          policy: 'confirm', ok: false, message: 'denied by person',
        })
        return { result: { ok: false, message: 'denied by person' }, auditId: entry.id, denied: true }
      }
      if (answer === 'Allow all this session') this.grant.auto = true
      policy = 'confirmed'
    }

    return await this.enqueue(async () => {
      const started = Date.now()
      const auditId = await this.audit.begin(actor, 'browser', action, policy, this.#view.url)
      this.#setView({ last: `${actor === 'model' ? 'model' : 'you'}: ${describeAction(action)}` })
      let result: ActResult
      try {
        result = await this.provider.act(action, { actor })
      } catch (error) {
        result = { ok: false, message: String((error as Error).message ?? error) }
      }
      const duration = Date.now() - started
      await this.audit.end(auditId, result.ok, result.message, duration)
      if (result.stale) {
        this.#setView({ last: `${actor}: stale ref, refreshing` })
      }
      if (result.ok && (result.changed || action.kind === 'navigate')) {
        if (action.kind === 'navigate' && result.url) await this.#remember(result.url)
        await this.refresh()
      }
      this.#setView({ audit: this.audit.recent(6).map(shortAudit) })
      return { result, auditId }
    })
  }

  async refresh(scope: 'viewport' | 'document' = this.#view.scope): Promise<Snapshot | undefined> {
    if (this.provider.supervisor.phase !== 'ready') return undefined
    try {
      const snapshot = await this.provider.snapshot({
        scope,
        maxChars: this.config.snapshotMaxChars * 8,
        cols: 110,
        rows: 34,
      })
      this.#lastSnapshot = snapshot
      this.#setView({
        status: 'ready',
        url: snapshot.url,
        title: snapshot.title,
        rows: projectRows(snapshot, 160),
        truncated: snapshot.nodes.length,
        scope,
        error: undefined,
        audit: this.audit.recent(6).map(shortAudit),
      })
      return snapshot
    } catch (error) {
      this.#setView({ status: 'error', error: String((error as Error).message ?? error) })
      return undefined
    }
  }

  lastSnapshot(): Snapshot | undefined {
    return this.#lastSnapshot
  }

  async modelSnapshot(scope: 'viewport' | 'document'): Promise<{ text: string; auditId: string }> {
    const snapshot = await this.refresh(scope)
    const started = Date.now()
    const entry = await this.audit.log({
      actor: 'model', provider: 'browser', action: `snapshot ${scope}`, url: snapshot?.url,
      policy: 'read-only', ok: !!snapshot, durationMs: Date.now() - started,
      message: snapshot ? `${snapshot.nodes.length} nodes` : 'failed',
    })
    if (!snapshot) return { text: `snapshot failed: ${this.view.error ?? 'unknown'}`, auditId: entry.id }
    return { text: renderSnapshotText(snapshot, this.config.snapshotMaxChars), auditId: entry.id }
  }

  async recent(): Promise<string[]> {
    try {
      const stored = (await storeGet<string[]>(this.ops, RECENT_KEY)) ?? []
      return stored
    } catch {
      return []
    }
  }

  async #remember(url: string): Promise<void> {
    try {
      const stored = (await storeGet<string[]>(this.ops, RECENT_KEY)) ?? []
      const next = [url, ...stored.filter(one => one !== url)].slice(0, 10)
      await storeSet(this.ops, RECENT_KEY, next)
    } catch {
      /* ignore */
    }
  }
}

export function projectRows(snapshot: Snapshot, limit: number): ViewRow[] {
  const rows: ViewRow[] = []
  for (const node of snapshot.nodes) {
    if (rows.length >= limit) break
    const label = node.name || node.value || node.role
    if (!label) continue
    rows.push({
      ref: node.ref,
      role: node.role,
      label: label.slice(0, 120),
      value: node.value?.slice(0, 60),
      flags: flagsOf(node),
      submits: node.submits,
    })
  }
  return rows
}

function flagsOf(node: Snapshot['nodes'][number]): string | undefined {
  const flags: string[] = []
  if (node.state?.disabled) flags.push('disabled')
  if (node.state?.checked) flags.push('checked')
  if (node.state?.focused) flags.push('focused')
  if (node.submits) flags.push('submit')
  return flags.length ? flags.join(',') : undefined
}

export function renderSnapshotText(snapshot: Snapshot, maxChars: number): string {
  const lines: string[] = []
  lines.push(`# ${snapshot.title || '(untitled)'}`)
  lines.push(snapshot.url)
  lines.push(
    `viewport ${snapshot.viewport.cols}x${snapshot.viewport.rows} scroll ${snapshot.viewport.scrollX},${snapshot.viewport.scrollY} doc ${snapshot.viewport.docWidth}x${snapshot.viewport.docHeight} scope ${snapshot.truncated.scope}`,
  )
  if (snapshot.landmarks.length) {
    lines.push(
      `landmarks: ${snapshot.landmarks.map(one => `${one.role}=${one.name}`).join(' | ')}`,
    )
  }
  lines.push('')
  let used = lines.join('\n').length
  for (const node of snapshot.nodes) {
    const bits = [`[${node.ref}]`, node.role]
    if (node.name) bits.push(JSON.stringify(node.name))
    if (node.value !== undefined) bits.push(`= ${JSON.stringify(node.value)}`)
    const flags = flagsOf(node)
    if (flags) bits.push(`(${flags})`)
    const line = bits.join(' ')
    if (used + line.length + 1 > maxChars) {
      lines.push(`… ${snapshot.nodes.length} nodes total, stopped at the character cap`)
      break
    }
    lines.push(line)
    used += line.length + 1
  }
  lines.push('')
  lines.push('refs are valid until the next snapshot or navigation')
  return lines.join('\n')
}

function shortAudit(entry: ReturnType<Audit['recent']>[number]): string {
  const mark = entry.ok ? 'ok' : '!!'
  return `${mark} ${entry.actor === 'model' ? 'model' : 'you'} ${entry.action} (${entry.durationMs}ms)`
}

export function isTmuxLike(): boolean {
  return false
}

export function normaliseKey(key: string): string {
  const map: Record<string, string> = {
    escape: 'Escape', esc: 'Escape', return: 'Enter', enter: 'Enter',
    tab: 'Tab', backspace: 'Backspace', delete: 'Delete', up: 'ArrowUp',
    down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: ' ',
    pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End',
  }
  return map[key.toLowerCase()] ?? key
}

export { ask }
