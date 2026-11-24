// Pure rendering: every function takes the model built in app.js and returns an HTML or Markdown string.
// Any user-supplied name must pass through esc() on its way into HTML.

const OP_TYPES = ['READ', 'WRITE', 'LOCK', 'UNLOCK', 'WAIT', 'SIGNAL'];

// Map geometry, in px
const LANE = 34, STATION_PAD = 70, MAP_TOP = 40, MAP_MIN = 440, HOME_GAP = 54, STEP_MIN = 92, STEP_MAX = 190;

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
function clip(str, max) { return str.length > max ? `${str.slice(0, max - 1)}…` : str; }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function inkClass(i) { return `ink-${i % 6}`; }

// ── Operation symbols, 24 x 24 ───────────────────────────────────────────────
const SYMBOL = {
  // A value leaves the station / arrives in it
  READ:   '<path d="M12 20V5M6 11l6-6 6 6"/>',
  WRITE:  '<path d="M12 4v15M6 13l6 6 6-6"/>',
  // The token is taken / put back
  LOCK:   '<circle class="solid" cx="12" cy="12" r="6"/>',
  UNLOCK: '<circle cx="12" cy="12" r="6"/>',
  // Semaphore arm at stop / lowered to clear
  WAIT:   '<path d="M7 21V4"/><path class="solid" d="M7 4h13v6H7z"/>',
  SIGNAL: '<path d="M7 21V4"/><path class="solid" d="M8 5l12 7-3 5-9-5z"/>'
};
function symbolSvg(type) { return `<svg class="symbol" viewBox="0 0 24 24" aria-hidden="true">${SYMBOL[type]}</svg>`; }

// ── Model helpers ────────────────────────────────────────────────────────────
function opId(model, t, o) { return `${model.threads[t].id}-op${o}`; }
function threadNumber(model, thread) { return model.threads.findIndex(t => t.id === thread.id) + 1; }

function raceStatus(model, race) {
  if (model.exploration.witnesses.has(race.id)) return 'confirmed';
  return model.exploration.complete ? 'unreachable' : 'unsettled';
}
function liveRaces(model) { return model.result.races.filter(r => raceStatus(model, r) !== 'unreachable'); }

// The pairs a user can select, with a stable key
function pairsOf(model) {
  return [
    ...model.result.races.map(r => ({ key: r.id, race: r, opA: r.opA, opB: r.opB, variable: r.variable })),
    ...model.result.safePairs.map((p, i) => ({ key: `safe-${i}`, safe: p, opA: p.opA, opB: p.opB, variable: p.variable }))
  ];
}
function selectedPair(model) {
  return model.pair && model.result ? pairsOf(model).find(p => p.key === model.pair) : null;
}
function pairHas(pair, id) { return !!pair && (pair.opA.op.id === id || pair.opB.op.id === id); }

// Runs of operations during which a thread holds each lock: [{ name, from, to, released, lane }]
function holdSpans(thread, lockSets) {
  const spans = [], open = new Map();
  thread.operations.forEach((op, i) => {
    const held = lockSets[op.id];
    for (const key of held) if (!open.has(key)) open.set(key, i);
    for (const [key, from] of open) {
      if (held.has(key)) continue;
      spans.push({ key, from, to: i, released: true });
      open.delete(key);
    }
  });
  for (const [key, from] of open) spans.push({ key, from, to: thread.operations.length - 1, released: false });
  spans.sort((a, b) => a.from - b.from);
  const laneEnds = [];
  for (const s of spans) {
    let lane = laneEnds.findIndex(end => end < s.from);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = s.to;
    s.lane = lane;
    s.name = s.key.slice(s.key.indexOf(':') + 1);
  }
  return spans;
}

// ── Annunciator ──────────────────────────────────────────────────────────────
function annunciatorView(model) {
  const pane = (label, value, tone) => `<div class="pane pane-${tone}"><span class="pane-label">${label}</span><span class="pane-value">${value}</span></div>`;
  if (!model.result) return pane('Program', 'Incomplete', 'warn');
  const { exploration: x } = model;
  const live = liveRaces(model).length;
  return pane('Conflicts', live || 'None', live ? 'danger' : 'clear')
    + pane('Endings', `${x.outcomes.length}${x.complete ? '' : '+'}`, x.outcomes.length > 1 ? 'warn' : 'clear')
    + pane('Deadlock', x.deadlock ? 'Possible' : x.complete ? 'None' : 'Not found yet', x.deadlock ? 'danger' : x.complete ? 'clear' : 'warn');
}

