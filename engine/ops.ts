// The slice of `$` the hub and providers use. Built inline in the hooks
// module (the validator only allows `$` at its own call sites there), so no
// module ever receives `$` itself.
import type { HookStream, HttpInit, HttpResponse, PaneOpenArgs, Timer, UiOpenResult } from 'claude-code'

import type { ProcessSpawnChunk, ProcessSpawnResult, ProcessSpawnRequest } from 'claude-code'

export type Ops = {
  root: string
  ask: (question: string, options: readonly string[]) => Promise<string>
  log: (text: string) => void
  status: (text: string | undefined) => void
  toast: (text: string) => void
  fetch: (url: string, init?: HttpInit) => Promise<HttpResponse>
  spawn: (request: ProcessSpawnRequest) => HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  openPane: (args: PaneOpenArgs) => Promise<UiOpenResult>
  closePane: (id: string) => Promise<void>
  /** Terminal identity for image-tier detection; names are spelled at the call site. */
  env: {
    term: () => Promise<string | undefined>
    termProgram: () => Promise<string | undefined>
    wtSession: () => Promise<string | undefined>
    tmux: () => Promise<string | undefined>
  }
}
