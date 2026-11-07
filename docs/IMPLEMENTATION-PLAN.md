# Transom implementation plan

Status: final; implemented
Date: 2026-11-07
Upstream: [README](../README.md) (positioning, landscape, engine research)
This document resolves the open questions left by the README and reduces the roadmap to executable milestones.

---

## 0. Conclusions first

Transom is a Claude Code function-hooks plugin. It collapses an external application into two interfaces — `snapshot()` for structured state and `act()` for structured actions — and serves the same pair to **people** (the session pane) and the **model** (`mcp__transom__*` tools). Every action passes capability negotiation, focus arbitration, permissions and audit.

v0.1 ships one provider: **headless Chromium over CDP**. It is both the proof of the product and the test bed for the provider contract. The contract is written for many providers from day one, but v0.1 does not ship a second one.

Decisions on three open questions:

| Question | Decision |
|---|---|
| tmux boundary | tmux owns session survival and terminal splitting; Transom owns **in-application** focus, scrolling and addressing. They do not overlap: Transom is not a multiplexer, tmux is not a DOM. |
| WeChat in the first wave? | No. The first provider must **have a protocol** (CDP). With no PTY, TUI-scraping targets wait until the contract is stable. |
| Confirmation granularity | Provider-level defaults plus action levels: reads pass; writes are confirmed per action by default (configurable per provider to `once`/`auto`); navigation to an unlisted host is always confirmed. |

## 1. Goals and non-goals

### 1.1 Acceptance goals (at repository completion)

1. In an interactive Claude Code session, `/transom open <url>` opens a pane containing a human-readable, clickable application snapshot.
2. The model can call `transom_snapshot` / `transom_act` / `transom_screenshot` and operate the same page through the same action queue as a person; every model action is visible in the pane and audited.
3. Snapshots are structured and stably addressable (each interactive node has a ref stable within the snapshot), not screenshot guessing.
4. Allowlists take effect: unlisted hosts, `file:`, and non-http(s) schemes are refused with a reason.
5. Every action is audited (who, when, which ref, result) and the audit is readable from the session.
6. Process supervision: a Chrome crash does not take down the session; the pane shows an error state and can reconnect; `session.end` cleans the process tree.
7. Degradation: narrow terminals/tmux fall back to the text tier; keyboard affordances disappear when unsupported.
8. `claude plugin validate` passes, `tsc --noEmit` passes, `claude plugin test` passes.

### 1.2 Non-goals (v0.1)

- Terminal emulator, multiplexer, standalone host.
- Pixel-perfect fidelity, audio/video, multiple tabs.
- Third-party provider distribution (the directory is reserved; providers stay in core).
- Full interaction on cloud/mobile surfaces (they must not crash; desktop and terminal come first).

## 2. Landscape correction and positioning

(Independently verified against the README; conclusions in §2.3; per-project data in [`COMPETITORS.md`](COMPETITORS.md).)

### 2.1 Verified neighbours

- **sandipchitale/browser-pane**: in-session browser tabs, explicitly without DOM reads or click driving → viewing only.
- **open-claude-in-chrome / safari-mcp / cdpilot / browser-debugger-cli / chrome-devtools-mcp / playwright MCP**: the model can drive, but the window is outside the session → a person cannot see what the model is doing, and the model does not see a person clicking in the other window.
- **pinkpixel-dev/claude-workspace, repoviewer, cli-mod**: file-domain panes; they never touch an external application.
- **Claude Code desktop Browser pane**: DOM-level tools for the model, but only inside the desktop process; it cannot reach an SSH session.

### 2.2 The remaining gap

Since 2026-07, [zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser) (MIT, 4.5k★) has shipped "in-session browser + model actions": kitty-graphics offscreen rendering, `/browser`, actions through the `agent-browser` CLI. The desktop app also ships a DOM-level Browser pane. So the gap is not "a browser in the session"; it is:

1. **A provider-agnostic framework**: capability negotiation, focus arbitration, supervisor, allowlists, audit — competitors have only a browser, not a contract.
2. **Registered tools rather than a shell CLI**: `mcp__transom__*` has typed inputs and outputs; no Bash permission prompt, no shell quoting.
3. **One action queue for people and models**: one provenance tag, one focus, one audit. terminal-browser's tools only hand a URL to the model, which then types CLI commands itself.
4. **Remote and tmux as first-class**: rendering degrades to plain text without kitty graphics; terminal-browser breaks under tmux and reports wrong coordinates.

### 2.3 Dangers to hold

