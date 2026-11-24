// Pure rendering: every function takes the model built in app.js and returns an HTML or Markdown string.
// Any user-supplied name must pass through esc() on its way into HTML.

const OP_TYPES = ['READ', 'WRITE', 'LOCK', 'UNLOCK', 'WAIT', 'SIGNAL'];

// Panel geometry, in px. The mosaic is built from CELL-sized squares; a tile covers 2 x 2.
const CELL = 48, TILE = 96, PLATE_W = 144, RAIL_H = 18;
// Train graph geometry
const STATION_H = 34, STATION_W = 104, GRAPH_TOP = 30;

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
function clip(str, max) { return str.length > max ? `${str.slice(0, max - 1)}…` : str; }
// Short schedules get wider steps
function stepWidth(steps) { return steps <= 6 ? 104 : steps <= 10 ? 78 : steps <= 16 ? 58 : 46; }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function inkClass(i) { return `ink-${i % 6}`; }

// ── Operation symbols, drawn on a 96 x 40 strip above the track ──────────────
const SYMBOL = {
  // A value leaves the section / arrives in it
  READ:   '<path class="sym-line" d="M48 20V4M42 10l6-6 6 6"/>',
  WRITE:  '<path class="sym-line" d="M48 2v16M42 12l6 6 6-6"/>',
  // The token is taken / put back
  LOCK:   '<circle class="sym-solid" cx="48" cy="11" r="7"/>',
  UNLOCK: '<circle class="sym-line" cx="48" cy="11" r="6"/>',
  // Semaphore arm at stop / lowered to clear
  WAIT:   '<path class="sym-line" d="M40 22V2"/><path class="sym-solid" d="M40 2h20v7H40z"/>',
  SIGNAL: '<path class="sym-line" d="M40 22V2"/><path class="sym-solid" d="M42 2l17 10-4 6-15-9z"/>'
};

function symbolSvg(type, lit) {
  const lamps = [8, 38, 68].map(x => `<rect class="lamp${lit ? ' lit' : ''}" x="${x}" y="27" width="20" height="4"/>`).join('');
  return `<svg class="symbol" viewBox="0 0 96 40" aria-hidden="true"><rect class="rail" x="0" y="23" width="96" height="12"/>${lamps}${SYMBOL[type]}</svg>`;
}

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

// ── Mosaic panel ─────────────────────────────────────────────────────────────
function panelLayout(model) {
  const rows = [];
  let top = 0;
  model.threads.forEach((thread, t) => {
    const spans = model.result ? holdSpans(model.result.threads[t], model.result.lockSets) : [];
    const lanes = spans.reduce((n, s) => Math.max(n, s.lane + 1), 0);
    // Space under the tiles for hold rails and wires, in whole cells
    const wires = t < model.threads.length - 1 ? 30 : lanes ? 6 : 0;
    const below = Math.ceil((lanes * RAIL_H + wires) / CELL) * CELL;
    rows.push({ top, spans, height: TILE + below });
    top += TILE + below;
  });
  const cols = model.threads.reduce((n, t) => Math.max(n, t.ops.length), 0) + 1;
  return { rows, height: top, width: PLATE_W + cols * TILE };
}

function wiresView(model, layout) {
  if (!model.result) return '';
  const at = new Map();
  model.threads.forEach((th, t) => th.ops.forEach((_, o) => at.set(opId(model, t, o), { t, o })));
  const pairs = pairsOf(model).filter(p => p.key === model.pair || (p.race && raceStatus(model, p.race) !== 'unreachable'));
  const used = [];
  return pairs.map((p, i) => {
    const a = at.get(p.opA.op.id), b = at.get(p.opB.op.id); // the engine lists the upper thread first
    const jog = ((i % 5) - 2) * 7;
    const xa = PLATE_W + a.o * TILE + TILE / 2 + jog, xb = PLATE_W + b.o * TILE + TILE / 2 + jog;
    const row = layout.rows[a.t];
    const channel = used[a.t] = (used[a.t] || 0) + 1;
    const ya = row.top + TILE, yb = layout.rows[b.t].top;
    const y = row.top + row.height - 6 - ((channel - 1) % 4) * 6;
    const tone = p.safe ? 'safe' : p.race.severity;
    const focus = model.pair ? (p.key === model.pair ? ' focus' : ' dim') : '';
    return `<g class="wire wire-${tone}${focus}"><path d="M${xa} ${ya}V${y}H${xb}V${yb}"/><circle cx="${xa}" cy="${ya + 3}" r="3.5"/><circle cx="${xb}" cy="${yb - 3}" r="3.5"/></g>`;
  }).join('');
}

