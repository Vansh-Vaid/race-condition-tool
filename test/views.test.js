const test = require('node:test');
const assert = require('node:assert/strict');
const { RaceDetectionEngine, PRESETS } = require('../engine.js');
const { analyseDesign, buildModel } = require('../model.js');
const views = require('../views.js');

// 'A: READ x, WRITE x'
function design(specs) {
  return specs.map((spec, i) => {
    const [name, ops] = spec.split(':');
    return { id: `T${i}`, name: name.trim(), ops: ops.split(',').map(o => {
      const [type, target = ''] = o.trim().split(' ');
      return { type, target };
    }) };
  });
}

function modelOf(threads, { counts = {}, ...view } = {}) {
  const analysis = analyseDesign(threads, counts, RaceDetectionEngine);
  const schedule = view.schedule || (analysis.result ? analysis.engine.roundRobin() : []);
  return buildModel(threads, counts, analysis, { preset: null, cursor: 0, selection: null, pair: null, ...view, schedule }, PRESETS);
}

function presetModel(key, view = {}) {
  const p = PRESETS[key];
  return modelOf(p.threads.map((t, i) => ({ id: `T${i}`, name: t.name, ops: t.operations })), { counts: p.semaphores, preset: key, ...view });
}

const HTML_VIEWS = ['annunciatorView', 'inspectorView', 'problemsView', 'challengeView', 'logView', 'boardView', 'endingsView', 'registerView'];
const renderAll = model => HTML_VIEWS.map(v => views[v](model)).join('\n');
const allNumbers = value => JSON.stringify(value, (k, v) => {
  if (typeof v === 'number') assert.ok(Number.isFinite(v), k);
  return v;
});

const INCREMENT = ['A: READ x, WRITE x', 'B: READ x, WRITE x'];

