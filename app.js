// State, events and DOM updates. Analysis lives in engine.js, rendering in views.js.

const $ = id => document.getElementById(id);
const DESIGN_KEY = 'raceguard-design', THEME_KEY = 'raceguard-theme';
const RUN_INTERVAL = 900;

// localStorage throws when the browser blocks site data
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* not persisted */ } }
};

// ── State ─────────────────────────────────────────────────────────────────────
let threads = [], counts = {}, nextId = 0; // op.uid lets the map follow an operation as it moves
let view = { preset: null, schedule: [], cursor: 0, selection: null, pair: null };
let analysis = null, model = null;
let runTimer = null;
const undoStack = [];
let lastEdit = null; // key of the previous edit, so typing in one field undoes as one step

// ── Design ────────────────────────────────────────────────────────────────────
function snapshot() {
  return JSON.stringify({ threads: threads.map(({ name, ops }) => ({ name, ops: ops.map(({ type, target }) => ({ type, target })) })), semaphores: counts, preset: view.preset });
}

// Returns false if the text is not a usable design
function loadSnapshot(text) {
  let saved;
  try { saved = JSON.parse(text); } catch { return false; }
  const list = saved && saved.threads;
  const isOp = o => o && OP_TYPES.includes(o.type) && typeof o.target === 'string';
  const isThread = t => t && typeof t.name === 'string' && Array.isArray(t.ops) && t.ops.every(isOp);
  if (!Array.isArray(list) || !list.every(isThread)) return false;
  const sems = Object.entries(saved.semaphores || {}).filter(([, n]) => Number.isInteger(n) && n >= 0);
  setDesign(list, Object.fromEntries(sems), Object.hasOwn(PRESETS, saved.preset) ? saved.preset : null);
  return true;
}

function newOp(type, target) { return { uid: nextId++, type, target }; }

function setDesign(list, semaphores, preset) {
  stopRun();
  threads = list.map(t => ({ id: `T${nextId++}`, name: t.name, ops: t.ops.map(o => newOp(o.type, o.target)) }));
  counts = { ...semaphores };
  view = { preset, schedule: [], cursor: 0, selection: null, pair: null };
  reanalyse();
}

function loadPreset(key) {
  const p = PRESETS[key];
  setDesign(p.threads.map(t => ({ name: t.name, ops: t.operations })), p.semaphores || {}, key);
}

// Wraps every change to the program. `key` groups consecutive edits of one field.
function edit(key, change) {
  if (key === null || key !== lastEdit) undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  lastEdit = key;
  stopRun();
  change();
  Object.assign(view, { preset: null, cursor: 0, schedule: [], pair: null });
  reanalyse();
}

function undo() {
  const before = undoStack.pop();
  if (!before) return;
  lastEdit = null;
  loadSnapshot(before);
  announce('Undone.');
}

function reanalyse() {
  analysis = analyseDesign(threads, counts, RaceDetectionEngine);
  if (analysis.result) view.schedule = analysis.engine.roundRobin();
  storage.set(DESIGN_KEY, snapshot());
  render();
}

// ── Running ───────────────────────────────────────────────────────────────────
function pull(t) {
  if (!model.state || !model.runnable[t]) return false;
  const k = model.cursor, o = model.state.pc[t], before = model.state;
  // Keep the plan if it already says this; otherwise replan from here
  view.schedule = model.schedule[k] === t ? model.schedule : analysis.engine.roundRobin([...model.schedule.slice(0, k), t]);
  view.cursor = k + 1;
  render();

  const op = threads[t].ops[o], stale = model.isStale(k);
  TrainMap.ring(t, o, stale);
  TrainMap.pluck(stationKey(op), stale ? 12 : op.type === 'READ' ? 3 : 5);
  if (stale) TrainMap.drop(t, o, before.values[model.result.variables.indexOf(op.target.trim())]);
  return true;
}

function stepOn() {
  if (!model.state || model.cursor >= model.schedule.length) return false;
  const t = model.schedule[model.cursor];
  Levers.swing(t);
  return pull(t);
}

function jumpTo(cursor) {
  if (!model.state) return;
  view.cursor = Math.max(0, Math.min(model.schedule.length, cursor));
  render();
}

function runSchedule(schedule, cursor) {
  stopRun();
  view.schedule = analysis.engine.roundRobin(schedule);
  view.cursor = cursor;
  render();
}

function startRun() {
  stopRun();
  if (!model.state) return;
  if (model.cursor >= model.schedule.length) jumpTo(0);
  if (reducedMotion()) { jumpTo(model.schedule.length); return; }
  runTimer = setInterval(() => { if (!stepOn() || model.cursor >= model.schedule.length) stopRun(); }, RUN_INTERVAL);
  renderTransport();
}

function stopRun() {
  if (!runTimer) return;
  clearInterval(runTimer);
  runTimer = null;
  renderTransport();
}

// ── Rendering ─────────────────────────────────────────────────────────────────
const REGIONS = {
  annunciator: annunciatorView, inspector: inspectorView, problems: problemsView,
  challenge: challengeView, log: logView, board: boardView, endings: endingsView, register: registerView
};
const shown = {};

