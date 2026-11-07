import type { Ops } from '../engine/ops'
import type { Action } from '../providers/browser/contract'

export type AuditEntry = {
  id: string
  at: number
  actor: 'person' | 'model'
  provider: string
  action: string
  url?: string
  policy: string
  ok: boolean
  durationMs: number
  message?: string
}

const MEMORY_LIMIT = 500
const STORE_KEY = 'audit.v1'
const STORE_LIMIT = 2000

export class Audit {
  #ring: AuditEntry[] = []
  #store: AuditEntry[] | undefined

  constructor(private readonly ops: Ops) {}

  async begin(actor: 'person' | 'model', provider: string, action: Action | string, policy: string, url?: string): Promise<string> {
    const id = randomId()
    this.#ring.push({
      id,
      at: Date.now(),
      actor,
      provider,
      action: typeof action === 'string' ? action : JSON.stringify(action),
      url,
      policy,
      ok: false,
      durationMs: 0,
      message: 'in flight',
    })
    this.#trim()
    return id
  }

  async end(id: string, ok: boolean, message: string, durationMs: number): Promise<AuditEntry | undefined> {
    const entry = this.#ring.find(one => one.id === id)
    if (!entry) return undefined
    entry.ok = ok
    entry.message = message.slice(0, 300)
    entry.durationMs = Math.max(0, Math.round(durationMs))
    await this.#persist(entry)
    return entry
  }

  async log(entry: Omit<AuditEntry, 'id' | 'at' | 'durationMs'> & { durationMs?: number }): Promise<AuditEntry> {
    const full: AuditEntry = { ...entry, id: randomId(), at: Date.now(), durationMs: entry.durationMs ?? 0 }
    this.#ring.push(full)
    this.#trim()
    await this.#persist(full)
    return full
  }

  recent(limit = 20): AuditEntry[] {
    return this.#ring.slice(-Math.max(1, limit)).reverse()
  }

  async #persist(entry: AuditEntry): Promise<void> {
    try {
      if (!this.#store) {
        this.#store = ((await this.ops.storeGet(STORE_KEY)) as AuditEntry[] | undefined) ?? []
      }
      this.#store.push(entry)
      if (this.#store.length > STORE_LIMIT) this.#store.splice(0, this.#store.length - STORE_LIMIT)
      await this.ops.storeSet(STORE_KEY, this.#store)
    } catch {
      /* persistence is best effort */
    }
  }

  #trim(): void {
    if (this.#ring.length > MEMORY_LIMIT) this.#ring.splice(0, this.#ring.length - MEMORY_LIMIT)
  }
}

function randomId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return `a${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}