function tileView(model, t, o) {
  const op = model.threads[t].ops[o], id = opId(model, t, o);
  const conflicts = model.result ? liveRaces(model).filter(r => pairHas(r, id)).length : 0;
  const done = !!model.state && o < model.state.pc[t];
  const next = !!model.state && o === model.state.pc[t];
  const selected = !!model.selection && model.selection.t === t && model.selection.o === o;
  const cls = ['tile', done && 'is-done', next && 'is-next', selected && 'is-selected', conflicts && 'is-race',
    pairHas(selectedPair(model), id) && 'is-pair', !op.target.trim() && 'is-empty'].filter(Boolean).join(' ');
  const label = `Thread ${t + 1}, operation ${o + 1}: ${op.type} ${op.target || 'no target'}` +
    (conflicts ? `, ${plural(conflicts, 'conflict')}` : '') + (done ? ', done' : next ? ', next' : '');
  return `<button type="button" class="${cls}" id="tile-${t}-${o}" data-action="select" data-t="${t}" data-o="${o}" draggable="true"
    aria-pressed="${selected}" aria-label="${esc(label)}" title="${esc(`${op.type} ${op.target}`)}">
    <span class="tile-type">${op.type}</span>${symbolSvg(op.type, done)}
    <span class="tile-target">${esc(clip(op.target, 11)) || '?'}</span>
    ${conflicts ? `<span class="tile-flag" aria-hidden="true">${conflicts}</span>` : ''}</button>`;
}

function panelView(model) {
  const layout = panelLayout(model);
  const rows = model.threads.map((thread, t) => {
    const { top, height, spans } = layout.rows[t];
    const rails = spans.map(s => {
      const left = PLATE_W + s.from * TILE + TILE / 2, right = PLATE_W + s.to * TILE + TILE / 2 + (s.released ? 0 : TILE / 2);
      const label = s.released ? s.name : `${s.name}, never released`;
      return `<div class="hold${s.released ? '' : ' hold-open'}" style="left:${left}px;width:${right - left}px;top:${TILE + 5 + s.lane * RAIL_H}px" title="${esc(label)}"><span>${esc(clip(label, 24))}</span></div>`;
    }).join('');
    const pc = model.state ? model.state.pc[t] : 0;
    return `<div class="row ${inkClass(t)}" style="top:${top}px;height:${height}px">
      <div class="track-bed" style="left:${PLATE_W}px"></div>
      <div class="plate"><span class="plate-num">${t + 1}</span>
        <input class="plate-name" id="name-${t}" data-input="name" data-t="${t}" value="${esc(thread.name)}" aria-label="Name of thread ${t + 1}" autocomplete="off" spellcheck="false">
        <button type="button" class="plate-remove" id="remove-thread-${t}" data-action="remove-thread" data-t="${t}" aria-label="Remove thread ${t + 1}">Remove</button></div>
      <div class="tiles">${thread.ops.map((_, o) => tileView(model, t, o)).join('')}<button type="button" class="tile tile-add" id="add-${t}" data-action="add-op" data-t="${t}" aria-label="Add operation to thread ${t + 1}"><span>Add</span></button></div>
      ${rails}
      <div class="berth" data-berth="${t}" style="left:${PLATE_W + pc * TILE}px" aria-hidden="true">${t + 1}</div>
    </div>`;
  }).join('');
  return `<div class="mosaic" style="min-width:${layout.width}px;height:${layout.height}px">
    <svg class="wires" width="${layout.width}" height="${layout.height}" aria-hidden="true">${wiresView(model, layout)}</svg>${rows}</div>`;
}

// ── Inspector ────────────────────────────────────────────────────────────────
function inspectorView(model) {
  const s = model.selection;
  if (!s) return `<p class="hint">Select a tile to change it. Red wires join operations that can collide.</p>`;
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
  return owner === t ? `${target} is already held by this thread` : `${target} is held by ${owner + 1}`;
}

