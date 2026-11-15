// One child process behind an adapter, its handshake, health and restart
// policy. Kept for process-owning adapters; the novel provider has none.
import { fetchJson } from './adapter'
import type { Ops } from './ops'

export type Endpoint = { port: number; token: string; url: string }

type Phase = 'idle' | 'starting' | 'ready' | 'failed' | 'stopped'

const START_TIMEOUT_MS = 8000
const HEALTH_INTERVAL_MS = 5000
const MAX_RESTARTS = 4

type Stream = AsyncGenerator<{ stream: 'stdout' | 'stderr'; text: string }, unknown>

export class Supervisor {
  #phase: Phase = 'idle'
  #endpoint: Endpoint | undefined
  #token = ''
  #restarts = 0
  #healthTimer: { cancel: () => void } | undefined
  #restartTimer: { cancel: () => void } | undefined
  #stream: Stream | undefined
  #idleExit = false
  #attachPort: number | undefined
  #onFatal: (reason: string) => void = () => {}
  #onIdle: () => void = () => {}

  readonly #script: string

  constructor(private readonly ops: Ops, script?: string) {
    this.#script = script ?? 'bridge/bridge.mjs'
  }

  get phase(): Phase {
    return this.#phase
  }

  get endpoint(): Endpoint | undefined {
    return this.#endpoint
  }

  onFatal(fn: (reason: string) => void): void {
    this.#onFatal = fn
  }

  onIdle(fn: () => void): void {
    this.#onIdle = fn
  }

  async ensure(options?: { attachPort?: number }): Promise<Endpoint> {
    if (options?.attachPort !== undefined) this.#attachPort = options.attachPort
    if (this.#phase === 'ready' && this.#endpoint) return this.#endpoint
    if (this.#phase === 'starting') {
      for (let i = 0; i < 70; i++) {
        await this.#$sleep(100)
        if ((this.#phase as Phase) === 'ready' && this.#endpoint) return this.#endpoint
        if ((this.#phase as Phase) === 'failed' || (this.#phase as Phase) === 'stopped') break
      }
      throw new Error('bridge did not become ready')
    }
    return await this.#start()
  }

  async #start(attachPortOverride?: number): Promise<Endpoint> {
    this.#phase = 'starting'
    this.#idleExit = false
    this.#token = randomToken()
    const env: Record<string, string> = { TRANSOM_TOKEN: this.#token }
    const attachPort = attachPortOverride ?? this.#attachPort
    if (attachPort) env.TRANSOM_ATTACH_PORT = String(attachPort)
    const chrome = processEnvChrome()
    if (chrome) env.TRANSOM_CHROME = chrome
    const stream = this.ops.spawn({
      argv: [nodePath(), this.#script.startsWith('/') || /^[A-Za-z]:/.test(this.#script) ? this.#script : `${this.ops.root}/${this.#script}`],
      env,
    }) as Stream
    this.#stream = stream

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
          // the bridge. The handshake is only the first stdout line; later
          // lines report an intentional idle shutdown.
          for await (const chunk of stream) {
            if (chunk.stream !== 'stdout') continue
            stdoutBuffer += chunk.text
            let index = stdoutBuffer.indexOf('\n')
            while (index !== -1) {
              const line = stdoutBuffer.slice(0, index).trim()
              stdoutBuffer = stdoutBuffer.slice(index + 1)
              index = stdoutBuffer.indexOf('\n')
              if (!line) continue
              let parsed: { event?: string; ready?: boolean; port?: number; error?: string }
              try {
                parsed = JSON.parse(line)
              } catch {
                continue
              }
              if (parsed.event === 'idle') this.#idleExit = true
              if (settled) continue
              handshake = parsed
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
      this.#killStream()
      this.#phase = 'failed'
      throw error
    }
    if ((this.#phase as Phase) === 'stopped') {
      this.#killStream()
      throw new Error('bridge stopped while starting')
    }
    if (!handshake?.ready || !handshake.port) {
      this.#killStream()
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
      const reason = String((error as Error).message ?? error)
      this.#endpoint = undefined
      this.#healthTimer?.cancel()
      this.#healthTimer = undefined
      if (this.#idleExit) {
        // A deliberate idle shutdown is not a crash: no restart, no error pane.
        this.#killStream()
        this.#phase = 'stopped'
        this.#onIdle()
        return
      }
      this.#phase = 'failed'
      this.#killStream()
      if (this.#restarts < MAX_RESTARTS) {
        this.#restarts += 1
        const wait = Math.min(8000, 250 * 2 ** this.#restarts)
        this.#restartTimer?.cancel()
        this.#restartTimer = this.ops.after(wait, () => {
          this.#restartTimer = undefined
          if (this.#phase === 'stopped') return
          void this.ensure().then(
            () => {},
            () => this.#onFatal(reason),
          )
        })
      } else {
        this.#onFatal(reason)
      }
    }
  }

  /** Runs one health probe now; exposed for tests and a status probe. */
  async probe(): Promise<void> {
    await this.#check()
  }

  async stop(): Promise<void> {
    this.#phase = 'stopped'
    this.#attachPort = undefined
    this.#healthTimer?.cancel()
    this.#healthTimer = undefined
    this.#restartTimer?.cancel()
    this.#restartTimer = undefined
    const endpoint = this.#endpoint
    this.#endpoint = undefined
    if (endpoint) {
      try {
        await fetchJson(this.ops, `${endpoint.url}/stop`, endpoint.token, { method: 'POST', body: {} })
        // Give the bridge its 250ms to close Chrome and remove the profile.
        // Only the stream that was running at stop time may be killed: a
        // start in the meantime (attach) has its own child.
        const abandoned = this.#stream
        this.ops.after(600, () => {
          if (this.#stream !== abandoned) return
          this.#killStream()
        })
        return
      } catch {
        /* fall through and kill now */
      }
    }
    this.#killStream()
  }

  #killStream(): void {
    const stream = this.#stream
    this.#stream = undefined
    if (!stream) return
    try {
      void stream.return(undefined)
    } catch {
      /* already ended */
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