- **terminal-browser absorbing the browser case**: differentiation rests on the framework, registered tools, remote usability and audit. The browser provider only has to be good enough; do not compete on rendering fidelity.
- **Context blow-up**: a full DOM is easily hundreds of thousands of characters. Default to the visible region plus a landmark summary plus a hard cap; the full page is opt-in.
- **No login state in headless Chrome**: start from a clean throwaway profile; a logged-in target needs a one-off window or imported cookies, never the user's daily browser by default.
- **Desktop overlap**: yield locally when typography matters; never claim to replace a browser.
- **Page prompt injection**: snapshots are untrusted input; validate scheme/host before and after navigation; confirm writes by default.
- **Early-access engine**: every `$` touch sits in `engine/`, so API changes land in one layer.
- **Chrome supply chain**: use the locally installed browser only; never download a binary; keep launch flags minimal.

## 3. Architecture

### 3.1 Layers and dependency direction

Dependencies point inward: only `engine/` touches `$`, only `providers/` touch external applications, `hub/` sits between.

```text
.claude-plugin/plugin.json     manifest
hooks/hooks.json               module declaration
hooks/main.tsx                 single registration point: wiring, lifecycle, events to the hub
engine/                        engine adapter (the only code importing 'claude-code' and using $)
  adapter.ts                   typed thin shell over $ + helpers
  supervisor.ts                child lifecycle, handshake, health, backoff, process cleanup
  frame-clock.ts               frame clock (design; implemented via engine subscriptions)
  focus.ts                     global focus token (design; delegated to the engine)
  render.ts                    shared snapshot → text tree / Raster renderer
hub/
  registry.ts                  provider registry (design; inlined into hub.ts in v0.1)
  negotiate.ts                 capability negotiation and degradation
  permissions.ts               scheme/host allowlists, action levels, confirmation
  audit.ts                     audit ring buffer ($.store persistence + session queries)
  actions.ts                   shared action queue (design; Hub.enqueue)
providers/browser/
  contract.ts                  concrete provider contract (capabilities, allowlist metadata)
  client.ts                    HTTP client for the bridge (token, reconnect)
  snapshot.ts                  snapshot trimming/projection (design; projection lives in hub)
  render.tsx                   pane Client module (drawing + pointer/keyboard → post)
  meta.ts                      size thresholds, launch flags, discovery
bridge/                        Node side (spawned by the supervisor, never imported by the engine)
  bridge.mjs                   HTTP service: /health /snapshot /act /shot /raster /stop, token check
  cdp.mjs                      minimal CDP client (WebSocket, no third-party dependencies)
  page-agent.mjs               injected snapshot/action implementation (function source strings)
  paths.mjs                    browser discovery
demo/
  server.mjs                   static server + fixture app
  app.html                     controllable fixture (forms, lists, overlays, scrolling)
tests/                          plugin tests (claude-code/testing) and bridge tests
docs/
  IMPLEMENTATION-PLAN.md       this document
  COMPETITORS.md               verified landscape data
  SECURITY.md                  threat model and checklist
  PROVIDERS.md                 provider author guide
```

### 3.2 Actual file map (v0.1)

`engine/frame-clock.ts`, `hub/registry.ts` and `hub/actions.ts` were not split out: the frame clock is the engine's `surface.every`/state subscription, the registry is inlined into `hub/hub.ts` because there is one provider, and the action queue is `Hub.enqueue`. Everything else landed as designed:

```text
.claude-plugin/plugin.json  marketplace.json  icon.png
hooks/main.tsx              wiring, commands, pane, Ops literal
hooks/tools.ts              five model tools + output projection
engine/ops.ts               narrow interface types
engine/adapter.ts           fetchJson / ask / store helpers
engine/supervisor.ts        child, handshake, health, backoff, stop
hub/hub.ts                  action queue, view projection, audit wiring, state machine
hub/permissions.ts          scheme/host allowlists and action levels
hub/audit.ts                ring audit + $.store persistence
hub/negotiate.ts            capability negotiation and degradation
providers/browser/contract.ts  Provider contract
providers/browser/client.ts    Provider implementation (HTTP → bridge)
providers/browser/keys.tsx     keyboard Client
providers/browser/rows.ts      pane rows → actions
bridge/bridge.mjs           HTTP + Chrome lifecycle + /raster
bridge/cdp.mjs              dependency-free CDP WebSocket client
bridge/page-agent.mjs       injected snapshot/action scripts
bridge/paths.mjs            browser discovery
demo/                       fixture app and static server
tests/                      plugin tests, supervisor unit tests, bridge E2E
scripts/make-icon.mjs       generates the 512px icon
```

