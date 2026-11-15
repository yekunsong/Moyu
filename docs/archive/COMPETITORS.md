# Competitive landscape

Checked 2026-11-07. Method: GitHub API for stars and licenses, READMEs via WebFetch, official docs for features. This file corrects the positioning section of the README; it does not repeat the positioning argument itself (see "Landscape" in the README and §2 of the implementation plan).

## Conclusions

1. **The three closest projects** are `zenbu-labs/terminal-browser` (pane + model actions; a direct competitor), the Claude Code desktop Browser pane (DOM-level tools, desktop-local), and `vercel-labs/agent-browser` (the exact a11y snapshot + `@e1` ref protocol, with no visual surface).
2. **The original claim that "nobody combines both halves" is stale.** The remaining gap is narrower: a provider framework, registered tools rather than a CLI, one queue and audit for people and models, and first-class remote/tmux support.
3. Pane projects are mostly tiny (0–6★, 1–33 commits) except terminal-browser; "both halves are mature" overstates the pane half.

## 1. In-session panes

| Repository | ★ / license | What it does | Gap |
|---|---|---|---|
| zenbu-labs/terminal-browser | 4.5k / MIT | Chromium offscreen-rendered to kitty graphics as a function-hooks pane; `/browser`; optional `open`/`close` tools; actions via the `agent-browser` CLI (text a11y snapshot + refs) | Actions are a Bash CLI, not registered tools; depends on kitty graphics, breaks under tmux and reports wrong coordinates; browser-only, no framework/audit/shared queue |
| sandipchitale/browser-pane | 0 / MIT | Shared browser window, mods add tabs, localhost + session token | README explicitly excludes DOM reads and click driving |
| pinkpixel-dev/claude-workspace | 3 / Apache-2.0 | File browse/edit, undo Claude's edits, usage, git/GitHub | File domain; README omits the license |
| kesavreddy-commits/repoviewer | 0 / MIT | Repository browse/edit pane; registers a read-only `show_file` tool | The model gets a one-line confirmation, not pane state |
| timmetim/cli-mod | 0 / none | File browser, editor, diff | No model interface |
| hwanyong/pane-grid | 0 / MIT | Splits the pane into a tmux-style grid | Layout only; FAQ says it makes no model calls |
| reporails/arcade | 6 / MIT | Game mods (Minesweeper, Breakout, Doom) plus a marketplace entry | Game state stays local; no tools |
| Unayung/cc-mods-enil | 18 / MIT | LINE client in a pane | Only a `draft` tool; the model cannot read messages |

## 2. Model-driven browsers (window outside / no surface)

| Repository | ★ / license | Notes |
|---|---|---|
| open-claude-in-chrome | 274 / MIT | Clean-room Chrome extension clone, 21 MCP tools over native messaging, separate window |
| safari-mcp | 237 / MIT | macOS, AppleScript + Safari extension, 98 tools |
| browser-debugger-cli | 184 / MIT | CDP shell commands for agents, persistent background Chrome |
| cdpilot | 33 / MIT | 70+ CDP CLI commands + MCP |
| chrome-devtools-mcp | 54.9k / Apache-2.0 | Official MCP server |
| playwright-mcp | 39.3k / Apache-2.0 | Microsoft MCP server |
| vercel-labs/agent-browser | 46.4k / Apache-2.0 | CLI whose `snapshot` returns a11y text with `@e1` refs; the reference protocol for Transom snapshots, but no surface |

## 3. Other prior art

| Repository | ★ | Notes |
|---|---|---|
| iamumeransari/claude-show-your-work | 298 | Inline images/video plus a throwaway-Chrome `show_html`; display-focused |
| hamzafer/claude-code-mods | 449 | browser-lanes (Playwright ownership cleanup), md-preview; no browser pane |
| data-goblin/claude-code-filetree | 388 | Pane only |
| prismantis | 317 | Rich tables, code and charts |
| claude-image-view | 278 | Image above the prompt |
| pisanvs/mc-cc | 2 | Chat with Claude inside Minecraft; the opposite direction |
| ruvnet/ruflo `plugins/ruflo-browser` | — | Playwright MCP tools with a11y/DOM snapshot artifacts; no pane |

## 4. Claude Code itself

The desktop app ships a **Browser pane / app preview**: it starts a dev server from `.claude/launch.json`, opens it beside the chat, and lets the model take screenshots, inspect the DOM, click and fill, with auto-verification after edits. Limits: desktop only, not in the CLI; the docs state that SSH sessions do not get those tools.

## 5. Corrections applied to the README

- "The desktop app cannot reach that machine" became "the desktop pane's tools cannot reach an SSH session".
- "The model guesses from screenshots" became "the desktop tools exist only inside the desktop app; Transom provides registered tools".
- The "nobody combines both" conclusion became the four narrowed positions above.
- Added terminal-browser; recorded repoviewer's read-only tool and claude-workspace's Apache-2.0 license.
- Added vendor competition and page prompt injection to the risk table.