function leversView(model) {
  if (!model.state) return '<p class="hint">The levers unlock when the program is complete.</p>';
  return model.threads.map((thread, t) => {
    const op = thread.ops[model.state.pc[t]];
    const state = !op ? 'done' : model.runnable[t] ? 'free' : 'locked';
    const status = state === 'done' ? 'Finished' : state === 'free' ? `${op.type} ${op.target.trim()}` : blockReason(model, t);
    return `<button type="button" class="lever lever-${state} ${inkClass(t)}" id="lever-${t}" data-action="pull" data-t="${t}" ${state === 'free' ? '' : 'aria-disabled="true"'}>
      <span class="lever-slot" aria-hidden="true"><span class="lever-arm" data-arm="${t}"></span></span>
      <span class="lever-num">${t + 1}</span><span class="lever-name">${esc(clip(thread.name || `Thread ${t + 1}`, 14))}</span>
      <span class="lever-status">${state === 'locked' ? '<b>Blocked.</b> ' : ''}${esc(clip(status, 34))}</span></button>`;
  }).join('');
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
  const locks = result.locks.map((l, i) => `<li class="token${state.owner[i] >= 0 ? ' is-out' : ''}"><span class="token-name">${esc(clip(l, 16))}</span>
    <span>${state.owner[i] >= 0 ? `held by ${state.owner[i] + 1}` : 'free'}</span></li>`).join('');
  const sems = result.semaphores.map((s, i) => `<li class="token"><span class="token-name">${esc(clip(s, 16))}</span><span>now ${state.counts[i]}</span>
    <label class="sem-start">starts at <input type="number" id="sem-${i}" min="0" max="99" value="${model.countOf(s)}" data-input="semaphore" data-name="${esc(s)}"></label></li>`).join('');
  return vars + (locks || sems ? `<ul class="tokens">${locks}${sems}</ul>` : '');
}

// ── Train graph: time left to right, one line per shared thing ───────────────
function graphView(model) {
  if (!model.state) return '';
  const { result, schedule, states, cursor } = model;
  const stations = [...result.variables.map(n => ({ n, kind: 'v' })), ...result.locks.map(n => ({ n, kind: 'l' })), ...result.semaphores.map(n => ({ n, kind: 's' }))];
  const rowOf = new Map(stations.map((s, i) => [`${s.kind}:${s.n}`, i + 1]));
  const kindOf = { READ: 'v', WRITE: 'v', LOCK: 'l', UNLOCK: 'l', WAIT: 's', SIGNAL: 's' };
  const n = model.threads.length;
  const total = Math.max(schedule.length, 4), STEP_W = stepWidth(total);
  const width = STATION_W + total * STEP_W + 30, height = GRAPH_TOP + (stations.length + 1) * STATION_H;
  const yRow = r => GRAPH_TOP + (r + 0.5) * STATION_H;
  const yOf = (r, t) => yRow(r) + (t - (n - 1) / 2) * 5;
  const xOf = k => STATION_W + (k + 0.5) * STEP_W;
  const now = STATION_W + cursor * STEP_W;

  const steps = schedule.map((t, k) => {
    const op = result.threads[t].operations[states[k].pc[t]];
    return { t, k, op, row: rowOf.get(`${kindOf[op.type]}:${op.target}`) };
  });

  let grid = `<text class="station" x="${STATION_W - 12}" y="${yRow(0) + 4}">not started</text><line class="station-line" x1="${STATION_W}" x2="${width}" y1="${yRow(0)}" y2="${yRow(0)}"/>`;
  stations.forEach((s, i) => {
    grid += `<text class="station station-${s.kind}" x="${STATION_W - 12}" y="${yRow(i + 1) + 4}">${esc(clip(s.n, 13))}<title>${esc(s.n)}</title></text>
      <line class="station-line line-${s.kind}" x1="${STATION_W}" x2="${width}" y1="${yRow(i + 1)}" y2="${yRow(i + 1)}"/>`;
  });
  for (let k = 0; k < total; k++) {
    grid += `<line class="time-line" x1="${STATION_W + k * STEP_W}" x2="${STATION_W + k * STEP_W}" y1="${GRAPH_TOP}" y2="${height}"/>`;
    if (k < schedule.length) grid += `<text class="time ${inkClass(schedule[k])}" x="${xOf(k)}" y="${GRAPH_TOP - 10}">${schedule[k] + 1}</text>`;
  }

  // Stretches of time during which a lock is held
  const held = new Map();
  const band = (s, to) => `<rect class="held ${inkClass(s.t)}" x="${xOf(s.k)}" width="${xOf(to) - xOf(s.k)}" y="${yRow(s.row) - 11}" height="22"/>`;
  let bands = '';
  steps.forEach(s => {
    if (s.op.type === 'LOCK') held.set(s.op.target, s);
    const from = held.get(s.op.target);
    if (s.op.type === 'UNLOCK' && from && from.t === s.t) { bands += band(from, s.k); held.delete(s.op.target); }
  });
  for (const s of held.values()) bands += band(s, total);

  const pair = selectedPair(model);
  let lines = '', marks = '';
  model.threads.forEach((thread, t) => {
    const ink = inkClass(t), mine = steps.filter(s => s.t === t);
    let y = yOf(0, t), d = `M${STATION_W} ${y}`;
    mine.forEach(s => {
      const yNext = yOf(s.row, t);
      d += `H${xOf(s.k) - Math.min(STEP_W, 46) * 0.5}L${xOf(s.k)} ${yNext}`;
      y = yNext;
    });
    const finished = mine.length === thread.ops.length;
    if (!finished) d += `H${STATION_W + total * STEP_W}`;
    lines += `<path class="path ${ink} dash-${t % 6}" d="${d}"/>`;
    if (finished && mine.length) {
      const x = xOf(mine.at(-1).k);
      marks += `<path class="terminus ${ink}" d="M${x} ${y}H${x + 12}M${x + 12} ${y - 5}V${y + 5}"/>`;
    }
    mine.forEach(s => {
      const x = xOf(s.k), yy = yOf(s.row, t);
      const open = s.op.type === 'READ' || s.op.type === 'UNLOCK' || s.op.type === 'SIGNAL' ? ' open' : '';
      const shape = kindOf[s.op.type] === 'v' ? `<circle class="mark${open}" cx="${x}" cy="${yy}" r="4.5"/>`
        : `<rect class="mark${open}" x="${x - 4.5}" y="${yy - 4.5}" width="9" height="9"/>`;
      marks += `<g class="${ink}">${pairHas(pair, s.op.id) ? `<circle class="pair-ring" cx="${x}" cy="${yy}" r="10"/>` : ''}${shape}</g>`;
      if (model.isStale(s.k)) marks += `<path class="lost" d="M${x - 8} ${yy - 8}l16 16M${x + 8} ${yy - 8}l-16 16"/>`;
    });
  });
  const hits = schedule.map((_, k) => `<rect class="hit" data-action="jump" data-k="${k + 1}" x="${STATION_W + k * STEP_W}" y="0" width="${STEP_W}" height="${height}"><title>${esc(describeStep(model, k))}</title></rect>`).join('');
  return `<svg class="graph" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(graphSummary(model))}">
    <defs><clipPath id="past"><rect x="0" y="0" width="${now}" height="${height}"/></clipPath>
    <clipPath id="plan"><rect x="${now}" y="0" width="${Math.max(0, width - now)}" height="${height}"/></clipPath></defs>
    ${grid}<g clip-path="url(#plan)" class="plan">${bands}${lines}${marks}</g><g clip-path="url(#past)">${bands}${lines}${marks}</g>
    <line class="now" x1="${now}" x2="${now}" y1="4" y2="${height}"/>${hits}</svg>`;
}