// ── Train map layout ─────────────────────────────────────────────────────────
// Time runs right. Stations (shared things) lie across the middle. Each thread rides a home line above or
// below them and swoops in to touch a station at the step its operation runs. Everything here is a target position: map.js animates to it.

const STATION_KIND = { READ: 'variable', WRITE: 'variable', LOCK: 'lock', UNLOCK: 'lock', WAIT: 'semaphore', SIGNAL: 'semaphore' };
function stationKey(op) { return `${STATION_KIND[op.type]}:${op.target.trim()}`; }

// Column of every operation: scheduled ones at their step, stuck ones after the last step.
function columns(model) {
  const col = model.threads.map(t => t.ops.map(() => -1));
  if (!model.state) { // not analysable yet: take turns, ignoring blocking
    let k = 0;
    const longest = model.threads.reduce((n, t) => Math.max(n, t.ops.length), 0);
    for (let o = 0; o < longest; o++) model.threads.forEach((t, i) => { if (o < t.ops.length) col[i][o] = k++; });
    return { col, total: k, scheduled: k };
  }
  const pc = model.threads.map(() => 0);
  model.schedule.forEach((t, k) => { col[t][pc[t]++] = k; });
  const scheduled = model.schedule.length;
  let total = scheduled;
  model.threads.forEach((t, i) => {
    for (let o = pc[i]; o < t.ops.length; o++) { col[i][o] = scheduled + o - pc[i]; total = Math.max(total, col[i][o] + 1); }
  });
  return { col, total, scheduled };
}

function mapLayout(model, available) {
  const n = model.threads.length;
  const { col, total, scheduled } = columns(model);
  const step = Math.max(STEP_MIN, Math.min(STEP_MAX, (available - 130) / Math.max(total, 4)));
  const width = Math.max(available, Math.max(total, 4) * step + 130);

  const order = { variable: 0, lock: 1, semaphore: 2 };
  const ops = model.threads.flatMap(t => t.ops);
  const keys = [...new Set(ops.map(stationKey))].sort((a, b) =>
    order[a.split(':')[0]] - order[b.split(':')[0]] || (a < b ? -1 : a > b ? 1 : 0));
  const above = Math.ceil(n / 2), below = n - above;
  const homes = above * HOME_GAP + Math.max(below, 1) * HOME_GAP, rows = Math.max(keys.length, 1);
  const gap = Math.max(STATION_PAD + Math.max(n, 2) * LANE, (MAP_MIN - MAP_TOP * 2 - homes) / rows);
  const stationTop = MAP_TOP + above * HOME_GAP;
  const live = model.result ? liveRaces(model) : [];
  const stations = keys.map((key, i) => {
    const kind = key.slice(0, key.indexOf(':')), name = key.slice(key.indexOf(':') + 1);
    return { key, kind, name, y: stationTop + (i + 0.5) * gap,
      conflicts: kind === 'variable' ? live.filter(r => r.variable === name).length : 0 };
  });
  const height = MAP_TOP * 2 + homes + rows * gap;
  const yOf = new Map(stations.map(s => [s.key, s.y]));
  const now = model.state ? model.cursor * step : 0;

  const threads = model.threads.map((thread, t) => {
    const lane = (t - (n - 1) / 2) * LANE;
    const points = thread.ops.map((op, o) => ({ x: (col[t][o] + 0.5) * step, y: yOf.get(stationKey(op)) + lane, reached: col[t][o] < scheduled }));
    const pc = model.state ? model.state.pc[t] : 0;
    const finished = pc === points.length && points.length > 0;
    const spans = model.result ? holdSpans(model.result.threads[t], model.result.lockSets) : [];
    return {
      homeY: t < above ? MAP_TOP + (t + 0.5) * HOME_GAP : stationTop + rows * gap + (t - above + 0.5) * HOME_GAP,
      points,
      trainX: finished ? Math.min(now, points[pc - 1].x + step * 0.8) : now,
      endX: points.length ? points.at(-1).x + step * 0.8 + 52 : 90,
      holds: spans.map(s => ({ name: s.name, from: s.from, to: s.released ? s.to : null })),
      blocked: !!model.state && !finished && pc < points.length && !model.runnable[t],
      cargo: model.state ? cargoOf(model, t) : []
    };
  });

  const at = new Map();
  model.threads.forEach((th, t) => th.ops.forEach((_, o) => at.set(opId(model, t, o), { t, o })));
  const arcs = !model.result ? [] : pairsOf(model)
    .filter(p => p.key === model.pair || (p.race && raceStatus(model, p.race) !== 'unreachable'))
    .map(p => ({ key: p.key, tone: p.safe ? 'safe' : p.race.severity, a: at.get(p.opA.op.id), b: at.get(p.opB.op.id),
      focus: p.key === model.pair, dim: !!model.pair && p.key !== model.pair }));

  return { width, height, step, now, stations, threads, arcs };
}

