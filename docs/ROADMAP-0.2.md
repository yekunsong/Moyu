# Roadmap 0.2 — phased plan

Status: approved, in progress
Owner: maintainer (review + direction); implementation by worker agents
Date: 2026-11-08

This plan covers three staged routes (text UI, HQ image, attach to a real browser), a minimal Linux/WSL verification, and the highest-value UX fixes. Every phase has a definition of done and a verification command; a phase is committed only after the maintainer runs the checks.

## Constraints

- Workers implement one phase at a time; the maintainer reviews diffs, runs the suite, and commits.
- No long-lived processes or accumulated scripts. Tests spawn Chrome and must close it; temporary scripts live under `.tmp/` and are deleted.
- WSL memory is limited: one Chrome instance at a time, one short experiment, delete temporary scripts afterwards.
- The engine rules stay in force: no `$` across module boundaries, plugin modules have no Node/DOM/`process`, gating hooks fail closed, tool results are plain strings.
- Repository is English-first; commits follow Conventional Commits.

## Phase A1 — Text tier: editable rows and richer nodes

**Why:** the text tier is the only universal, directly interactive surface. Today editing opens a modal `$.ui.ask`; selects and links lack data.

**Expected result:** a textbox row is an inline `Input`; a combobox row is an inline `Select` with real options; pressing Enter fills/selects without a dialog; links show their destination; the pane renders these controls.

**Implementation:**

1. `bridge/page-agent.mjs` snapshot: for `input[type=checkbox]` include `checked`; for `select` include `options: [{ value, label, selected }]`; for links include `href`; include `aria-invalid`/error text where cheap.
2. `providers/browser/contract.ts` + snapshot text projection: add `href`, `options`, `invalid`.
3. Pane (`hooks/main.tsx`): render `Input` for `textbox`/`searchbox` rows (`onSubmit` → `fill`), `Select` for `combobox` with `options` (`onSelect` → `select`); keep `Button` rows for everything else. Escape cancels input focus.
4. `providers/browser/rows.ts`: remove the ask-dialog path for textbox/select; keep it only for rows without structured options.
5. Renderer projection (`hub/hub.ts`) carries the new fields.

**Acceptance:**

- Bridge test: demo form snapshot contains `options` for the Plan select, `href` for a link, and checkbox state.
- Plugin test: typing into the row Input and submitting calls `fill` with the typed text; selecting an option calls `select`; tree validates on terminal.
- `npm test` green.

## Phase A2 — Text tier: structure, sections and status

**Why:** the current pane is a flat list; real pages need hierarchy and a stable status area.

**Expected result:** rows grouped by landmarks/headings with indentation and separators; a fixed status line shows URL, mode, counter summary and the last audit entry; truncation offers an explicit "next block" action instead of a dead "N more below"; toolbar groups view vs page actions.

**Implementation:**

1. Projection: build sections from `landmarks` + heading nodes; indent by `depth` (capped at 4); include a per-section count.
2. Pane: `Box` borders/dividers; status bar; toolbar split into "page" (back/reload/scroll) and "view" (refresh/whole page/visual/hq once B lands).
3. Truncation: when nodes exceed the pane window, expose "next block" that scrolls the page by one viewport (`scroll dy`) rather than slicing silently; show `shown/total`.
4. Keyboard hints for the focused pane.

**Acceptance:**

- Plugin tests: sections render with headers; status bar shows mode/audit; next-block button calls scroll.
- No tree larger than the pane body; no regression in A1 tests.

## Phase B1 — HQ image tier: real pixels (view)

**Why:** Raster half-blocks cap at ~1×2 colored pixels per cell. `Image` with a file source lets the terminal display a real browser screenshot at native pixel density.

**Expected result:** `/transom hq` (and an `hq` toolbar button) switches the pane to a real screenshot of the page on capable terminals (kitty, Ghostty, WezTerm, iTerm2 3.5+ fullscreen), refreshed at ~1 fps only while the pane is focused; unsupported terminals fall back to text with a one-line notice.

**Implementation:**

1. Bridge: `POST /frame {cols, rows}` captures a PNG and writes it to a private temp file, returns `{ file, generation, columns, rows }`; keep at most 10 frames, delete older files. Do not touch device metrics outside the call.
2. Provider: `frame(cols, rows)`; contract addition.
3. Capability detection: read `TERM` / `TERM_PROGRAM` / `WT_SESSION` / `TMUX` through `Ops` (literal keys), allow `hq` only for known image terminals and not inside tmux unless opted in.
4. Pane: `Image { file, format: 'png', generation }` sized to the body; module-level frame cache like `lastShot`; refresh via `$.clock.every(1000)` started when the pane is focused and stopped otherwise; `Esc`/mode switch stops it.
5. Commands/tools unchanged; screenshot tool can reuse the frame.

**Acceptance:**

- Bridge test: `/frame` returns an existing PNG file whose header is PNG; generations increase; old files are pruned.
- Plugin test: supported env → tree contains `Image` with a file source; unsupported env → text tier plus notice.
- Manual: user verifies on their terminal (`/transom hq`).
- `npm test` green; no temp files left after close.

## Phase B2 — HQ image tier: pointer interaction

**Why:** the image is a leaf; without an overlay the HQ mode is view-only.

**Expected result:** clicking anywhere on the HQ image hits the page at the corresponding CSS pixel; the click goes through the normal permission/audit path; scroll still works via toolbar/keys.

