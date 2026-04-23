class RaceDetectionEngine {
  constructor() { this.threads = []; }

  reset() { this.threads = []; }

  addThread(id, name, color, operations) {
    const thread = {
      id, name, color,
      operations: operations.map((op, idx) => ({
        id: `${id}-op${idx}`, threadId: id, threadName: name, threadColor: color,
        type: op.type, target: op.target
      }))
    };
    this.threads.push(thread);
    return thread;
  }

  getVariables() {
    const s = new Set();
    this.threads.forEach(t => t.operations.forEach(op => {
      if (op.type === 'READ' || op.type === 'WRITE') s.add(op.target);
    }));
    return [...s].sort();
  }

  getLocks() {
    const s = new Set();
    this.threads.forEach(t => t.operations.forEach(op => {
      if (['LOCK', 'UNLOCK', 'WAIT', 'SIGNAL'].includes(op.type)) s.add(op.target);
    }));
    return [...s].sort();
  }

  
  computeLockSets() {
    const map = {};
    for (const thread of this.threads) {
      const held = new Set();
      for (const op of thread.operations) {
        if (op.type === 'LOCK' || op.type === 'WAIT') held.add(op.target);
        else if (op.type === 'UNLOCK' || op.type === 'SIGNAL') held.delete(op.target);
        map[op.id] = new Set(held);
      }
    }
    return map;
  }

  hasCommonLock(a, b) { for (const l of a) if (b.has(l)) return true; return false; }

  // Main detection: Bernstein conditions + lockset
  detect() {
    if (this.threads.length < 2) return this._empty();
    const lockSets = this.computeLockSets();
    const races = [], safePairs = [], seen = new Set();

    for (let i = 0; i < this.threads.length; i++) {
      for (let j = i + 1; j < this.threads.length; j++) {
        const tA = this.threads[i], tB = this.threads[j];
        for (const opA of tA.operations) {
          if (opA.type !== 'READ' && opA.type !== 'WRITE') continue;
          for (const opB of tB.operations) {
            if (opB.type !== 'READ' && opB.type !== 'WRITE') continue;
            if (opA.target !== opB.target) continue;         // same variable
            if (opA.type === 'READ' && opB.type === 'READ') continue; // no write
            const key = [opA.id, opB.id].sort().join('||');
            if (seen.has(key)) continue;
            seen.add(key);

            const lsA = lockSets[opA.id] || new Set();
            const lsB = lockSets[opB.id] || new Set();
            const raceType = (opA.type === 'WRITE' && opB.type === 'WRITE') ? 'WW'
                           : (opA.type === 'WRITE') ? 'WR' : 'RW';

            if (this.hasCommonLock(lsA, lsB)) {
              safePairs.push({ opA: { thread: tA, op: opA }, opB: { thread: tB, op: opB },
                variable: opA.target, commonLocks: [...lsA].filter(l => lsB.has(l)) });
            } else {
              races.push({
                id: `race-${races.length}`, type: raceType,
                severity: raceType === 'WW' ? 'critical' : 'warning',
                opA: { thread: tA, op: opA, lockSet: [...lsA] },
                opB: { thread: tB, op: opB, lockSet: [...lsB] },
                variable: opA.target,
                description: this._desc(raceType, tA, opA, tB, opB)
              });
            }
          }
        }
      }
    }

    const interleaving = this._buildInterleaving(races);
    return {
      races, safePairs, threads: this.threads,
      variables: this.getVariables(), locks: this.getLocks(),
      interleaving, lockSets,
      critical: races.filter(r => r.severity === 'critical').length,
      warnings: races.filter(r => r.severity === 'warning').length
    };
  }

  _empty() {
    return { races: [], safePairs: [], threads: this.threads,
      variables: this.getVariables(), locks: this.getLocks(),
      interleaving: [], lockSets: {}, critical: 0, warnings: 0 };
  }

  _desc(type, tA, opA, tB, opB) {
    const v = `'${opA.target}'`;
    if (type === 'WW') return `${tA.name} and ${tB.name} both write to ${v} — one write will be lost (data corruption guaranteed).`;
    if (type === 'WR') return `${tA.name} writes to ${v} while ${tB.name} reads — ${tB.name} may see an inconsistent value.`;
    return `${tA.name} reads ${v} while ${tB.name} writes — ${tA.name} may read stale or partial data.`;
  }

  // Build a round-robin interleaving that exposes races visually
  _buildInterleaving(races) {
    const steps = [];
    const racingIds = new Set(races.flatMap(r => [r.opA.op.id, r.opB.op.id]));
    const ptrs = this.threads.map(() => 0);
    let total = this.threads.reduce((s, t) => s + t.operations.length, 0);
    let ti = 0, stepNum = 0;

    while (total > 0 && stepNum < 500) {
      let assigned = false;
      for (let a = 0; a < this.threads.length; a++) {
        const idx = (ti + a) % this.threads.length;
        const thread = this.threads[idx];
        const ptr = ptrs[idx];
        if (ptr < thread.operations.length) {
          const op = thread.operations[ptr];
          const race = races.find(r => r.opA.op.id === op.id || r.opB.op.id === op.id) || null;
          steps.push({ stepNum: stepNum++, thread, op,
            isRace: racingIds.has(op.id), race, raceSeverity: race ? race.severity : null });
          ptrs[idx]++;
          total--;
          ti = (idx + 1) % this.threads.length;
          assigned = true;
          break;
        }
      }
      if (!assigned) break;
    }
    return steps;
  }
}

// ── Preset Scenarios ──────────────────────────────────────────────────────────
const PRESETS = {
  counter: {
    label: 'Counter++', description: 'Two threads increment a shared counter without synchronization.',
    threads: [
      { name: 'Thread 1', operations: [{ type: 'READ', target: 'counter' }, { type: 'WRITE', target: 'counter' }] },
      { name: 'Thread 2', operations: [{ type: 'READ', target: 'counter' }, { type: 'WRITE', target: 'counter' }] }
    ]
  },
  bank: {
    label: 'Bank Transfer', description: 'Sender uses a mutex, but receiver accesses balance without synchronization.',
    threads: [
      { name: 'Sender', operations: [
        { type: 'LOCK', target: 'mutex' }, { type: 'READ', target: 'balance' },
        { type: 'WRITE', target: 'balance' }, { type: 'UNLOCK', target: 'mutex' }
      ]},
      { name: 'Receiver', operations: [{ type: 'READ', target: 'balance' }, { type: 'WRITE', target: 'balance' }] }
    ]
  },
  producer: {
    label: 'Producer/Consumer', description: 'Unsynchronized buffer and count access between producer and consumer.',
    threads: [
      { name: 'Producer', operations: [{ type: 'WRITE', target: 'buffer' }, { type: 'WRITE', target: 'count' }] },
      { name: 'Consumer', operations: [
        { type: 'READ', target: 'count' }, { type: 'READ', target: 'buffer' }, { type: 'WRITE', target: 'count' }
      ]}
    ]
  },
  rw: {
    label: 'Reader/Writer', description: 'One writer and two readers share data without any locking.',
    threads: [
      { name: 'Writer', operations: [{ type: 'WRITE', target: 'data' }, { type: 'WRITE', target: 'version' }] },
      { name: 'Reader 1', operations: [{ type: 'READ', target: 'version' }, { type: 'READ', target: 'data' }] },
      { name: 'Reader 2', operations: [{ type: 'READ', target: 'data' }] }
    ]
  }
};

const engine = new RaceDetectionEngine();
