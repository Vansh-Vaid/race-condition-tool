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

  // Run one round-robin schedule, honouring mutexes and semaphores.
  // `deadlock` is null, or lists the threads left stuck in this schedule.
  _simulate(races) {
    const raceOf = new Map(); // op.id -> most severe race
    for (const r of races) {
      for (const id of [r.opA.op.id, r.opB.op.id]) {
        if (!raceOf.has(id) || (r.severity === 'critical' && raceOf.get(id).severity !== 'critical')) raceOf.set(id, r);
      }
    }

    const owner = new Map(), counts = new Map();
    const count = s => (counts.has(s) ? counts.get(s) : this.semaphoreCount(s));
    const next = this.threads.map(() => 0);
    const pending = i => this.threads[i].operations[next[i]];
    const isBlocked = op => (op.type === 'LOCK' && owner.has(op.target))
                         || (op.type === 'WAIT' && count(op.target) <= 0);
    const stuck = () => this.threads
      .map((thread, i) => ({ thread, op: pending(i) }))
      .filter(b => b.op && isBlocked(b.op));

    const interleaving = [];
    let turn = 0;
    for (;;) {
      let chosen = -1;
      for (let k = 0; k < this.threads.length && chosen < 0; k++) {
        const i = (turn + k) % this.threads.length;
        if (pending(i) && !isBlocked(pending(i))) chosen = i;
      }
      if (chosen < 0) break;

      const thread = this.threads[chosen], op = pending(chosen);
      const race = raceOf.get(op.id) || null;
      interleaving.push({ stepNum: interleaving.length, thread, op, blocked: stuck(),
        isRace: !!race, race, raceSeverity: race ? race.severity : null });

      if (op.type === 'LOCK') owner.set(op.target, thread.id);
      else if (op.type === 'UNLOCK' && owner.get(op.target) === thread.id) owner.delete(op.target);
      else if (op.type === 'WAIT') counts.set(op.target, count(op.target) - 1);
      else if (op.type === 'SIGNAL') counts.set(op.target, count(op.target) + 1);

      next[chosen]++;
      turn = (chosen + 1) % this.threads.length;
    }

    const blocked = stuck();
    return { interleaving, deadlock: blocked.length ? { blocked } : null };
  }
}

// ── Preset Scenarios ──────────────────────────────────────────────────────────
const PRESETS = {
  counter: {
    emoji: '🔢', label: 'Counter++', description: 'Two threads increment a shared counter without synchronization.',
    threads: [
      { name: 'Thread 1', operations: [{ type: 'READ', target: 'counter' }, { type: 'WRITE', target: 'counter' }] },
      { name: 'Thread 2', operations: [{ type: 'READ', target: 'counter' }, { type: 'WRITE', target: 'counter' }] }
    ]
  },
  bank: {
    emoji: '🏦', label: 'Bank Transfer', description: 'Sender uses a mutex, but receiver accesses balance without synchronization.',
    threads: [
      { name: 'Sender', operations: [
        { type: 'LOCK', target: 'mutex' }, { type: 'READ', target: 'balance' },
        { type: 'WRITE', target: 'balance' }, { type: 'UNLOCK', target: 'mutex' }
      ]},
      { name: 'Receiver', operations: [{ type: 'READ', target: 'balance' }, { type: 'WRITE', target: 'balance' }] }
    ]
  },
  producer: {
    emoji: '📦', label: 'Producer/Consumer', description: 'Unsynchronized buffer and count access between producer and consumer.',
    threads: [
      { name: 'Producer', operations: [{ type: 'WRITE', target: 'buffer' }, { type: 'WRITE', target: 'count' }] },
      { name: 'Consumer', operations: [
        { type: 'READ', target: 'count' }, { type: 'READ', target: 'buffer' }, { type: 'WRITE', target: 'count' }
      ]}
    ]
  },
  rw: {
    emoji: '📖', label: 'Reader/Writer', description: 'One writer and two readers share data without any locking.',
    threads: [
      { name: 'Writer', operations: [{ type: 'WRITE', target: 'data' }, { type: 'WRITE', target: 'version' }] },
      { name: 'Reader 1', operations: [{ type: 'READ', target: 'version' }, { type: 'READ', target: 'data' }] },
      { name: 'Reader 2', operations: [{ type: 'READ', target: 'data' }] }
    ]
  },
  signal: {
    emoji: '🚦', label: 'Signal/Wait', description: 'A semaphore starting at 0 makes the consumer wait, so no lock is needed.',
    semaphores: { ready: 0 },
    threads: [
      { name: 'Producer', operations: [{ type: 'WRITE', target: 'message' }, { type: 'SIGNAL', target: 'ready' }] },
      { name: 'Consumer', operations: [{ type: 'WAIT', target: 'ready' }, { type: 'READ', target: 'message' }] }
    ]
  },
  deadlock: {
    emoji: '🔒', label: 'Deadlock', description: 'Two threads take the same two locks in opposite order and get stuck.',
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
