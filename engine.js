const DEFAULT_SEMAPHORE_COUNT = 1;

class RaceDetectionEngine {
  constructor() { this.reset(); }

  reset() { this.threads = []; this.semaphoreCounts = {}; }

  addThread(id, name, color, operations) {
    const thread = {
      id, name, color,
      operations: operations.map((op, idx) => ({
        id: `${id}-op${idx}`, threadId: id, threadName: name, threadColor: color,
        type: op.type, target: op.target.trim()
      }))
    };
    this.threads.push(thread);
    return thread;
  }

  // counts: { semaphoreName: initialCount }
  setSemaphores(counts = {}) { this.semaphoreCounts = { ...counts }; }

  semaphoreCount(name) {
    return Object.hasOwn(this.semaphoreCounts, name) ? this.semaphoreCounts[name] : DEFAULT_SEMAPHORE_COUNT;
  }

  _targets(...types) {
    const s = new Set();
    this.threads.forEach(t => t.operations.forEach(op => { if (types.includes(op.type)) s.add(op.target); }));
    return [...s].sort();
  }

  getVariables() { return this._targets('READ', 'WRITE'); }
  getLocks() { return this._targets('LOCK', 'UNLOCK'); }
  getSemaphores() { return this._targets('WAIT', 'SIGNAL'); }

  // Names used in more than one role (variable, mutex, semaphore)
  nameConflicts() {
    const all = [...this.getVariables(), ...this.getLocks(), ...this.getSemaphores()];
    return [...new Set(all.filter((n, i) => all.indexOf(n) !== i))].sort();
  }

  // A semaphore excludes like a mutex only when it starts at 1 and nobody signals it without holding it.
  _mutexSemaphores() {
    return new Set(this.getSemaphores().filter(name => {
      if (this.semaphoreCount(name) !== 1) return false;
      return this.threads.every(t => {
        let held = 0;
        for (const op of t.operations) {
          if (op.target !== name) continue;
          if (op.type === 'WAIT') held++;
          else if (op.type === 'SIGNAL' && --held < 0) return false;
        }
        return true;
      });
    }));
  }

  // op.id -> Set of held locks, keyed 'lock:name' or 'sem:name'
  computeLockSets() {
    const mutexSems = this._mutexSemaphores();
    const map = {};
    for (const thread of this.threads) {
      const held = new Set();
      for (const op of thread.operations) {
        if (op.type === 'LOCK') held.add(`lock:${op.target}`);
        else if (op.type === 'UNLOCK') held.delete(`lock:${op.target}`);
        else if (op.type === 'WAIT' && mutexSems.has(op.target)) held.add(`sem:${op.target}`);
        else if (op.type === 'SIGNAL') held.delete(`sem:${op.target}`);
        map[op.id] = new Set(held);
      }
    }
    return map;
  }

  // Happens-before edges: program order, plus each SIGNAL that a WAIT cannot pass without.
  //
  // A thread's j-th WAIT on s needs at least (j - initial) SIGNALs first. Signals from anyone but
  // thread A can supply at most `others` of them, so A's first (j - initial - others) SIGNALs must
  // precede the WAIT in every execution.
  _happensBefore() {
    const edges = {};
    const signals = new Map(); // semaphore -> Map(threadId -> [op ids])
    for (const t of this.threads) {
      t.operations.forEach((op, i) => {
        edges[op.id] = i + 1 < t.operations.length ? [t.operations[i + 1].id] : [];
        if (op.type !== 'SIGNAL') return;
        if (!signals.has(op.target)) signals.set(op.target, new Map());
        const bySender = signals.get(op.target);
        bySender.set(t.id, [...(bySender.get(t.id) || []), op.id]);
      });
    }

    for (const waiter of this.threads) {
      const waits = new Map(), ownSignals = new Map();
      const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
      for (const op of waiter.operations) {
        if (op.type === 'SIGNAL') bump(ownSignals, op.target);
        if (op.type !== 'WAIT') continue;
        bump(waits, op.target);
        const needed = waits.get(op.target) - this.semaphoreCount(op.target);
        const sent = id => signals.get(op.target)?.get(id) || [];
        const available = id => (id === waiter.id ? (ownSignals.get(op.target) || 0) : sent(id).length);
        for (const sender of this.threads) {
          if (sender.id === waiter.id) continue;
          const others = this.threads.reduce((n, t) => n + (t.id === sender.id ? 0 : available(t.id)), 0);
          sent(sender.id).slice(0, Math.max(0, needed - others)).forEach(id => edges[id].push(op.id));
        }
      }
    }

    const reach = {};
    const reachableFrom = id => {
      if (reach[id]) return reach[id];
      const found = new Set(), stack = [...edges[id]];
      while (stack.length) {
        const next = stack.pop();
        if (found.has(next)) continue;
        found.add(next);
        stack.push(...edges[next]);
      }
      return (reach[id] = found);
    };
    return (a, b) => reachableFrom(a).has(b);
  }

