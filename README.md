# RaceGuard

A browser tool for learning about race conditions. Design threads from READ, WRITE, LOCK, UNLOCK, WAIT and
SIGNAL operations, then see which accesses can race, why, and how to fix them.

**Live:** https://vansh-vaid.github.io/race-condition-tool/

## What it does

- Finds possible races using Bernstein's conditions, lockset analysis and semaphore happens-before ordering
- Simulates one schedule step by step, showing blocked threads and deadlock
- Shows a timeline, a memory heatmap and a report with fix suggestions (exports to Markdown)
- Generates runnable C (pthreads) and Python for the design

Race reports mean "could overlap", so some may be false positives. Deadlock is checked in the simulated
schedule only, so finding none does not prove there is none.

## Run

Open `index.html` in a browser. There is nothing to install or build.

## Test

```
node --test
```

Needs Node 18 or later. Python is optional; tests that run generated Python are skipped without it.