// The copies thread t is carrying: what it read, and whether that is now out of date
function cargoOf(model, t) {
  const { result, state } = model;
  return result.variables.map((name, i) => ({ name, value: state.locals[t][i], current: state.values[i] }))
    .filter(c => c.value !== null)
    .map(c => ({ name: c.name, value: c.value, stale: c.value !== c.current && model.willWrite(t, c.name) }));
}

// A thread's route as knots joined by S-bends: out from home, flat through each stop, and home again
// unless the next stop is the very next step.
function routeKnots(points, home, step) {
  const DWELL = 16, reach = step * 0.72;
  const knots = [{ x: 0, y: home }];
  const add = (x, y) => knots.push({ x: Math.max(x, knots.at(-1).x), y });
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (!prev || p.x - prev.x > step * 1.5) add(p.x - Math.min(reach, prev ? (p.x - prev.x) / 2 : p.x), home);
    add(p.x - DWELL, p.y);
    add(p.x + DWELL, p.y);
    const next = points[i + 1];
    if (!next) add(p.x + reach, home);
    else if (next.x - p.x > step * 1.5) add(p.x + Math.min(reach, (next.x - p.x) / 2), home);
  });
  return knots;
}
function routeY(knots, x) {
  let a = knots[0];
  for (const b of knots) {
    if (x <= b.x && b.x > a.x) {
      const u = Math.max(0, (x - a.x) / (b.x - a.x));
      return a.y + (b.y - a.y) * u * u * (3 - 2 * u);
    }
    a = b;
  }
  return a.y;
}

// Attributes of one stop's button
function stopAttrs(model, t, o) {
  const op = model.threads[t].ops[o], id = opId(model, t, o);
  const conflicts = model.result ? liveRaces(model).filter(r => pairHas(r, id)).length : 0;
  const done = !!model.state && o < model.state.pc[t];
  const next = !!model.state && o === model.state.pc[t];
  const selected = !!model.selection && model.selection.t === t && model.selection.o === o;
  return {
    className: ['stop', inkClass(t), done && 'is-done', next && 'is-next', selected && 'is-selected', conflicts && 'is-race',
      pairHas(selectedPair(model), id) && 'is-pair', !op.target.trim() && 'is-empty'].filter(Boolean).join(' '),
    label: `Thread ${t + 1}, operation ${o + 1}: ${op.type} ${op.target || 'no name'}` +
      (conflicts ? `, ${plural(conflicts, 'conflict')}` : '') + (done ? ', done' : next ? ', next' : ''),
    selected, type: op.type
  };
}

// Live value shown on a station's nameboard
function stationValue(model, s) {
  if (!model.state) return '';
  const { state, result } = model;
  if (s.kind === 'variable') return String(state.values[result.variables.indexOf(s.name)]);
  if (s.kind === 'semaphore') return String(state.counts[result.semaphores.indexOf(s.name)]);
  const owner = state.owner[result.locks.indexOf(s.name)];
  return owner < 0 ? 'free' : `held by ${owner + 1}`;
}

