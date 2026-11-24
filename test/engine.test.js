const test = require('node:test');
const assert = require('node:assert/strict');
const { RaceDetectionEngine, PRESETS } = require('../engine.js');

// 'A: WAIT s, READ d' -> { name, operations }
function parse(spec) {
  const [name, ops] = spec.split(':');
  return {
    name: name.trim(),
    operations: ops.split(',').map(o => {
      const [type, target] = o.trim().split(' ');
      return { type, target };
    })
  };
}

function analyze(specs, semaphores) {
  return run(specs.map(parse), semaphores);
}

function run(threads, semaphores) {
  const engine = new RaceDetectionEngine();
  threads.forEach((t, i) => engine.addThread(`T${i}`, t.name, '#000000', t.operations));
  engine.setSemaphores(semaphores);
  return engine.detect();
}

const trace = result => result.interleaving.map(s => `${s.thread.name}:${s.op.type}`).join(' ');

// ── Baseline ─────────────────────────────────────────────────────────────────
const BASELINE = {
  counter:  { races: 3, critical: 1, warnings: 2, safe: 0 },
  bank:     { races: 3, critical: 1, warnings: 2, safe: 0 },
  producer: { races: 3, critical: 1, warnings: 2, safe: 0 },
  rw:       { races: 3, critical: 0, warnings: 3, safe: 0 }
};
for (const [key, expected] of Object.entries(BASELINE)) {
  test(`preset ${key} keeps its baseline counts`, () => {
    const r = run(PRESETS[key].threads, PRESETS[key].semaphores);
    assert.deepEqual(
      { races: r.races.length, critical: r.critical, warnings: r.warnings, safe: r.safePairs.length },
      expected
    );
  });
}

test('a single thread cannot race', () => {
  assert.equal(analyze(['A: WRITE x, WRITE x']).races.length, 0);
});

test('two reads do not race', () => {
  assert.equal(analyze(['A: READ x', 'B: READ x']).races.length, 0);
});

test('a common mutex protects a pair', () => {
  const r = analyze(['A: LOCK m, WRITE x, UNLOCK m', 'B: LOCK m, WRITE x, UNLOCK m']);
  assert.equal(r.races.length, 0);
  assert.equal(r.safePairs[0].reason, 'lock');
  assert.deepEqual(r.safePairs[0].commonLocks, ['m']);
});

test('different mutexes do not protect a pair', () => {
  assert.equal(analyze(['A: LOCK m, WRITE x, UNLOCK m', 'B: LOCK n, WRITE x, UNLOCK n']).races.length, 1);
});

test('surrounding whitespace in a target is ignored', () => {
  const engine = new RaceDetectionEngine();
  engine.addThread('T0', 'A', '#000000', [{ type: 'WRITE', target: 'x ' }]);
  engine.addThread('T1', 'B', '#000000', [{ type: 'WRITE', target: 'x' }]);
  assert.equal(engine.detect().races.length, 1);
});

// ── Semaphores as mutual exclusion ───────────────────────────────────────────
const MUTEX_STYLE = ['A: WAIT s, WRITE x, SIGNAL s', 'B: WAIT s, WRITE x, SIGNAL s'];

test('a semaphore with count 1 used as WAIT..SIGNAL protects a pair', () => {
  const r = analyze(MUTEX_STYLE, { s: 1 });
  assert.equal(r.races.length, 0);
  assert.equal(r.safePairs[0].reason, 'lock');
});

test('a semaphore defaults to count 1', () => {
  assert.equal(analyze(MUTEX_STYLE).races.length, 0);
});

test('a semaphore with count 2 admits both threads and does not protect', () => {
  assert.equal(analyze(MUTEX_STYLE, { s: 2 }).races.length, 1);
});

test('signalling without holding the semaphore destroys its mutual exclusion', () => {
  assert.equal(analyze([...MUTEX_STYLE, 'C: SIGNAL s'], { s: 1 }).races.length, 1);
});

test('a mutex and a semaphore sharing a name are not a common lock', () => {
  assert.equal(analyze(['A: LOCK s, WRITE x, UNLOCK s', 'B: WAIT s, WRITE x, SIGNAL s']).races.length, 1);
});

// ── Semaphores as ordering ───────────────────────────────────────────────────
test('SIGNAL orders the accesses before it ahead of those after the WAIT', () => {
  const r = analyze(['A: WRITE d, SIGNAL s', 'B: WAIT s, READ d'], { s: 0 });
  assert.equal(r.races.length, 0);
  assert.equal(r.safePairs[0].reason, 'order');
  assert.equal(r.safePairs[0].first.op.threadName, 'A');
});

test('an initial count lets the WAIT pass early, so there is no ordering', () => {
  assert.equal(analyze(['A: WRITE d, SIGNAL s', 'B: WAIT s, READ d'], { s: 1 }).races.length, 1);
});

test('an access after the SIGNAL is not ordered', () => {
  assert.equal(analyze(['A: SIGNAL s, WRITE d', 'B: WAIT s, READ d'], { s: 0 }).races.length, 1);
});

test('an access before the WAIT is not ordered', () => {
  assert.equal(analyze(['A: WRITE d, SIGNAL s', 'B: READ d, WAIT s'], { s: 0 }).races.length, 1);
});

