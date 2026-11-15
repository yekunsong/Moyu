# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/). This project is early access; minor versions may change the engine-facing surface.

## [Unreleased]

## [0.4.0] - 2026-11-15

### Changed

- **The product is moyu.** The plugin, marketplace, pane id and state key, store prefixes
  (`moyu.progress.*`, `moyu.recent.v1`, `moyu.audit.v1`), the command and the tools are renamed;
  the command is `/moyu` and the tools are `mcp__moyu__{open,read,find,annotate,turn,boss}`.
- The browser stack is removed (`bridge/`, `providers/browser/`, `providers/reader/`, `demo/`,
  host and write permissions, the image and raster tiers, negotiation). The provider contract,
  serial queue, capability gate, audit and supervisor stay for later adapters.
- The provider contract is trimmed to `click` / `press` / `scroll` / `command` and text
  capabilities; `ops` gains `readText`, `listDir`, `statPath` and `fillPrompt`.
- The boss key is `q`, bound as a Client key and as a Button hotkey; the pane opens with
  `focus: true`, `closeOnEscape: true` and a transparent body. `ctrl+g` remains an alias while
  the pane holds the keys.
- The default theme is `auto`: no session theme is set or cleared, so the pane follows the
  person's own palette. `mono`, `paper` and `ink` are opt-in presets, cleared only when this
  plugin applied them.
- Reading position is written whenever it settles (open, snapshot clamp, turn), survives
  hide/close/reload, and a bare `/moyu` resumes the last book. Closing stops the provider and
  drops the book consistently.
- Tool and command registration moved to `hooks/entry.ts`, a plain TypeScript hooks module: the
  host scans a module's source for `$.tool.register` and `$.command.register` at call sites.
- Engine/supervisor keep a configurable script path; the package requires Node 22.

### Added

- Novel mode: a `libraryRoot` guard (resolved real path must stay inside it, three extensions
  only), chapter/paragraph parsing, viewport paging, saved progress, directory shelves, recent
  books, `autoHideSeconds`, shared `· AI` annotations, paragraph selection and prompt quoting
  through `$.prompt.fill`.
- A less-shaped key set (space/b, j/k, g/G, home/end, n/p), an `ask about ¶` footer affordance and
  the `q 隐藏` hotkey button.
- Host-facing docs: provider contract, security model, architecture and an English/Chinese
  README, plus CI on Linux.

## [0.3.0] - 2026-11-09

### Added

- HQ frames render at a desktop width (1100 px floor, aspect borrowed from the cell box) at 1–3×
  physical density (`hqDetail`, default 2); leaving image mode restores the cell-box viewport via
  `POST /frame/stop`.
- HQ streams through Chrome's screencast: the pane polls for newer generations every 250 ms while
  focused and once a second otherwise, takes one sharp still after about two seconds of quiet,
  and falls back to one-second stills when the target refuses to stream.
- HQ frames are a source union: kitty, Ghostty and WezTerm keep reading a PNG path; iTerm2 3.5+
  and tmux take the same PNG inline, with automatic detail reduction and a text fallback when the
  2 MiB inline cap cannot be met.
- The provider contract moved to `engine/provider.ts`; the hub takes a provider factory, checks
  capabilities before prompting or executing, and audits the provider id.
- A read-only `reader` provider fetches and parses a document with no browser or child process.
- Link clicks and `clickAt` preflight their destination before dispatch: a denied scheme or host
  never clicks, and a page-script navigation to a denied or unlisted host is audited as `escaped`.

### Fixed

- The bridge waits for `taskkill` on Windows and retries profile removal.
- Re-install the page agent after a document load, so snapshots and ref actions survive reloads.
- Attach mode forces a compositor frame on connect and retries a dropped capture once.

## [0.2.0] - 2026-11-08

### Added