function render() {
  model = buildModel(threads, counts, analysis, view, PRESETS);
  Object.assign(view, { schedule: model.schedule, cursor: model.cursor });

  const focus = rememberFocus();
  for (const [id, draw] of Object.entries(REGIONS)) {
    const html = draw(model);
    if (shown[id] !== html) $(id).innerHTML = shown[id] = html;
  }
  TrainMap.update(model);
  Levers.update(model);
  restoreFocus(focus);

  $('preset').value = view.preset || '';
  $('undo').disabled = undoStack.length === 0;
  $('export').disabled = !model.result;
  renderTransport();
  renderCode();
}

function renderTransport() {
  const ready = !!(model && model.state);
  $('rewind').disabled = $('back').disabled = !ready || model.cursor === 0;
  $('on').disabled = !ready || model.cursor >= model.schedule.length;
  $('run').disabled = !ready || model.schedule.length === 0;
  $('run').textContent = runTimer ? 'Pause' : 'Run';
}

function renderCode() {
  const lang = document.querySelector('input[name="lang"]:checked').value;
  $('code').textContent = generateCode(lang, threads, counts);
}

// Regions are replaced wholesale, so carry focus and caret across
function rememberFocus() {
  const el = document.activeElement;
  if (!el || !el.id) return null;
  let caret = null;
  try { caret = [el.selectionStart, el.selectionEnd]; } catch { /* not a text field */ }
  return { id: el.id, el, caret };
}
function restoreFocus(saved) {
  if (!saved || saved.el.isConnected) return;
  const el = $(saved.id);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (saved.caret && typeof saved.caret[0] === 'number') el.setSelectionRange(...saved.caret);
}

function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

function announce(text) { $('announce').textContent = text; }

// ── Actions: buttons carry data-action ────────────────────────────────────────
const ACTIONS = {
  select(d) {
    const t = +d.t, o = +d.o, same = view.selection && view.selection.t === t && view.selection.o === o;
    view.selection = same ? null : { t, o };
    lastEdit = null;
    render();
  },
  'add-op'(d) {
    const t = +d.t, last = threads[t].ops.at(-1);
    edit(null, () => {
      threads[t].ops.push(newOp('READ', last && (last.type === 'READ' || last.type === 'WRITE') ? last.target : 'x'));
      view.selection = { t, o: threads[t].ops.length - 1 };
    });
    $('op-target').focus();
    $('op-target').select();
  },
  'remove-op'() {
    const { t, o } = view.selection;
    edit(null, () => {
      threads[t].ops.splice(o, 1);
      view.selection = threads[t].ops.length ? { t, o: Math.min(o, threads[t].ops.length - 1) } : null;
    });
    $(view.selection ? `stop-${t}-${view.selection.o}` : `add-${t}`).focus();
  },
  'move-op'(d) { moveOp(view.selection.t, view.selection.o, view.selection.o + Number(d.by)); },
  'add-thread'() {
    edit(null, () => {
      threads.push({ id: `T${nextId++}`, name: `Thread ${threads.length + 1}`, ops: [] });
      view.selection = null;
    });
    $(`add-${threads.length - 1}`).focus();
  },
  'remove-thread'(d) {
    edit(null, () => { threads.splice(+d.t, 1); view.selection = null; });
    announce('Thread removed. Undo brings it back.');
  },
  clear() {
    edit(null, () => { threads = []; counts = {}; view.selection = null; });
    announce('Program cleared. Undo brings it back.');
  },
  undo,
  deselect() {
    const { t, o } = view.selection;
    view.selection = null;
    render();
    $(`stop-${t}-${o}`).focus();
  },
  rewind() { stopRun(); jumpTo(0); },
  back() { stopRun(); jumpTo(model.cursor - 1); },
  on() { stopRun(); stepOn(); },
  run() { if (runTimer) stopRun(); else startRun(); },
  jump(d) { stopRun(); jumpTo(+d.k); },
  pair(d) { view.pair = view.pair === d.key ? null : d.key; render(); },
  show(d) {
    const schedule = analysis.exploration.witnesses.get(d.key);
    view.pair = d.key;
    runSchedule(schedule, schedule.length);
    revealMap();
  },
  'run-ending'(d) { runSchedule(analysis.exploration.outcomes[+d.i].schedule, 0); revealMap(); startRun(); },
  'run-deadlock'() { runSchedule(analysis.exploration.deadlock.schedule, 0); revealMap(); startRun(); },
  theme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storage.set(THEME_KEY, next);
    labelTheme();
  },
  export: exportReport,
  async copy() {
    let done = 'Copied';
    try { await navigator.clipboard.writeText($('code').textContent); } catch { done = 'Copy failed'; }
    announce(done);
    $('copy').textContent = done;
    setTimeout(() => { $('copy').textContent = 'Copy'; }, 1600);
  }
};

function moveOp(t, from, to) {
  if (to < 0 || to >= threads[t].ops.length || from === to) return;
  edit(null, () => {
    const [op] = threads[t].ops.splice(from, 1);
    threads[t].ops.splice(to, 0, op);
    view.selection = { t, o: to };
  });
}

