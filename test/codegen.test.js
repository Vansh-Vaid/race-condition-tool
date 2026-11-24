const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { generateCode } = require('../codegen.js');

const op = (type, target) => ({ type, target });
const thread = (name, ...ops) => ({ name, ops: ops.map(o => op(...o.split(' '))) });
const count = (text, re) => (text.match(re) || []).length;

const python = ['python3', 'python'].find(c => spawnSync(c, ['--version']).status === 0);
function runPython(code) {
  return spawnSync(python, ['-c', code], { encoding: 'utf8', timeout: 10000 });
}

const COUNTER = [thread('Thread 1', 'READ counter', 'WRITE counter'), thread('Thread 2', 'READ counter', 'WRITE counter')];

// ── Python ───────────────────────────────────────────────────────────────────
test('generated Python runs its threads', { skip: !python }, () => {
  const r = runPython(generateCode('py', COUNTER));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /counter = [12]\b/);
});

test('generated Python handles locks, semaphores and an empty thread', { skip: !python }, () => {
  const r = runPython(generateCode('py', [
    thread('A', 'LOCK m', 'WRITE d', 'UNLOCK m', 'SIGNAL s'),
    thread('B', 'WAIT s', 'LOCK m', 'READ d', 'WRITE d', 'UNLOCK m'),
    thread('C')
  ], { s: 0 }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /d = 2\b/);
});

test('generated Python survives awkward names', { skip: !python }, () => {
  const r = runPython(generateCode('py', [
    { name: '1 class', ops: [op('WRITE', '2x'), op('READ', 'lambda'), op('WRITE', 'threading')] },
    { name: '1-class', ops: [op('WRITE', 'a-b'), op('WRITE', 'a b'), op('WRITE', 'π')] },
    { name: '"""\nimport os', ops: [op('WRITE', 'x\ny'), op('READ', 'print')] }
  ]));
  assert.equal(r.status, 0, r.stderr);
});

// ── C ────────────────────────────────────────────────────────────────────────
test('C declares a local once however often it is read', () => {
  const c = generateCode('c', [thread('A', 'READ x', 'READ x', 'READ y'), thread('B', 'WRITE x')]);
  assert.equal(count(c, /int local_x\b/g), 1);
  assert.equal(count(c, /int local_y\b/g), 1);
});

test('a WRITE after a READ uses the value that was read', () => {
  assert.match(generateCode('c', COUNTER), /counter = local_counter \+ 1;/);
});

test('a WRITE with no prior READ does not read the variable', () => {
  const c = generateCode('c', [thread('A', 'WRITE x'), thread('B', 'WRITE x')]);
  assert.match(c, /\bx = 1;/);
  assert.match(c, /\bx = 2;/);
  assert.doesNotMatch(c, /x\+\+/);
});

test('semaphores start at their configured count', () => {
  const t = [thread('A', 'SIGNAL s'), thread('B', 'WAIT s')];
  assert.match(generateCode('c', t, { s: 0 }), /sem_init\(&s, 0, 0\)/);
  assert.match(generateCode('c', t), /sem_init\(&s, 0, 1\)/);
  assert.match(generateCode('py', t, { s: 3 }), /threading\.Semaphore\(3\)/);
});

test('C only includes the semaphore header when it is needed', () => {
  assert.doesNotMatch(generateCode('c', COUNTER), /semaphore\.h/);
});

test('threads with colliding names get distinct functions', () => {
  const c = generateCode('c', [thread('T a', 'WRITE x'), thread('T-a', 'WRITE x')]);
  const names = [...c.matchAll(/^void \*(\w+)\(/gm)].map(m => m[1]);
  assert.equal(new Set(names).size, 2);
});

test('C reserved words and leading digits become valid identifiers', () => {
  const c = generateCode('c', [thread('A', 'WRITE int', 'WRITE 2x', 'WRITE main'), thread('B', 'READ int')]);
  const declared = [...c.matchAll(/^int (\S+) = 0;/gm)].map(m => m[1]);
  assert.equal(declared.length, 3);
  for (const n of declared) {
    assert.match(n, /^[A-Za-z_]\w*$/);
    assert.ok(!['int', 'main'].includes(n), n);
  }
});

test('no threads yields a placeholder', () => {
  assert.equal(generateCode('c', []), '// Add threads to generate code');
  assert.equal(generateCode('py', []), '# Add threads to generate code');
});