- Inline editing in the text pane: textbox rows render `Input`, combobox rows render `Select`, Enter/pick submits without a dialog.
- Section grouping by page headings, depth indentation, a fixed status bar (mode, window, last audit line), split page/view toolbars, and a `next block` button for long pages.
- HQ image tier (`hq`): real PNG frames from the terminal's image protocol on kitty, Ghostty and WezTerm, refreshed about once a second, with capability detection and a text fallback; the image carries a pointer overlay that maps cells back to page pixels.
- `clickAt` action (clamped viewport coordinates) with a hit-test description in the audit.
- Attach mode: `/moyu attach <port>` mirrors and drives a Chrome the person started with `--remote-debugging-port`; `/stop` and `/moyu close` detach and leave the browser running.
- `browser_find`, snapshot deltas (`sinceLast`), `browser_wait` (selector, text or network idle), and automatic dialog handling (alerts accepted, confirms/prompts dismissed, recorded in `/health` and action messages).
- Linux and macOS browser discovery, platform-aware Playwright fallback, and POSIX process-group cleanup; the full bridge suite runs in WSL Ubuntu with Node 22 and chrome-headless-shell.
- Session host grants: `/moyu allow <host|url>` and `/moyu deny <host|url>` (exact or `*.` wildcard, deny wins, audited).
- `check` / `uncheck` actions with honest no-op results; radio unchecking is refused rather than faked.
- Validation text (`error`) for invalid fields in snapshots, snapshot text and the pane; link destinations in write confirmations.

### Changed

- Seven model tools: `browser_open`, `browser_snapshot`, `browser_find`, `browser_act`, `browser_wait`, `browser_screenshot`, `browser_audit`.
- The demo fixture adds a link, alert and delayed-append buttons, and an invalid-email example.
- Tests grew to 42 plugin/permissions/supervisor tests and 27 bridge/portability tests; README, roadmap, provider guide and security model updated.

### Fixed

- The HQ refresh clock now uses module state instead of a stale hub view, so it keeps running in image mode and stops on every exit path.
- A stale `inline`/unsupported-terminal notice no longer occupies a header line after a page opens.

## [0.1.0] - 2026-11-07

### Added

- Claude Code function-hooks mod with a docked/inline pane (`/moyu`) and commands `open`, `demo`, `audit`, `close`.
- Browser provider over the Chrome DevTools Protocol: structured snapshots (roles, accessible names, values, state, bounds, stable refs) and actions (`click`, `fill`, `select`, `press`, `scroll`, `hover`, `focus`, `navigate`, `back`, `forward`, `reload`).
- Five model tools: `browser_open`, `browser_snapshot`, `browser_act`, `browser_screenshot`, `browser_audit`.
- One serial action queue shared by people and the model, with per-action audit persisted across sessions.
- Permission model: http(s)-only navigation, host allowlist with `localhost` always allowed, `confirm`/`once`/`auto` write policy, fail-closed confirmations.
- Text tier and colored-cell tier (`Raster`, half-block, 24-bit color) with capability negotiation and a summary fallback.
- Supervised local bridge: token-guarded loopback HTTP, health checks, exponential backoff, idle shutdown, process-tree cleanup.
- Snapshot hardening: document-generation refs, password masking, `elementFromPoint` hit tests, untrusted-content banner, control-character stripping.
- Demo fixture (counter, form, list, canvas, shadow DOM, same-origin iframe, overlay, long scroller).
- Test suites: bridge integration tests and plugin/supervisor tests, with `claude plugin validate` and `tsc` gates.
- Documentation: README (English + Simplified Chinese), security model, provider guide, verified competitive landscape, implementation plan.

### Known limitations

- No dirty-rectangle raster streaming; the HQ image tier supports file-source terminals only (kitty, Ghostty, WezTerm), not iTerm2 or tmux yet.
- Mouse input requires the fullscreen layout (`CLAUDE_CODE_NO_FLICKER=1`).
- Headless Chrome uses a throwaway profile; no logged-in sessions by default.
- A model click on a link can navigate outside the host allowlist as a side effect; use `confirm`/`once`, not `auto`, when this matters.
