# Provider author guide

The adapter contract is `engine/provider.ts`. The hub depends only on it, never on an adapter: a provider factory in `hooks/main.tsx` maps an id to a factory, and `Hub` is constructed with `{ providerFactory }`. Adding a provider means implementing the contract, declaring capabilities, and registering the factory.

## 1. Contract

```ts
type Provider = {
  readonly meta: {
    id: string
    label: string
    capabilities: {
      pointer: boolean; keys: boolean; scroll: boolean
      text: boolean; minCols: number; minRows: number
    }
    allowSchemes: string[]
    defaultWidth: number
  }
  readonly supervisor?: { onFatal(fn): void; onIdle(fn): void }
  start(options?: { attachPort?: number }): Promise<void>
  stop(): Promise<void>
  health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }>
  open?(path: string): Promise<ActResult>
  act(action: Action, context: { actor: 'person' | 'model' }): Promise<ActResult>
  snapshot(request: { scope: 'viewport' | 'document'; maxChars: number; cols: number; rows: number }): Promise<Snapshot>
}
```

`supervisor` is only for providers that own a child process; `engine/supervisor.ts` is kept for one. `open` is for providers with their own path namespace, as the novel library has.

### Snapshot

```ts
type SnapshotNode = {
  ref: string          // stable until the next snapshot/turn; checked before acting
  role: string         // heading/paragraph/file/annotation/...
  name: string         // the text, trimmed and capped
  depth: number
  value?: string       // a provider-specific target, e.g. a library file's real path
  interactive?: boolean
  state?: { selected?: boolean }
  bounds: { x; y; w; h }
}
```

Hard requirements:

1. **A ref must derive from the document's own identity**, never a coordinate or a live array position. The novel provider uses the normalized-text hash for progress keys and paragraph character offsets for refs, so a ref survives re-snapshots and changes with the file.
2. **Snapshots contain the visible region by default** and support a whole-document request through `scope: 'document'`. Both obey `maxChars`.
3. **Never put credentials in names.** The novel has none; a future provider masks tokens.

### Actions

The action set is `click`, `press`, `scroll` and `command`. The hub checks `capabilities` before it runs anything and fails closed with `the <label> provider does not support <kind> (no <capability>)`:

- `pointer` gates `click`.
- `keys` gates `press`.
- `scroll` gates `scroll`.
- `command` is always allowed; a provider declares its own verbs and returns a clear error for unknown ones.

`ActResult` must carry `message`. Set `changed: true` whenever the provider's visible output changed (including a selection mark or a new annotation) so the hub refreshes. Use `changed: false` for pure reads such as `find`, and put their answer in `text`.

## 2. The novel adapter

`providers/novel/client.ts` is the reference adapter. It guards a library root (`providers/novel/library.ts`), parses and pages text (`providers/novel/parse.ts`), keeps progress in `$.store`, and serves commands `page`, `next`, `prev`, `chapter`, `goto`, `find`, `annotate` and `selected`. It declares `text/pointer/keys/scroll`, `minCols: 20`, `minRows: 5`, and has no process.

Do not assume Node, DOM or a PTY inside the plugin module. Use `ops.readText`, `ops.listDir`, `ops.statPath` and `ops.storeGet/Set`; a process-owning adapter gets `ops.spawn` and `ops.fetch` but must keep pumping its stream or the child is killed on the first leave.

## 3. Audit and gating

Every action funnels through the queue, whether a person or the model sent it. The novel has no network and no writes, so every policy is `read-only`; the capability gate is the only refusal before execution. A future network adapter brings its own scheme/host guard.

## 4. Rendering

Return `SnapshotNode[]`; `projectRows` in `hub/hub.ts` maps it to pane rows. Without `pointer`, rows draw as plain text. The novel pane paints `heading`, `paragraph`, `annotation` and `file` roles; a new role falls through to a clickable paragraph row.

## 5. Tool result shape (measured)

For a tool registered with `$.tool.register` and no output schema, `result` in the `tool.call` answer must be a **plain string**:

```ts
return { result: 'ok: clicked e12', text: 'ok: clicked e12' }
```

Returning MCP-style `{ content: [{ type: 'text', ... }] }` is rejected by 2.1.319 with
`does not match its output shape: invalid_union … expected string, received object`.
Serialize structured data into text (or declare an output schema if the build supports it).

## 6. Testing

1. Pure logic tests go in `tests/*.test.ts` (`claude plugin test .`).
2. `tests/helpers.ts` fakes `$.fs` over an in-memory library and records prompt/theme calls; copy it for a new provider's bottom.
3. Cover at least: snapshot structure, each action, guard refusals, and a start/stop round trip when the provider owns a process.
4. Never depend on a real process or the network in plugin tests.