// ── Inspector ────────────────────────────────────────────────────────────────
function inspectorView(model) {
  const s = model.selection;
  if (!s) return '';
  const ops = model.threads[s.t].ops, op = ops[s.o];
  const types = OP_TYPES.map(type => `<label class="type-option${type === op.type ? ' is-on' : ''}">
    <input type="radio" name="op-type" id="type-${type}" value="${type}" data-input="type" ${type === op.type ? 'checked' : ''}><span>${type}</span></label>`).join('');
  const isVar = op.type === 'READ' || op.type === 'WRITE';
  const names = [...new Set(model.threads.flatMap(t => t.ops)
    .filter(o => (o.type === 'READ' || o.type === 'WRITE') === isVar).map(o => o.target.trim()).filter(Boolean))];
  const what = isVar ? 'Variable' : op.type === 'LOCK' || op.type === 'UNLOCK' ? 'Mutex' : 'Semaphore';
  return `<fieldset class="inspector"><legend>Thread ${s.t + 1}, operation ${s.o + 1}</legend>
    <div class="type-options" role="radiogroup" aria-label="Operation type">${types}</div>
    <label class="field"><span>${what}</span><input id="op-target" data-input="target" list="known-names" value="${esc(op.target)}" autocomplete="off" spellcheck="false"></label>
    <datalist id="known-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="inspector-actions">
      <button type="button" id="move-back" data-action="move-op" data-by="-1" ${s.o === 0 ? 'disabled' : ''}>Move left</button>
      <button type="button" id="move-on" data-action="move-op" data-by="1" ${s.o === ops.length - 1 ? 'disabled' : ''}>Move right</button>
      <button type="button" id="remove-op" data-action="remove-op">Remove</button>
      <button type="button" id="close-op" data-action="deselect">Done</button>
    </div></fieldset>`;
}

function problemsView(model) {
  return model.problems.map(p => `<p class="problem">${esc(p)}</p>`).join('');
}

// ── Lever frame ──────────────────────────────────────────────────────────────
function blockReason(model, t) {
  const op = model.threads[t].ops[model.state.pc[t]];
  const target = op.target.trim();
  if (op.type !== 'LOCK') return `${target} is at 0`;
  const owner = model.state.owner[model.result.locks.indexOf(target)];
  return owner === t ? `${target} is already held by this thread` : `${target} is held by thread ${owner + 1}`;
}

function leverParts(model, t) {
  const thread = model.threads[t];
  const name = thread.name || `Thread ${t + 1}`;
  if (!model.state) return { state: 'locked', name, status: 'Program incomplete' };
  const op = thread.ops[model.state.pc[t]];
  if (!op) return { state: 'done', name, status: 'Finished' };
  if (model.runnable[t]) return { state: 'free', name, status: `${op.type} ${op.target.trim()}` };
  return { state: 'locked', name, status: `Blocked: ${blockReason(model, t)}` };
}

function challengeView(model) {
  const preset = model.preset && model.presets[model.preset];
  return preset ? `<b>Try this:</b> ${esc(preset.challenge)}` : 'Pull a lever to run that thread’s next operation.';
}

// What step k of the schedule did (plain text)
function describeStep(model, k) {
  const t = model.schedule[k], before = model.states[k], after = model.states[k + 1];
  const op = model.result.threads[t].operations[before.pc[t]], name = op.target, who = `Thread ${t + 1}`;
  const v = model.result.variables.indexOf(name), s = model.result.semaphores.indexOf(name);
  switch (op.type) {
    case 'READ': return `${who} read ${name} and got ${before.values[v]}.`;
    case 'WRITE': {
      const copy = before.locals[t][v], text = `${who} wrote ${after.values[v]} to ${name}.`;
      if (copy === null) return text;
      return copy === before.values[v] ? `${text} It was working from the ${copy} it read.`
        : `${text} It was working from an old ${copy}, so the ${before.values[v]} written since is lost.`;
    }
    case 'LOCK': return `${who} took the lock ${name}.`;
    case 'UNLOCK': return before.owner[model.result.locks.indexOf(name)] === t ? `${who} released the lock ${name}.`
      : `${who} tried to release ${name} without holding it, so nothing changed.`;
    case 'WAIT': return `${who} passed ${name}, leaving it at ${after.counts[s]}.`;
    default: return `${who} signalled ${name}, raising it to ${after.counts[s]}.`;
  }
}

