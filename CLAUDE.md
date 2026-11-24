# RaceGuard

Educational, browser-only race condition detector. The user designs threads out of operations
(READ, WRITE, LOCK, UNLOCK, WAIT, SIGNAL), then schedules them by pulling levers. The engine explores every
schedule and reports races, endings and deadlock. Vanilla HTML/CSS/JS with no dependencies and no build step: keep it that way.

- **Run:** open `index.html`, or `python -m http.server` from the root.
- **Test:** `node --test` (covers everything except `app.js`, `map.js` and `levers.js`). UI changes need a browser check in both
  themes and at phone width.
- **Deploy:** GitHub Pages serves `main` from the root, so **every push to `main` goes live** at
  https://vansh-vaid.github.io/race-condition-tool/. Develop on a branch.
- **Contributors:** Vansh Vaid, kashvibansal11, Nayanavamal. Many commit messages before 2026-11 are
  inaccurate (e.g. "Update print statement from 'Hello' to 'Goodbye'"); trust diffs over messages.

## Architecture

`index.html` loads `engine.js`, `codegen.js`, `model.js`, `views.js`, `map.js`, `levers.js`, `app.js`, in that
order, as classic scripts sharing one global scope.

| File | Role | DOM |
| --- | --- | --- |
| `engine.js` | `RaceDetectionEngine` (detection, stepping, exploration), `PRESETS` | no |
| `codegen.js` | `generateCode(lang, threads, semaphoreCounts)` | no |
| `model.js` | `analyseDesign` (per design), `buildModel` (per view state) | no |
| `views.js` | Pure renderers and `mapLayout`; returns strings and target positions | no |
| `map.js` | `TrainMap`: springs, trains, strings, dragging stops | yes |
| `levers.js` | `Levers`: draggable levers with persistent elements | yes |
| `app.js` | State, undo, persistence, events; calls all of the above | yes |
| `fonts/` | DINish (SIL OFL), self-hosted | |

**Data flow:** `threads` + `counts` → `analyseDesign` → `analysis`; plus `view` (schedule, cursor, selection,
pair) → `buildModel` → `model` → renderers. Every change to the program goes through `edit()`, which handles
undo, saving and re-analysis.

**Detection rules:** a pair is a candidate when it spans two threads, hits the same variable and includes a
WRITE. It is safe if both hold a common lock, or if one must happen before the other. Otherwise `explore()`
settles it: `confirmed` (a schedule lets both run at once), `unreachable`, or `unsettled` (budget ran out).

**Values:** variables start at 0. WRITE after READ stores the copy + 1; a lone WRITE stores the thread number.
`engine.step` and `codegen.js` must agree on this.

**Semaphores:** each has an initial count, default 1. It acts as a lock only at count 1 when no thread
signals it without having waited. Ordering comes from `_happensBefore`: a SIGNAL precedes a WAIT only if the
WAIT cannot pass without it. Any change must stay sound: never call a pair safe that some schedule can
overlap.

**Exploration:** breadth-first over all schedules, capped at 20,000 states. When `complete` is false, absence
proves nothing, so UI text must not claim it.

**Persistence:** `localStorage` keys `raceguard-theme` and `raceguard-design`, always through the `storage`
wrapper because access can throw.

### Design language

A living train map, because Dijkstra's semaphore is a railway signal. The railway is the form; labels keep CS
terms. Each visual must mean something:

- Time runs right. A thread rides its home line and swoops to a station (variable, lock, semaphore) to use it.
- Cargo on a train is the copy it read, red when out of date. A lost value falls off the track.
- A string trembles while its variable has a live conflict. A sheath marks a held lock.
- Red means danger only. Thread colour always comes with the thread's number.
- Motion goes through springs or WAAPI and must respect `prefers-reduced-motion`.

### Gotchas

- **Escape every user-supplied name** with `esc()` before it reaches `innerHTML`, or use `textContent`.
- **`op.uid` is identity.** The map follows an operation by `uid`; create operations with `newOp()`.
- **Stops and levers persist** across renders so drags and focus survive. Update them in place.
- **Animated dashes are costly** without a GPU; keep them on `steps()`.
- **Adding an operation type** touches: `_targets` callers, `computeLockSets`, `canRun`, `step` (engine); `lower`
  and both generators (codegen); `OP_TYPES`, `SYMBOL`, `STATION_KIND`, `describeStep`, `blockReason` (views).
- **Adding a preset:** add it to `PRESETS` only, with a `challenge` that is actually achievable.

## Progress

Keep this section current: when a change lands, tick or move its item, and add one dated line to the log.

### Status

Branch `fix/correctness-pass` (bug fixes) and, on top of it, `redesign/signal-box` (living train map) are
committed locally and awaiting review. Neither is pushed, so the live site still runs the old code.

### Done

- [x] Detection (Bernstein, lockset, semaphore ordering), full schedule exploration, witnesses, deadlock
- [x] Living train map with draggable stops, physical levers, undo, saved designs, 6 presets with challenges
- [x] Possible endings, conflict list with "Show it happen", Markdown export, runnable C and Python
- [x] Light/dark, phone layout, keyboard control, reduced motion. Lighthouse accessibility 100; 97 with the
      phone editor sheet open, because it covers the transport buttons
- [x] Tests for engine, codegen, model and views

### Known limits

- [ ] Exploration stops at 20,000 states; larger programs can leave conflicts unsettled.
- [ ] "Endings" compare final memory only, not the values threads read.
- [ ] Generated C is syntax-checked with stub headers, not run (no pthreads on the dev machine).
- [ ] `app.js`, `map.js` and `levers.js` have no automated tests; they are checked in a browser.

### Ideas

1. Share a design by URL.
2. GitHub Actions running `node --test` on pull requests; protect `main`.
3. Sound: a lever clunk and a signal bell, off by default.

### Log

- 2026-04-05: Initial upload. `CNAME` (raceguard.com) added, then removed.
- 2026-04-18: Layout refactor.
- 2026-04-22: Onboarding, mobile drawer, drag-to-reorder, themes and adaptive palettes.
- 2026-04-23: WAIT/SIGNAL, Code tab, report export.
- 2026-04-24: CSS and HTML polish (`b39690a`).
- 2026-11-24: CLAUDE.md created. Correctness pass on `fix/correctness-pass`: engine semantics, codegen
  rewrite, UI bugs, accessibility, tests, README; removed four spent codemods.
- 2026-11-24: Redesign on `redesign/signal-box`. A static tile panel came first and was rejected as rigid;
  replaced by the living train map. Engine gained stepping and exploration.
