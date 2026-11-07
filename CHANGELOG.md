# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/). This project is early access; minor versions may change the engine-facing surface.

## [0.1.0] - 2026-11-07

### Added

- Claude Code function-hooks mod with a docked/inline pane (`/transom`) and commands `open`, `demo`, `audit`, `close`.
- Browser provider over the Chrome DevTools Protocol: structured snapshots (roles, accessible names, values, state, bounds, stable refs) and actions (`click`, `fill`, `select`, `press`, `scroll`, `hover`, `focus`, `navigate`, `back`, `forward`, `reload`, `clickAt`).
- Five model tools: `browser_open`, `browser_snapshot`, `browser_act`, `browser_screenshot`, `browser_audit`.
- One serial action queue shared by people and the model, with per-action audit persisted across sessions.
- Permission model: http(s)-only navigation, host allowlist with `localhost` always allowed, `confirm`/`once`/`auto` write policy, fail-closed confirmations.
- Colored-cell visual tier (`Raster`, half-block, 24-bit color) and an HQ image tier (`Image`, real PNG frames at ~1 fps on kitty, Ghostty and WezTerm), with capability negotiation and a summary fallback.
- Supervised local bridge: token-guarded loopback HTTP, health checks, exponential backoff, idle shutdown, process-tree cleanup.
- Snapshot hardening: document-generation refs, password masking, `elementFromPoint` hit tests, untrusted-content banner, control-character stripping.
- Demo fixture (counter, form, list, canvas, shadow DOM, same-origin iframe, overlay, long scroller).
- Test suites: 19 real-Chrome bridge integration tests, 30 plugin/supervisor tests, `claude plugin validate` and `tsc` gates.
- Documentation: README (English + Simplified Chinese), security model, provider guide, verified competitive landscape, implementation plan.

### Known limitations

- No dirty-rectangle raster streaming; the HQ image tier supports file-source terminals only (kitty, Ghostty, WezTerm), not iTerm2 or tmux yet.
- Mouse input requires the fullscreen layout (`CLAUDE_CODE_NO_FLICKER=1`).
- Headless Chrome uses a throwaway profile; no logged-in sessions by default.
- A model click on a link can navigate outside the host allowlist as a side effect; use `confirm`/`once`, not `auto`, when this matters.