  // Main detection: Bernstein conditions, then lockset, then happens-before
  detect() {
    const lockSets = this.computeLockSets();
    const precedes = this._happensBefore();
    const races = [], safePairs = [];
    const label = keys => [...keys].map(k => k.slice(k.indexOf(':') + 1));

    for (let i = 0; i < this.threads.length; i++) {
      for (let j = i + 1; j < this.threads.length; j++) {
        const tA = this.threads[i], tB = this.threads[j];
        for (const opA of tA.operations) {
          if (opA.type !== 'READ' && opA.type !== 'WRITE') continue;
          for (const opB of tB.operations) {
            if (opB.type !== 'READ' && opB.type !== 'WRITE') continue;
            if (opA.target !== opB.target) continue;                  // same variable
            if (opA.type === 'READ' && opB.type === 'READ') continue; // no write

            const a = { thread: tA, op: opA }, b = { thread: tB, op: opB };
            const common = [...lockSets[opA.id]].filter(l => lockSets[opB.id].has(l));
            if (common.length > 0) {
              safePairs.push({ opA: a, opB: b, variable: opA.target, reason: 'lock', commonLocks: label(common) });
              continue;
            }
            const aFirst = precedes(opA.id, opB.id);
            if (aFirst || precedes(opB.id, opA.id)) {
              safePairs.push({ opA: a, opB: b, variable: opA.target, reason: 'order', commonLocks: [],
                first: aFirst ? a : b, second: aFirst ? b : a });
              continue;
            }

            const type = (opA.type === 'WRITE' && opB.type === 'WRITE') ? 'WW'
                       : (opA.type === 'WRITE') ? 'WR' : 'RW';
            races.push({
              id: `race-${races.length}`, type,
              severity: type === 'WW' ? 'critical' : 'warning',
              opA: { ...a, lockSet: label(lockSets[opA.id]) },
              opB: { ...b, lockSet: label(lockSets[opB.id]) },
              variable: opA.target,
              description: this._desc(type, tA, opA, tB)
            });
          }
        }
      }
    }

    return {
      races, safePairs, lockSets, threads: this.threads,
      variables: this.getVariables(), locks: this.getLocks(), semaphores: this.getSemaphores(),
      ...this._simulate(races),
      critical: races.filter(r => r.severity === 'critical').length,
      warnings: races.filter(r => r.severity === 'warning').length
    };
  }

  _desc(type, tA, opA, tB) {
    const v = `'${opA.target}'`;
    if (type === 'WW') return `${tA.name} and ${tB.name} can both write to ${v} at the same time — one update may be lost.`;
    if (type === 'WR') return `${tA.name} writes to ${v} while ${tB.name} reads — ${tB.name} may see an inconsistent value.`;
    return `${tA.name} reads ${v} while ${tB.name} writes — ${tA.name} may read stale or partial data.`;
  }

  // ── Execution ───────────────────────────────────────────────────────────────
  // A state is plain arrays, indexed by thread, or by position in getVariables() / getLocks() /
  // getSemaphores(). Steps never modify the state they are given.

  start() {
    const variables = this.getVariables();
    return {
      pc: this.threads.map(() => 0),
      owner: this.getLocks().map(() => -1),
      counts: this.getSemaphores().map(s => this.semaphoreCount(s)),
      values: variables.map(() => 0),
      locals: this.threads.map(() => variables.map(() => null)) // last value each thread read
    };
  }

  // Position of each op's target within its kind
  _slots() {
    const index = names => new Map(names.map((n, i) => [n, i]));
    const v = index(this.getVariables()), l = index(this.getLocks()), s = index(this.getSemaphores());
    const kind = { READ: v, WRITE: v, LOCK: l, UNLOCK: l, WAIT: s, SIGNAL: s };
    return op => kind[op.type].get(op.target);
  }

  pending(state, i) { return this.threads[i].operations[state.pc[i]]; }

  canRun(state, i, slot = this._slots()) {
    const op = this.pending(state, i);
    if (!op) return false;
    if (op.type === 'LOCK') return state.owner[slot(op)] < 0;
    if (op.type === 'WAIT') return state.counts[slot(op)] > 0;
    return true;
  }