### 3.3 Provider contract

```ts
type Capabilities = {
  pointer: boolean; keys: boolean; scroll: boolean; images: boolean;
  text: boolean; minCols: number; minRows: number;
};

type SnapshotRequest = { scope: 'viewport' | 'document'; maxChars: number };
type Snapshot = {
  provider: string; url: string; title: string; capturedAt: number;
  viewport: { cols: number; rows: number; scrollX: number; scrollY: number };
  capabilities: Capabilities;
  landmarks: Array<{ role: string; name: string; ref?: string }>;
  nodes: Array<SnapshotNode>;          // visible region, document order
  truncated: { nodes: number; reason: string };
};

type SnapshotNode = {
  ref: string;                          // stable within the snapshot and its document, e.g. "e12"
  role: string;                         // button/link/textbox/heading/text/image/...
  name: string;                         // accessible name or text, whitespace collapsed
  value?: string;                       // form value (passwords masked)
  state?: { disabled?: true; checked?: boolean; expanded?: boolean;
            selected?: boolean; focused?: true };
  bounds: { x: number; y: number; w: number; h: number };
  depth: number;
};

type Action =
  | { kind: 'click'; ref: string }
  | { kind: 'fill'; ref: string; text: string }
  | { kind: 'select'; ref: string; value: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; dx: number; dy: number }
  | { kind: 'hover'; ref: string }
  | { kind: 'navigate'; url: string }
  | { kind: 'back' } | { kind: 'forward' } | { kind: 'reload' };

type Provider = {
  id: string;
  capabilities: Capabilities;
  start(opts: StartOptions): Promise<void>;
  stop(): Promise<void>;
  isAlive(): Promise<boolean>;
  snapshot(req: SnapshotRequest): Promise<Snapshot>;
  act(a: Action, ctx: ActContext): Promise<ActResult>;
  screenshot?(): Promise<{ pngBase64: string; cols: number; rows: number }>;
};
```

`act` returns `{ ok, changed, message, auditId }`; `changed` tells the pane whether to refresh immediately. A provider throwing is normalized into an `ActResult` error; it never escapes upward.

### 3.4 Action flow

```text
person clicks a pane row ──ui.message──┐
                                       ├─→ Hub.enqueue(actor, action)
model calls a tool ────────tool.call───┘        │
                                                ├─ permissions.decide → allow/ask/deny
                                                │        └─ ask → $.ui.ask (per action or session grant)
                                                ├─ audit.begin(actor, action)
                                                ├─ provider.act
                                                ├─ audit.end(result)
                                                └─ pane refresh (human actions also echo to the status line)
```

The queue is serial and carries `actor: 'person' | 'model'` on every action. Provenance is written to both the audit and a short `$.ui.log` line.

### 3.5 Focus token

- Design: a single global `FocusToken` `{ holder: 'prompt' | 'pane'; since }`.
- A pane click acquires it; `Esc` unconditionally returns it (`closeOnEscape` stays off).
- `surface.onKey` forwards keys only while the token is held; pointer events still forward when it is not (`fine` coordinates mapped to CSS pixels).
- `turn.complete` neither unmounts the pane nor steals focus.
- **Implemented:** the token is delegated to the engine's pane focus (`isFocused`); there is only one focus state to keep in sync.

### 3.6 Rendering and degradation