function graphSummary(model) {
  const order = model.schedule.map(t => t + 1).join(', ') || 'none';
  return `Schedule by thread number: ${order}. ${plural(model.cursor, 'step')} run so far.`;
}

// ── Endings ──────────────────────────────────────────────────────────────────
const MAX_ENDINGS = 12;
function endingsView(model) {
  if (!model.result) return '';
  const { exploration: x, result } = model;
  const values = o => result.variables.map((v, i) => `${clip(v, 14)} = ${o.values[i]}`).join(', ') || 'finishes';
  const rows = x.outcomes.slice(0, MAX_ENDINGS).map((o, i) => `<li><span class="ending-values">${esc(values(o))}</span>
    <button type="button" id="ending-${i}" data-action="run-ending" data-i="${i}" aria-label="Run it: ${esc(values(o))}">Run it</button></li>`).join('');
  const extra = x.outcomes.length > MAX_ENDINGS ? `<li class="more">and ${x.outcomes.length - MAX_ENDINGS} more</li>` : '';
  const dead = x.deadlock ? `<li class="ending-dead"><span class="ending-values">Deadlock: ${esc(x.deadlock.blocked.map(b => `${threadNumber(model, b.thread)} stuck at ${b.op.type} ${b.op.target}`).join(', '))}</span>
    <button type="button" id="ending-dead" data-action="run-deadlock" aria-label="Run it: deadlock">Run it</button></li>` : '';
  const lead = x.outcomes.length === 0 ? 'No schedule finishes.'
    : x.outcomes.length === 1 && !x.deadlock ? 'One ending. The order of the threads does not change the result.'
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
  module.exports = { OP_TYPES, esc, clip, holdSpans, annunciatorView, panelView, inspectorView, problemsView, leversView, challengeView,
    describeStep, logView, boardView, graphView, endingsView, registerView, reportMarkdown, raceStatus, pairsOf };
}
