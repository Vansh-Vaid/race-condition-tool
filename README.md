# RaceGuard

A browser tool for learning about race conditions. Design threads from READ, WRITE, LOCK, UNLOCK, WAIT and
SIGNAL operations, then see which accesses can race, why, and how to fix them.

**Live:** https://vansh-vaid.github.io/race-condition-tool/

## What it does

- Draws each thread as a train line that swoops in to touch what it shares. Drag stops to change the program.
- Makes you the scheduler: pull a lever to run a thread, and watch an update get lost.
- Finds races with Bernstein's conditions, lockset analysis and semaphore ordering, then checks every schedule
  (up to 20,000 states) for a moment when both sides really can run.
- Lists every possible ending, including deadlock, and replays any of them.
- Exports a Markdown report and generates runnable C (pthreads) and Python.

Keys: 1-9 pull a lever, left and right step, Alt+arrows reorder a stop, Ctrl+Z undoes.

## Run

Open `index.html` in a browser. There is nothing to install or build.

## Test

```
node --test
```

Tested on Node 22. Python is optional; tests that run generated Python are skipped without it.

## Credits

Typeface: [DINish](https://github.com/playbeing/dinish), SIL Open Font License (`fonts/OFL.txt`).