- Text tier (default): a list of `Box/Text/Button`, colored by `role`, with refs as clickable keys.
- Colored-cell tier (M3): a `Raster` covering the visible region (the bridge downscales with Chrome's own canvas into u32 cells) plus a thin `Client` for pointer input; dirty-rectangle repaint is planned.
- Image tier (optional): `Image` on kitty/iTerm2-capable terminals.
- Negotiation: `columns < minCols` or `rows < minRows` → summary line; tmux (no `fine`) → drop sub-cell hover precision; `keys=false` → hide the keyboard strip.
- Frame rate: text refreshes on actions/polling; Raster is manual in v0.1; stop the clock when hidden or unfocused.

### 3.7 Context policy

- Tools default to `scope: 'viewport'` with a hard cap of 12,000 characters (configurable up to 30,000).
- Overflow is trimmed by importance: keep `landmarks` and interactive nodes first, then truncate text nodes, and report `truncated`.
- `scope: 'document'` only on explicit request, and still capped.
- Snapshots carry `capturedAt`; repeated identical pages can be summarized.

### 3.8 Permission model

- Configuration (`plugin.json` `userConfig` with defaults): `allowedHosts` (comma-separated, `localhost` always allowed), schemes fixed to http/https, `writePolicy` (`confirm` | `once` | `auto`, default `confirm`), `snapshotMaxChars`.
- Every `navigate` parses the URL first: a non-allowed scheme is denied; an unlisted host is confirmed and then allowed for the session.
- Writes (click/fill/select/press/back/forward/reload) follow `writePolicy`; reads (snapshot/screenshot/scroll/hover/focus) never confirm.
- Submit-like actions (Enter, clicking `type=submit`) are flagged `submits` and are confirmed even under `once`.
- All confirmations go through `$.ui.ask`; anything other than the exact allow labels is a deny, and the model receives the reason.
- Credentials: never injected, never read from password fields (`value: "••••"`); a logged-in target uses the user's own profile only if they opt in.

### 3.9 Audit

- Each entry: `{ id, ts, actor, provider, action, url, policy, ok, durationMs, message }`.
- 500-entry in-memory ring plus 2,000 persisted in `$.store` across sessions; `/transom audit` prints the recent entries.
- Model actions carry an `auditId` in the tool result; human actions flash in the pane footer.
- Failures and denials are recorded too.
- `fill` text is never recorded — only the ref and character count.

### 3.10 Process and crash handling

- The bridge starts first (first stdout line `{"ready":true,"port":N}`), then launches Chrome with `--headless=new --remote-debugging-port=0 --user-data-dir=<temp> --no-first-run --disable-extensions --hide-scrollbars` and reads `DevToolsActivePort` for the port.
- `/health` every 5 s; on failure, back off (250 ms × 2^n, capped at 8 s), restart up to 4 times, then show the error pane.
- `session.end`, module unload and `/transom close` all call `stop()`: `Browser.close`, then the process tree.
- The error pane shows the reason, a Retry button that restarts the provider, and recent audit lines.
- The bridge shuts down after 30 idle minutes; health polls do not count as activity, and the supervisor treats an idle exit as deliberate (no restart).

### 3.11 Engine adapter layer

- `engine/ops.ts` defines the narrow surface: pane open/close, ask, tool registration helpers, store, log/status/toast, spawn, fetch, clock.
- `Ops` is constructed inline in `hooks/main.tsx`, because `claude plugin validate` forbids passing `$` across modules.
- The session version is logged at start; unknown major versions enter conservative mode (text tier only).
- All gating hooks carry `.catch` and fail closed.

## 4. Milestones and acceptance

| Milestone | Content | Acceptance | Status |
|---|---|---|---|
| M0 probe | Minimal manifest, pane, Client pointer, child stdout plumbing | `validate` passes; pane clickable, coordinates reported | ✅ Done |
| M1 contract and bridge | Provider contract, supervisor, bridge, CDP, snapshot/act, demo | Bridge E2E green: launch, snapshot, click, fill, scroll, navigate | ✅ Done (19 integration tests) |
| M2 shared channel | Hub, permissions, audit, tool registration, pane interaction, focus | `claude plugin test` green; a model click and a person click produce the same audit shape | ✅ Done (30 tests) |
| M3 visual tier | Raster downscale, dirty repaint, Image tier | Stable frame rate; ≤1 cell coordinate error | ✅ Half-block Raster and HQ file-image tier done; dirty repaint pending |
| M4 degradation and crashes | Negotiation, error pane, backoff, process cleanup | Recovery after killing Chrome; summary line in narrow panes | ✅ Negotiation/restart/idle done; real kill smoke verified via tests |
| M5 docs and packaging | SECURITY, PROVIDERS, marketplace, icon | Clean-folder install works; README install section accurate | ✅ Done; manual install smoke by the user |

### Implementation deviations (final)

1. **Raster decoding happens in the page**: after a screenshot, the page's own `OffscreenCanvas` downscales into half-block u32 cells, avoiding a third-party image library. Each cell uses the upper half as background, the lower half as foreground, code point U+2584.
2. **Visual frames are not state**: a Raster frame can be 512×256×12 bytes, too large for `$.state`; it lives in a module variable in `hooks/main.tsx` and falls back to text after a hot reload.
3. **`$` never crosses modules**: the validator forbids passing `$` as an argument; the hub and providers take the narrow `Ops` interface, constructed inline in the hooks module.
4. **Fake bridge in tests**: `claude plugin test` has no network or processes; `tests/helpers.ts` impersonates the bridge in memory and covers permissions, audit, rendering, degradation and restart.
5. **Health and idle**: 5 s health checks, 250 ms×2^n backoff, 4 restarts, then the error pane; the bridge stops after 30 idle minutes.
6. **Focus delegated to the engine**: no second token; a pane click focuses it, Esc returns the keys, and `ui.render` reads `isFocused` to decide whether to forward keys.
7. **Tool results are plain text**: 2.1.319 validates `result` for plugin tools without an output schema as a string; MCP `{content:[...]}` is rejected. Every tool returns `{ result: text, text }`; screenshots return text (the image tier belongs to the pane).
8. **Mouse depends on the fullscreen layout**: inline panes receive no mouse events (an engine rule); with `CLAUDE_CODE_NO_FLICKER=1` the pane docks right and clicks work. Inline panes show a hint and support `ctrl+x tab` keyboard focus.
9. **`-p` loads plugin tools in practice**: contrary to the official docs, 2.1.319 registers them; this was used for headless real-model verification. Interactive TUI sessions inside a nested PTY hang on API calls, so interactive testing is manual.
10. **The queue is FIFO with decisions inside it**: permission decision, confirmation and execution form one critical section, so the page cannot be swapped between "Allow" and the action. A person's click does not preempt a pending model confirmation; in practice the engine blocks pane input while a dialog is open. Priority preemption, if ever needed, comes later.

After each milestone: `tsc` + `validate` + tests + a local commit.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Early-access API changes | Only `engine/ops.ts` and `engine/adapter.ts`; version check, conservative mode on major changes |
| No PTY / one-shot stdin | Bridge pattern: HTTP + token, long-lived process |
| Pages hostile to snapshot scripts (shadow DOM, iframe, canvas) | Recurse into open shadow roots; same-origin iframes expanded, cross-origin placeholders; canvas via the visual tier |
| CSP blocking the snapshot script | Inject function source through `Runtime.evaluate`, never a `<script>` |
| Reflow invalidating refs | Refs bind to the backend node and are validated before acting; invalid refs return `stale` with a fresh snapshot |
| Context pollution | §3.7 policy plus hard caps |
| Port/token leakage | Loopback only, random token, passed via the child environment, never the command line |
| Multiple Chrome instances | One supervisor instance; `/transom close` releases immediately; 30-minute idle stop |
| Orphaned Windows process trees | Kill the child tree, remove the temporary profile (best effort) |

## 6. Threat model summary

See [`SECURITY.md`](SECURITY.md). Key points: the bridge is a loopback code-execution surface (`Runtime.evaluate`) and must validate the token and reject browser `Origin`; pages can forge any snapshot content, so snapshots are always untrusted input; `javascript:` and `data:` are never allowed; scheme/host checks run before and after navigation; page text is never executed as rich content.

## 6.1 Real-session verification (2026-11-07, Claude Code 2.1.319)

- Interactive with `CLAUDE_CODE_NO_FLICKER=1`: `/transom demo` docks the pane on the right; an SGR mouse click on `Increase count` changes the counter 0→1 and records `person click ... 89ms` in the audit.
- Headless `claude -p` with a real model: `browser_open` + `browser_snapshot` return the page title and nodes; `browser_act` is denied under `-p` because no person can confirm — fail-closed as designed.
- Found and fixed: tool result shape (object → string), refs rebinding across navigation, case-sensitive password masking, covered clicks reporting false success.

## 7. Test strategy

1. **Static**: `tsc --noEmit`; `claude plugin validate`.
2. **Bridge integration** (Node, no engine): demo server plus real headless Chrome; assert snapshot nodes, post-click state, token rejection, stale refs, covered targets, password masking, raster sizes, process stop.
3. **Plugin tests** (`claude plugin test`): fake `http.fetch` and `spawn` in memory; cover permission levels, audit, pane rendering, focus forwarding, degradation, restart races.
4. **Manual smoke**: in a session, `/transom open http://127.0.0.1:PORT/`, person and model actions, network loss, killed process.
5. **Regression**: one snapshot assertion per fixture type (form, list, shadow DOM, iframe, long document, canvas, overlay).

## 8. Success metrics

- Closed-loop time: action → snapshot refreshed (timestamps in the audit).
- `act` success rate / `stale-ref` rate / misclick rate.
- Idle CPU, per-frame cost, snapshot bytes and token count.
- Degradation hit rate and task completion under degradation.

Metrics live in the audit's `durationMs` and debug lines; there is no separate telemetry.

## 9. Open questions (later)

1. Is the coordinate error of the Raster + Client composite acceptable on real terminals?
2. Should providers be third-party distributable? Start internal; pluginize through the `types/index.d.ts` contract once it settles.
3. Focus and resource quotas when several providers coexist.
4. `Client` support on mobile surfaces.
