# Roadmap 0.3 — fidelity, containment and a second provider

Status: implemented (2026-11-09); manual iTerm2/tmux sessions and the 0.3.0 release are pending
Owner: maintainer (review + direction); implementation by worker agents
Date: 2026-11-08

0.2 shipped the text tier, the HQ image tier, attach mode and Linux portability, but it did not reach the bar that matters for this project: the pane must show a page you can actually read, and a click must never leave the allowed hosts. 0.3 raises capture fidelity, makes streaming steady under occlusion, widens terminal coverage, closes the link-escape hole, and finally proves the provider contract with a second adapter.

## Constraints

- No long-lived processes or accumulated scripts. Tests spawn Chrome and must close it; temporary scripts live under `.tmp/` and are deleted.
- The engine rules stay in force: no `$` across module boundaries, plugin modules have no Node/DOM/`process`, gating hooks fail closed, tool results are plain strings, refs are rebuilt after document loads.
- The bridge owns all pixel work; the plugin only maps cells to CSS pixels and hands image sources to the terminal.
- Engine `Image` payload limits are hard: at most 2 MiB decoded for inline bytes, and inline bytes render only in the fullscreen layout.
- Clicks follow the same tab; a `target="_blank"` target that opens a second tab is out of scope (0.4).
- Every phase ships its tests and docs; the maintainer runs `npm test` and commits. The release cuts `0.3.0` and moves the Unreleased entries into it.

## Phase F1 — Real-pixel capture and honest layout ✅

**Why:** the current frame ties the CSS viewport to the cell box (`columns × 8 × rows × 16`, `deviceScaleFactor: 1`). At 84 columns the page renders 672 px wide, then a HiDPI terminal scales it to twice that: text is soft, and every site lays out as a narrow window.

**Expected result:** the frame is captured at the pane's physical pixel density from a desktop-width viewport, the pane scales it once at 2× or 3× detail, and click mapping still uses CSS pixels, not device pixels.

**Implementation:**

1. `POST /frame` takes `detail` (1–3, default from `hqDetail` config, default 2), and the provider method becomes `frame(cols, rows, detail)`. In owned mode the CSS viewport keeps the cell box's aspect ratio but is floored at 1100 px wide (`width = max(columns × 8, 1100)`, `height = width × rows × 16 / (columns × 8)`), so the page gets a desktop layout without distortion, and `deviceScaleFactor: detail` multiplies the capture to physical pixels.
2. Cap the capture at 3840×2560; to fit, reduce `detail` first, then the width (whose height is derived), never one axis alone.
3. Return both the CSS mapping size (`pageWidth`, `pageHeight`) and the pixel size; the pane keeps using the CSS values in `clickPixel`.
4. State the side effects in the docs: entering hq changes the viewport (a stale snapshot follows), and the PNGs are 1–4 MB each. Add `POST /frame/stop` so leaving image mode restores the cell-box viewport.
5. Leave `/shot` and `/raster` on their current cell-derived metrics so the text and visual tiers do not regress.
6. Add an `hqDetail` userConfig option (1 = fast, 2 = default, 3 = sharp) and document its CPU and disk cost.

**Acceptance:**

- Bridge test: before caps, `/frame` pixel size is `detail` × the CSS box; capped and short-pane requests reduce detail before width; PNG header intact; generation increases; files pruned.
- Bridge test: click mapping against the returned CSS size hits the counter.
- Plugin test: `hqDetail` reaches the provider; an invalid value clamps.
- Manual: on WezTerm, a 100-column pane shows readable body text at 1:1 zoom; aspect error versus the cell box is under 3%.
- `npm test` green.

## Phase F2 — Streaming and occlusion resilience ✅

**Why:** hq polls a full `captureScreenshot` per second. That is slow, re-encodes the whole viewport every frame, and stalls until a BeginFrame that an occluded window never sends — the exact failure the 0.2.1 patch only papers over with retries.

**Expected result:** Chrome pushes frames, the bridge keeps only the newest, and the pane fetches a new frame when one exists. Occluded windows keep a stale frame until they are visible again instead of dropping the mode.

**Implementation:**

1. Bridge: `Page.startScreencast({ format: 'png', maxWidth, maxHeight, everyNthFrame: 2 })`; acknowledge every `Page.screencastFrame` immediately or Chrome stops. The newest frame overwrites a single rolling `live.png` and bumps the generation, so nothing accumulates on disk.
2. New `GET /frame?since=<generation>`: 200 with the newest frame when newer than `since`, otherwise `{ same: true }`. No long-polling. `POST /frame` stays for the first frame and the high-detail still.
3. Pane: poll at 250 ms while focused and 1 s while unfocused; keep exactly one request in flight (`frameBusy` already guards). After 2 s of `same`, take one high-detail `captureScreenshot` still (detail 2) and continue streaming at detail 1, so a static page is sharp and motion stays cheap.
4. Screencast metadata (`deviceWidth`, `deviceHeight`, `pageScaleFactor`) feeds the CSS mapping.
5. Fall back to `captureScreenshot` when the target refuses `Page.startScreencast`; keep the 0.2.1 retry as the fallback path only.
6. Cancel the screencast on a mode switch, `/transom close`, pane close, session end and `/stop`; an unfocused pane keeps the 1 s cadence.

