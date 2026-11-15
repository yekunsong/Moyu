# Novel mode — design (0.4)

Status: shipped in 0.4 (2026-11-15). The browser stack is removed.
The framework (provider contract, serial queue, audit, capability gating, supervisor) stays for later adapters.

## Product

A novel reader inside the session that hides in plain sight: it reads like command output, shares one theme with the model's replies, and has a boss key that makes the whole thing look like normal Claude Code.

Audience: people reading at work. The distinct features are the camouflage (mono terminal theme, prose rendered as plain output) and the shared channel (the model reads the same page, annotates it in the same style).

## Core model

- Library root (`libraryRoot`, default `novels` relative to the working directory). Only regular `.txt`, `.md`, `.text` files resolve under the resolved root; `realPath` must stay inside it.
- A file is parsed into chapters and paragraphs. Chapters: `第N章/回/节/卷`, `CHAPTER N`, `#`-headings, or a numbered line. Pages are viewport-sized paragraph ranges; refs are `p<offset>` and change with the document hash.
- Progress (chapter index + offset) persists per file under `moyu.progress.<hash>`; a snapshot that clamps the position writes it back, so hiding, closing or reloading never loses it. A bare `/moyu` resumes the last book.
- Directory opens list readable files as `file` nodes; clicking one opens it.

## Interface

- Command `/moyu`: open a path, or **toggle visibility** with no argument (boss key). `/moyu hide` and `/moyu show` are the explicit forms, `/moyu theme <mono|paper|ink>` picks a preset, and `/moyu close` drops the book. A tool can also toggle (`mcp__moyu__boss`).
- Pane keys: `up`/`down`/`left`/`right`, `space`/`b` and `j`/`k` turn pages, `n`/`p` next/previous chapter, `a` fills the prompt with the selected paragraph, `q` hides at once. `ctrl+g` also hides while the pane holds the keys; the host binds it to its external editor in the Chat context, so `q` is the boss key. A `q` Button hotkey makes it reachable after `ctrl+x tab` without the pointer.
- Tools: `mcp__moyu__open {path}`, `mcp__moyu__read {scope page|next|prev|chapter}`, `mcp__moyu__find {text}`, `mcp__moyu__annotate {ref, text}`, `mcp__moyu__turn {delta}`, `mcp__moyu__boss {visible}`.
- Clicking a paragraph selects it; the footer offers `ask about ¶`, which fills the prompt through `$.prompt.fill`.

## Styling and camouflage

- Default theme is `auto`: the plugin sets no session theme at all, and the pane paints with the person's own theme keys (no explicit colors for prose, `dimColor` for chrome) so it follows the CLI palette exactly. Presets (`mono`, `paper`, `ink`) are opt-in through `/moyu theme`; only a preset this plugin applied is cleared on hide/close/session end.
- Annotations render italic, in the same `text` colour as prose, prefixed with `· AI`, after their anchor paragraph.
- No headers with borders; dim path-like header, progress as a percentage. Looks like `less`, not a reader app.
- `autoHideSeconds` (default 0, off): hide after that much idle time; any key or turn resets it.

## Provider surface

`providers/moyu/` implements `engine/provider.ts`: `text/pointer/keys/scroll` capabilities, `open(path)`, `snapshot`, and `act` for `click`/`press`/`scroll`/`command`. Commands: `page`, `next`, `prev`, `chapter`, `goto`, `find`, `annotate`, `selected`. No process, no browser, no images.

## Framework kept

- `engine/provider.ts` (trimmed union: `click`, `press`, `scroll`, `command`), provider factory, capability gating before any prompt, audit, serial queue, `engine/supervisor.ts`, `Ops` with new `fs` and `prompt.fill` members.
- Removed: `bridge/`, `providers/browser/`, `providers/reader/`, `demo/`, `hub/negotiate.ts`, image/pointer hit-testing and the hq/raster tiers, host/write permissions (novel has no network writes).

## Non-goals

Network novels, EPUB, fonts/spacing controls, images in prose, audio, multi-provider focus. The game adapter comes after the novel proves the trimmed contract.
