# Provider author guide

The adapter contract is `engine/provider.ts`. The hub depends only on it, never on an adapter: a provider registry in `hooks/main.tsx` maps an id to a factory, and `Hub` is constructed with `{ providerFactory }`. Adding a provider means implementing the contract, declaring capabilities and permission metadata, and registering the factory.

## 1. Contract

```ts
type Provider = {
  readonly meta: {
    id: string
    label: string
    capabilities: {
      pointer: boolean; keys: boolean; scroll: boolean; images: boolean;
      text: boolean; navigation: boolean; minCols: number; minRows: number
    }
    allowSchemes: string[]
    defaultWidth: number
  }
  readonly supervisor?: { onFatal(fn): void; onIdle(fn): void }
  start(options?: { attachPort?: number }): Promise<void>
  stop(): Promise<void>
  health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }>
  snapshot(request: { scope: 'viewport' | 'document'; maxChars: number; cols: number; rows: number }): Promise<Snapshot>
  act(action: Action, context: { actor: 'person' | 'model' }): Promise<ActResult>
  screenshot?(cols: number, rows: number): Promise<{ pngBase64: string; cols: number; rows: number }>
  raster?(cols: number, rows: number): Promise<{ cells: string; columns: number; rows: number }>
  frame?(cols: number, rows: number, detail?: number, source?: FrameSource): Promise<Frame>
  latestFrame?(since: number, source?: FrameSource): Promise<FramePoll>
  stopFrame?(): Promise<void>
  hitAt?(x: number, y: number): Promise<Hit>
}
```

`supervisor` is only for providers that own a child process. `screenshot`, `raster`, `frame`, `latestFrame`, `stopFrame` and `hitAt` are optional and the hub/pane guard each of them.

### Snapshot

```ts
type SnapshotNode = {
  ref: string          // stable until the next snapshot/navigation; checked before acting
  role: string         // button/link/textbox/heading/text/...
  name: string         // whitespace-collapsed and truncated
  depth: number
  value?: string       // passwords masked
  href?: string
  interactive?: boolean
  submits?: boolean
  state?: { disabled?; checked?; expanded?; selected?; focused? }
  bounds: { x; y; w; h }
}
```

Hard requirements:

1. **A ref must derive from the application's own object identity**, never a coordinate or an array index. The browser provider uses `WeakMap<Element, string>`; the reader hashes the document and appends the node ordinal.
2. **An invalid ref must be reported explicitly** (`ActResult.stale = true`) so the pane can retake a snapshot. Never silently act on a different element.
3. **Snapshots contain the visible region by default** and support a full-page request through `scope: 'document'`. Both obey `maxChars`.
4. **Never put credentials in values.** Password and token fields get a placeholder.

### Actions

The full action set: `click` / `check` / `uncheck` / `clickAt` / `fill` / `select` / `focus` / `hover` / `press` / `scroll` / `wait` / `navigate` / `back` / `forward` / `reload`.

The hub checks `capabilities` before it prompts or executes and fails closed with `the <label> provider does not support <kind> (no <capability>)`:

- `pointer` gates `click`, `check`, `uncheck`, `clickAt`, `hover`, `fill`, `select`, `focus`.
- `keys` gates `press`.
- `scroll` gates `scroll`.
- `navigation` gates `navigate`, `back`, `forward`, `reload`.

Declare only what the adapter really implements. An action outside the set (for example `fill` on a text-only provider) reaches `act()` and should return a clear unsupported message. `wait` has no capability bit and is likewise the adapter's business.

`ActResult` must carry `message`. On success where the application may have changed, set `changed: true` so the hub refreshes. `navigate`, `back` and `forward` should set `url` to where they landed.

## 2. Two reference adapters

- `providers/browser/client.ts` is the full-featured adapter: a supervised local child process (`engine/supervisor.ts`), loopback HTTP with a random bearer token, and `/health`, `/snapshot`, `/act`, `/shot`, `/raster`, `/frame`, `/frame/stop` and `/hit`.
- `providers/reader/client.ts` is the minimal read-only adapter: it fetches over `ops.fetch`, parses with `providers/reader/parse.ts`, and implements only `navigate` / `back` / `forward` / `reload` on top of a per-URL cache. It declares `text: true`, `navigation: true`, everything else false, with `allowSchemes: ['http:', 'https:']`. Use it as the copyable skeleton for a browser-free provider.

Do not assume Node, DOM or a PTY inside the plugin module. `spawn` stdin is one-shot and there is no PTY; interactive programs must expose their own protocol. Use `ops.fetch` and `ops.after` instead; both are provider-safe.

## 3. Permissions and schemes

`hub/permissions.ts` holds `classify()` (read / write / navigate), `decide()` (scheme and host allowlists) and the confirmation flow. Every action funnels through the same queue, whether a person or the model sent it. Declare `allowSchemes`; the hub refuses a `navigate` whose scheme is absent. Unknown schemes are denied, and writes are confirmed by default.

## 4. Rendering

For the text tier, returning `SnapshotNode[]` is enough: `projectRows` in `hooks/main.tsx` turns it into buttons, inputs and text. Without `pointer`, interactive rows render as plain text. The visual tier is optional: implement `raster()` returning base64 of `columns * rows` u32 triplets `[codePoint, foreground, background]`. `frame()` and `latestFrame()` are the image tier.

`FrameSource` is `'file' | 'png'` and `Frame` is a discriminated union, both sharing `generation`, the cell box (`columns`, `rows`), the CSS mapping size (`pageWidth`, `pageHeight`) and the PNG pixel size (`pixelWidth`, `pixelHeight`):

```ts
type Frame = FrameMetrics &
  ({ kind: 'file'; file: string } | { kind: 'png'; data: string })
```

`file` is an absolute PNG path the terminal reads itself (kitty, Ghostty, WezTerm). `png` is the whole PNG as base64 for terminals that take inline bytes (iTerm2 3.5+, tmux with passthrough); the pane keeps it under the engine's 2 MiB decoded limit before drawing. `source` names the shape the caller wants; the streamed answer follows it. A frame provider with only one shape may ignore the parameter and return that kind.

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
2. Child-protocol tests use `node:test`, modelled on `tests/bridge/bridge.test.mjs`.
3. Cover at least: snapshot structure, an action, stale refs, scheme refusal, process stop.
4. Never depend on a real process in plugin tests. `tests/helpers.ts` fakes the bridge and non-bridge fetches; `tests/reader.test.ts` uses a fake `ops.fetch`.

## 7. Integration order

1. `engine/provider.ts` — the shared contract (only if a new capability is genuinely needed)
2. `providers/<name>/client.ts` — the Provider implementation and its metadata
3. `hooks/main.tsx` — add the id to `providerFactory`
4. A command (or tool) that calls `hub.useProvider(id)`; `open()` always selects `browser`, `/transom reader` selects `reader`
5. If it introduces persistent state, extend `PluginState` in `types/index.d.ts`

The hub's constructor takes `{ providerFactory(id): Provider }`; `useProvider(id)` stops the previous provider when it owns a process and clears snapshots. Audit rows use `meta.id`.