function logView(model) {
  if (!model.state) return '';
  const { cursor, schedule } = model;
  const stuck = model.stuck.length ? ` <b class="danger-text">Deadlock: ${model.stuck.map(b => `thread ${threadNumber(model, b.thread)} is stuck at ${b.op.type} ${esc(b.op.target)}`).join(' and ')}.</b>` : '';
  const pair = selectedPair(model);
  const atOnce = pair && pair.race && [pair.opA, pair.opB].every(o => {
    const t = threadNumber(model, o.thread) - 1;
    return model.runnable[t] && model.result.threads[t].operations[model.state.pc[t]].id === o.op.id;
  });
  const meet = atOnce ? ` <b class="danger-text">Both can touch ${esc(pair.variable)} now. Pull either lever first.</b>` : '';
  if (cursor === 0) return `Nothing has run yet.${meet}${stuck}`;
  return `<span class="log-step">${cursor} of ${schedule.length}</span> <span${model.isStale(cursor - 1) ? ' class="danger-text"' : ''}>${esc(describeStep(model, cursor - 1))}</span>${meet}${stuck}`;
}

// ── Memory board ─────────────────────────────────────────────────────────────
function boardView(model) {
  if (!model.state) return '';
  const { state, result } = model;
  const copyCell = (t, i) => {
    const copy = state.locals[t][i];
    if (copy === null) return '<td class="copy none"><span class="sr-only">not read</span></td>';
    const stale = copy !== state.values[i] && model.willWrite(t, result.variables[i]);
    return `<td class="copy${stale ? ' stale' : ''}">${copy}${stale ? '<span class="stale-mark">out of date</span>' : ''}</td>`;
  };
  const vars = result.variables.length ? `<table class="memory"><thead><tr><th scope="col">Variable</th><th scope="col">Memory</th>
    ${model.threads.map((_, t) => `<th scope="col">Copy in ${t + 1}</th>`).join('')}</tr></thead><tbody>
    ${result.variables.map((v, i) => `<tr><th scope="row" title="${esc(v)}">${esc(clip(v, 16))}</th><td class="value">${state.values[i]}</td>${model.threads.map((_, t) => copyCell(t, i)).join('')}</tr>`).join('')}
    </tbody></table>` : '';
  return vars;
}

// ── Endings ──────────────────────────────────────────────────────────────────
const MAX_ENDINGS = 12;
// Split-flap lettering; the real text sits beside it for screen readers
function flaps(text) {
  return `<span class="flaps" aria-hidden="true">${[...clip(text, 26)].map((c, i) => `<i style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</i>`).join('')}</span>`;
}
function endingsView(model) {
  if (!model.result) return '<p class="lead">Waiting for a complete program.</p>';
  if (!model.threads.some(t => t.ops.length)) return '<p class="lead">Add a thread, then give it operations.</p>';
  const { exploration: x, result } = model;
  const values = o => result.variables.map((v, i) => `${clip(v, 14)} = ${o.values[i]}`).join(', ') || 'finishes';
  const via = schedule => schedule.map(t => t + 1).join(' ');
  const row = (id, action, text, schedule, cls) => `<li class="${cls}"><span class="sr-only">${esc(text)}</span>${flaps(text)}
    <span class="via" title="Order of threads">${esc(clip(via(schedule), 24))}</span>
    <button type="button" id="${id}" ${action} aria-label="Run it: ${esc(text)}">Run</button></li>`;
  const rows = x.outcomes.slice(0, MAX_ENDINGS).map((o, i) => row(`ending-${i}`, `data-action="run-ending" data-i="${i}"`, values(o), o.schedule, '')).join('');
  const extra = x.outcomes.length > MAX_ENDINGS ? `<li class="more">and ${x.outcomes.length - MAX_ENDINGS} more</li>` : '';
  const dead = x.deadlock ? row('ending-dead', 'data-action="run-deadlock"', 'Deadlock', x.deadlock.schedule, 'dead') : '';
  const lead = x.outcomes.length === 0 ? 'No schedule finishes.'
    : x.outcomes.length === 1 && !x.deadlock ? (liveRaces(model).length ? 'Memory always ends the same, but threads can read different values on the way.'
      : 'One ending. The order of the threads does not change the result.')
    : 'The result depends on who runs when.';
  const proof = x.complete ? `Every schedule checked (${plural(x.states, 'state')}).` : `Stopped after ${x.states.toLocaleString('en')} states. There may be more.`;
  return `<p class="lead">${lead}</p><ul class="endings">${dead}${rows}${extra}</ul><p class="proof">${proof}</p>`;
}

