# moyu 摸鱼

**English** | [简体中文](README.zh-CN.md)

> A novel reader that hides in plain sight inside a Claude Code session.

[![CI](https://github.com/yekunsong/Moyu/actions/workflows/ci.yml/badge.svg)](https://github.com/yekunsong/Moyu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.x-6f42c1)](https://code.claude.com)
[![Status](https://img.shields.io/badge/status-early%20access-orange)](#status)

moyu (摸鱼, “catching fish”) turns the side of a Claude Code session into a page of prose. It
borrows **your** theme, draws like command output, and goes away with one key. The model reads
the same page and can leave notes in the same style.

No browser, no daemon, no network: a directory of text files, and a pane.

```text
novels/01-night-ferry.txt · 37%
第一章 夜航

渡口的灯在雾里只剩一团黄。阿桂把缆绳在手心绕了两圈，
船身便轻轻贴住石阶。

他数着岸上的脚步声，一遍又一遍。

· AI 雾、玻璃和潮汐——三样让人看不清的东西。
空格/j/k 翻页 · n/p 章节 · a 引用 · q 隐藏
q 隐藏
```

---

## Contents

- [Why](#why)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Keyboard](#keyboard)
- [Model tools](#model-tools)
- [Configuration](#configuration)
- [The library](#the-library)
- [Architecture](#architecture)
- [Security and privacy](#security-and-privacy)
- [Compatibility and limitations](#compatibility-and-limitations)
- [Status](#status)
- [Roadmap](#roadmap)
- [Development](#development)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Why

Reading at work means reading something that looks like work. A browser tab or a reader app is
one alt-tab away from being noticed; a `less`-shaped pane inside the session is not.

moyu is built around three small ideas:

1. **Camouflage.** By default it sets no theme at all. Prose inherits the session's own text
   colour, chrome uses the dim variant, and headings carry no boxes. It reads as another block
   of output.
2. **A boss key.** `q` closes the pane instantly. A bare `/moyu` brings it back on the same
   paragraph, or opens the last book if nothing is open.
3. **A shared channel.** The model reads the same page through registered tools and can annotate
   it. Press `a` on a paragraph to quote it into the prompt and ask.

It is deliberately small: text in, text out, progress on disk, nothing else.

## Features

- **Plain-text page.** Paragraphs and chapter headings, viewport-sized paging, a dim path and
  percentage header. No reader chrome.
- **Palette inheritance.** `theme: "auto"` (default) never calls `$.theme.set`; the pane follows
  the person's own terminal and Claude Code theme. `mono`, `paper` and `ink` are opt-in presets.
- **Boss key.** `q`, Escape, `/moyu` (no argument) or `/moyu hide`. Opening requests focus,
  Escape closes, and the pane body is transparent.
- **Resume.** Chapter and offset persist per file under `moyu.progress.<hash>`. A bare `/moyu`
  reopens the last book at the saved page, so hiding never costs your place.
- **Library guard.** Only `.txt`, `.md` and `.text` regular files under the resolved library root;
  symlinks are judged by their real path.
- **Directory shelf.** Opening a directory lists readable files; a recent list fills the empty
  pane.
- **Shared annotations.** `mcp__moyu__annotate` attaches a note to a paragraph ref. Notes render
  italic in the prose colour, prefixed `· AI`, right after the anchor.
- **Ask about ¶.** Click a paragraph, then `a` or the footer button to quote it into the prompt
  through `$.prompt.fill` — never auto-submitted.
- **Auto-hide.** `autoHideSeconds` hides the pane after quiet time; any key re-arms it.
- **Audited.** Person and model actions share one serial queue and one audit ring.

## Requirements

- Claude Code 2.1.x with function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`), in an
  **interactive terminal**.
- Node.js 22+.
- A library directory containing UTF-8 `.txt`, `.md` or `.text` files.

No Chrome, no extra process, no API key of its own.

## Installation

From a session:

```text
/plugin install moyu --marketplace yekunsong/Moyu
```

From a checkout, for development:

```bash
git clone https://github.com/yekunsong/Moyu.git
cd Moyu
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 CLAUDE_CODE_NO_FLICKER=1 \
  claude --plugin-dir "$PWD"
```

`CLAUDE_CODE_NO_FLICKER=1` enables the fullscreen layout: the pane docks right and the pointer
reaches it. Inline panes stay keyboard-only — `ctrl+x tab` gives them the keyboard, Escape
returns it.

## Quick start

```bash
mkdir -p novels
cp fixtures/novel/* novels/
```

```text
/moyu 01-night-ferry.txt
```

Read with `↓`/`↑`, `space`/`b`, `j`/`k`, or the mouse. Click a paragraph to select it, `a` to put
it in the prompt. `q` hides the pane; `/moyu` comes back to the same page.

Ask the model:

> Call `mcp__moyu__read`, then `mcp__moyu__annotate` on the second paragraph with a one-line note,
> then read the page again.

The note appears under the paragraph in the prose style.

## Commands

| Command | What it does |
|---|---|
| `/moyu` | Toggle the pane (boss key). With nothing open, resumes the last book |
| `/moyu <path>` | Open a file, or a directory as a shelf, under the library root |
| `/moyu hide` / `/moyu show` | Hide or show explicitly |
| `/moyu theme <auto\|mono\|paper\|ink>` | Follow your own palette (default) or set a preset |
| `/moyu close` | Drop the book and close the pane |

`/moyu show` with nothing open reopens the last book at its saved page; if the recent list is
empty it shows the shelf.

## Keyboard

The pane is less-shaped.

| Key | Action |
|---|---|
| `↑` `↓` `←` `→`, `space` `b`, `j` `k` | Turn pages |
| `n` / `p` | Next / previous chapter |
| `g` / `G`, `home` / `end` | Start / end of chapter |
| Click | Select a paragraph |
| `a` | Quote the selected paragraph into the prompt |
| `q`, `Escape` | Hide the pane at once |
| `ctrl+g` | Hide while the pane holds the keys |

`q` is both a Client key and a Button hotkey, so it works after `ctrl+x tab` or `closeOnEscape`
without the pointer. `ctrl+g` is the host's external-editor chord in the Chat context; the pane
consumes it only while focused, which is why `q` is the boss key.

## Model tools

| Tool | Purpose |
|---|---|
| `mcp__moyu__open` | Open a library file or directory |
| `mcp__moyu__read` | Read the current page; `next` / `prev` / `chapter` turn or move first |
| `mcp__moyu__find` | Find text in the whole book; at most 20 excerpts |
| `mcp__moyu__annotate` | Attach a note to a paragraph ref |
| `mcp__moyu__turn` | Turn pages by a signed delta |
| `mcp__moyu__boss` | Show, hide or toggle the pane |

Reads are capped by `snapshotMaxChars`. Refs are offsets into the normalized document and stay
valid until the next snapshot or turn. Page text is untrusted data, never instructions.

## Configuration

`/config` → moyu, or `plugin.json` → `userConfig`:

| Option | Default | Meaning |
|---|---|---|
| `libraryRoot` | `novels` | Directory the pane may open. Relative paths resolve from the working directory; nothing outside it resolves. |
| `theme` | `auto` | `auto` follows your own colours. `mono` (grey CLI), `paper` (sepia) and `ink` (light) set a preset while the pane is shown. |
| `autoHideSeconds` | `0` | Hide after this many idle seconds; `0` keeps it open. |
| `snapshotMaxChars` | `12000` | Hard character cap on one `read`. |

## The library

- Root default `novels/`, relative to the session working directory, or an absolute path.
- Accepted: regular `.txt`, `.md`, `.text`. Case-insensitive extensions; UTF-8 text.
- Resolved real paths must stay inside the root; `..` that escapes is refused, so is a file
  outside it even when given by absolute path.
- Chapters split on `第N章/回/节/卷`, `CHAPTER N`, `#`-headings and `1.` / `1)` lines. A document
  with none is one chapter; a first line of 60 characters or fewer becomes the title.
- CRLF and BOM are normalized, tabs kept, other control characters dropped. Paragraphs are
  capped at 2,000 characters.

See [`docs/NOVEL.md`](docs/NOVEL.md) for the full design and [`docs/PROVIDERS.md`](docs/PROVIDERS.md)
for the adapter contract.

## Architecture

```text
hooks/entry.ts        the one hooks module: captures, tools, command, pane
hooks/main.tsx        pane rendering, key routing, Ops literal
hooks/boss.ts         visibility, theme presets, idle hide
hooks/tools.ts        tool schemas and handlers
hub/hub.ts            serial action queue, capability gate, view model
hub/audit.ts          ring buffer + $.store persistence
engine/provider.ts    the provider contract
engine/ops.ts         the narrow slice of $ adapters get
providers/novel/      library guard, parser, pager, provider, key strip
tests/                plugin suite against an in-memory library
```

Dependencies point inward. Only `hooks/` touches `$`; only `providers/` touch the outside world —
here, a directory. The hub is provider-agnostic and gates actions by declared capabilities before
anything runs.

A provider implements `open` / `snapshot` / `act`; `snapshot` returns role-tagged nodes with
character-offset refs, `act` accepts `click`, `press`, `scroll` and provider `command`s. A future
game adapter is the reason the contract is kept.

## Security and privacy

Everything is local. Reads are confined to the resolved root, extensions and real paths are
checked, and text is treated as data. The pane fills the prompt but never submits it. There is no
telemetry. See [`docs/SECURITY.md`](docs/SECURITY.md).

## Compatibility and limitations

- **Terminals:** any terminal that can draw a pane; no graphics protocol needed.
- **Platforms:** Windows, Linux and macOS. Windows and POSIX path shapes are both folded.
- **Interactive only:** headless `-p` runs load the tools but do not draw the pane.
- **Text only:** no EPUB/PDF, no network novels, no images, no fonts or spacing controls, no
  non-UTF-8 encodings.
- **Annotations are in memory** and clear when the file is reopened; progress does not.
- **Small panes** work but get very short pages; the pane clamps at 20 columns minimum.
- Early access: the function-hooks API changes between Claude Code releases.

## Status

0.4, early access. 0.1–0.3 were the browser line; 0.4 replaces it with the reader while keeping
the contract, queue, gate, audit and supervisor for later adapters. Version numbers may move
quickly until the hooks API settles.

## Roadmap

- Hardening: more parser edge cases, a note toggle, per-file bookmarks.
- A game adapter on the trimmed contract.
- Optional third-party providers via the contract.

Not planned: network novels, EPUB, images in prose, multi-pane focus.

## Development

```bash
npm run typecheck
npm run validate
npm run test:plugin
npm test                 # all three
```

The suite covers the parser, pager, guard, provider, hub, pane and tools against an in-memory
library; CI runs it on Linux with Node 22. No novel text leaves the machine.

See [`CONTRIBUTING.md`](CONTRIBUTING.md), including the one host rule worth knowing: tool and
command registration must be literal calls in the plain-TypeScript hooks module.

## FAQ

<details>
<summary>Why did <code>ctrl+g</code> open an editor instead of hiding the pane?</summary>

`ctrl+g` is Claude Code's own external-editor chord in the prompt. The pane only receives it
while it holds the keyboard. `q` is the reliable boss key and is bound both as a plain key and as
a Button hotkey.
</details>

<details>
<summary>Where is my place stored?</summary>

In the plugin store under `moyu.progress.<document hash>`, written whenever the position settles.
Deleting the plugin store resets it. Annotations are not persisted.
</details>

<details>
<summary>Does it change my theme?</summary>

Not by default. `auto` sets nothing; the pane paints with your theme keys. Presets are explicit
and are cleared again when the pane hides.
</details>

<details>
<summary>Can I read the same library on a server over SSH?</summary>

Yes — the pane is text on the terminal, so it works in an SSH session and inside tmux. The
library must exist on that machine.
</details>

## Contributing

Issues and pull requests are welcome. Please run the three checks above and say which terminal
you tried. By participating you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). The name is a pun; the code is ordinary TypeScript.

Acknowledgements: the Claude Code function-hooks authors, and the terminals whose restraint made
a text pane the right shape.
