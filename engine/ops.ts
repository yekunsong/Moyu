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
  // The kept supervisor still speaks over fetch and a child process; a novel
  // provider itself uses neither.
  fetch: (url: string, init?: HttpInit) => Promise<HttpResponse>
  spawn: (request: ProcessSpawnRequest) => HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  openPane: (args: PaneOpenArgs) => Promise<UiOpenResult>
  closePane: (id: string) => Promise<void>
  /** File text; the novel provider reads its own library with these. */
  readText: (path: string) => Promise<string>
  listDir: (path: string) => Promise<Array<{ name: string; kind: string; size: number; mtimeMs: number; isLink: boolean }>>
  statPath: (
    path: string,
    resolve?: boolean,
  ) => Promise<{ kind: string; size: number; mtimeMs: number; isLink: boolean; realPath?: string }>
  /** Put text in the prompt box as the draft. */
  fillPrompt: (text: string) => Promise<void>
}
