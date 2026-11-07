// One bridge child process, its handshake, health and restart policy.
// The bridge owns Chromium; this class only supervises the bridge.
import { fetchJson } from './adapter'
import type { Ops } from './ops'

export type Endpoint = { port: number; token: string; url: string }

type Phase = 'idle' | 'starting' | 'ready' | 'failed' | 'stopped'

const START_TIMEOUT_MS = 8000
const HEALTH_INTERVAL_MS = 5000
const MAX_RESTARTS = 4

export class Supervisor {
  #phase: Phase = 'idle'
  #endpoint: Endpoint | undefined
  #token = ''
  #restarts = 0
  #lastStart = 0
  #healthTimer: { cancel: () => void } | undefined
  #onFatal: (reason: string) => void = () => {}

  constructor(private readonly ops: Ops) {}

  get phase(): Phase {
    return this.#phase
  }

  get endpoint(): Endpoint | undefined {
    return this.#endpoint
  }

  onFatal(fn: (reason: string) => void): void {
    this.#onFatal = fn
  }

  async ensure(): Promise<Endpoint> {
    if (this.#phase === 'ready' && this.#endpoint) return this.#endpoint
    if (this.#phase === 'starting') {
      for (let i = 0; i < 300; i++) {
        await this.#$sleep(100)
        if ((this.#phase as Phase) === 'ready' && this.#endpoint) return this.#endpoint
        if ((this.#phase as Phase) === 'failed') break
      }
      throw new Error('bridge did not become ready')
    }
    if (this.#phase === 'failed' && Date.now() - this.#lastStart < 8000) {
      await this.#$sleep(8000 - (Date.now() - this.#lastStart))
    }
    return await this.#start()
  }

  async #start(): Promise<Endpoint> {
    this.#phase = 'starting'
    this.#lastStart = Date.now()
    this.#token = randomToken()
    const env: Record<string, string> = { TRANSOM_TOKEN: this.#token }
    const chrome = processEnvChrome()
    if (chrome) env.TRANSOM_CHROME = chrome
    const stream = this.ops.spawn({
      argv: [nodePath(), `${this.ops.root}/bridge/bridge.mjs`],
      env,
    })

    let stdoutBuffer = ''
    let handshake: { ready?: boolean; port?: number; error?: string } | undefined
    let settled = false
    const firstLine = new Promise<void>((resolve, reject) => {
      const timer = this.ops.after(START_TIMEOUT_MS, () => {
        if (settled) return
        settled = true
        reject(new Error('bridge handshake timed out'))
      })
      void (async () => {
        try {
          // Keep the loop alive for the child's whole life: leaving it kills
          // the bridge. The handshake is only the first stdout line.
          for await (const chunk of stream) {
            if (chunk.stream !== 'stdout') continue
            stdoutBuffer += chunk.text
            let index = stdoutBuffer.indexOf('\n')
            while (index !== -1) {
              const line = stdoutBuffer.slice(0, index).trim()
              stdoutBuffer = stdoutBuffer.slice(index + 1)
              index = stdoutBuffer.indexOf('\n')
              if (!line || settled) continue
              try {
                handshake = JSON.parse(line) as typeof handshake
              } catch {
                continue
              }
              settled = true
              timer.cancel()
              resolve()
            }
          }
          if (!settled) {
            settled = true
            timer.cancel()
            reject(new Error('bridge ended before the handshake'))
          }
        } catch (error) {
          if (!settled) {
            settled = true
            timer.cancel()
            reject(error)
          }
        }
      })()
    })

    try {
      await firstLine
    } catch (error) {
      this.#phase = 'failed'
      throw error
    }
    if (!handshake?.ready || !handshake.port) {
      this.#phase = 'failed'
      throw new Error(handshake?.error ?? 'bridge failed to start')
    }
    this.#endpoint = {
      port: handshake.port,
      token: this.#token,
      url: `http://127.0.0.1:${handshake.port}`,
    }
    this.#phase = 'ready'
    this.#restarts = 0
    this.#watch()
    return this.#endpoint
  }

  #watch(): void {
    this.#healthTimer?.cancel()
    this.#healthTimer = this.ops.every(HEALTH_INTERVAL_MS, () => {
      void this.#check()
    })
  }

  async #check(): Promise<void> {
    if (this.#phase !== 'ready' || !this.#endpoint) return
    try {
      const health = await fetchJson<{ ok: boolean; error?: string | null }>(
        this.ops,
        `${this.#endpoint.url}/health`,
        this.#endpoint.token,
      )
      if (!health.ok) throw new Error(health.error ?? 'bridge unhealthy')
    } catch (error) {
      if (this.#phase !== 'ready') return
      this.#endpoint = undefined
      this.#phase = 'failed'
      this.#healthTimer?.cancel()
      const reason = String((error as Error).message ?? error)
      if (this.#restarts < MAX_RESTARTS && this.#shouldRestart()) {
        this.#restarts += 1
        const wait = Math.min(8000, 250 * 2 ** this.#restarts)
        this.ops.after(wait, () => {
          void this.ensure().then(
            () => this.#onFatal(''),
            () => this.#onFatal(reason),
          )
        })
      } else {
        this.#onFatal(reason)
      }
    }
  }

  #shouldRestart(): boolean {
    // The user may have closed the pane on purpose; a stop() sets stopped.
    return this.#phase === 'failed'
  }

  async stop(): Promise<void> {
    this.#phase = 'stopped'
    this.#healthTimer?.cancel()
    this.#healthTimer = undefined
    const endpoint = this.#endpoint
    this.#endpoint = undefined
    if (!endpoint) return
    try {
      await fetchJson(this.ops, `${endpoint.url}/stop`, endpoint.token, { method: 'POST', body: {} })
    } catch {
      /* bridge may already be gone */
    }
  }

  async #$sleep(ms: number): Promise<void> {
    await new Promise<void>(resolve => {
      this.ops.after(ms, resolve)
    })
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function nodePath(): string {
  return 'node'
}

function processEnvChrome(): string | undefined {
  return undefined
}
