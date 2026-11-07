# Contributing to Transom

Thanks for helping. This project is an early-access Claude Code function-hooks mod; the engine API moves between releases, so small, well-described changes are easier to review than broad rewrites.

## Development setup

Requirements: Node.js 20+ and a local Chrome/Chromium/Edge (or `TRANSOM_CHROME`).

```bash
git clone <repo>
cd transom
npm test
```

`npm test` runs, in order:

1. `tsc --noEmit` (TypeScript 5.9 via `npx`)
2. `claude plugin validate .`
3. `claude plugin test .` — plugin tests against an in-memory fake bridge
4. `npm run test:bridge` — real headless Chrome against the demo app, plus the browser-free portability checks

Run a single suite with `npm run test:plugin` or `npm run test:bridge`.

## Trying it in a session

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 CLAUDE_CODE_NO_FLICKER=1 \
  claude --plugin-dir "$PWD"
```

Then `/transom demo`. The fullscreen layout (`CLAUDE_CODE_NO_FLICKER=1`) is required for mouse clicks; inline panes are keyboard-only.

## Commit messages

All commits are in **English**, following [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <imperative summary>

<optional body: why, not what>

Co-Authored-By: ...
```

- **type**: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.
- **scope** (optional): `bridge`, `hub`, `engine`, `provider`, `pane`, `tools`, `docs`, `tests`.
- Summary in the imperative mood (`add`, `fix`, `document`), lowercase, no trailing period, at most 72 characters.
- Keep the subject line free of CJK characters; the repository is English-first.
- Body wraps at 72 columns and explains motivation and trade-offs.
- One logical change per commit; tests and docs for the change travel with it.

Examples:

```text
feat(bridge): add a /raster endpoint returning half-block cells
fix(hub): fail closed when a confirmation returns free text
docs: translate the repository to English and add a zh-CN README
```

## Pull requests

- Describe the problem, the change and how it was verified.
- Include the commands you ran (`npm test`, manual session checks).
- Note engine-version assumptions: function hooks are early access; state the Claude Code version you tested (currently 2.1.319).
- New providers: read [`docs/PROVIDERS.md`](docs/PROVIDERS.md) and include protocol-level tests.
- Security-sensitive changes: read [`docs/SECURITY.md`](docs/SECURITY.md) and run the release checklist.

## Code style

- TypeScript with `strict` and `noUncheckedIndexedAccess`; no `any` unless narrowing an engine boundary.
- The plugin modules run with no Node, DOM, network or `process` — everything goes through `Ops` (`engine/ops.ts`).
- Verify plugin behavior with `claude plugin test`; verify the bridge with `node --test`.
- Never pass `$` across modules: `claude plugin validate` rejects it. Build an `Ops` literal at the hook call site.
- Keep engine calls inside `engine/` and `hooks/`; providers and the hub stay host-agnostic.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
