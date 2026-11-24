// Turns a design plus view state into the model that views.js renders. Pure: no DOM access.

// threads: [{ id, name, ops: [{ type, target }] }], counts: { semaphoreName: initialCount }
// Independent of the schedule, so callers can reuse it until the design changes.
function analyseDesign(threads, counts, Engine) {
  const problems = [];
  threads.forEach((t, i) => t.ops.forEach((op, o) => {
    if (!op.target.trim()) problems.push(`Thread ${i + 1}, operation ${o + 1} (${op.type}) needs a name.`);
  }));
  const engine = new Engine();
  threads.forEach(t => engine.addThread(t.id, t.name, '#000000', t.ops));
  engine.setSemaphores(counts);
  engine.nameConflicts().filter(Boolean).forEach(n => {
    problems.push(`“${n}” is used as more than one of variable, mutex and semaphore. Rename one of them.`);
  });
  if (problems.length) return { problems, engine, result: null, exploration: null };
  const result = engine.detect();
  return { problems, engine, result, exploration: engine.explore(result.races) };
}

// view: { preset, schedule, cursor, selection, pair }
function buildModel(threads, counts, analysis, view, presets) {
  const { problems, engine, result, exploration } = analysis;
  const base = {
    threads, problems, result, exploration, presets, ...view,
    countOf: name => engine.semaphoreCount(name),
    states: [], state: null, runnable: [], stuck: [],
    isStale: () => false, willWrite: () => false
  };
  if (!result) return base;

  const states = engine.replay(view.schedule);
  const schedule = view.schedule.slice(0, states.length - 1);
  const cursor = Math.min(view.cursor, schedule.length);
  const state = states[cursor];
  const runnable = threads.map((_, i) => engine.canRun(state, i));
  return {
    ...base, schedule, cursor, states, state, runnable,
    stuck: runnable.some(Boolean) ? [] : engine.blockedThreads(state),
    isStale: k => engine.isStaleWrite(states[k], schedule[k]),
    // Does thread t write this variable before reading it again?
    willWrite: (t, variable) => {
      const next = result.threads[t].operations.slice(state.pc[t])
        .find(op => op.target === variable && (op.type === 'READ' || op.type === 'WRITE'));
      return !!next && next.type === 'WRITE';
    }
  };
}

// Browser pages load this as a classic script; Node tests require() it.
if (typeof module !== 'undefined') module.exports = { analyseDesign, buildModel };