  // READ copies the variable; a later WRITE by the same thread stores that copy + 1. A WRITE with no
  // prior READ stores the thread's number. codegen.js generates the same behaviour.
  step(state, i, slot = this._slots()) {
    const op = this.pending(state, i), k = slot(op);
    const next = { ...state, pc: state.pc.with(i, state.pc[i] + 1) };
    switch (op.type) {
      case 'READ': next.locals = state.locals.with(i, state.locals[i].with(k, state.values[k])); break;
      case 'WRITE': {
        const copy = state.locals[i][k];
        next.values = state.values.with(k, copy === null ? i + 1 : copy + 1);
        break;
      }
      case 'LOCK': next.owner = state.owner.with(k, i); break;
      case 'UNLOCK': if (state.owner[k] === i) next.owner = state.owner.with(k, -1); break;
      case 'WAIT': next.counts = state.counts.with(k, state.counts[k] - 1); break;
      case 'SIGNAL': next.counts = state.counts.with(k, state.counts[k] + 1); break;
    }
    return next;
  }

  // True when thread i is about to overwrite a value that changed after it read it
  isStaleWrite(state, i) {
    const op = this.pending(state, i);
    if (!op || op.type !== 'WRITE') return false;
    const k = this._slots()(op), copy = state.locals[i][k];
    return copy !== null && copy !== state.values[k];
  }

  isDone(state) { return this.threads.every((_, i) => !this.pending(state, i)); }

  blockedThreads(state) {
    const slot = this._slots();
    return this.threads
      .map((thread, i) => ({ thread, op: this.pending(state, i), runs: this.canRun(state, i, slot) }))
      .filter(b => b.op && !b.runs)
      .map(({ thread, op }) => ({ thread, op }));
  }

  // States visited by a schedule (thread indexes), stopping before the first step that cannot run
  replay(schedule) {
    const slot = this._slots(), states = [this.start()];
    for (const i of schedule) {
      const state = states[states.length - 1];
      if (!this.canRun(state, i, slot)) break;
      states.push(this.step(state, i, slot));
    }
    return states;
  }

  // Extend a schedule by taking turns until nothing can run
  roundRobin(schedule = []) {
    const slot = this._slots(), out = [...schedule], n = this.threads.length;
    let state = this.replay(out).at(-1);
    let turn = out.length ? out[out.length - 1] + 1 : 0;
    for (;;) {
      let chosen = -1;
      for (let k = 0; k < n && chosen < 0; k++) if (this.canRun(state, (turn + k) % n, slot)) chosen = (turn + k) % n;
      if (chosen < 0) return out;
      out.push(chosen);
      state = this.step(state, chosen, slot);
      turn = chosen + 1;
    }
  }

  // One round-robin schedule. `deadlock` describes that schedule only; explore() covers the rest.
  _simulate(races) {
    const raceOf = new Map(); // op.id -> most severe race
    for (const r of races) {
      for (const id of [r.opA.op.id, r.opB.op.id]) {
        if (!raceOf.has(id) || (r.severity === 'critical' && raceOf.get(id).severity !== 'critical')) raceOf.set(id, r);
      }
    }
    const schedule = this.roundRobin(), states = this.replay(schedule);
    const interleaving = schedule.map((i, stepNum) => {
      const op = this.pending(states[stepNum], i), race = raceOf.get(op.id) || null;
      return { stepNum, thread: this.threads[i], op, blocked: this.blockedThreads(states[stepNum]),
        isRace: !!race, race, raceSeverity: race ? race.severity : null };
    });
    const blocked = this.blockedThreads(states.at(-1));
    return { interleaving, deadlock: blocked.length ? { blocked } : null };
  }

  // Breadth-first search of every schedule, so each result carries a shortest schedule reaching it.
  //   outcomes:  distinct final variable values
  //   witnesses: race id -> schedule after which both racing operations can run
  //   deadlock:  null, or a schedule that leaves threads stuck
  //   complete:  false when the state budget ran out, so absence proves nothing
  explore(races, limit = 20000) {
    const slot = this._slots();
    const raceAt = new Map(races.map(r => [`${r.opA.op.id}|${r.opB.op.id}`, r.id]));
    const nodes = [{ state: this.start(), parent: -1, via: -1 }];
    const seen = new Set([JSON.stringify(nodes[0].state)]);
    const pathTo = n => {
      const path = [];
      for (; nodes[n].parent >= 0; n = nodes[n].parent) path.push(nodes[n].via);
      return path.reverse();
    };
    const outcomes = new Map(), witnesses = new Map();
    let deadlock = null, complete = true;

    for (let n = 0; n < nodes.length; n++) {
      const { state } = nodes[n];
      const runnable = this.threads.map((_, i) => i).filter(i => this.canRun(state, i, slot));

      for (const i of runnable) for (const j of runnable) {
        if (i >= j) continue;
        const id = raceAt.get(`${this.pending(state, i).id}|${this.pending(state, j).id}`);
        if (id && !witnesses.has(id)) witnesses.set(id, pathTo(n));
      }

      if (runnable.length === 0) {
        if (this.isDone(state)) {
          const key = JSON.stringify(state.values);
          if (!outcomes.has(key)) outcomes.set(key, { values: state.values, schedule: pathTo(n) });
        } else if (!deadlock) {
          deadlock = { schedule: pathTo(n), blocked: this.blockedThreads(state) };
        }
        continue;
      }
      for (const i of runnable) {
        const next = this.step(state, i, slot), key = JSON.stringify(next);
        if (seen.has(key)) continue;
        if (nodes.length >= limit) { complete = false; continue; }
        seen.add(key);
        nodes.push({ state: next, parent: n, via: i });
      }
    }

    const byValues = (a, b) => a.values.map((v, k) => v - b.values[k]).find(d => d !== 0) || 0;
    return { outcomes: [...outcomes.values()].sort(byValues), witnesses, deadlock, complete, states: nodes.length };
  }
}

