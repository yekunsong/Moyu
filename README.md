# Transom

**English** | [简体中文](README.zh-CN.md)

> A side pane for any app inside a Claude Code session — visible to you, operable by you, callable by the model.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-early%20access-orange)](#status)
[![Claude%20Code](https://img.shields.io/badge/Claude%20Code-2.1.319-6f42c1)](https://code.claude.com)

```bash
/plugin install transom --marketplace <owner>/<repo>
```

Transom collapses an external application into two interfaces — `snapshot()` to read structured state, `act()` to perform structured actions — and renders them in a session pane. People and the model share the same channel, every action is audited, and writes are gated by permissions.

Moving the window into the terminal is a side effect. The product is **structured, addressable, auditable application state**.

---

## Table of contents

- [Why Transom](#why-transom)
- [Features](#features)
- [Status](#status)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Model tools](#model-tools)
- [Pane controls](#pane-controls)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Security](#security)
- [Engine notes](#engine-notes)
- [Rendering tiers](#rendering-tiers)
- [Compatibility and limitations](#compatibility-and-limitations)
- [Development](#development)
- [Roadmap](#roadmap)
- [Landscape](#landscape)
- [Open questions](#open-questions)
- [Glossary](#glossary)
- [References](#references)
- [License](#license)

## Why Transom

### Where it fits

- **The terminal is the only entry point.** SSH boxes, containers, tmux. The Claude Code desktop app has a Browser pane with DOM and click tools, but it **cannot reach those machines** — the docs say SSH sessions do not get those tools.
- **Sessions outlive connections.** A tmux/screen session survives network changes and machine switches. A desktop window does not.
- **No graphical environment.** Servers, CI, containers without X. There is no browser window to open.
- **The model needs registered actions, not screenshots.** Transom exposes `snapshot`/`act` as tools registered in the session — no Bash, no shell quoting, typed results, a token budget, available in any terminal.
- **Review in place.** The transcript and the application live in one view: change, look, correct, without switching windows.

### Where it deliberately does not fit

| Need | Use instead |
|---|---|
| Local development, typography, video, precise dragging, multi-tab browsing | Desktop Browser pane / a real browser |
| Pure local coding with no UI | The CLI alone |
| Pixel-perfect acceptance | The desktop app |

**Transom is infrastructure for heavy remote users, not a desktop replacement.** The audience is small and the ceiling is low (cell resolution, 2–5 fps), but the "visible in-session + callable by the model" slice is still unclaimed in the way Transom claims it.

## Features

- **One channel for people and models.** The pane and `mcp__transom__*` tools feed the same serial action queue; every action records actor, target, policy, result and duration.
- **Structured snapshots, not screenshots.** A stable-ref object graph with roles, accessible names, values, state and bounds. Refs carry a document generation, so navigation cannot silently rebind them; stale refs return `stale` instead of clicking the wrong thing.
- **Provider framework.** Capability negotiation, supervisor, allowlists and rendering live in the hub; the browser is the first adapter, not the only possible one.
- **Permissioned by default.** http(s)-only navigation, host allowlist (`localhost` always), model writes confirmed per action (or `once`/`auto`), exact-label approval, fail-closed confirmations.
- **Audited.** Human and model actions land in the same ring buffer and in `$.store`; fill text is redacted.
- **Two rendering tiers.** Text (buttons and rows, any terminal) and colored cells (half-block Raster, 24-bit color). Degrades to a summary line in narrow panes.
- **Crash-isolated.** A supervised local bridge owns headless Chromium; health checks, backoff restarts, idle shutdown, and process-tree cleanup on close.
- **Untrusted page content is treated as data.** Snapshots start with an explicit banner; page strings are control-character-stripped before dialogs; clicks hit-test `elementFromPoint` and report covered targets.

## Status

v0.1, early access. The Claude Code function-hooks API is early access and may change between releases. Milestones M0–M5 are complete; see [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) for the design, deviations and verified findings. The phased 0.2 plan (text UI, HQ image tier, attach mode, Linux, UX fixes) is in [`docs/ROADMAP-0.2.md`](docs/ROADMAP-0.2.md).

## Requirements

- Claude Code 2.1.x with function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`), in an **interactive terminal**.
- Node.js 20+ (22 recommended).
- A local Chrome, Chromium or Edge — or set `TRANSOM_CHROME` to an executable path.

## Installation

From a terminal session:

```bash
/plugin install transom --marketplace <owner>/<repo>
```

Develop from a folder:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 CLAUDE_CODE_NO_FLICKER=1 \
  claude --plugin-dir D:/Study/transom
```

`CLAUDE_CODE_NO_FLICKER=1` enables the fullscreen layout: the pane docks to the right and **mouse clicks reach the buttons**. Without it the pane renders inline above the prompt, where mouse events do not reach it — use `ctrl+x tab` to give the pane the keyboard, then Tab/Enter.

> Official docs say function hooks are interactive-only. On 2.1.319, `claude -p` also loads plugin tools (`--allowedTools mcp__transom__…` works headlessly), but that is early-access behaviour and is not guaranteed.

## Quick start

```text
/transom demo          # start a local fixture and open it in the pane
```

Click **Increase count** in the pane. Then ask the model:

> Call `mcp__transom__browser_snapshot`, then use `browser_act` to click the button named "Increase count", then snapshot again and report the counter.

The model's write is confirmed before it runs. `/transom audit` shows both actions, attributed to `person` and `model`.

## Commands

| Command | What it does |
|---|---|
| `/transom` | Open the pane |
| `/transom open <url>` | Open the pane and navigate (localhost/127.0.0.1 and configured hosts by default) |
| `/transom demo` | Start the local fixture (counter, form, list, canvas, shadow DOM, iframe, long scroller) and open it |
| `/transom attach <port>` | Attach to a Chrome already running with `--remote-debugging-port=<port>`; `/transom close` detaches without closing it |
| `/transom audit` | Show the last 20 audit entries |
| `/transom close` | Close the pane and stop the browser (in attach mode: detach only) |

### Attach to a browser you started

Transom can mirror and control an existing Chrome instead of launching its own. Start Chrome with a debugging port — the flag only applies to a new process, so quit Chrome first — then attach:

```text
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=%TEMP%\transom-chrome
/transom attach 9222
```

The pane connects to the first tab (preferring an http/https page) and drives it in place; `/transom close` detaches and leaves Chrome running. Pass your normal profile directory instead of the temporary one if you want the browser's existing cookies and logins — attach mode inherits that state. See [`docs/SECURITY.md`](docs/SECURITY.md).

## Model tools

| Tool | Access | Purpose |
|---|---|---|
| `mcp__transom__browser_open` | write (navigation) | Open the pane and navigate; unlisted hosts require confirmation |
| `mcp__transom__browser_snapshot` | read | Structured page snapshot: URL, title, landmarks, ref-tagged nodes |
| `mcp__transom__browser_act` | read/write | `click`, `clickAt` (viewport px), `fill`, `select`, `press`, `scroll`, `hover`, `focus`, `navigate`, `back`, `forward`, `reload` |
| `mcp__transom__browser_screenshot` | read | Capture the viewport as a PNG for visual checks |
| `mcp__transom__browser_audit` | read | Recent actions with actor and outcome |

Snapshots return the visible region by default; `scope: "document"` asks for the whole page. Both are capped by `snapshotMaxChars`. Refs are valid until the next snapshot or navigation.

## Pane controls

- **Mouse** requires the fullscreen layout (`CLAUDE_CODE_NO_FLICKER=1`); inline panes support keyboard focus only.
- Clicking a row executes immediately (a person can see the page). Model writes are confirmed according to `writePolicy`.
- Text fields and selects are edited inline: type and press Enter, or pick an option; no dialog.
- Rows are grouped under page headings with a fixed status bar; `↓ next block` scrolls the page when the snapshot is longer than the pane.
- `visual` switches to the colored-cell tier; `hq` shows a real PNG frame (kitty, Ghostty, WezTerm), refreshed about once a second, and clicking the picture clicks the page; both return to text with another press.
- Click the keyboard strip to forward keys to the page; Esc returns them to the prompt.
- Panes narrower than 48 columns show a degradation notice.

## Configuration

`plugin.json` → `userConfig`:

| Option | Default | Meaning |
|---|---|---|
| `allowedHosts` | `localhost,127.0.0.1` | Comma-separated hosts; localhost is always allowed. Wildcards: `*.example.org`. |
| `writePolicy` | `confirm` | `confirm` (each write), `once` (first write per session; submits still confirmed), `auto` |
| `snapshotMaxChars` | `12000` | Hard character cap on a snapshot handed to the model |

## Architecture

Dependencies point inward; only the hooks module touches the engine API.

```text
hooks/main.tsx          registration, commands, pane, Ops literal
hooks/tools.ts          five model tools and output projection
engine/ops.ts           narrow interface over $
engine/adapter.ts       fetchJson / ask / store helpers
engine/supervisor.ts    bridge process, handshake, health, backoff, stop
hub/hub.ts              serial action queue, view model, audit wiring
hub/permissions.ts      scheme/host allowlists, action classification
hub/audit.ts            ring buffer + $.store persistence
hub/negotiate.ts        capability negotiation and degradation
providers/browser/      provider contract, HTTP client, pane rows/keys
bridge/                 localhost HTTP + CDP + injected page agent
demo/                   fixture app and static server
tests/                  plugin tests, supervisor unit tests, bridge E2E
```

### Provider contract

```ts
type Provider = {
  readonly meta: {
    id: string
    label: string
    capabilities: {
      pointer: boolean; keys: boolean; scroll: boolean; images: boolean
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

Reusable refs must come from the application's own object identity, not coordinates or indices. When a ref is no longer valid, the provider reports `stale`; it must never silently act on a different element. See [`docs/PROVIDERS.md`](docs/PROVIDERS.md).

### Key mechanisms

- **Capability negotiation:** narrow panes and terminals without pointer/key support degrade to text or a summary line.
- **Supervisor:** one bridge per provider, handshake, health polling, exponential backoff, idle shutdown, process-tree cleanup.
- **Shared queue:** permission decision, confirmation and execution run as one critical section; a stale page cannot slip between "Allow" and the action.
- **Context policy:** visible region plus landmark summary; the whole page is opt-in and always capped.
- **Fail-closed:** only the exact `Allow` labels approve; free text or a dismissed dialog denies.

## Security

See [`docs/SECURITY.md`](docs/SECURITY.md). In short: the bridge is a loopback HTTP service guarded by a per-start random bearer token and rejects browser `Origin`; Chrome runs with a throwaway profile (attach mode instead uses the browser you started); navigation is http(s)-only and host-allowlisted; password values are masked; page text is untrusted data, never instructions; every action is audited.

Known non-goal: a model click on a link can navigate to a host outside the allowlist as a side effect. Under `confirm`/`once` the click itself is confirmed; `auto` gives that protection up.

## Engine notes

Measured on Claude Code 2.1.319, local, interactive terminal.

### Available

| Capability | API |
|---|---|
| Side pane | `$.ui.open({ id, title, columns })`; docks at ≥110 columns once asked (144 unasked) |
| Rendering | `Client` tree, `Raster` (u32 `[codePoint, fg, bg]` per cell), `Image`, `Svg`, `Markdown`, `Code` |
| Frame clock | `surface.every(ms, fn)`; redraw ≤10/s (30/s for a shown terminal pane); `$.ui.blit` up to ~60/s |
| Pointer | `surface.onPointer` with `down/move/up/enter/leave`; sub-cell `fine.x/y` on kitty, Ghostty, iTerm2, WezTerm, foot |
| Keyboard | `surface.onKey` after click focus; Esc always returns the keys |
| Sizes | `Client` width/height accept percentages; `surface.columns/rows` are measured cells |
| Surfaces | One tree, per-surface via `e.surface`: terminal/desktop/vscode/mobile |
| Processes | `$.process.spawn` (stdout stream, one-shot stdin), `$.process.run` |
| Network / files | `$.http.fetch`, `$.mcp.connect`; `$.fs` reads ≤4 MiB |
| Model interface | `$.tool.register`, `$.session.append`, `$.ui.ask` |
| State | `$.state` (session) / `$.store` (cross-session) with typed contracts |

### Hard constraints

1. **`spawn` stdin is one-shot and there is no PTY.** Interactive programs need a control port (CDP / JSON-RPC / socket) or a single-process design.
2. **`Client` cannot embed `Raster`/`Image`.** High frame rate and pointer input require a composite layer: Raster for pixels, a thin Client for pointer events.
3. Three consecutive `setState` calls with no event trip the render-loop detector and unmount the instance.
4. A tree is capped at 20k nodes / 100k characters; a Raster at 512×256.
5. Terminals report no key-up; tmux does not forward sub-cell `fine` coordinates.
6. Mouse input works only in the fullscreen layout (`CLAUDE_CODE_NO_FLICKER=1`).
7. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is required. Officially interactive-only; 2.1.319 also loads tools under `-p` (see [Installation](#installation)).
8. Early access: interfaces move between releases.

## Rendering tiers

| Tier | Content | Cost | Status |
|---|---|---|---|
| Text | Text, links, form structure, colored | Low | Shipped |
| Colored cells | Raster downscale, 24-bit color, clickable by row | Medium | Shipped (`visual`) |
| Images (HQ) | `Image` with a PNG file source; kitty, Ghostty, WezTerm | Medium | Shipped (`hq`), ~1 fps |

The color is real 24-bit foreground/background, not monochrome. Cells are still an image, not the thing itself: small type blurs and rounded shadows disappear.

## Compatibility and limitations

- **Terminals:** kitty, Ghostty, iTerm2, WezTerm and foot get the full feature set; Windows Terminal and GNOME degrade; tmux loses sub-cell precision.
- **Interactive only:** desktop app, mobile and headless sessions do not draw the pane.
- **Headless Chrome only:** no logged-in profile by default; no extensions, no audio, no tabs.
- **No JS-rendered canvas semantics:** canvas content participates as an image, not as nodes.
- **Raster is manual:** `visual` repaints on demand; `hq` refreshes at ~1 fps. No dirty-rectangle streaming yet.
- **HQ terminals:** `hq` needs a terminal that reads a PNG path itself (kitty, Ghostty, WezTerm); iTerm2, tmux and Windows Terminal stay on the text tier.

## Development

```bash
npm test          # typecheck + plugin validate + plugin tests + bridge E2E
npm run typecheck
npm run validate
npm run test:plugin
npm run test:bridge
```

- `tests/bridge/bridge.test.mjs` starts a demo server and real headless Chrome: snapshots, clicks, fills, shadow DOM, frames, raster, stale refs, covered targets, password masking.
- `tests/*.test.ts` run in the engine test kit against an in-memory fake bridge: permissions, audit, rendering, degradation, restart races.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), imperative, English. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Roadmap

- **M0–M5 (done):** probe, provider contract + bridge, shared human/model channel, colored-cell tier, degradation and recovery, docs and packaging.
- **Next:** dirty-rectangle raster streaming and an image tier; `once`-policy end-to-end test; a second provider (Minecraft or a LINE gateway) to pressure-test the contract.
- **Later:** third-party provider distribution via the `types` contract; multi-provider focus and resource quotas; mobile surface support.

## Landscape

Transom is not the first in-session browser. [`zenbu-labs/terminal-browser`](https://github.com/zenbu-labs/terminal-browser) (MIT, ~4.5k★) ships a pane + model actions through the `agent-browser` CLI; the Claude Code desktop app ships a DOM-level Browser pane. The gap Transom aims at is narrower:

1. **Provider-agnostic framework** — capability negotiation, supervisor, allowlists and audit for any app, not just a browser.
2. **Registered tools, not a shell CLI** — typed inputs/outputs, no Bash permission prompt, visible-region token budget.
3. **One queue for people and models** — same focus, same audit, same `act()`.
4. **Remote and tmux as first-class** — text tier on any terminal, no kitty-graphics dependency.

Full verified table: [`docs/COMPETITORS.md`](docs/COMPETITORS.md).

## Open questions

1. Where is the boundary between Transom panes and tmux splits?
2. For targets without an official API (LINE/WeChat), do reconnect and ban risks justify a first-wave provider?
3. Confirmation granularity: per action is noisy, blanket approval is risky — is per-provider policy enough?
4. Can the Raster + Client composite hit acceptable frame rate and coordinate error?
5. Should providers become third-party distributable plugins, or stay in core until the contract settles?

## Glossary

- **Mod / function hooks:** the Claude Code plugin form that draws session UI, receives input and calls host capabilities.
- **Provider:** an adapter for an external application implementing `snapshot`/`act`.
- **Snapshot:** a structured serialization of application state shared by the model and the renderer.
- **Ref:** a snapshot-scoped address for a node; invalidated by navigation or a newer snapshot.

## References

- Engine types and long-form docs: generated under `.../bundled-skills/<version>/plugin-authoring/` beside the skill.
- Skeleton and feel references: [manfye/cc-dino](https://github.com/manfye/cc-dino) (click focus, `$.store`, 33 ms frames, out-of-room notices), [tomas-schmieder/clawd-run](https://github.com/tomas-schmieder/clawd-run) (`prompt.edit` empty-composer check, half-block bitmaps, type contracts, `NOTICE` attribution).
- Ecosystem: [claude-mods-starter-kit](https://github.com/promptadvisers/claude-mods-starter-kit) (MIT), [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods), [mods.aidojo.si](https://mods.aidojo.si/).

## License

[MIT](LICENSE).

The engine and most skeletons are permissively licensed (MIT/BSD-3). If a GPL-2.0 engine such as Doom is ever bundled, it must live in a separate directory with its own notice.
