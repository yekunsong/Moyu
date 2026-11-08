# Security model

## 1. Boundaries and trust assumptions

- **The bridge is a high-privilege surface on the loopback interface.** It can `Runtime.evaluate` arbitrary page script, which is equivalent to a constrained code-execution channel. It binds `127.0.0.1` only, generates a fresh 24-byte random bearer token at every start, and passes it through the child's environment (never on the command line, never on disk). Every request validates the token; failures are 401.
- **All page content is untrusted.** Text, links and form names in a snapshot can be attacker-controlled. Transom never treats page text as instructions; every snapshot carries a provenance banner, and every action passes through the permission layer.
- **People are trusted more than models.** Human clicks in the pane execute without per-action confirmation because the person can see the page; model-initiated writes are confirmed according to `writePolicy`. Both are bound by the scheme/host allowlists.
- **Chrome uses a throwaway profile.** A private `--user-data-dir` under `mkdtemp`; no access to the user's daily cookies, password store or extensions. Removed on stop (best effort).
- **Attach mode inherits the person's browser session.** `/transom attach <port>` connects to a Chrome the person started with `--remote-debugging-port`; its page, cookies and logged-in state belong to that browser, so the throwaway-profile guarantee above does not apply. Attach is person-initiated only (no model tool reaches it), audited as `person attach <port>`, and `/transom close` or `/stop` detaches without closing the browser or touching its profile.

## 2. Attack surface and mitigations

| Surface | Risk | Mitigation |
|---|---|---|
| Bridge HTTP | Another local process calls `/act` | Random bearer token; loopback only; token exists only in the child env and plugin memory; browser `Origin` rejected |
| Page script | DOM text tricks the model into clicking external links, filling forms or submitting | Snapshots are labelled untrusted; navigation validates scheme/host; writes are confirmed; audit is reviewable |
| Link clicks and `clickAt` | A click navigates to an off-list host before the snapshot catches it | The href is resolved inside the queued action (from the node for `click`, `POST /hit` for `clickAt`) and the scheme/host decision runs before dispatch; an unlisted destination is confirmed even under `once`/`auto`; a denial never clicks |
| Navigation | `javascript:` / `data:` / `file:` reads local files | Only http/https; `file:` always denied; host allowlist |
| Forms | Passwords leak into snapshots | Password fields (including case variants) always report `••••` and never use their value as an accessible name |
| Clicking | Hit an invisible or overlaid element | Snapshots include visible nodes only; `scrollIntoView` plus an `elementFromPoint` hit test returns `covered` instead of a false success; CDP dispatches real mouse events |
| Process | Orphaned Chrome process tree | Bridge `/stop` → `Browser.close` → kill child; supervisor backoff; idle shutdown after 30 minutes |
| Audit | Untracked actions or leaked form values | One queue for people and models, successes and failures both recorded; `fill` records only ref and character count; `$.store` keeps 2000 entries |
| Engine API | Early-access changes | All `$` usage is confined to the `Ops` literal in `hooks/main.tsx` and the `engine/` layer |

## 3. Explicit non-goals

- **Page-initiated navigation.** A link click and `clickAt` are preflighted, but a navigation the page performs itself — a script redirect, or a form submit caused by `press Enter` — cannot be seen before it happens. The hub compares the host after every successful write and refresh; a denied or unlisted destination produces an audited `escaped` entry and a pane warning with **back** and **allow host**. This is a backstop, not prevention; do not rely on it under `auto`.
- A page sending data to third parties (normal browser behaviour).
- An attacker who already controls the machine and can read the bridge child's environment.
- A model performing a harmful-but-consented action on a page the person approved.
- The content of a visual-tier screenshot (equivalent to what a person sees on screen).

## 4. Release checklist

- [ ] `claude plugin validate .` passes; no unexpected gating hook lacks `.catch`.
- [ ] The bridge only calls `listen(0, '127.0.0.1')`.
- [ ] Every POST route validates `Authorization: Bearer`.
- [ ] Navigation allows only `http:`/`https:`.
- [ ] Password values are masked.
- [ ] Audit covers `snapshot`, `act`, `screenshot`, denials, failures and post-hoc `escaped` navigations.
- [ ] Link clicks and `clickAt` preflight their destination before the click runs.
- [ ] Every `Page.screencastFrame` is acknowledged immediately, or Chrome stops the stream; the screencast is cancelled on a mode switch, `/transom close`, pane close, session end and `/stop` (an unfocused pane keeps the 1 s cadence).
- [ ] Inline PNG sources stay under the engine's 2 MiB decoded limit: an oversized frame lowers detail and then falls back to the text tier with a notice.
- [ ] The `reader` provider stays in the browser-free path: it fetches only through `ops.fetch`, starts no process, and refuses a navigation whose scheme is not `http:`/`https:` before fetching.
- [ ] Temporary profiles are removed after `stop`.
- [ ] Attach mode never launches or closes Chrome: `/stop` detaches and the browser keeps running.
- [ ] Documentation states that page text is untrusted.
