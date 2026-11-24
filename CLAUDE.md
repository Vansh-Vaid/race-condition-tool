# RaceGuard

Educational, browser-only race condition detector. The user designs threads out of operations
(READ, WRITE, LOCK, UNLOCK, WAIT, SIGNAL); the engine finds conflicting pairs with Bernstein's
conditions and filters them by lockset. Vanilla HTML/CSS/JS: no dependencies, no build, no tests.

- **Run:** open `index.html`, or `python -m http.server` from the root.
- **Deploy:** GitHub Pages serves `main` from the root, so **every push to `main` goes live** at
  https://vansh-vaid.github.io/race-condition-tool/. Develop on a branch.
- **Contributors:** Vansh Vaid, kashvibansal11, Nayanavamal. Many commit messages are inaccurate
  (e.g. "Update print statement from 'Hello' to 'Goodbye'"); trust diffs over messages.

## Architecture

`index.html` loads `engine.js`, then `ui.js`, as classic scripts sharing one global scope. Load order
matters, and functions must stay global because markup calls them through inline `onclick` handlers.

| File | Role |
| --- | --- |
| `engine.js` | `RaceDetectionEngine`, `PRESETS`, the `engine` singleton. No DOM access; runs in Node. |
| `ui.js` | All state, rendering, theming, export and code generation. |
| `style.css` | Design tokens in `:root`, dark overrides in `:root[data-theme="dark"]`. |
| `theme.js`, `updater.js`, `theme-installer.js`, `palettr-updater.js` | Spent codemods (see Gotchas). |

**Data flow:** `uiThreads` (editable design) → `runDetection()` copies it into `engine` →
`engine.detect()` → `detectionResult` → `renderTimeline/Heatmap/Report`. `renderCode` is the exception:
it reads `uiThreads` directly. `detect()` returns `races`, `safePairs`, `interleaving`, `lockSets`,
`variables`, `locks`, `threads`, `critical`, `warnings`.

**Detection rules:** a pair races when it spans two threads, hits the same variable, includes a WRITE, and
shares no held lock. WW is `critical`; RW and WR are `warning`. WAIT counts as acquiring and SIGNAL as
releasing, so semaphores behave as mutexes.

**Persistence:** `localStorage` keys `raceguard-theme` and `raceguard-visited` only. Designs are not saved.

### Gotchas

- **Codemods:** the four Node scripts rewrite `style.css`, `index.html` and `ui.js` in place by regex. They
  have already been applied. Rerunning `theme.js` or `updater.js` overwrites about 100 lines of current
  styling; the other two are now no-ops. Edit the app files directly.
- **Colors live in three places:** the CSS tokens, `PALETTE_LIGHT`/`PALETTE_DARK` in `ui.js`, and the initial
  `let` values at the top of `ui.js`. SVG code appends alpha suffixes (`${color}1a`), so the JS palettes
  must be 6-digit hex.
- **Adding an operation type** touches: `computeLockSets` and `getLocks` (engine); both palettes,
  `renderThreads`, `updateSharedVars`, `updateNarration`, `renderCode` (ui); badge and legend CSS; and the
  help, legend and Learn markup in `index.html`.
- **Preset cards are hardcoded in `index.html`**, including op counts. `label` and `description` in
  `PRESETS` are unused, so a new preset needs both places.
- **Two meanings of `t1, t2…`:** the timeline numbers each thread's own op index; the heatmap numbers global
  interleaving steps.

### Engine baseline

There is no test suite, so recheck these after any engine change (verified 2026-11-24):

| Preset | Races | Critical | Warning | Safe |
| --- | --- | --- | --- | --- |
| counter | 3 | 1 | 2 | 0 |
| bank | 3 | 1 | 2 | 0 |
| producer | 3 | 1 | 2 | 0 |
| rw | 3 | 0 | 3 | 0 |

## Progress

Keep this section current: when a change lands, tick or move its item, and add one dated line to the log.

### Done

- [x] Detection engine, 4 presets, thread designer with drag-to-reorder
- [x] Timeline with step-through, autoplay and narration; heatmap; report with fix suggestions
- [x] Markdown report export
- [x] Light/dark themes, responsive layout, mobile drawer, onboarding, keyboard shortcuts

### In progress

- [ ] Code tab (C pthreads and Python): UI works, generated output is broken (see Known issues).
- [ ] WAIT/SIGNAL support: engine, palettes, badges and code generation are done. Missing from
      `updateSharedVars`, `updateNarration` (sentence stops after "performs"), the timeline legend, and
      the help, onboarding and Learn text.

### Known issues

Confirmed by running the code:

- [ ] Generated Python never starts its threads: the launch code is indented into the last function
      (`ui.js`, `renderCode`).
- [ ] Generated C emits `int temp` per READ, so two READs in one thread fail to compile with a redefinition
      error (hits the `producer` preset).
- [ ] SIGNAL→WAIT ordering is reported as a race (false positive), since there is no happens-before model.
- [ ] `_buildInterleaving` ignores blocking: it shows two threads holding the same mutex at once.
- [ ] Thread and variable names reach `innerHTML` unescaped in the report. From reading, also in thread
      cards, shared state, heatmap and narration. `esc()` exists but skips quotes, so it is unsafe for
      attributes.

From reading, not yet reproduced in a browser:

- [ ] Light theme: timeline labels and report text use hardcoded near-white colors
      (`rgba(255,255,255,…)`, `#fff`, `#eef0ff`) on white.
- [ ] Global Enter/Space handlers call `preventDefault`, overriding keyboard activation of focused buttons.
- [ ] Editing threads after detection leaves stale results on screen.
- [ ] Double-clicking an op's ✕ can delete the next op too: `deleteOp` splices by index after a 230 ms delay.
- [ ] Generated identifiers can collide or be invalid: names differing only in punctuation, leading digits,
      or a name shared by a variable and a lock.

### Suggested next

1. Fix code generation (the first two confirmed issues).
2. Finish WAIT/SIGNAL.
3. Fix light theme contrast and escaping.
4. Add engine tests from the baseline table.
5. Delete the spent codemods and add a README.

### Log

- 2026-04-05: Initial upload. `CNAME` (raceguard.com) added, then removed.
- 2026-04-18: Layout refactor.
- 2026-04-22: Onboarding, mobile drawer, drag-to-reorder, themes and adaptive palettes.
- 2026-04-23: WAIT/SIGNAL, Code tab, report export.
- 2026-04-24: CSS and HTML polish (`b39690a`).
- 2026-11-24: Project analyzed; CLAUDE.md created. No app code changed.