function dropOp(t, from, to, target) {
  edit(null, () => {
    const [op] = threads[t].ops.splice(from, 1);
    op.target = target;
    threads[t].ops.splice(to, 0, op);
    view.selection = null;
  });
}

function revealMap() {
  const box = $('map').getBoundingClientRect();
  if (box.top < 0 || box.bottom > innerHeight) $('map').scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function labelTheme() { $('theme').textContent = document.documentElement.dataset.theme === 'dark' ? 'Day' : 'Night'; }

function exportReport() {
  if (!model.result) return;
  const url = URL.createObjectURL(new Blob([reportMarkdown(model)], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'raceguard-report.md';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('Report downloaded.');
}

// ── Events ────────────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled) ACTIONS[el.dataset.action](el.dataset);
});

const INPUTS = {
  name(el) { edit(`name-${el.dataset.t}`, () => { threads[+el.dataset.t].name = el.value; }); },
  type(el) { edit(null, () => { threads[view.selection.t].ops[view.selection.o].type = el.value; }); },
  target(el) {
    const { t, o } = view.selection;
    edit(`target-${threads[t].id}-${o}`, () => { threads[t].ops[o].target = el.value; });
  }
};
function onInput(el) {
  const handler = INPUTS[el.dataset.input];
  if (handler) handler(el);
  else if (el.name === 'lang') renderCode();
}
// Re-rendering mid-composition would break IME input, so wait for it to end
document.addEventListener('input', e => { if (!e.isComposing) onInput(e.target); });
document.addEventListener('compositionend', e => onInput(e.target));
document.addEventListener('change', e => {
  if (e.target.id === 'preset' && e.target.value) {
    undoStack.push(snapshot());
    lastEdit = null;
    loadPreset(e.target.value);
  } else if (e.target.dataset.input === 'semaphore') {
    const n = parseInt(e.target.value, 10), { name } = e.target.dataset;
    edit(null, () => { counts[name] = Number.isNaN(n) ? 1 : Math.min(99, Math.max(0, n)); });
  }
});

document.addEventListener('keydown', e => {
  const typing = e.target.closest('input, select, textarea');
  const inText = typing && typing.matches('input:not([type="radio"])');
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inText) { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey) return;
  const stop = e.target.closest('.stop');
  if (stop && stopKey(e, +stop.dataset.t, +stop.dataset.o)) { e.preventDefault(); return; }
  if (typing || e.altKey) return;
  if (/^[1-9]$/.test(e.key)) {
    const t = e.key - 1;
    if (t < threads.length) { stopRun(); if (pull(t)) Levers.swing(t); else Levers.refuse(t); }
  } else if (e.key === 'ArrowRight' && model.state) { e.preventDefault(); ACTIONS.on(); }
  else if (e.key === 'ArrowLeft' && model.state) { e.preventDefault(); ACTIONS.back(); }
  else if (e.key === 'Escape') { view.selection = null; view.pair = null; render(); }
});

// Arrow keys walk the map; Alt+arrow moves the operation; Delete removes it
function stopKey(e, t, o) {
  const go = (t2, o2) => {
    const el = $(`stop-${t2}-${o2}`) || $(`add-${t2}`);
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    return true;
  };
  switch (e.key) {
    case 'ArrowRight':
      if (!e.altKey) return go(t, o + 1);
      moveOp(t, o, o + 1);
      return go(t, Math.min(o + 1, threads[t].ops.length - 1));
    case 'ArrowLeft':
      if (!e.altKey) return go(t, Math.max(o - 1, 0));
      moveOp(t, o, o - 1);
      return go(t, Math.max(o - 1, 0));
    case 'ArrowDown': return t + 1 < threads.length ? go(t + 1, Math.min(o, threads[t + 1].ops.length - 1)) : true;
    case 'ArrowUp': return t > 0 ? go(t - 1, Math.min(o, threads[t - 1].ops.length - 1)) : true;
    case 'Delete': case 'Backspace': view.selection = { t, o }; ACTIONS['remove-op'](); return true;
    default: return false;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
$('preset').innerHTML = '<option value="" disabled>Your own program</option>' +
  Object.entries(PRESETS).map(([key, p]) => `<option value="${key}">${esc(p.label)}</option>`).join('');
labelTheme();
TrainMap.init({ root: $('map'), scroller: $('map-scroll'), layer: $('map-layer'), svg: $('map-svg'), heads: $('map-heads'), plates: $('map-plates'), ticks: $('map-ticks'), popover: $('inspector') },
  { onDragStart: stopRun, onDrop: dropOp });
Levers.init($('levers'), t => { stopRun(); return pull(t); });
const savedDesign = storage.get(DESIGN_KEY);
if (!savedDesign || !loadSnapshot(savedDesign) || threads.length === 0) loadPreset('counter');

// Show what the machine does: run the opening program once, unless the visitor acts first
if (!reducedMotion() && view.preset) {
  const opening = setTimeout(startRun, 1100);
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => clearTimeout(opening), { once: true, capture: true });
}
