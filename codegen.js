// Turns a thread design into runnable source. Pure: no DOM access.
const generateCode = (() => {
  const RESERVED = {
    c: `auto break case char const continue default do double else enum extern float for goto if inline int
        long register restrict return short signed sizeof static struct switch typedef union unsigned void
        volatile while bool true false nullptr main printf stdin stdout stderr NULL arg`,
    py: `False None True and as assert async await break class continue def del elif else except finally for
        from global if import in is lambda nonlocal not or pass raise return try while with yield match case
        type print threading`
  };

  // Maps design names to unique identifiers: same name in, same identifier out.
  function createNamer(lang) {
    const used = new Set(RESERVED[lang].trim().split(/\s+/));
    const assigned = new Map();
    return (scope, name) => {
      const key = `${scope}\0${name}`;
      if (assigned.has(key)) return assigned.get(key);
      let base = name.trim().replace(/[^A-Za-z0-9_]+/g, '_');
      if (!/^[A-Za-z]/.test(base)) base = `v${base}`;
      // Generated code uses these itself: thread handles, per-thread copies, library calls.
      if (/^(t\d+|local_.*|pthread_.*|sem_.*)$/.test(base)) base = `${base}_`;
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
      used.add(id);
      assigned.set(key, id);
      return id;
    };
  }

  function describe(lang, threads, counts) {
    const name = createNamer(lang);
    const id = {
      variable: t => name('variable', t.trim()),
      lock: t => name('lock', t.trim()),
      semaphore: t => name('semaphore', t.trim())
    };
    const targets = (...types) => [...new Set(
      threads.flatMap(t => t.ops).filter(o => types.includes(o.type)).map(o => o.target.trim())
    )];
    // Shared names are assigned first so they keep their spelling over function names.
    const variables = targets('READ', 'WRITE').map(id.variable);
    const locks = targets('LOCK', 'UNLOCK').map(id.lock);
    const semaphores = targets('WAIT', 'SIGNAL').map(s => ({
      id: id.semaphore(s), count: Object.hasOwn(counts, s) ? counts[s] : 1
    }));
    const functions = threads.map((t, i) => name(`function${i}`, `${t.name.toLowerCase().trim()}_func`));
    return { id, variables, locks, semaphores, functions };
  }

  // Lowers ops to language-neutral steps. READ copies a variable into a local; a later WRITE in the
  // same thread stores local + 1, so an interleaved run really does lose updates.
  function lower(thread, index, id) {
    const read = new Set();
    return thread.ops.map(op => {
      switch (op.type) {
        case 'READ': {
          const v = id.variable(op.target);
          read.add(v);
          return { type: 'READ', v, local: `local_${v}` };
        }
        case 'WRITE': {
          const v = id.variable(op.target);
          return { type: 'WRITE', v, value: read.has(v) ? `local_${v} + 1` : String(index + 1) };
        }
        case 'LOCK': case 'UNLOCK': return { type: op.type, v: id.lock(op.target) };
        default: return { type: op.type, v: id.semaphore(op.target) };
      }
    });
  }

  function generateC(threads, counts) {
    const d = describe('c', threads, counts);
    const out = ['// Build: gcc -pthread race.c -o race', '#include <stdio.h>', '#include <pthread.h>'];
    if (d.semaphores.length) out.push('#include <semaphore.h>');
    out.push('');
    const section = (title, lines) => { if (lines.length) out.push(`// ${title}`, ...lines, ''); };
    section('Shared variables', d.variables.map(v => `int ${v} = 0;`));
    section('Mutexes', d.locks.map(l => `pthread_mutex_t ${l} = PTHREAD_MUTEX_INITIALIZER;`));
    section('Semaphores', d.semaphores.map(s => `sem_t ${s.id};`));

    threads.forEach((t, i) => {
      const steps = lower(t, i, d.id);
      const locals = [...new Set(steps.filter(s => s.type === 'READ').map(s => s.local))];
      out.push(`void *${d.functions[i]}(void *arg) {`, '    (void)arg;');
      locals.forEach(l => out.push(`    int ${l} = 0;`));
      steps.forEach(s => out.push('    ' + {
        READ: `${s.local} = ${s.v}; // READ`,
        WRITE: `${s.v} = ${s.value}; // WRITE`,
        LOCK: `pthread_mutex_lock(&${s.v});`,
        UNLOCK: `pthread_mutex_unlock(&${s.v});`,
        WAIT: `sem_wait(&${s.v});`,
        SIGNAL: `sem_post(&${s.v});`
      }[s.type]));
      locals.forEach(l => out.push(`    (void)${l};`));
      out.push('    return NULL;', '}', '');
    });

    out.push('int main(void) {');
    d.semaphores.forEach(s => out.push(`    sem_init(&${s.id}, 0, ${s.count});`));
    out.push(`    pthread_t ${threads.map((_, i) => `t${i}`).join(', ')};`);
    threads.forEach((_, i) => out.push(`    pthread_create(&t${i}, NULL, ${d.functions[i]}, NULL);`));
    threads.forEach((_, i) => out.push(`    pthread_join(t${i}, NULL);`));
    d.variables.forEach(v => out.push(`    printf("${v} = %d\\n", ${v});`));
    out.push('    return 0;', '}');
    return out.join('\n');
  }

  function generatePython(threads, counts) {
    const d = describe('py', threads, counts);
    const out = ['import threading', ''];
    const section = (title, lines) => { if (lines.length) out.push(`# ${title}`, ...lines, ''); };
    section('Shared variables', d.variables.map(v => `${v} = 0`));
    section('Locks', d.locks.map(l => `${l} = threading.Lock()`));
    section('Semaphores', d.semaphores.map(s => `${s.id} = threading.Semaphore(${s.count})`));

    threads.forEach((t, i) => {
      const steps = lower(t, i, d.id);
      const written = [...new Set(steps.filter(s => s.type === 'WRITE').map(s => s.v))];
      out.push('', `def ${d.functions[i]}():`);
      if (written.length) out.push(`    global ${written.join(', ')}`);
      steps.forEach(s => out.push('    ' + {
        READ: `${s.local} = ${s.v}  # READ`,
        WRITE: `${s.v} = ${s.value}  # WRITE`,
        LOCK: `${s.v}.acquire()`,
        UNLOCK: `${s.v}.release()`,
        WAIT: `${s.v}.acquire()`,
        SIGNAL: `${s.v}.release()`
      }[s.type]));
      if (!steps.length) out.push('    pass');
      out.push('');
    });

    out.push('');
    threads.forEach((_, i) => out.push(`t${i} = threading.Thread(target=${d.functions[i]})`));
    threads.forEach((_, i) => out.push(`t${i}.start()`));
    threads.forEach((_, i) => out.push(`t${i}.join()`));
    d.variables.forEach(v => out.push(`print("${v} =", ${v})`));
    return out.join('\n');
  }

  // threads: [{ name, ops: [{ type, target }] }], counts: { semaphoreName: initialCount }
  return (lang, threads, counts = {}) => {
    if (threads.length === 0) return `${lang === 'py' ? '#' : '//'} Add threads to generate code`;
    return lang === 'py' ? generatePython(threads, counts) : generateC(threads, counts);
  };
})();

// Browser pages load this as a classic script; Node tests require() it.
if (typeof module !== 'undefined') module.exports = { generateCode };