// ── Conflict register ────────────────────────────────────────────────────────
const STATUS_TEXT = { confirmed: 'Can collide', unreachable: 'Never meet', unsettled: 'May collide' };

function registerView(model) {
  if (!model.result) return '';
  const pairs = pairsOf(model);
  if (pairs.length === 0) return '<p class="lead">No two threads share a variable that either one writes, so there is nothing to protect.</p>';
  const rank = p => p.safe ? 3 : raceStatus(model, p.race) === 'unreachable' ? 2 : p.race.severity === 'critical' ? 0 : 1;
  const side = o => { const t = threadNumber(model, o.thread); return `<span class="side"><span class="chip ${inkClass(t - 1)}">${t}</span>${o.op.type}</span>`; };
  return `<ul class="register">${pairs.sort((a, b) => rank(a) - rank(b)).map(p => {
    const status = p.safe ? 'safe' : raceStatus(model, p.race);
    const text = p.safe ? (p.safe.reason === 'order' ? 'Ordered' : 'Locked') : STATUS_TEXT[status];
    const open = p.key === model.pair;
    return `<li class="entry entry-${status}${open ? ' is-open' : ''}">
      <button type="button" class="entry-head" id="pair-${p.key}" data-action="pair" data-key="${p.key}" aria-expanded="${open}">
        <span class="entry-var" title="${esc(p.variable)}">${esc(clip(p.variable, 14))}</span>${side(p.opA)}${side(p.opB)}<span class="entry-status">${text}</span></button>
      ${open ? `<div class="entry-body">${p.safe ? `<p>${esc(describeSafePair(p.safe))}</p>` : raceBody(model, p.race, status)}</div>` : ''}</li>`;
  }).join('')}</ul>`;
}

function raceBody(model, race, status) {
  const holds = o => o.lockSet.length ? o.lockSet.map(l => `<code>${esc(l)}</code>`).join(', ') : 'nothing';
  const fix = generateFixSuggestion(model, race, s => `<b>${esc(s)}</b>`, s => `<code>${esc(s)}</code>`);
  const note = {
    confirmed: `<button type="button" class="primary" id="show-${race.id}" data-action="show" data-key="${race.id}">Show it happen</button>`,
    unreachable: '<p>The locks alone do not prove this safe, but no schedule lets both run at once.</p>',
    unsettled: '<p>The search stopped before settling this one.</p>'
  }[status];
  return `<p>${esc(race.description)}</p>
    <p>Holding: thread ${threadNumber(model, race.opA.thread)} ${holds(race.opA)}; thread ${threadNumber(model, race.opB.thread)} ${holds(race.opB)}.</p>
    ${status === 'unreachable' ? '' : `<p class="fix"><b>Fix.</b> ${fix}</p>`}${note}`;
}

function describeSafePair(pair) {
  if (pair.reason === 'order') {
    const { first, second } = pair;
    return `${first.thread.name}'s ${first.op.type} of '${pair.variable}' always happens before ${second.thread.name}'s ${second.op.type}, because a semaphore orders them.`;
  }
  return `${pair.opA.thread.name} and ${pair.opB.thread.name} both access '${pair.variable}', but hold a common lock: ${pair.commonLocks.join(', ')}.`;
}

