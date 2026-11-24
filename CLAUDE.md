# RaceGuard

Educational, browser-only race condition detector. The user designs threads out of operations
(READ, WRITE, LOCK, UNLOCK, WAIT, SIGNAL); the engine reports which accesses may race and simulates one
schedule. Vanilla HTML/CSS/JS with no dependencies and no build step: keep it that way.

- **Run:** open `index.html`, or `python -m http.server` from the root.
- **Test:** `node --test` (covers `engine.js` and `codegen.js`). UI changes need a browser check in both
  themes and at phone width.
- **Deploy:** GitHub Pages serves `main` from the root, so **every push to `main` goes live** at
  https://vansh-vaid.github.io/race-condition-tool/. Develop on a branch.
- **Contributors:** Vansh Vaid, kashvibansal11, Nayanavamal. Many commit messages before 2026-11 are
  inaccurate (e.g. "Update print statement from 'Hello' to 'Goodbye'"); trust diffs over messages.

## Architecture

`index.html` loads `engine.js`, `codegen.js`, then `ui.js`, as classic scripts sharing one global scope. Order
matters, and functions must stay global because markup calls them through inline `onclick` handlers.

| File | Role |
| --- | --- |
| `engine.js` | `RaceDetectionEngine`, `PRESETS`, the `engine` singleton. No DOM access. |
| `codegen.js` | `generateCode(lang, threads, semaphoreCounts)`. No DOM access. |
| `ui.js` | All state, rendering, theming, persistence and export. |
| `style.css` | Design tokens in `:root`, dark overrides in `:root[data-theme="dark"]`. |

**Data flow:** `uiThreads` + `semaphoreCounts` (the editable design) → `runDetection()` copies them into
`engine` → `engine.detect()` → `detectionResult` → `renderTimeline/Heatmap/Report`. `renderCode` reads the
design directly. Every edit must end in `designChanged()`, which saves the design and drops stale results.

**Detection rules:** a pair is a candidate when it spans two threads, hits the same variable and includes a
WRITE. It is safe if both hold a common lock, or if one must happen before the other; otherwise it is a
possible race. WW is `critical`; RW and WR are `warning`.

**Semaphores:** each has an initial count, default 1. It acts as a lock only at count 1 when no thread
signals it without having waited. Ordering comes from `_happensBefore`: a SIGNAL precedes a WAIT only if the
WAIT cannot pass without it. Any change must stay sound: never call a pair safe that some schedule can
overlap.

**Simulation:** one round-robin schedule that respects blocking. `deadlock` describes that schedule only;
`null` is not proof of absence, so UI text must not claim it.

**Persistence:** `localStorage` keys `raceguard-theme`, `raceguard-visited` and `raceguard-design`, always
through the `storage` wrapper because access can throw.

### Gotchas

- **Escape every user-supplied name** with `esc()` before it reaches `innerHTML`.
- **Wording:** findings are possible races, so write "may" and "possible".
- **Colors live in two places:** CSS tokens, and `PALETTE_LIGHT`/`PALETTE_DARK` in `ui.js` (6-digit hex,
  because SVG code appends alpha suffixes). White text goes on `--fill`/`--fill2`; `--accent` is for text.
- **Adding an operation type** touches: `computeLockSets`, `_simulate`, `_targets` callers (engine); `lower`
  and both generators (codegen); `OP_TYPES`, `OP_ABBR`, both palettes, `updateSharedVars`,
  `updateNarration` (ui); badge and legend CSS; help, legend and Learn markup.
- **Adding a preset:** add it to `PRESETS` only; its card is generated.

## Progress

Keep this section current: when a change lands, tick or move its item, and add one dated line to the log.

### Status

Branch `fix/correctness-pass` is complete and committed locally, awaiting review. It is not pushed, so the
live site still runs the old code.

### Done

- [x] Detection (Bernstein, lockset, semaphore ordering), blocking simulation and deadlock reporting
- [x] 6 presets, thread designer with drag-to-reorder, semaphore counts, saved designs
- [x] Timeline with step-through, autoplay and narration; heatmap; report with fix suggestions
- [x] Markdown export; runnable C (pthreads) and Python
- [x] Light/dark themes, responsive layout, onboarding, keyboard support (Lighthouse accessibility 100)
- [x] Engine and codegen tests

### Known limits

- [ ] Deadlock is checked in one schedule. Exploring all schedules would find the rest, and could replay them.
- [ ] Lockset analysis can report false positives, e.g. accesses ordered only by mutex hand-off.
- [ ] Generated C is syntax-checked with stub headers, not run (no pthreads on the dev machine).
- [ ] `ui.js` has no automated tests; its behavior is checked in a browser.
- [ ] Operations can be reordered only by mouse drag (no keyboard or touch).

### Ideas

1. Exhaustive schedule exploration with a witness interleaving per race.
2. Keyboard and touch reordering.
3. Share a design by URL.
4. GitHub Actions running `node --test` on pull requests; protect `main`.

### Log

- 2026-04-05: Initial upload. `CNAME` (raceguard.com) added, then removed.
- 2026-04-18: Layout refactor.
- 2026-04-22: Onboarding, mobile drawer, drag-to-reorder, themes and adaptive palettes.
- 2026-04-23: WAIT/SIGNAL, Code tab, report export.
- 2026-04-24: CSS and HTML polish (`b39690a`).
- 2026-11-24: CLAUDE.md created. Correctness pass on `fix/correctness-pass`: engine semantics, codegen
  rewrite, UI bugs, accessibility, tests, README; removed four spent codemods.