test('either of two signallers may release one WAIT, so neither is ordered', () => {
  const r = analyze(['A: WRITE d, SIGNAL s', 'C: SIGNAL s', 'B: WAIT s, READ d'], { s: 0 });
  assert.equal(r.races.length, 1);
});

test('waiting for every signaller orders all of them', () => {
  const r = analyze(['A: WRITE d, SIGNAL s', 'C: WRITE e, SIGNAL s', 'B: WAIT s, WAIT s, READ d, READ e'], { s: 0 });
  assert.equal(r.races.length, 0);
});

test('a thread that signals itself does not order another signaller', () => {
  assert.equal(analyze(['A: WRITE d, SIGNAL s', 'B: SIGNAL s, WAIT s, READ d'], { s: 0 }).races.length, 1);
});

test('ordering is transitive across threads', () => {
  const r = analyze(['A: WRITE d, SIGNAL s', 'B: WAIT s, SIGNAL t', 'C: WAIT t, READ d'], { s: 0, t: 0 });
  assert.equal(r.races.length, 0);
});

// ── Interleaving ─────────────────────────────────────────────────────────────
test('a thread waits for a held mutex instead of sharing it', () => {
  const r = analyze(['A: LOCK m, WRITE x, UNLOCK m', 'B: LOCK m, WRITE x, UNLOCK m']);
  assert.equal(trace(r), 'A:LOCK A:WRITE A:UNLOCK B:LOCK B:WRITE B:UNLOCK');
  assert.equal(r.deadlock, null);
});

test('a step lists the threads blocked at that moment', () => {
  const r = analyze(['A: LOCK m, WRITE x, UNLOCK m', 'B: LOCK m, WRITE x, UNLOCK m']);
  const write = r.interleaving.find(s => s.op.type === 'WRITE');
  assert.deepEqual(write.blocked.map(b => [b.thread.name, b.op.target]), [['B', 'm']]);
});

test('unlocking a mutex held by another thread does not release it', () => {
  const r = analyze(['A: LOCK m, WRITE x, WRITE x, UNLOCK m', 'B: UNLOCK m, LOCK m, READ y']);
  assert.ok(trace(r).indexOf('A:UNLOCK') < trace(r).indexOf('B:LOCK'));
});

test('a WAIT blocks until it is signalled', () => {
  assert.equal(trace(analyze(['B: WAIT s, READ d', 'A: WRITE d, SIGNAL s'], { s: 0 })),
    'A:WRITE A:SIGNAL B:WAIT B:READ');
});

test('opposite lock order deadlocks', () => {
  const r = analyze(['A: LOCK m, LOCK n, UNLOCK n, UNLOCK m', 'B: LOCK n, LOCK m, UNLOCK m, UNLOCK n']);
  assert.deepEqual(r.deadlock.blocked.map(b => [b.thread.name, b.op.type, b.op.target]),
    [['A', 'LOCK', 'n'], ['B', 'LOCK', 'm']]);
  assert.equal(r.interleaving.length, 2);
});

test('locking a mutex twice in one thread deadlocks that thread', () => {
  const r = analyze(['A: LOCK m, LOCK m', 'B: READ x']);
  assert.deepEqual(r.deadlock.blocked.map(b => b.thread.name), ['A']);
});

test('long programs are not truncated', () => {
  const ops = Array(300).fill('READ x').join(', ');
  assert.equal(analyze([`A: ${ops}`, `B: ${ops}`]).interleaving.length, 600);
});

test('a step in several races reports the most severe one', () => {
  const r = analyze(['A: WRITE x', 'B: READ x, WRITE x']);
  assert.equal(r.interleaving[0].raceSeverity, 'critical');
});

// ── Wording, names, presets ──────────────────────────────────────────────────
test('descriptions do not claim certainty', () => {
  const r = analyze(['A: WRITE x', 'B: WRITE x']);
  assert.doesNotMatch(r.races[0].description, /guarantee|will be lost/i);
});

test('a name used in two roles is a conflict', () => {
  const engine = new RaceDetectionEngine();
  engine.addThread('T0', 'A', '#000000', parse('A: LOCK m, WRITE m, WAIT s').operations);
  assert.deepEqual(engine.nameConflicts(), ['m']);
});

test('semaphores are listed separately from mutexes', () => {
  const r = analyze(['A: LOCK m, WAIT s', 'B: READ x']);
  assert.deepEqual([r.locks, r.semaphores], [['m'], ['s']]);
});

test('preset signal is race-free because of ordering', () => {
  const r = run(PRESETS.signal.threads, PRESETS.signal.semaphores);
  assert.equal(r.races.length, 0);
  assert.equal(r.deadlock, null);
  assert.ok(r.safePairs.some(p => p.reason === 'order'));
});

test('preset deadlock deadlocks', () => {
  assert.ok(run(PRESETS.deadlock.threads, PRESETS.deadlock.semaphores).deadlock);
});

test('every preset has the fields its card renders', () => {
  for (const [key, p] of Object.entries(PRESETS)) {
    assert.ok(p.emoji && p.label && p.description, key);
  }
});
