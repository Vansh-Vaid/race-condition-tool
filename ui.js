/**
 * ui.js — RaceGuard UI Controller
 * Handles: thread designer, SVG timeline, heatmap, race report, step-through mode
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const THREAD_COLORS = ['#6c63ff','#00d4ff','#ff6b9d','#ffd93d','#6bcb77','#ff9f43'];
const OP_COLORS = { READ:'#38bdf8', WRITE:'#fb923c', LOCK:'#4ade80', UNLOCK:'#34d399' };
const RACE_COLOR = '#ff4757';

const TL = { // timeline geometry
  LABEL_W: 120, OP_W: 88, OP_GAP: 10, OP_H: 52,
  LANE_H: 82, LANE_PAD: 14, HEADER_H: 28, PAD: 20
};

// ── State ─────────────────────────────────────────────────────────────────────
let uiThreads = [];   // [{id, name, color, ops:[{type,target}]}]
let threadIdCtr = 0;
let detectionResult = null;
let currentStep = -1;  // -1 = all shown (static), >=0 = step-through
let autoPlayTimer = null;
let activePreset = null;

// ── Initialise ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPreset('counter');
});

// ── Preset Loading ────────────────────────────────────────────────────────────
function loadPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  activePreset = key;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`preset-${key}`);
  if (btn) btn.classList.add('active');

  uiThreads = [];
  threadIdCtr = 0;
  preset.threads.forEach(t => {
    addThreadData(t.name, t.operations.map(o => ({ type: o.type, target: o.target })));
  });
  detectionResult = null;
  currentStep = -1;
  renderThreads();
  resetResultViews();
  updateSharedVars();
}

// ── Thread Data Ops ───────────────────────────────────────────────────────────
function addThreadData(name, ops = []) {
  const id = `T${threadIdCtr++}`;
  const color = THREAD_COLORS[uiThreads.length % THREAD_COLORS.length];
  uiThreads.push({ id, name, color, ops });
  return id;
}

function addThread() {
  activePreset = null;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  addThreadData(`Thread ${threadIdCtr + 1}`, []);
  renderThreads();
  updateSharedVars();
}

function deleteThread(id) {
  uiThreads = uiThreads.filter(t => t.id !== id);
  renderThreads();
  updateSharedVars();
}

function addOp(threadId) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t) return;
  t.ops.push({ type: 'READ', target: 'x' });
  renderThreads();
  updateSharedVars();
}

function deleteOp(threadId, opIdx) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t) return;
  t.ops.splice(opIdx, 1);
  renderThreads();
  updateSharedVars();
}

function updateThreadName(id, val) {
  const t = uiThreads.find(t => t.id === id);
  if (t) t.name = val;
}

function updateOp(threadId, opIdx, field, val) {
  const t = uiThreads.find(t => t.id === threadId);
  if (t && t.ops[opIdx]) {
    t.ops[opIdx][field] = val;
    if (field === 'type') renderThreads();
    updateSharedVars();
  }
}

// ── Render Thread Cards ───────────────────────────────────────────────────────
function renderThreads() {
  const container = document.getElementById('threads-container');
  container.innerHTML = '';
  uiThreads.forEach(thread => {
    const card = document.createElement('div');
    card.className = 'thread-card';
    card.id = `card-${thread.id}`;

    const opsHtml = thread.ops.map((op, i) => `
      <div class="op-row" id="op-${thread.id}-${i}">
        <span class="op-type-badge badge-${op.type.toLowerCase()}">${op.type[0]}</span>
        <select class="op-type-select" onchange="updateOp('${thread.id}',${i},'type',this.value)">
          ${['READ','WRITE','LOCK','UNLOCK'].map(t =>
            `<option value="${t}" ${op.type===t?'selected':''}>${t}</option>`
          ).join('')}
        </select>
        <input class="op-target-input" type="text" value="${op.target}"
          placeholder="${op.type==='LOCK'||op.type==='UNLOCK'?'lock':'var'}"
          onchange="updateOp('${thread.id}',${i},'target',this.value)"
          oninput="updateOp('${thread.id}',${i},'target',this.value)" />
        <button class="btn-delete-op" onclick="deleteOp('${thread.id}',${i})" title="Remove">✕</button>
      </div>`
    ).join('');

    card.innerHTML = `
      <div class="thread-card-header">
        <div class="thread-color-dot" style="background:${thread.color}"></div>
        <input class="thread-name-input" type="text" value="${thread.name}"
          onchange="updateThreadName('${thread.id}',this.value)"
          oninput="updateThreadName('${thread.id}',this.value)" />
        <button class="btn-delete-thread" onclick="deleteThread('${thread.id}')" title="Delete thread">✕</button>
      </div>
      <div class="thread-ops-list">${opsHtml}</div>
      <div style="padding:0 8px 8px">
        <button class="btn-add-op" onclick="addOp('${thread.id}')">+ Add Operation</button>
      </div>`;
    container.appendChild(card);
  });
}

// ── Shared Vars/Locks Display ─────────────────────────────────────────────────
function updateSharedVars() {
  const el = document.getElementById('shared-vars');
  const vars = new Set(), locks = new Set();
  uiThreads.forEach(t => t.ops.forEach(op => {
    if (op.type === 'READ' || op.type === 'WRITE') vars.add(op.target);
    if (op.type === 'LOCK' || op.type === 'UNLOCK') locks.add(op.target);
  }));
  const pills = [...vars].map(v => `<span class="var-pill">${v}</span>`).join('')
              + [...locks].map(l => `<span class="lock-pill">🔒${l}</span>`).join('');
  el.innerHTML = pills || '<span class="empty-hint">No variables yet</span>';
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetAll() {
  uiThreads = []; threadIdCtr = 0; detectionResult = null; currentStep = -1;
  activePreset = null;
  stopAutoPlay();
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  renderThreads();
  updateSharedVars();
  resetResultViews();
}

function resetResultViews() {
  stopAutoPlay();
  document.getElementById('stats-bar').classList.add('hidden');
  document.getElementById('timeline-empty').classList.remove('hidden');
  document.getElementById('timeline-svg').classList.add('hidden');
  document.getElementById('step-controls').classList.add('hidden');
  document.getElementById('timeline-legend').classList.add('hidden');
  document.getElementById('heatmap-empty').classList.remove('hidden');
  document.getElementById('heatmap-grid').classList.add('hidden');
  document.getElementById('heatmap-grid').innerHTML = '';
  document.getElementById('report-empty').classList.remove('hidden');
  document.getElementById('report-content').classList.add('hidden');
  document.getElementById('report-content').innerHTML = '';
}

// ── Tab Switching ─────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`content-${name}`).classList.add('active');
}

// ── Main Detection ────────────────────────────────────────────────────────────
function runDetection() {
  if (uiThreads.length < 2) {
    showToast('⚠ Add at least 2 threads to detect races', 'error'); return;
  }
  if (uiThreads.some(t => t.ops.length === 0)) {
    showToast('⚠ Each thread needs at least one operation', 'error'); return;
  }

  engine.reset();
  uiThreads.forEach(t => engine.addThread(t.id, t.name, t.color, t.ops));
  detectionResult = engine.detect();

  // Stats
  const raceCount = detectionResult.races.length;
  document.getElementById('stats-bar').classList.remove('hidden');
  document.getElementById('val-threads').textContent = uiThreads.length;
  document.getElementById('val-vars').textContent = detectionResult.variables.length;
  document.getElementById('val-races').textContent = raceCount;
  document.getElementById('val-safe').textContent = detectionResult.safePairs.length;

  const raceCard = document.getElementById('stat-races');
  raceCard.className = 'stat-card ' + (raceCount === 0 ? 'success' : detectionResult.critical > 0 ? 'critical' : 'warning');

  // Render all views
  currentStep = -1;
  renderTimeline();
  renderHeatmap();
  renderReport();

  if (raceCount > 0) {
    showToast(`⚡ ${raceCount} race condition${raceCount>1?'s':''} detected!`, 'error');
  } else {
    showToast('✅ No race conditions detected — all accesses are protected', 'success');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TIMELINE RENDERING (SVG)
// ══════════════════════════════════════════════════════════════════════════════
function renderTimeline() {
  if (!detectionResult) return;
  const { threads, races, interleaving } = detectionResult;
  const maxOps = Math.max(...threads.map(t => t.operations.length), 1);
  const svgW = TL.LABEL_W + maxOps * (TL.OP_W + TL.OP_GAP) + TL.PAD * 2;
  const svgH = threads.length * TL.LANE_H + TL.HEADER_H + TL.PAD;

  const svg = document.getElementById('timeline-svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.classList.remove('hidden');
  document.getElementById('timeline-empty').classList.add('hidden');
  document.getElementById('timeline-legend').classList.remove('hidden');

  const racingIds = new Set(races.flatMap(r => [r.opA.op.id, r.opB.op.id]));

  // Build lookup: opId → {col (x), row (y)}
  const opPos = {};
  threads.forEach((thread, row) => {
    thread.operations.forEach((op, col) => {
      const x = TL.LABEL_W + col * (TL.OP_W + TL.OP_GAP);
      const y = TL.HEADER_H + row * TL.LANE_H;
      opPos[op.id] = { x, y, row, col };
    });
  });

  let html = `<defs>
    <filter id="glow-race"><feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="glow-step"><feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="${RACE_COLOR}" opacity="0.7"/>
    </marker>
  </defs>`;

  // Lane backgrounds
  threads.forEach((thread, row) => {
    const y = TL.HEADER_H + row * TL.LANE_H;
    const bg = row % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.03)';
    html += `<rect x="0" y="${y}" width="${svgW}" height="${TL.LANE_H}" fill="${bg}"/>`;
    // Thread label
    html += `<rect x="4" y="${y+16}" width="${TL.LABEL_W-12}" height="50" rx="6" fill="${thread.color}18" stroke="${thread.color}40" stroke-width="1"/>
    <circle cx="16" cy="${y+TL.LANE_H/2-8}" r="5" fill="${thread.color}"/>
    <text x="26" y="${y+TL.LANE_H/2-3}" fill="${thread.color}" font-family="JetBrains Mono,monospace" font-size="11" font-weight="600">${esc(thread.name)}</text>
    <text x="26" y="${y+TL.LANE_H/2+12}" fill="${thread.color}99" font-family="JetBrains Mono,monospace" font-size="9">${thread.operations.length} op${thread.operations.length!==1?'s':''}</text>`;
  });

  // Vertical grid lines (time slots)
  for (let col = 0; col < maxOps; col++) {
    const x = TL.LABEL_W + col * (TL.OP_W + TL.OP_GAP);
    html += `<line x1="${x}" y1="${TL.HEADER_H}" x2="${x}" y2="${svgH}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
    <text x="${x + TL.OP_W/2}" y="${TL.HEADER_H - 8}" fill="rgba(255,255,255,0.2)" font-size="10" text-anchor="middle" font-family="JetBrains Mono,monospace">t${col+1}</text>`;
  }

  // Operation blocks
  threads.forEach((thread, row) => {
    thread.operations.forEach((op, col) => {
      const pos = opPos[op.id];
      const x = pos.x + 4; const y = pos.y + TL.LANE_PAD;
      const w = TL.OP_W - 4; const h = TL.OP_H;
      const isRace = racingIds.has(op.id);
      const fillColor = isRace ? RACE_COLOR : OP_COLORS[op.type] || '#888';
      const opacity = currentStep >= 0 ? (interleaving[currentStep]?.op.id === op.id ? 1 : 0.35) : 1;

      html += `<g class="op-group" id="op-block-${op.id}" opacity="${opacity}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"
          fill="${fillColor}22" stroke="${fillColor}" stroke-width="${isRace?2:1.5}"
          ${isRace ? `filter="url(#glow-race)"` : ''}/>
        <rect x="${x}" y="${y}" width="${w}" height="4" rx="3" fill="${fillColor}60"/>
        <text x="${x+w/2}" y="${y+18}" text-anchor="middle" fill="${fillColor}"
          font-family="JetBrains Mono,monospace" font-size="10" font-weight="600">${op.type}</text>
        <text x="${x+w/2}" y="${y+33}" text-anchor="middle" fill="rgba(255,255,255,0.8)"
          font-family="JetBrains Mono,monospace" font-size="11">${esc(op.target)}</text>
        ${isRace ? `<text x="${x+w-6}" y="${y+12}" text-anchor="middle" fill="${RACE_COLOR}" font-size="12">⚡</text>` : ''}
      </g>`;
    });
  });

  // Race arcs (connecting lines between racing operations across threads)
  races.forEach((race, ri) => {
    const pA = opPos[race.opA.op.id];
    const pB = opPos[race.opB.op.id];
    if (!pA || !pB) return;
    const x1 = pA.x + TL.OP_W/2, y1 = pA.y + TL.LANE_PAD + TL.OP_H/2;
    const x2 = pB.x + TL.OP_W/2, y2 = pB.y + TL.LANE_PAD + TL.OP_H/2;
    const cx = (x1+x2)/2, cy = Math.min(y1,y2) - 20 - ri*8;
    const color = race.severity === 'critical' ? RACE_COLOR : '#ffa502';
    html += `<path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}"
      stroke="${color}" stroke-width="1.5" fill="none" stroke-dasharray="5,4" opacity="0.7"
      marker-end="url(#arrow)"/>`;
  });

  // Step highlight overlay
  if (currentStep >= 0 && interleaving[currentStep]) {
    const step = interleaving[currentStep];
    const pos = opPos[step.op.id];
    if (pos) {
      const x = pos.x + 4; const y = pos.y + TL.LANE_PAD;
      const w = TL.OP_W - 4; const h = TL.OP_H;
      const color = step.isRace ? RACE_COLOR : '#fff';
      html += `<rect x="${x-2}" y="${y-2}" width="${w+4}" height="${h+4}" rx="7"
        fill="none" stroke="${color}" stroke-width="2.5" opacity="0.9" filter="url(#glow-step)"/>`;
    }
  }

  svg.innerHTML = html;
  document.getElementById('step-controls').classList.remove('hidden');
  updateStepUI();
}

// ── Step-through ──────────────────────────────────────────────────────────────
function stepNext() {
  if (!detectionResult) return;
  const max = detectionResult.interleaving.length - 1;
  if (currentStep < max) currentStep++;
  renderTimeline();
}
function stepPrev() {
  if (currentStep > 0) currentStep--;
  else currentStep = -1;
  renderTimeline();
}
function updateStepUI() {
  if (!detectionResult) return;
  const total = detectionResult.interleaving.length;
  const el = document.getElementById('step-indicator');
  el.textContent = currentStep < 0 ? `All steps` : `Step ${currentStep+1} / ${total}`;
  document.getElementById('btn-prev').disabled = currentStep <= 0;
  document.getElementById('btn-next').disabled = currentStep >= total - 1;

  if (currentStep >= 0 && detectionResult.interleaving[currentStep]) {
    const s = detectionResult.interleaving[currentStep];
    el.style.color = s.isRace ? RACE_COLOR : '#8892b0';
  } else {
    el.style.color = '#8892b0';
  }
}
function toggleAutoPlay() {
  if (autoPlayTimer) { stopAutoPlay(); return; }
  const btn = document.getElementById('btn-auto');
  btn.textContent = '⏹ Stop'; btn.classList.add('playing'); btn.classList.remove('accent');
  if (currentStep < 0) currentStep = 0;
  autoPlayTimer = setInterval(() => {
    const max = detectionResult.interleaving.length - 1;
    if (currentStep >= max) { stopAutoPlay(); return; }
    currentStep++;
    renderTimeline();
  }, 700);
}
function stopAutoPlay() {
  if (autoPlayTimer) { clearInterval(autoPlayTimer); autoPlayTimer = null; }
  const btn = document.getElementById('btn-auto');
  btn.textContent = '▶ Auto'; btn.classList.remove('playing'); btn.classList.add('accent');
}

// ══════════════════════════════════════════════════════════════════════════════
// HEATMAP RENDERING
// ══════════════════════════════════════════════════════════════════════════════
function renderHeatmap() {
  if (!detectionResult) return;
  const { interleaving, variables, threads, races } = detectionResult;
  if (variables.length === 0 || interleaving.length === 0) return;

  const racingIds = new Set(races.flatMap(r => [r.opA.op.id, r.opB.op.id]));

  // Build matrix: variables × steps
  let html = `<table class="heatmap-table"><thead><tr>
    <th class="hm-var-label">Variable</th>`;
  interleaving.forEach((s, i) => {
    html += `<th class="hm-step-label" title="${s.thread.name}: ${s.op.type}(${s.op.target})">t${i+1}</th>`;
  });
  html += `</tr></thead><tbody>`;

  variables.forEach(varName => {
    html += `<tr><td class="hm-var-label heatmap-table">${varName}</td>`;
    interleaving.forEach((step, i) => {
      const isAccess = (step.op.type === 'READ' || step.op.type === 'WRITE') && step.op.target === varName;
      const isRace = isAccess && racingIds.has(step.op.id);
      if (!isAccess) {
        html += `<td class="heatmap-cell-empty"></td>`;
      } else {
        const bg = OP_COLORS[step.op.type] || '#888';
        const classes = ['heatmap-cell-access', isRace ? 'heatmap-cell-race' : ''].join(' ');
        html += `<td class="${classes}" style="background:${bg}22; border-color:${bg}60"
          title="${step.thread.name} ${step.op.type}(${varName}) at t${i+1}${isRace?' ⚡ RACE':''}"
          >
          <div class="hm-tooltip">${step.op.type[0]}</div>
          <div class="hm-tooltip" style="color:${step.thread.color}">${step.thread.name.split(' ').pop()}</div>
        </td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;

  // Legend row
  html += `<div style="margin-top:16px;display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#8892b0">
    ${threads.map(t => `<span style="display:flex;align-items:center;gap:6px">
      <span style="width:10px;height:10px;border-radius:50%;background:${t.color};display:inline-block"></span>${t.name}
    </span>`).join('')}
    <span style="display:flex;align-items:center;gap:6px">
      <span style="width:10px;height:10px;border-radius:2px;background:${RACE_COLOR};box-shadow:0 0 6px ${RACE_COLOR};display:inline-block"></span>Race Window
    </span>
  </div>`;

  const grid = document.getElementById('heatmap-grid');
  grid.innerHTML = html;
  grid.classList.remove('hidden');
  document.getElementById('heatmap-empty').classList.add('hidden');
}

// ══════════════════════════════════════════════════════════════════════════════
// RACE REPORT RENDERING
// ══════════════════════════════════════════════════════════════════════════════
function renderReport() {
  if (!detectionResult) return;
  const { races, safePairs, variables, locks, threads, critical, warnings } = detectionResult;
  const el = document.getElementById('report-content');

  // Algorithm info
  let html = `<div class="algo-box">
    <strong>Detection Algorithms:</strong><br>
    <b>Bernstein's Conditions</b> — two operations race if they (1) belong to different threads,
    (2) access the same variable, (3) at least one is a WRITE, and (4) they are not protected
    by a common mutex.<br>
    <b>Lockset / Eraser Analysis</b> — tracks which locks are held when each operation executes
    and checks for intersection across threads.
  </div>`;

  // Summary
  html += `<div class="report-section-title">Summary</div>`;
  if (races.length === 0) {
    html += `<div class="safe-summary">
      ✅ <strong>No race conditions detected.</strong>
      All concurrent accesses to shared variables are protected by a common mutex. The program is
      race-free under the Eraser/Lockset analysis model.
    </div>`;
  } else {
    html += `<div class="race-card" style="border-color:rgba(255,71,87,0.3)">
      <div style="font-size:13px;color:#8892b0;line-height:1.6">
        Found <strong style="color:#ff4757">${races.length} race condition${races.length>1?'s':''}</strong>
        across <strong style="color:#f0f2ff">${threads.length} threads</strong>
        and <strong style="color:#f0f2ff">${variables.length} shared variable${variables.length>1?'s':''}</strong>.
        ${critical > 0 ? `<span style="color:#ff4757">⚠ ${critical} critical (Write-Write)</span>` : ''}
        ${warnings > 0 ? `<span style="color:#ffa502"> · ${warnings} warning (Read-Write)</span>` : ''}
      </div>
    </div>`;
  }

  // Race cards
  if (races.length > 0) {
    html += `<div class="report-section-title">Race Conditions</div>`;
    races.forEach((race, i) => {
      const lsAStr = race.opA.lockSet.length ? race.opA.lockSet.join(', ') : 'none';
      const lsBStr = race.opB.lockSet.length ? race.opB.lockSet.join(', ') : 'none';
      html += `<div class="race-card ${race.severity}">
        <div class="race-card-header">
          <span class="severity-badge severity-${race.severity}">${race.severity}</span>
          <span class="race-type-badge">${race.type} Race</span>
          <span class="race-var">${race.variable}</span>
        </div>
        <div class="race-description">${race.description}</div>
        <div class="race-threads">
          <div class="race-thread-tag">
            <span class="race-thread-dot" style="background:${race.opA.thread.color}"></span>
            ${race.opA.thread.name} · ${race.opA.op.type}
          </div>
          <span style="color:#4a5568;font-size:12px;align-self:center">↔</span>
          <div class="race-thread-tag">
            <span class="race-thread-dot" style="background:${race.opB.thread.color}"></span>
            ${race.opB.thread.name} · ${race.opB.op.type}
          </div>
        </div>
        <div class="race-lockset">
          Locks held: ${race.opA.thread.name} [<span>${lsAStr}</span>] &nbsp;|&nbsp;
          ${race.opB.thread.name} [<span>${lsBStr}</span>] &nbsp;→ No common lock ⚡
        </div>
      </div>`;
    });
  }

  // Safe pairs
  if (safePairs.length > 0) {
    html += `<div class="report-section-title">Protected Pairs (No Race)</div>`;
    safePairs.forEach(pair => {
      html += `<div class="race-card safe">
        <div class="race-card-header">
          <span class="severity-badge severity-safe">✅ Safe</span>
          <span class="race-var">${pair.variable}</span>
        </div>
        <div class="race-description" style="font-size:12px">
          ${pair.opA.thread.name} and ${pair.opB.thread.name} both access
          <code style="color:#00d4ff">'${pair.variable}'</code>, but are protected by common lock(s):
          <span style="color:#4ade80;font-family:JetBrains Mono,monospace">${pair.commonLocks.join(', ')}</span>
        </div>
      </div>`;
    });
  }

  el.innerHTML = html;
  el.classList.remove('hidden');
  document.getElementById('report-empty').classList.add('hidden');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}