**Acceptance:**

- Bridge test: with the demo page scrolling, two `since` reads return distinct generations; a third returns `same`.
- Plugin test: rapid frame losses never stack requests (single in-flight), and the mode survives an occluded interval.
- Manual: motion interval ≤ 250 ms; idle CPU under 5%; disk holds one live frame plus one still, never a growing set.
- `npm test` green.

## Phase F3 — Terminal coverage and inline image sources ✅

**Why:** hq works only where the terminal reads a PNG path itself. iTerm2 needs inline bytes, and tmux needs passthrough.

**Expected result:** iTerm2 3.5+ and tmux show hq through inline PNG bytes; file-source terminals keep the current path; unsupported terminals still get the text tier plus a one-line reason.

**Implementation:**

1. `Frame` becomes a discriminated union: `{ kind: 'file', file, ... }` or `{ kind: 'png', data, ... }`, sharing generation, columns, rows, pageWidth, pageHeight, pixelWidth and pixelHeight. The provider methods take a `FrameSource` (`'file' | 'png'`).
2. Bridge: `POST /frame` takes `source` (default `file`); png returns the base64 capture and writes no file. The screencast remembers the requested source: png keeps the newest bytes in `liveFrame`, writes no `live.png`, and still prunes/clears as today. File mode is unchanged.
3. iTerm2/tmux use an inline `png` source, downscaled until the decoded payload is under 2 MiB; document that both need fullscreen rendering and tmux needs `allow-passthrough` and `focus-events`.
4. `detectImageTier` returns `{ supported, source, reason }`; tmux is allowed only when the outer program is kitty, Ghostty, WezTerm or iTerm2, with a notice naming the required tmux options; Windows Terminal stays on the text tier.
5. Contract and provider guide describe both source kinds.

**Dropped: POSIX shared memory (`/dev/shm`).** CDP has no raw-pixel output: `Page.captureScreenshot` and `Page.screencastFrame` produce only PNG/JPEG/WebP. A shm source would therefore require decoding every frame in the page and writing tens of megabytes per raw frame — a 1600×1920 frame is about 9 MiB raw, while the same PNG is usually under 2 MiB — which is strictly worse than the PNG path it would replace. The shm item is removed rather than deferred; inline PNG covers the terminals it was meant for. Shared memory moves to out of scope.

**Acceptance:**

- Unit tests for tier detection across term/env combinations, including tmux.
- Bridge test: `source: 'png'` returns base64 PNG bytes (IHDR readable), writes no file, and `GET /frame?since` follows the remembered source; file mode unchanged.
- Plugin test: iTerm2 and tmux+iTerm2 draw a png source; WezTerm keeps the file source; Windows Terminal stays text with the notice; an oversized png lowers detail and then falls back with a notice.
- Manual: hq on iTerm2 and inside tmux with passthrough.
- `npm test` green.

## Phase S1 — Click-driven navigation cannot escape the allowlist ✅

**Why:** host and scheme checks run only on the `navigate` action. A model `click`, `clickAt` or `press Enter` can land on any host, and the hub notices only afterwards when the snapshot comes back. The 0.2 changelog lists this as a known limitation.

**Expected result:** a click whose target is a link to a disallowed host is confirmed or denied *before* it runs; a navigation the page performs by itself produces a visible, audited warning with `back` and `allow host` actions.

**Implementation:**

1. Preflight in the hub: a `click` on a node that carries `href` is classified as navigation — scheme/host decision, and the confirmation names the destination. A denied href does not click.
2. New bridge route `POST /hit { x, y }` returns the clamped point, the hit description and any enclosing `a[href]`; `clickAt` calls it inside the queued action, before the decision, and the hub treats a returned href as a navigation.
3. Post-hoc: after every write, compare the snapshot host with the host before the action. On an unlisted or denied host reached by page script, set a warning banner with **back** and **allow host** buttons, and audit it as `escaped`. `back` and `forward` land under the same check.
4. `press` that submits a form to an unlisted host is caught by the post-hoc path; document that preflight cannot see it.
5. Tests: allowed link clicks without a prompt; off-list link asks and names the href; denial leaves the page; script navigation warns and audits.

**Acceptance:**

- No path reaches an unlisted host without a confirmation or an `escaped` audit entry.
- `npm test` green.

## Phase C1 — Contract proof: a read-only `reader` provider ✅