// ── Preset Scenarios ──────────────────────────────────────────────────────────
const PRESETS = {
  counter: {
    label: 'Counter++', challenge: 'Make two increments leave counter at 1.',
    description: 'Two threads increment a shared counter without synchronization.',
    threads: [
      { name: 'Thread 1', operations: [{ type: 'READ', target: 'counter' }, { type: 'WRITE', target: 'counter' }] },
      { name: 'Thread 2', operations: [{ type: 'READ', target: 'counter' }, { type: 'WRITE', target: 'counter' }] }
    ]
  },
  bank: {
    label: 'Bank Transfer', challenge: 'The sender locks but the receiver does not. Lose one of the two updates.',
    description: 'Sender uses a mutex, but receiver accesses balance without synchronization.',
    threads: [
      { name: 'Sender', operations: [
        { type: 'LOCK', target: 'mutex' }, { type: 'READ', target: 'balance' },
        { type: 'WRITE', target: 'balance' }, { type: 'UNLOCK', target: 'mutex' }
      ]},
      { name: 'Receiver', operations: [{ type: 'READ', target: 'balance' }, { type: 'WRITE', target: 'balance' }] }
    ]
  },
  producer: {
    label: 'Producer/Consumer', challenge: 'Let the consumer read buffer before the producer fills it.',
    description: 'Unsynchronized buffer and count access between producer and consumer.',
    threads: [
      { name: 'Producer', operations: [{ type: 'WRITE', target: 'buffer' }, { type: 'WRITE', target: 'count' }] },
      { name: 'Consumer', operations: [
        { type: 'READ', target: 'count' }, { type: 'READ', target: 'buffer' }, { type: 'WRITE', target: 'count' }
      ]}
    ]
  },
  rw: {
    label: 'Reader/Writer', challenge: 'Let Reader 1 read the old version, then the new data.',
    description: 'One writer and two readers share data without any locking.',
    threads: [
      { name: 'Writer', operations: [{ type: 'WRITE', target: 'data' }, { type: 'WRITE', target: 'version' }] },
      { name: 'Reader 1', operations: [{ type: 'READ', target: 'version' }, { type: 'READ', target: 'data' }] },
      { name: 'Reader 2', operations: [{ type: 'READ', target: 'data' }] }
    ]
  },
  signal: {
    label: 'Signal/Wait', challenge: 'Try to make the consumer read before the producer writes.',
    description: 'A semaphore starting at 0 makes the consumer wait, so no lock is needed.',
    semaphores: { ready: 0 },
    threads: [
      { name: 'Producer', operations: [{ type: 'WRITE', target: 'message' }, { type: 'SIGNAL', target: 'ready' }] },
      { name: 'Consumer', operations: [{ type: 'WAIT', target: 'ready' }, { type: 'READ', target: 'message' }] }
    ]
  },
  deadlock: {
    label: 'Deadlock', challenge: 'Get both threads stuck in two steps.',
    description: 'Two threads take the same two locks in opposite order and get stuck.',
    threads: [
      { name: 'Transfer 1', operations: [
        { type: 'LOCK', target: 'lockA' }, { type: 'LOCK', target: 'lockB' }, { type: 'WRITE', target: 'funds' },
        { type: 'UNLOCK', target: 'lockB' }, { type: 'UNLOCK', target: 'lockA' }
      ]},
      { name: 'Transfer 2', operations: [
        { type: 'LOCK', target: 'lockB' }, { type: 'LOCK', target: 'lockA' }, { type: 'WRITE', target: 'funds' },
        { type: 'UNLOCK', target: 'lockA' }, { type: 'UNLOCK', target: 'lockB' }
      ]}
    ]
  }
};

const engine = new RaceDetectionEngine();

// Browser pages load this as a classic script; Node tests require() it.
if (typeof module !== 'undefined') module.exports = { RaceDetectionEngine, PRESETS };
