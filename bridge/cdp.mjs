// Minimal Chrome DevTools Protocol client. One WebSocket, flattened sessions,
// id-matched promises, per-command timeout. No third-party dependencies.

const COMMAND_TIMEOUT_MS = 15000

export class Cdp {
  #ws
  #nextId = 1
  #pending = new Map()
  #listeners = new Map()
  #closed = false
  onClose = () => {}

  static async connect(wsUrl) {
    const cdp = new Cdp()
    await cdp.#open(wsUrl)
    return cdp
  }

  #open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.#ws = ws
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error(`CDP connect timeout: ${url}`))
      }, 10000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.addEventListener('error', event => {
        clearTimeout(timer)
        reject(new Error(`CDP socket error: ${event.message ?? 'unknown'}`))
      })
      ws.addEventListener('close', () => {
        this.#closed = true
        for (const { reject: fail } of this.#pending.values()) {
          fail(new Error('CDP socket closed'))
        }
        this.#pending.clear()
        this.onClose()
      })
      ws.addEventListener('message', event => {
        let message
        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (message.id !== undefined) {
          const waiting = this.#pending.get(message.id)
          if (!waiting) return
          this.#pending.delete(message.id)
          clearTimeout(waiting.timer)
          if (message.error) {
            waiting.reject(
              new Error(`${waiting.method}: ${message.error.message ?? message.error.code}`),
            )
          } else {
            waiting.resolve(message.result)
          }
          return
        }
        const key = message.method
        for (const fn of this.#listeners.get(key) ?? []) fn(message.params, message.sessionId)
      })
    })
  }

  get isClosed() {
    return this.#closed
  }

  on(method, fn) {
    const list = this.#listeners.get(method) ?? []
    list.push(fn)
    this.#listeners.set(method, list)
    return () => {
      const next = (this.#listeners.get(method) ?? []).filter(one => one !== fn)
      this.#listeners.set(method, next)
    }
  }

  waitFor(method, predicate = () => true, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`timed out waiting for ${method}`))
      }, timeoutMs)
      const off = this.on(method, (params, sessionId) => {
        if (!predicate(params)) return
        clearTimeout(timer)
        off()
        resolve({ params, sessionId })
      })
    })
  }

  send(method, params = {}, sessionId, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (this.#closed) return Promise.reject(new Error('CDP socket closed'))
    const id = this.#nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${method}: timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timer, method })
      try {
        this.#ws.send(JSON.stringify(payload))
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(error)
      }
    })
  }

  close() {
    try {
      this.#ws.close()
    } catch {
      /* already gone */
    }
  }
}