**Why:** the contract is imported from `providers/browser/` and the hub constructs `BrowserProvider` directly. Until a second adapter exists, every "provider framework" claim is untested.

**Expected result:** `providers/reader/` serves a URL as a text-only snapshot (headings, links, paragraphs) with no browser, and the hub runs it through the same queue, permissions and audit. Pointer, raster and image tiers hide through capability negotiation.

**Implementation:**

1. Move the contract to `engine/provider.ts`; the hub gains `setProvider()` and takes a factory, hides actions the capabilities lack, guards `screenshot`/`raster`/`frame` on the optional methods, and writes `meta.id` into audit rows.
2. Reader lives entirely in the plugin (`ops.fetch`, no child process): a tolerant tokenizer builds a heading/link/text tree from the HTML, best-effort on malformed markup; refs derive from a document hash plus node ordinal.
3. Capabilities: `text` only; no pointer, keys, scroll, images.
4. Command `/transom reader <url>`; existing tools unchanged; unsupported actions return a clear message.
5. Tests: reader parsing against local fixture strings (structure, off-list host, fetch failure); hub tests proving the pointer and hq buttons disappear and unsupported actions are refused.

**Acceptance:**

- Reader snapshots are readable and permissions behave identically to the browser provider.
- The hub imports nothing under `providers/`; a small registry in `hooks/` supplies factories, and `tsc` stays green.
- `npm test` green.

Interactive third-party providers (Minecraft, LINE) move to 0.4.

## Phase Q1 — Gates, docs and release engineering ✅

1. `once`-policy end-to-end test through the hub (currently only unit-tested in `tests/permissions.test.ts`).
2. Refresh the README roadmap, the provider guide's action list, and the "known limitations"; document `hqDetail`, tmux/iTerm2 setup and occlusion behaviour. Make the tool descriptions provider-neutral (they currently say `browser_*` and describe DOM-only actions).
3. Add a remote, a marketplace install line with the real `owner/repo`, and CI: typecheck, `validate` and plugin tests on every push; bridge tests on a Windows runner with Chrome.
4. Extend the `docs/SECURITY.md` release checklist: screencast acknowledgement, inline-payload cap, escaped-navigation audit.
5. Cut `0.3.0`: move Unreleased, bump `plugin.json` and `package.json`, tag.

## Verification matrix

`npm test` per phase, the phase tests above, and a manual session on WezTerm with `CLAUDE_CODE_NO_FLICKER=1`. Frame interval, idle CPU and capture bytes are measured from `.tmp` scripts and deleted afterwards.

## Sequencing

F1 → F2 → F3 → S1 → C1 → Q1. S1 is independent of the pixel work and may be swapped before F3 if security should land early; C1 must follow F3 because it changes the `Frame` union the hub consumes. F1 and F2 can each ship alone.

## Self-review (2026-11-08)

Corrections made while checking the draft against the engine types and the current code:

1. **Aspect distortion.** A fixed 16:9 viewport squashes tall, narrow panes; kept a width floor with a height derived from the cell box instead, so the desktop layout does not cost geometry.
2. **Disk churn.** A screencast writes megabytes at 2 fps; replaced the ten-frame ring with one rolling file and one high-detail still when motion stops.
3. **`clickAt` preflight was impossible** as drafted, because the href is only known inside the bridge after dispatch; added the `/hit` route, called inside the queued action before the decision.
4. **The reader does not need a child process.** A bridge would have been more code than the parser; it lives in the plugin on `ops.fetch`. The capability gating the hub lacks is now explicit work.
5. **tmux cannot be probed** without a process; detection infers from `TERM_PROGRAM` and only advertises with the tmux options set, keeping the notice.
6. **`target="_blank"` was unaccounted for**; same-tab only, stated as a constraint.

Residual risks:

- `deviceScaleFactor` invalidates the current viewport metrics, so entering hq makes the visible snapshot stale. Accepted and documented.
- Screencast PNGs at detail 2 may still exceed the 5% CPU budget on large panes; the moving-detail fallback mitigates it, and F2 measures it before proceeding.
- The inline-bytes cap will force detail 1 on large iTerm2/tmux panes; automatic, but worth stating in the docs.
- The link preflight is defeatable by JS navigation; the post-hoc banner is a backstop, not prevention.
- The dependency-free tokenizer will mishandle deeply malformed markup; it is a contract proof, not a scraper.

## Out of scope for 0.3

- Mobile surfaces, multi-provider focus, resource quotas.
- Third-party provider distribution.
- Video or canvas-specific capture beyond the generic screencast.
- POSIX shared-memory frame sources (`/dev/shm`): CDP emits no raw pixels, so the bridge would have to decode every frame and write far more than the PNG path it replaces. Dropped from F3; inline PNG is the source for terminals that cannot read a path.
