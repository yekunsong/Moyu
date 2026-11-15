# Contributing to moyu

Thanks for helping. moyu is an early-access Claude Code function-hooks mod: the engine API moves
between releases, so small, well-described changes are easier to review than broad rewrites.

## Setup

Requirements: Node.js 22+, the Claude Code CLI 2.1.x and an interactive terminal.

```bash
git clone https://github.com/yekunsong/Moyu.git
cd Moyu
npm install --global @anthropic-ai/claude-code@2.1.322   # if not already installed
```

`npm test` runs, in order:

1. `tsc --noEmit`
2. `claude plugin validate .`
3. `claude plugin test .` — the plugin suite against an in-memory library

Run one step with `npm run typecheck`, `npm run validate` or `npm run test:plugin`.

## Trying it in a session

```bash
mkdir -p novels
cp fixtures/novel/* novels/
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 CLAUDE_CODE_NO_FLICKER=1 \
  claude --plugin-dir "$PWD"
```

Then `/moyu 01-night-ferry.txt`. `q` hides the pane. The fullscreen layout
(`CLAUDE_CODE_NO_FLICKER=1`) is required for mouse interaction; inline panes are keyboard-only
(`ctrl+x tab` gives them the keyboard).

## Where things live

```text
hooks/entry.ts       the one hooks module; tool and command registration
hooks/main.tsx       commands, pane, Ops literal
hooks/boss.ts        visibility, presets, idle hide
hooks/tools.ts       tool specs and tool.call handlers
hub/                 serial queue, view model, audit
providers/novel/     guard, parser, pager, provider, key strip
```

The host scans `hooks/entry.ts` for the `$` calls a module makes. `$.tool.register` and
`$.command.register` must be literal calls in that plain `.ts` file; `.tsx` files are not
scanned, so keep engine calls in hooks modules and pure logic elsewhere.

## Tests

- Tests import `claude plugin test`'s kit. The plugin is loaded by the harness: configure it with
  `test(name, { options }, body)` instead of calling `register` again.
- Fake files live in `tests/helpers.ts`. Use POSIX absolute paths (`/lib`), not `C:/…`, or the
  Linux runner treats them as relative.
- `$.prompt.fill` is answered directly with `{ isFilled: true }`; `session.start` is answered by
  the bottom hook.
- Cover the happy path and one refusal (outside the root, wrong extension, empty input).

## Commit messages

English, imperative, [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <summary>

<body: why, not what>

Co-Authored-By: …
```

Scopes in use: `novel`, `pane`, `boss`, `hub`, `engine`, `tools`, `tests`, `docs`.

## Pull requests

- One concern per PR; say what you tried and in which terminal.
- Update `docs/NOVEL.md` for behaviour changes and `CHANGELOG.md` under `Unreleased`.
- Keep the pane text-only. A feature that needs a process or the network should say so in the PR.