// `strong` and `code` wrap (and escape) user-supplied names for the output format.
function generateFixSuggestion(model, race, strong, code) {
  const { result } = model;
  const { opA: a, opB: b, variable } = race;
  const isSem = name => result.semaphores.includes(name);
  const acquire = name => isSem(name) ? `WAIT ${name}` : `LOCK ${name}`;
  const release = name => isSem(name) ? `SIGNAL ${name}` : `UNLOCK ${name}`;
  const nameA = strong(a.thread.name), nameB = strong(b.thread.name), v = code(variable);
  const oneSided = (held, holder, other) =>
    `${holder} holds ${held.map(code).join(', ')}, but ${other} holds nothing. Add ${code(acquire(held[0]))} before and ${code(release(held[0]))} after ${other}'s access to ${v}.`;

  let fix;
  if (a.lockSet.length === 0 && b.lockSet.length === 0) {
    fix = `Put ${code('LOCK mutex')} before and ${code('UNLOCK mutex')} after the use of ${v} in both ${nameA} and ${nameB}.`;
  } else if (b.lockSet.length === 0) {
    fix = oneSided(a.lockSet, nameA, nameB);
  } else if (a.lockSet.length === 0) {
    fix = oneSided(b.lockSet, nameB, nameA);
  } else {
    fix = `The threads hold different locks (${nameA}: ${a.lockSet.map(code).join(', ')}; ${nameB}: ${b.lockSet.map(code).join(', ')}). Use one of them, such as ${code(a.lockSet[0])}, in both threads.`;
  }

  const uses = (t, type, sem) => t.operations.some(op => op.type === type && op.target === sem);
  const orderer = result.semaphores.find(s => model.countOf(s) > 0 &&
    [[a.thread, b.thread], [b.thread, a.thread]].some(([from, to]) =>
      uses(from, 'SIGNAL', s) && !uses(from, 'WAIT', s) && uses(to, 'WAIT', s) && !uses(to, 'SIGNAL', s)));
  if (orderer) fix += ` If ${code(orderer)} is meant to make one thread wait for the other, set its starting count to 0.`;
  return fix;
}

// ── Markdown report ──────────────────────────────────────────────────────────
function reportMarkdown(model) {
  const { result, exploration: x } = model;
  let md = `# RaceGuard report\n\n- Threads: ${model.threads.length}\n- Shared variables: ${result.variables.length}\n- Conflicts: ${liveRaces(model).length}\n- Possible endings: ${x.outcomes.length}${x.complete ? '' : ' or more'}\n- Deadlock: ${x.deadlock ? 'possible' : x.complete ? 'none' : 'not found (search incomplete)'}\n\n`;
  const order = schedule => schedule.map(t => t + 1).join(', ');
  if (x.outcomes.length || x.deadlock) {
    md += `## Endings\n\n`;
    if (x.deadlock) md += `- Deadlock: ${x.deadlock.blocked.map(b => `${b.thread.name} stuck at ${b.op.type} ${b.op.target}`).join(', ')}. Schedule: ${order(x.deadlock.schedule) || 'the start'}\n`;
    x.outcomes.forEach(o => { md += `- ${result.variables.map((v, i) => `\`${v}\` = ${o.values[i]}`).join(', ') || 'finishes'}. Schedule: ${order(o.schedule)}\n`; });
    md += '\n';
  }
  if (result.races.length) {
    md += `## Conflicts\n\n`;
    result.races.forEach((r, i) => {
      const status = raceStatus(model, r);
      md += `### ${i + 1}. \`${r.variable}\`: ${r.opA.thread.name} ${r.opA.op.type}, ${r.opB.thread.name} ${r.opB.op.type} (${STATUS_TEXT[status].toLowerCase()})\n\n${r.description}\n\n`;
      [r.opA, r.opB].forEach(o => { md += `- ${o.thread.name} holds: ${o.lockSet.join(', ') || 'nothing'}\n`; });
      if (status === 'confirmed') md += `- Schedule that brings them together: ${order(x.witnesses.get(r.id)) || 'the start'}\n`;
      if (status !== 'unreachable') md += `\n**Fix.** ${generateFixSuggestion(model, r, s => `**${s}**`, s => `\`${s}\``)}\n`;
      md += '\n';
    });
  }
  if (result.safePairs.length) md += `## Protected pairs\n\n${result.safePairs.map(p => `- ${describeSafePair(p)}`).join('\n')}\n`;
  return md;
}

// Browser pages load this as a classic script; Node tests require() it.
if (typeof module !== 'undefined') {
  module.exports = { OP_TYPES, esc, clip, holdSpans, annunciatorView, mapLayout, routeKnots, routeY, stopAttrs, stationValue, inspectorView, problemsView, leverParts,
    challengeView, describeStep, logView, boardView, endingsView, registerView, reportMarkdown, raceStatus, pairsOf };
}