**Implementation:**

1. New action `clickAt { x, y }` (CSS pixels in the page viewport), classified as a write, confirmed for the model, direct for a person.
2. Bridge dispatches CDP mouse events at the point (after clamping to the viewport) and returns what element was hit via `document.elementFromPoint` for the audit message.
3. Pane: an absolutely positioned thin `Client` over the `Image` capturing pointer down/up; map cell coordinates to CSS pixels using the frame's columns/rows, posting `{ kind: 'clickAt', x, y }`.
4. Audit message includes the hit element's tag/name, so a misclick is reviewable.

**Acceptance:**

- Bridge test: `clickAt` on the demo counter increments it; out-of-bounds coordinates are clamped.
- Plugin test: overlay `Client` posts the mapped coordinates; model `clickAt` is confirmed/denied like other writes.
- `npm test` green.

## Phase C1 — Attach to a real browser

**Why:** a real logged-in Chrome is the only way to use most sites; the page stays live in the user's window while CLI shows the mirror and tools.

**Expected result:** `/transom attach <port>` connects the bridge to an already-running Chrome debugging port, reuses its first page target (or creates one), and on close detaches without killing the browser. `browser_open` continues to open the pane and can navigate the attached page.

**Implementation:**

1. Bridge: `TRANSOM_ATTACH_PORT` (or request field) selects attach mode — read `/json/version`, connect, list targets, pick a `page` target; never spawn or close Chrome; `/stop` detaches.
2. Supervisor: start options `{ attachPort }`; provider command `/transom attach <port>`; `/transom close` detaches.
3. Security doc note: attach inherits the browser's logged-in state and cookies; it is person-initiated and audited.
4. Discovery helper: `--remote-debugging-port=9222` instructions in README.

**Acceptance:**

- Bridge test: launch Chrome with an explicit debugging port, attach, snapshot and click, then `/stop`; assert the browser is still alive afterwards.
- Plugin test: attach mode does not spawn a process.
- `npm test` green; README documents the flow.

## Phase L1 — Linux portability + minimal WSL experiment

**Why:** the bridge currently discovers Windows browsers only and kills with `chrome.kill()`; Linux/macOS users cannot run it.

**Expected result:** browser discovery on Linux and macOS; POSIX process-group kill; bridge E2E passes in WSL Ubuntu with one short-lived Chrome; no leftovers.

**Implementation:**

1. `bridge/paths.mjs`: Linux names (`google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `/snap/bin/chromium`), macOS app path, `TRANSOM_CHROME`.
2. POSIX launch with `detached: true`; shutdown kills `-pid` (group); Windows keeps the current path plus `taskkill /T /F` best effort.
3. WSL: start Ubuntu once, install or download a headless Chromium minimally (one experiment), run `node --test tests/bridge/bridge.test.mjs`, then delete the temporary script and confirm no Chrome remains.
4. Record the result in `docs/IMPLEMENTATION-PLAN.md` §6.1 and close WSL.

**Acceptance:**

- Path unit checks for Linux/macOS.
- Either the full bridge suite passes in WSL, or a documented minimal smoke (snapshot + click) passes with the reason recorded.
- `wsl -l -v` shows Ubuntu stopped; no leftover processes.

## Phase U1 — Model usability

**Why:** the model currently reads a full snapshot, guesses refs by scanning, and has no way to wait for async pages.

**Expected result:** four additions, each tested: `browser_find`, snapshot deltas, `wait`, and dialog handling.

**Implementation:**

1. `browser_find { text?, role?, interactiveOnly? }` — read-only; returns matching lines with refs, capped.
2. `browser_snapshot { sinceLast?: true }` — diff against the previous snapshot per ref: added/removed/changed nodes; falls back to full when no baseline or after navigation.
3. Action/tool `wait { selector?, text?, idleMs? }` — polls in the page up to a timeout; reports what was satisfied.
4. Dialog handling: listen for `Page.javascriptDialogOpening`; default policy `dismiss-alert` (accept alert, dismiss confirm) recorded in the audit; `/transom dialogs accept|dismiss` override.

**Acceptance:**

- Plugin tests for find and delta; bridge test for wait on a delayed element; bridge test for alert auto-dismiss.
- `npm test` green.

## Phase U2 — Safety and editing polish

**Why:** close the remaining usability and safety gaps found in review.

**Expected result:** runtime host grants, href in click confirmations, checkbox check/uncheck action, form error text in snapshots, and model-visible limits.

**Implementation:**

1. `/transom allow <host>` / `/transom deny <host>` update the session allowlist and audit it.
2. Click confirmation includes the target's `href` for links; snapshots already carry it after A1.
3. `check`/`uncheck` actions (click if state differs, no-op otherwise).
4. Snapshot shows `invalid` fields and nearby error text; `browser_act` result mentions validation failures.
5. Document limits and the two-tier model in README.

**Acceptance:** plugin and bridge tests per item; `npm test` green.

## Verification matrix (every phase)

```bash
npm test
```

plus phase-specific tests listed above and a manual session check where the surface cannot be exercised headlessly (Image rendering, real terminal mouse).

## Out of scope for 0.2

- Second provider (contract proof) — 0.3.
- Continuous screencast / dirty-rect streaming.
- Multi-tab UI, uploads, drag.
- Marketplace publication and CI (tracked separately).
