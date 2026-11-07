# Provider author guide

v0.1 ships a single `browser` provider, but the contract is written for many. Adding a provider means four things: implement the contract, declare capabilities, declare permission metadata, and wire it into the hub.

## 1. Contract

`providers/browser/contract.ts` is the reference implementation.

```ts
type Provider = {
  readonly meta: {
    id: string
    label: string
    capabilities: {
      pointer: boolean; keys: boolean; scroll: boolean; images: boolean;
      text: boolean; minCols: number; minRows: number
    }
    allowSchemes: string[]
    defaultWidth: number
  }
  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }>
  snapshot(request: { scope: 'viewport' | 'document'; maxChars: number; cols: number; rows: number }): Promise<Snapshot>
  act(action: Action, context: { actor: 'person' | 'model' }): Promise<ActResult>
  screenshot?(cols: number, rows: number): Promise<{ pngBase64: string }>
  raster?(cols: number, rows: number): Promise<{ cells: string; columns: number; rows: number }>
}
```

### Snapshot

```ts
type SnapshotNode = {
  ref: string          // stable until the next snapshot/navigation; checked before acting
  role: string         // button/link/textbox/heading/text/...
  name: string         // whitespace-collapsed and truncated
  depth: number
  value?: string       // passwords masked
  interactive?: boolean
  submits?: boolean
  state?: { disabled?; checked?; expanded?; selected?; focused? }
  bounds: { x; y; w; h }
}
```

Hard requirements:

1. **A ref must derive from the application's own object identity**, never a coordinate or an array index. The browser provider uses `WeakMap<Element, string>`; other providers should use a stable id from their protocol.
2. **An invalid ref must be reported explicitly** (`ActResult.stale = true`) so the pane can retake a snapshot. Never silently act on a different element.
3. **Snapshots contain the visible region by default** and support a full-page request through `scope: 'document'`. Both obey `maxChars`.
4. **Never put credentials in values.** Password and token fields get a placeholder.

### Actions

The action set: `click` / `fill` / `select` / `focus` / `hover` / `press` / `scroll` / `navigate` / `back` / `forward` / `reload`. When capabilities are missing:

- No pointer: hide pane row clicks, keep action tools.
- No keyboard: do not render the keyboard strip.
- Declare the supported subset in `capabilities`; `hub/negotiate.ts` handles degradation.

`ActResult` must carry `message`. On success where the application may have changed, set `changed: true` so the hub refreshes.

## 2. Transport

The browser provider's pattern is recommended:

- One supervised local child process (`engine/supervisor.ts`) whose first stdout line is `{"ready":true,"port":N}`.
- Loopback HTTP with a random bearer token.
- At least `/health`, `/snapshot`, `/act`, `/stop`.

Do not assume Node, DOM or a PTY inside the plugin module. `spawn` stdin is one-shot and there is no PTY; interactive programs must expose their own protocol.

## 3. Permissions

Extend `classify()` in `hub/permissions.ts` with the action level (read / write / submit), and `decide()` with scheme and target allowlists. Unknown schemes are denied; writes are confirmed by default.

## 4. Rendering

For the text tier, returning `SnapshotNode[]` is enough: `projectRows` in `hooks/main.tsx` turns it into buttons and text. The visual tier is optional: implement `raster()` returning base64 of `columns * rows` u32 triplets `[codePoint, foreground, background]`.

## 4.1 Tool result shape (measured)

For a tool registered with `$.tool.register` and no output schema, `result` in the `tool.call` answer must be a **plain string**:

```ts
return { result: 'ok: clicked e12', text: 'ok: clicked e12' }
```

Returning MCP-style `{ content: [{ type: 'text', ... }] }` is rejected by 2.1.319 with
`does not match its output shape: invalid_union … expected string, received object`.
Serialize structured data into text (or declare an output schema if the build supports it).

## 5. Testing

1. Pure logic tests go in `tests/*.test.ts` (`claude plugin test .`).
2. Child-protocol tests use `node:test`, modelled on `tests/bridge/bridge.test.mjs`.
3. Cover at least: snapshot structure, click/fill, stale refs, scheme refusal, process stop.
4. Add a fake endpoint to `tests/helpers.ts` so plugin tests never depend on a real process.

## 6. Integration order

1. `providers/<name>/contract.ts` — capabilities and metadata
2. `providers/<name>/client.ts` — the Provider implementation
3. Instantiate it in `hub/hub.ts` (v0.1 has only the browser, constructed directly)
4. Add commands and a tool namespace in `hooks/main.tsx`
5. If it introduces persistent state, extend `PluginState` in `types/index.d.ts`
