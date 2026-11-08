# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/). This project is early access; minor versions may change the engine-facing surface.

## [Unreleased]

### Fixed

- Re-install the page agent after a document load, so a reload, back/forward or page-driven navigation no longer turns the next snapshot or ref action into a `TypeError`. Covered by a bridge regression test.
- Attach mode forces a compositor frame on connect and retries a dropped capture once; hq image mode now rides out isolated dropped frames instead of falling back to text on the first one. Covered by a pane test.
- The engine test kit can fail `/frame` on demand, so frame-loss handling is testable in memory.

## [0.2.0] - 2026-11-08

### Added

- Inline editing in the text pane: textbox rows render `Input`, combobox rows render `Select`, Enter/pick submits without a dialog.
- Section grouping by page headings, depth indentation, a fixed status bar (mode, window, last audit line), split page/view toolbars, and a `next block` button for long pages.
- HQ image tier (`hq`): real PNG frames from the terminal's image protocol on kitty, Ghostty and WezTerm, refreshed about once a second, with capability detection and a text fallback; the image carries a pointer overlay that maps cells back to page pixels.
- `clickAt` action (clamped viewport coordinates) with a hit-test description in the audit.
- Attach mode: `/transom attach <port>` mirrors and drives a Chrome the person started with `--remote-debugging-port`; `/stop` and `/transom close` detach and leave the browser running.
- `browser_find`, snapshot deltas (`sinceLast`), `browser_wait` (selector, text or network idle), and automatic dialog handling (alerts accepted, confirms/prompts dismissed, recorded in `/health` and action messages).
- Linux and macOS browser discovery, platform-aware Playwright fallback, and POSIX process-group cleanup; the full bridge suite runs in WSL Ubuntu with Node 22 and chrome-headless-shell.
- Session host grants: `/transom allow <host|url>` and `/transom deny <host|url>` (exact or `*.` wildcard, deny wins, audited).
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

- Claude Code function-hooks mod with a docked/inline pane (`/transom`) and commands `open`, `demo`, `audit`, `close`.
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