for (const key of Object.keys(PRESETS)) {
  test(`preset ${key} renders at every step, with every pair open`, () => {
    const base = presetModel(key);
    for (let cursor = 0; cursor <= base.schedule.length; cursor++) {
      for (const pair of [null, ...views.pairsOf(base).map(p => p.key)]) {
        const m = presetModel(key, { cursor, pair, selection: { t: 0, o: 0 } });
        assert.doesNotMatch(renderAll(m), /undefined|NaN|\[object/);
        allNumbers(views.mapLayout(m, 900));
      }
    }
    assert.doesNotMatch(views.reportMarkdown(base), /undefined|NaN|\[object/);
  });
}

test('names cannot inject HTML anywhere', () => {
  const evil = `"><img/src=x>'`;
  const threads = [0, 1].map(i => ({ id: `T${i}`, name: evil, ops: [
    { type: 'LOCK', target: `${evil}l` }, { type: 'WRITE', target: evil }, { type: 'UNLOCK', target: `${evil}l` },
    { type: 'READ', target: evil }, { type: 'WAIT', target: `${evil}s` }, { type: 'SIGNAL', target: `${evil}s` }] }));
  const base = modelOf(threads);
  for (let cursor = 0; cursor <= base.schedule.length; cursor++) {
    for (const p of views.pairsOf(base)) {
      assert.doesNotMatch(renderAll(modelOf(threads, { cursor, pair: p.key, selection: { t: 0, o: 1 } })), /<img/);
    }
  }
  const broken = [{ id: 'T0', name: evil, ops: [{ type: 'LOCK', target: evil }, { type: 'READ', target: evil }] }];
  assert.doesNotMatch(renderAll(modelOf(broken)), /<img/);
});

test('an unnamed operation is reported instead of analysed', () => {
  const m = modelOf(design(['A: READ', 'B: WRITE x']));
  assert.deepEqual(m.problems, ['Thread 1, operation 1 (READ) needs a name.']);
  assert.equal(m.result, null);
  assert.doesNotMatch(renderAll(m), /undefined|NaN/);
  allNumbers(views.mapLayout(m, 900));
});

test('a name with two roles is reported', () => {
  assert.match(modelOf(design(['A: READ x, LOCK x'])).problems[0], /“x”/);
});

test('an empty program renders', () => {
  assert.doesNotMatch(renderAll(modelOf([])), /undefined|NaN|Infinity/);
  allNumbers(views.mapLayout(modelOf([]), 900));
  assert.match(views.endingsView(modelOf([])), /Add a thread/);
});

test('a thread with no operations renders as finished', () => {
  const m = modelOf([{ id: 'T0', name: 'A', ops: [] }, { id: 'T1', name: 'B', ops: [{ type: 'READ', target: 'x' }] }]);
  assert.equal(views.leverParts(m, 0).state, 'done');
  allNumbers(views.mapLayout(m, 900));
});

test('the log explains a lost update', () => {
  const m = modelOf(design(INCREMENT), { schedule: [0, 1, 0, 1], cursor: 4 });
  assert.equal(views.describeStep(m, 3), 'Thread 2 wrote 1 to x. It was working from an old 0, so the 1 written since is lost.');
  assert.match(views.logView(m), /danger-text/);
});

test('the board marks a copy that is about to overwrite newer data', () => {
  assert.match(views.boardView(modelOf(design(INCREMENT), { schedule: [0, 1, 0, 1], cursor: 3 })), /out of date/);
  assert.doesNotMatch(views.boardView(modelOf(design(INCREMENT), { schedule: [0, 0, 1, 1], cursor: 2 })), /out of date/);
});

test('a blocked lever says who holds the lock', () => {
  const m = modelOf(design(['A: LOCK m, UNLOCK m', 'B: LOCK m, UNLOCK m']), { schedule: [0], cursor: 1 });
  assert.deepEqual(views.leverParts(m, 1), { state: 'locked', name: 'B', status: 'Blocked: m is held by thread 1' });
  assert.deepEqual(m.runnable, [true, false]);
});

test('a conflict no schedule can reach is not counted', () => {
  const both = n => `${n}: WAIT s, WAIT s, WRITE x, SIGNAL s, SIGNAL s`;
  const m = modelOf(design([both('A'), both('B')]), { counts: { s: 2 } });
  assert.equal(m.result.races.length, 1);
  assert.match(views.annunciatorView(m), /Conflicts<\/span><span class="pane-value">None/);
  assert.match(views.registerView(m), /Never meet/);
});

test('hold rails span from LOCK to UNLOCK and flag a lock that is never released', () => {
  const m = modelOf(design(['A: LOCK m, READ x, UNLOCK m, LOCK n', 'B: READ x']));
  assert.deepEqual(views.holdSpans(m.result.threads[0], m.result.lockSets).map(s => [s.name, s.from, s.to, s.released]),
    [['m', 0, 2, true], ['n', 3, 3, false]]);
});

test('nested holds get separate lanes', () => {
  const m = modelOf(design(['A: LOCK m, LOCK n, UNLOCK n, UNLOCK m', 'B: READ x']));
  assert.deepEqual(views.holdSpans(m.result.threads[0], m.result.lockSets).map(s => s.lane), [0, 1]);
});

test('an impossible schedule is cut at the first step that cannot run', () => {
  const m = modelOf(design(['A: LOCK m', 'B: LOCK m']), { schedule: [0, 1], cursor: 2 });
  assert.deepEqual([m.schedule, m.cursor], [[0], 1]);
  assert.equal(m.stuck.length, 1);
});

test('the fix names the semaphore operations for a semaphore lock', () => {
  const m = modelOf(design(['A: WAIT s, WRITE x, SIGNAL s', 'B: WRITE x']));
  assert.match(views.reportMarkdown(m), /Add `WAIT s` before and `SIGNAL s` after/);
});

test('an ordering semaphore that starts above 0 gets a hint', () => {
  const m = modelOf(design(['A: WRITE d, SIGNAL s', 'B: WAIT s, READ d']));
  assert.match(views.reportMarkdown(m), /set its starting count to 0/);
});

test('when a selected conflict is within reach, the log says so', () => {
  const base = modelOf(design(INCREMENT));
  const race = base.result.races[0];
  const schedule = base.exploration.witnesses.get(race.id);
  const m = modelOf(design(INCREMENT), { schedule, cursor: schedule.length, pair: race.id });
  assert.match(views.logView(m), /Both can touch x now/);
});

// ── Train map ────────────────────────────────────────────────────────────────
test('stops sit at the step that runs them, on their own station', () => {
  const l = views.mapLayout(modelOf(design(INCREMENT), { schedule: [0, 0, 1, 1] }), 900);
  const xs = l.threads.flatMap(t => t.points.map(p => p.x));
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
  assert.deepEqual(l.stations.map(s => s.key), ['variable:x']);
});

test('changing the schedule moves the stops', () => {
  const x = schedule => views.mapLayout(modelOf(design(INCREMENT), { schedule }), 900).threads[1].points[0].x;
  assert.ok(x([0, 1, 0, 1]) < x([0, 0, 1, 1]));
});

test('operations a deadlock never reaches come after the last step', () => {
  const l = views.mapLayout(presetModel('deadlock'), 900);
  assert.deepEqual(l.threads[0].points.map(p => p.reached), [true, false, false, false, false]);
  assert.ok(l.threads[0].points[1].x > 2 * l.step);
});

test('trains ride together at the present, and a finished train stops', () => {
  const l = views.mapLayout(modelOf(design(INCREMENT), { schedule: [0, 0, 1, 1], cursor: 3 }), 900);
  assert.equal(l.threads[1].trainX, l.now);
  assert.ok(l.threads[0].trainX < l.now);
});

test('a train carries the copy it read, flagged when it is out of date', () => {
  const cargo = cursor => views.mapLayout(modelOf(design(INCREMENT), { schedule: [0, 1, 0, 1], cursor }), 900).threads[1].cargo;
  assert.deepEqual(cargo(1), []);
  assert.deepEqual(cargo(2), [{ name: 'x', value: 0, stale: false }]);
  assert.deepEqual(cargo(3), [{ name: 'x', value: 0, stale: true }]);
});

test('a station trembles only while it has a live conflict', () => {
  assert.equal(views.mapLayout(modelOf(design(INCREMENT)), 900).stations[0].conflicts, 3);
  assert.equal(views.mapLayout(presetModel('signal'), 900).stations.find(s => s.kind === 'variable').conflicts, 0);
});

test('a route rides home, swoops through a stop and returns', () => {
  const knots = views.routeKnots([{ x: 150, y: 200 }, { x: 750, y: 260 }], 20, 100);
  const y = x => views.routeY(knots, x);
  assert.equal(y(0), 20);
  assert.equal(y(150), 200);
  assert.equal(y(450), 20);
  assert.equal(y(750), 260);
  assert.equal(y(2000), 20);
  assert.ok(y(110) > 20 && y(110) < 200);
});

test('a route goes straight to a stop on the next step', () => {
  const knots = views.routeKnots([{ x: 150, y: 200 }, { x: 250, y: 200 }], 20, 100);
  assert.equal(views.routeY(knots, 200), 200);
});

test('threads ride above and below the stations, which sit between', () => {
  const l = views.mapLayout(modelOf(design(INCREMENT)), 900);
  assert.ok(l.threads[0].homeY < l.stations[0].y && l.stations[0].y < l.threads[1].homeY);
});

test('station values follow the run', () => {
  const m = modelOf(design(['A: LOCK m, WRITE x, UNLOCK m', 'B: WAIT s']), { schedule: [0, 0, 1], cursor: 3 });
  const l = views.mapLayout(m, 900);
  assert.deepEqual(l.stations.map(s => [s.name, views.stationValue(m, s)]), [['x', '1'], ['m', 'held by 1'], ['s', '0']]);
});

test('one ending with live conflicts is not described as order-independent', () => {
  assert.match(views.endingsView(presetModel('rw')), /different values on the way/);
  assert.match(views.endingsView(presetModel('signal')), /does not change the result/);
});

test('a train carries the token of each lock it holds', () => {
  const l = views.mapLayout(modelOf(design(['A: LOCK m, UNLOCK m', 'B: READ x']), { schedule: [0, 1, 0], cursor: 1 }), 900);
  assert.deepEqual(l.threads.map(th => th.tokens), [['m'], []]);
});

test('the map fills the height it is given, and grows past it when it must', () => {
  assert.equal(views.mapLayout(modelOf(design(INCREMENT)), 900, 620).height, 620);
  const many = modelOf(design(['A: READ a, READ b, READ c, READ d, READ e, READ f', 'B: READ a']));
  assert.ok(views.mapLayout(many, 900, 500).height > 500);
});

test('only a conflicting pair is ringed as dangerous', () => {
  assert.doesNotMatch(views.stopAttrs(presetModel('counter', { pair: 'race-0' }), 0, 0).className, /is-safe/);
  assert.match(views.stopAttrs(presetModel('signal', { pair: 'safe-0' }), 0, 0).className, /is-pair is-safe/);
});
