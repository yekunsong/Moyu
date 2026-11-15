# Security model

## 1. Boundaries

moyu has no network access, no child process and no browser. Its only surface is the local
library on disk, read through the engine's `$.fs`.

- **The library root is a guard, not a hint.** `libraryRoot` is resolved once per open; every
  target is resolved to its real path (symlinks follow) and must stay inside that root. Sibling
  prefixes such as `/libber` do not pass for `/lib`.
- **Extensions are checked after resolution**, so a symlink cannot introduce a `.png` under a
  `.txt` name.
- **Only regular files and directories open.** Devices, sockets and missing paths are refused
  with the reason.
- **Novel text is untrusted data.** Snapshots opened by the model start with an explicit banner;
  control characters are stripped on normalize and again on output.
- **Reads are bounded.** One paragraph is capped at 2,000 characters, one tool read at
  `snapshotMaxChars` (default 12,000), and a single `$.fs.read` at the engine's 4 MiB limit.

## 2. What moyu touches

| Surface | What it can do | Mitigation |
|---|---|---|
| Library files | Read text under the root | Real-path containment, extension list, size caps |
| Progress store | Write `moyu.progress.<hash>` and `moyu.recent.v1` | Plugin-scoped `$.store`; plain JSON, no paths outside the root |
| Session theme | Set/clear a theme **only when a preset is chosen** | `auto` sets nothing; a clear happens only for a theme this plugin applied |
| Prompt box | Fill a draft when the person presses `a` / **ask about ¶** | It never submits; the person still presses Enter |
| Annotations | Hold AI notes in memory for the session | 600 characters each, 50 per paragraph |

There is no telemetry and no remote service.

## 3. Explicit non-goals

- A novel that is itself a symlink swapped *after* the guard resolved it (TOCTOU); the next
  open re-resolves.
- Huge files: `$.fs.read` fails above 4 MiB rather than streaming.
- Non-UTF-8 encodings (GBK, Shift-JIS): they appear as replacement characters.
- A malicious model note; it is prose, never instructions, and is drawn as text.
- Terminal-level snooping of the screen.

## 4. Release checklist

- [ ] `claude plugin validate .` passes.
- [ ] The library guard still compares resolved real paths with a separator, not a bare prefix.
- [ ] `NOVEL_EXTS` is unchanged or widened deliberately.
- [ ] Progress writes are wrapped so a failing store cannot break reading.
- [ ] The pane sets no theme under `auto`, and `hide` clears only an applied preset.
- [ ] `npm run test:plugin` is green, including the outside-path and extension refusal cases.
- [ ] README still states that novel text is untrusted data.

## Reporting

Open a GitHub issue with the version, terminal and reproduction, and mark it `security` if you
prefer not to describe the impact publicly. There is no bounty programme.
