const THREAD_COLORS = ['#7c6aff','#00d4ff','#ff6b9d','#ffd93d','#6bcb77','#ff9f43'];
const OP_COLORS = { READ:'#38bdf8', WRITE:'#fb923c', LOCK:'#4ade80', UNLOCK:'#34d399' };
const RACE_COLOR = '#ff4757';

const TL = {
  LABEL_W: 110, OP_W: 84, OP_GAP: 8, OP_H: 48,
  LANE_H: 76, LANE_PAD: 14, HEADER_H: 24, PAD: 16
};

// ── State ─────────────────────────────────────────────────────────────────────
let uiThreads = [];
let threadIdCtr = 0;
let detectionResult = null;
let currentStep = -1;
let autoPlayTimer = null;
let activePreset = null;
let onboardingSlide = 0;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPreset('counter');
  setupKeyboardShortcuts();
  setupScrollSpy();
  setupScrollTop();
  checkOnboarding();
});

// ══════════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════════════════════
function checkOnboarding() {
  const visited = localStorage.getItem('raceguard-visited');
  if (!visited) {
    showOnboarding();
  }
}

function showOnboarding() {
  onboardingSlide = 0;
  updateOnboardingSlide();
  document.getElementById('onboarding-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeOnboarding() {
  document.getElementById('onboarding-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  localStorage.setItem('raceguard-visited', 'true');
}

function nextOnboardingSlide() {
  const slides = document.querySelectorAll('.onboarding-slide');
  if (onboardingSlide < slides.length - 1) {
    onboardingSlide++;
    updateOnboardingSlide();
  } else {
    closeOnboarding();
  }
}

function updateOnboardingSlide() {
  const slides = document.querySelectorAll('.onboarding-slide');
  const dots = document.querySelectorAll('.onboarding-dots .dot');
  const nextBtn = document.getElementById('onboarding-next');

  slides.forEach((s, i) => {
    s.classList.toggle('active', i === onboardingSlide);
  });
  dots.forEach((d, i) => {
    d.classList.toggle('active', i === onboardingSlide);
  });

  if (onboardingSlide === slides.length - 1) {
    nextBtn.textContent = 'Get Started ✨';
  } else {
    nextBtn.textContent = 'Next →';
  }
}

// Make dots clickable
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('dot') && e.target.dataset.dot !== undefined) {
    onboardingSlide = parseInt(e.target.dataset.dot);
    updateOnboardingSlide();
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// MOBILE DRAWER
// ══════════════════════════════════════════════════════════════════════════════
function toggleDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const hamburger = document.getElementById('hamburger-btn');
  const isOpen = !drawer.classList.contains('hidden');

  if (isOpen) {
    closeDrawer();
  } else {
    drawer.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    hamburger.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const hamburger = document.getElementById('hamburger-btn');
  drawer.classList.add('hidden');
  backdrop.classList.add('hidden');
  hamburger.classList.remove('active');
  document.body.style.overflow = '';
}

function navTo(sectionId) {
  closeDrawer();
  setTimeout(() => scrollToSection(sectionId), 100);
}


// ══════════════════════════════════════════════════════════════════════════════
// SCROLL SPY & NAV
// ══════════════════════════════════════════════════════════════════════════════
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateActiveNav(id);
  }
}

function updateActiveNav(sectionId) {
  document.querySelectorAll('.nav-btn').forEach(b => b.removeAttribute('data-active'));
  const map = {
    'design-section': 'nav-design',
    'results-section': 'nav-results',
    'learn-section': 'nav-learn',
    'presets-section': 'nav-design',
    'cta-section': 'nav-design'
  };
  const btn = document.getElementById(map[sectionId]);
  if (btn) btn.setAttribute('data-active', 'true');
}

function setupScrollSpy() {
  const sections = ['design-section', 'results-section', 'learn-section'];
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        updateActiveNav(entry.target.id);
      }
    });
  }, { threshold: 0.2, rootMargin: '-60px 0px 0px 0px' });

  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });

  // Header scroll effect
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const header = document.getElementById('app-header');
    if (window.scrollY > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
    lastScroll = window.scrollY;
  }, { passive: true });
}

function setupScrollTop() {
  const btn = document.getElementById('scroll-top');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 400) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }, { passive: true });
}


// ══════════════════════════════════════════════════════════════════════════════
// COLLAPSIBLE SECTIONS
// ══════════════════════════════════════════════════════════════════════════════
function toggleExplain(id) {
  const body = document.getElementById(id);
  const toggle = document.getElementById(`toggle-${id}`);
  const isExpanded = body.classList.contains('expanded');
  body.classList.toggle('expanded', !isExpanded);
  if (toggle) toggle.classList.toggle('collapsed', isExpanded);
}

function toggleLearnCard(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const body = card.querySelector('.learn-card-body');
  const toggle = card.querySelector('.learn-toggle');
  const isExpanded = body.classList.contains('expanded');
  body.classList.toggle('expanded', !isExpanded);
  if (toggle) toggle.classList.toggle('collapsed', isExpanded);
}


// ══════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════════════════
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); stepNext(); break;
      case 'ArrowLeft':  e.preventDefault(); stepPrev(); break;
      case ' ':          e.preventDefault(); toggleAutoPlay(); break;
      case 'Enter':      e.preventDefault(); runDetection(); break;
      case 'Escape':     e.preventDefault(); closeDrawer(); closeOnboarding(); break;
    }
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// PRESET LOADING
// ══════════════════════════════════════════════════════════════════════════════
function loadPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  activePreset = key;

  document.querySelectorAll('.preset-card').forEach(b => b.classList.remove('active'));
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


// ══════════════════════════════════════════════════════════════════════════════
// THREAD DATA
// ══════════════════════════════════════════════════════════════════════════════
function addThreadData(name, ops = []) {
  const id = `T${threadIdCtr++}`;
  const color = THREAD_COLORS[uiThreads.length % THREAD_COLORS.length];
  uiThreads.push({ id, name, color, ops });
  return id;
}

function addThread() {
  activePreset = null;
  document.querySelectorAll('.preset-card').forEach(b => b.classList.remove('active'));
  addThreadData(`Thread ${threadIdCtr + 1}`, []);
  renderThreads();
  updateSharedVars();
  showToast('✓ Thread added', 'success');
}

function deleteThread(id) {
  const card = document.getElementById(`card-${id}`);
  if (card) {
    card.style.animation = 'slideOut 0.3s var(--ease) forwards';
    setTimeout(() => {
      uiThreads = uiThreads.filter(t => t.id !== id);
      renderThreads();
      updateSharedVars();
    }, 280);
  } else {
    uiThreads = uiThreads.filter(t => t.id !== id);
    renderThreads();
    updateSharedVars();
  }
}

function addOp(threadId) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t) return;
  t.ops.push({ type: 'READ', target: 'x' });
  renderThreads();
  updateSharedVars();
  // Auto-focus the new input
  requestAnimationFrame(() => {
    const inputs = document.querySelectorAll(`#card-${threadId} .op-target-input`);
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });
}

function deleteOp(threadId, opIdx) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t) return;
  const row = document.getElementById(`op-${threadId}-${opIdx}`);
  if (row) {
    row.style.animation = 'slideOut 0.25s var(--ease) forwards';
    setTimeout(() => {
      t.ops.splice(opIdx, 1);
      renderThreads();
      updateSharedVars();
    }, 230);
  } else {
    t.ops.splice(opIdx, 1);
    renderThreads();
    updateSharedVars();
  }
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
    // Validate
    if (field === 'target') {
      const input = document.querySelector(`#op-${threadId}-${opIdx} .op-target-input`);
      if (input) {
        input.classList.toggle('invalid', !val.trim());
      }
    }
  }
}

// ── Move operations (drag-and-drop) ──
function moveOp(threadId, fromIdx, toIdx) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t || fromIdx === toIdx) return;
  const [op] = t.ops.splice(fromIdx, 1);
  t.ops.splice(toIdx, 0, op);
  renderThreads();
  updateSharedVars();
}


// ══════════════════════════════════════════════════════════════════════════════
// RENDER THREAD CARDS
// ══════════════════════════════════════════════════════════════════════════════
function renderThreads() {
  const container = document.getElementById('threads-container');
  container.innerHTML = '';
  uiThreads.forEach(thread => {
    const card = document.createElement('div');
    card.className = 'thread-card';
    card.id = `card-${thread.id}`;

    const opsHtml = thread.ops.map((op, i) => `
      <div class="op-row" id="op-${thread.id}-${i}"
        draggable="true"
        ondragstart="onDragStartOp(event,'${thread.id}',${i})"
        ondragover="onDragOverOp(event,'${thread.id}',${i})"
        ondragleave="onDragLeaveOp(event)"
        ondrop="onDropOp(event,'${thread.id}',${i})"
        ondragend="onDragEndOp(event)">
        <span class="op-drag-handle" title="Drag to reorder">⠿</span>
        <span class="op-type-badge badge-${op.type.toLowerCase()}">${op.type[0]}</span>
        <select class="op-type-select" onchange="updateOp('${thread.id}',${i},'type',this.value)">
          ${['READ','WRITE','LOCK','UNLOCK'].map(t =>
            `<option value="${t}" ${op.type===t?'selected':''}>${t}</option>`
          ).join('')}
        </select>
        <input class="op-target-input${!op.target.trim() ? ' invalid' : ''}" type="text" value="${op.target}"
          placeholder="${op.type==='LOCK'||op.type==='UNLOCK'?'lock name (e.g. mutex)':'variable (e.g. counter)'}"
          onchange="updateOp('${thread.id}',${i},'target',this.value)"
          oninput="updateOp('${thread.id}',${i},'target',this.value)" />
        <button class="btn-delete-op" onclick="deleteOp('${thread.id}',${i})" title="Remove operation">✕</button>
      </div>`
    ).join('');

    const opsCount = thread.ops.length;

    card.innerHTML = `
      <div class="thread-card-header">
        <div class="thread-color-dot" style="background:${thread.color}; box-shadow:0 0 8px ${thread.color}"></div>
        <input class="thread-name-input" type="text" value="${thread.name}"
          placeholder="Thread name"
          onchange="updateThreadName('${thread.id}',this.value)"
          oninput="updateThreadName('${thread.id}',this.value)" />
        <span class="thread-ops-badge">${opsCount} op${opsCount !== 1 ? 's' : ''}</span>
        <button class="btn-delete-thread" onclick="deleteThread('${thread.id}')" title="Delete thread">✕</button>
      </div>
      <div class="thread-ops-list">${opsHtml}</div>
      <div style="padding:6px 12px 12px">
        <button class="btn-add-op" onclick="addOp('${thread.id}')">+ Add Operation</button>
      </div>`;
    container.appendChild(card);
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// DRAG AND DROP (OPERATIONS REORDER)
// ══════════════════════════════════════════════════════════════════════════════
let dragThreadId = null;
let dragOpIdx = null;

function onDragStartOp(e, threadId, opIdx) {
  dragThreadId = threadId;
  dragOpIdx = opIdx;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', ''); // Required for Firefox
}

function onDragOverOp(e, threadId, opIdx) {
  e.preventDefault();
  if (threadId !== dragThreadId) return;
  e.currentTarget.classList.add('drag-over');
}

function onDragLeaveOp(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDropOp(e, threadId, opIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (threadId === dragThreadId && dragOpIdx !== null) {
    moveOp(threadId, dragOpIdx, opIdx);
  }
  dragThreadId = null;
  dragOpIdx = null;
}

function onDragEndOp(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragThreadId = null;
  dragOpIdx = null;
}


// ══════════════════════════════════════════════════════════════════════════════
// SHARED VARS
// ══════════════════════════════════════════════════════════════════════════════
function updateSharedVars() {
  const el = document.getElementById('shared-vars');
  const vars = new Set(), locks = new Set();
  uiThreads.forEach(t => t.ops.forEach(op => {
    if (op.type === 'READ' || op.type === 'WRITE') vars.add(op.target);
    if (op.type === 'LOCK' || op.type === 'UNLOCK') locks.add(op.target);
  }));
  const pills = [...vars].map(v => `<span class="var-pill">${v}</span>`).join('')
              + [...locks].map(l => `<span class="lock-pill">🔒 ${l}</span>`).join('');
  el.innerHTML = pills || '<span class="empty-hint">No variables yet — add operations above</span>';
}


// ══════════════════════════════════════════════════════════════════════════════
// RESET
// ══════════════════════════════════════════════════════════════════════════════
function resetAll() {
  uiThreads = []; threadIdCtr = 0; detectionResult = null; currentStep = -1;
  activePreset = null;
  stopAutoPlay();
  document.querySelectorAll('.preset-card').forEach(b => b.classList.remove('active'));
  renderThreads();
  updateSharedVars();
  resetResultViews();
  showToast('✓ Reset complete', 'success');
}

function resetResultViews() {
  stopAutoPlay();
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('timeline-svg').classList.add('hidden');
  document.getElementById('step-controls').classList.add('hidden');
  document.getElementById('timeline-legend').classList.add('hidden');
  document.getElementById('step-narration').classList.add('hidden');
  document.getElementById('heatmap-grid').classList.add('hidden');
  document.getElementById('heatmap-grid').innerHTML = '';
  document.getElementById('report-content').classList.add('hidden');
  document.getElementById('report-content').innerHTML = '';
}


// ══════════════════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`content-${name}`).classList.add('active');
}


// ══════════════════════════════════════════════════════════════════════════════
// MAIN DETECTION
// ══════════════════════════════════════════════════════════════════════════════
function runDetection() {
  // Validation
  if (uiThreads.length < 2) {
    showToast('⚠ Add at least 2 threads to detect races', 'error'); return;
  }
  if (uiThreads.some(t => t.ops.length === 0)) {
    showToast('⚠ Each thread needs at least one operation', 'error'); return;
  }
  const emptyTargets = uiThreads.some(t => t.ops.some(op => !op.target.trim()));
  if (emptyTargets) {
    showToast('⚠ Fill in all variable/lock names', 'error'); return;
  }

  engine.reset();
  uiThreads.forEach(t => engine.addThread(t.id, t.name, t.color, t.ops));
  detectionResult = engine.detect();

  const raceCount = detectionResult.races.length;

  // Show results section
  const resultsEl = document.getElementById('results-section');
  resultsEl.classList.remove('hidden');

  // Explain text
  const explainEl = document.getElementById('results-explain');
  if (raceCount === 0) {
    explainEl.innerHTML = `<strong style="color:var(--success)">✅ No race conditions found!</strong> All concurrent accesses to shared variables are protected by common locks. Your program is <strong style="color:var(--success)">race-free</strong> under the Eraser/Lockset model.`;
  } else {
    explainEl.innerHTML = `Found <strong style="color:var(--danger)">${raceCount} race condition${raceCount>1?'s':''}</strong> across ${uiThreads.length} threads and ${detectionResult.variables.length} shared variable${detectionResult.variables.length>1?'s':''}. Scroll down to see the timeline visualization, memory heatmap, and detailed report with <strong>fix suggestions</strong>.`;
  }

  // Stats with animation
  animateStatValue('val-threads', uiThreads.length);
  animateStatValue('val-vars', detectionResult.variables.length);
  animateStatValue('val-races', raceCount);
  animateStatValue('val-safe', detectionResult.safePairs.length);

  const raceCard = document.getElementById('stat-races');
  raceCard.className = 'stat-card ' + (raceCount === 0 ? 'success' : detectionResult.critical > 0 ? 'critical' : 'warning');

  const safeCard = document.getElementById('stat-safe');
  safeCard.className = 'stat-card ' + (detectionResult.safePairs.length > 0 ? 'success' : '');

  // Render views
  currentStep = -1;
  renderTimeline();
  renderHeatmap();
  renderReport();

  // Scroll to results
  setTimeout(() => scrollToSection('results-section'), 250);

  if (raceCount > 0) {
    showToast(`⚡ ${raceCount} race condition${raceCount>1?'s':''} detected!`, 'error');
  } else {
    showToast('✅ No race conditions — all accesses are protected', 'success');
  }
}

function animateStatValue(elId, targetVal) {
  const el = document.getElementById(elId);
  if (!el) return;
  let current = 0;
  const steps = 15;
  const inc = targetVal / steps;
  const interval = setInterval(() => {
    current += inc;
    if (current >= targetVal) {
      el.textContent = targetVal;
      clearInterval(interval);
    } else {
      el.textContent = Math.floor(current);
    }
  }, 30);
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
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';
  svg.classList.remove('hidden');
  document.getElementById('timeline-legend').classList.remove('hidden');

  const racingIds = new Set(races.flatMap(r => [r.opA.op.id, r.opB.op.id]));

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

  // Lanes
  threads.forEach((thread, row) => {
    const y = TL.HEADER_H + row * TL.LANE_H;
    const bg = row % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.03)';
    html += `<rect x="0" y="${y}" width="${svgW}" height="${TL.LANE_H}" fill="${bg}"/>`;
    html += `<rect x="4" y="${y+12}" width="${TL.LABEL_W-12}" height="50" rx="6" fill="${thread.color}18" stroke="${thread.color}40" stroke-width="1"/>
    <circle cx="14" cy="${y+TL.LANE_H/2-6}" r="4" fill="${thread.color}"/>
    <text x="23" y="${y+TL.LANE_H/2-1}" fill="${thread.color}" font-family="JetBrains Mono,monospace" font-size="10" font-weight="700">${esc(thread.name)}</text>
    <text x="23" y="${y+TL.LANE_H/2+12}" fill="${thread.color}88" font-family="JetBrains Mono,monospace" font-size="8">${thread.operations.length} op${thread.operations.length!==1?'s':''}</text>`;
  });

  // Grid lines
  for (let col = 0; col < maxOps; col++) {
    const x = TL.LABEL_W + col * (TL.OP_W + TL.OP_GAP);
    html += `<line x1="${x}" y1="${TL.HEADER_H}" x2="${x}" y2="${svgH}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
    <text x="${x + TL.OP_W/2}" y="${TL.HEADER_H - 6}" fill="rgba(255,255,255,0.2)" font-size="9" text-anchor="middle" font-family="JetBrains Mono,monospace">t${col+1}</text>`;
  }

  // Op blocks
  threads.forEach((thread, row) => {
    thread.operations.forEach((op, col) => {
      const pos = opPos[op.id];
      const x = pos.x + 3; const y = pos.y + TL.LANE_PAD;
      const w = TL.OP_W - 3; const h = TL.OP_H;
      const isRace = racingIds.has(op.id);
      const fillColor = isRace ? RACE_COLOR : OP_COLORS[op.type] || '#888';
      const isCurrentStep = currentStep >= 0 && interleaving[currentStep] && interleaving[currentStep].op.id === op.id;
      const opacity = currentStep >= 0 ? (isCurrentStep ? 1 : 0.25) : 1;

      html += `<g class="op-group" opacity="${opacity}" style="transition:opacity 0.3s">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"
          fill="${fillColor}1a" stroke="${fillColor}" stroke-width="${isRace?2:1.2}"
          ${isRace ? `filter="url(#glow-race)"` : ''}/>
        <rect x="${x}" y="${y}" width="${w}" height="3" rx="2" fill="${fillColor}55"/>
        <text x="${x+w/2}" y="${y+17}" text-anchor="middle" fill="${fillColor}"
          font-family="JetBrains Mono,monospace" font-size="9" font-weight="700">${op.type}</text>
        <text x="${x+w/2}" y="${y+31}" text-anchor="middle" fill="rgba(255,255,255,0.75)"
          font-family="JetBrains Mono,monospace" font-size="10">${esc(op.target)}</text>
        ${isRace ? `<text x="${x+w-4}" y="${y+11}" text-anchor="middle" fill="${RACE_COLOR}" font-size="10">⚡</text>` : ''}
      </g>`;
    });
  });

  // Race arcs
  races.forEach((race, ri) => {
    const pA = opPos[race.opA.op.id];
    const pB = opPos[race.opB.op.id];
    if (!pA || !pB) return;
    const x1 = pA.x + TL.OP_W/2, y1 = pA.y + TL.LANE_PAD + TL.OP_H/2;
    const x2 = pB.x + TL.OP_W/2, y2 = pB.y + TL.LANE_PAD + TL.OP_H/2;
    const cx = (x1+x2)/2, cy = Math.min(y1,y2) - 18 - ri*8;
    const color = race.severity === 'critical' ? RACE_COLOR : '#ffb142';
    html += `<path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}"
      stroke="${color}" stroke-width="1.5" fill="none" stroke-dasharray="5,4" opacity="0.65"
      marker-end="url(#arrow)"/>`;
  });

  // Step highlight
  if (currentStep >= 0 && interleaving[currentStep]) {
    const step = interleaving[currentStep];
    const pos = opPos[step.op.id];
    if (pos) {
      const x = pos.x + 3; const y = pos.y + TL.LANE_PAD;
      const w = TL.OP_W - 3; const h = TL.OP_H;
      const color = step.isRace ? RACE_COLOR : '#fff';
      html += `<rect x="${x-2}" y="${y-2}" width="${w+4}" height="${h+4}" rx="7"
        fill="none" stroke="${color}" stroke-width="2.5" opacity="0.85" filter="url(#glow-step)"/>`;
    }
  }

  svg.innerHTML = html;
  document.getElementById('step-controls').classList.remove('hidden');
  updateStepUI();
  updateNarration();
}


// ══════════════════════════════════════════════════════════════════════════════
// STEP NARRATION
// ══════════════════════════════════════════════════════════════════════════════
function updateNarration() {
  const narration = document.getElementById('step-narration');
  const text = document.getElementById('narration-text');
  if (!detectionResult) { narration.classList.add('hidden'); return; }

  narration.classList.remove('hidden');

  if (currentStep < 0) {
    text.innerHTML = `This timeline shows <strong>${detectionResult.interleaving.length} operations</strong> from <strong>${detectionResult.threads.length} threads</strong>. ` +
      (detectionResult.races.length > 0
        ? `<span class="race-highlight">⚡ ${detectionResult.races.length} race${detectionResult.races.length>1?'s':''} detected</span> — red-highlighted operations are involved in races. Click <strong>Next ▶</strong> or press <kbd>→</kbd> to step through each operation.`
        : `All accesses are protected — <strong style="color:var(--success)">no races found</strong>. Click <strong>Next ▶</strong> to step through.`);
    return;
  }

  const step = detectionResult.interleaving[currentStep];
  if (!step) return;

  let desc = `<strong style="color:${step.thread.color}">${step.thread.name}</strong> performs `;
  if (step.op.type === 'READ') {
    desc += `a <strong style="color:${OP_COLORS.READ}">READ</strong> on variable <code style="color:var(--accent2);font-family:var(--mono);background:rgba(0,212,255,0.08);padding:1px 6px;border-radius:3px">${esc(step.op.target)}</code>`;
    desc += ` — it loads the current value of <em>${esc(step.op.target)}</em> into its local register.`;
  } else if (step.op.type === 'WRITE') {
    desc += `a <strong style="color:${OP_COLORS.WRITE}">WRITE</strong> to variable <code style="color:var(--accent2);font-family:var(--mono);background:rgba(0,212,255,0.08);padding:1px 6px;border-radius:3px">${esc(step.op.target)}</code>`;
    desc += ` — it stores a new value into shared memory.`;
  } else if (step.op.type === 'LOCK') {
    desc += `a <strong style="color:${OP_COLORS.LOCK}">LOCK</strong> on mutex <code style="color:var(--op-lock);font-family:var(--mono);background:rgba(74,222,128,0.08);padding:1px 6px;border-radius:3px">${esc(step.op.target)}</code>`;
    desc += ` — it acquires the mutex, blocking other threads from entering the critical section.`;
  } else if (step.op.type === 'UNLOCK') {
    desc += `an <strong style="color:${OP_COLORS.UNLOCK}">UNLOCK</strong> on mutex <code style="color:var(--op-unlock);font-family:var(--mono);background:rgba(52,211,153,0.08);padding:1px 6px;border-radius:3px">${esc(step.op.target)}</code>`;
    desc += ` — it releases the mutex, allowing other threads to proceed.`;
  }

  if (step.isRace && step.race) {
    const other = step.race.opA.op.id === step.op.id ? step.race.opB : step.race.opA;
    desc += `<br><span class="race-highlight">⚡ RACE CONDITION:</span> This conflicts with <strong>${other.thread.name}</strong>'s ${other.op.type} on the same variable — no common lock protects them!`;
  }

  text.innerHTML = desc;
}


// ══════════════════════════════════════════════════════════════════════════════
// STEP-THROUGH
// ══════════════════════════════════════════════════════════════════════════════
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

function resetStep() {
  currentStep = -1;
  stopAutoPlay();
  renderTimeline();
}

function updateStepUI() {
  if (!detectionResult) return;
  const total = detectionResult.interleaving.length;
  const el = document.getElementById('step-indicator');
  el.textContent = currentStep < 0 ? `All ${total} steps` : `Step ${currentStep+1} / ${total}`;
  document.getElementById('btn-prev').disabled = currentStep <= 0;
  document.getElementById('btn-next').disabled = currentStep >= total - 1;

  if (currentStep >= 0 && detectionResult.interleaving[currentStep]) {
    el.style.color = detectionResult.interleaving[currentStep].isRace ? RACE_COLOR : '#9aa3c0';
  } else {
    el.style.color = '#9aa3c0';
  }
}

function toggleAutoPlay() {
  if (autoPlayTimer) { stopAutoPlay(); return; }
  if (!detectionResult) return;
  const btn = document.getElementById('btn-auto');
  btn.textContent = '⏹ Stop'; btn.classList.add('playing'); btn.classList.remove('accent');
  if (currentStep < 0) currentStep = 0;
  renderTimeline();
  autoPlayTimer = setInterval(() => {
    const max = detectionResult.interleaving.length - 1;
    if (currentStep >= max) { stopAutoPlay(); return; }
    currentStep++;
    renderTimeline();
  }, 800);
}

function stopAutoPlay() {
  if (autoPlayTimer) { clearInterval(autoPlayTimer); autoPlayTimer = null; }
  const btn = document.getElementById('btn-auto');
  if (btn) {
    btn.textContent = '▶ Auto'; btn.classList.remove('playing'); btn.classList.add('accent');
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// HEATMAP
// ══════════════════════════════════════════════════════════════════════════════
function renderHeatmap() {
  if (!detectionResult) return;
  const { interleaving, variables, threads, races } = detectionResult;
  if (variables.length === 0 || interleaving.length === 0) return;

  const racingIds = new Set(races.flatMap(r => [r.opA.op.id, r.opB.op.id]));

  let html = `<table class="heatmap-table"><thead><tr>
    <th class="hm-var-label">Variable</th>`;
  interleaving.forEach((s, i) => {
    html += `<th class="hm-step-label" title="${s.thread.name}: ${s.op.type}(${s.op.target})">t${i+1}</th>`;
  });
  html += `</tr></thead><tbody>`;

  variables.forEach(varName => {
    html += `<tr><td class="hm-var-label">${varName}</td>`;
    interleaving.forEach((step, i) => {
      const isAccess = (step.op.type === 'READ' || step.op.type === 'WRITE') && step.op.target === varName;
      const isRace = isAccess && racingIds.has(step.op.id);
      if (!isAccess) {
        html += `<td class="heatmap-cell-empty"></td>`;
      } else {
        const bg = OP_COLORS[step.op.type] || '#888';
        const cls = ['heatmap-cell-access', isRace ? 'heatmap-cell-race' : ''].join(' ');
        html += `<td class="${cls}" style="background:${bg}1a;border-color:${bg}55"
          title="${step.thread.name} ${step.op.type}(${varName}) at t${i+1}${isRace?' ⚡ RACE':''}">
          <div class="hm-tooltip">${step.op.type[0]}</div>
          <div class="hm-tooltip" style="color:${step.thread.color}">${step.thread.name.split(' ').pop()}</div>
        </td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;

  // Legend
  html += `<div style="margin-top:16px;display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:#9aa3c0;font-weight:500">
    ${threads.map(t => `<span style="display:flex;align-items:center;gap:6px">
      <span style="width:10px;height:10px;border-radius:50%;background:${t.color};display:inline-block"></span>${t.name}
    </span>`).join('')}
    <span style="display:flex;align-items:center;gap:6px">
      <span style="width:10px;height:10px;border-radius:3px;background:${RACE_COLOR};box-shadow:0 0 6px ${RACE_COLOR};display:inline-block"></span>Race Window
    </span>
  </div>`;

  const grid = document.getElementById('heatmap-grid');
  grid.innerHTML = html;
  grid.classList.remove('hidden');
}


// ══════════════════════════════════════════════════════════════════════════════
// RACE REPORT (with fix suggestions)
// ══════════════════════════════════════════════════════════════════════════════
function renderReport() {
  if (!detectionResult) return;
  const { races, safePairs, variables, locks, threads, critical, warnings } = detectionResult;
  const el = document.getElementById('report-content');

  let html = `<div class="algo-box">
    <strong>Detection Algorithms Used:</strong><br>
    <b>Step 1 — Bernstein's Conditions</b>: Identifies all pairs of operations from different threads that access the same shared variable where at least one is a WRITE. These are <em>potential</em> race candidates.<br>
    <b>Step 2 — Lockset / Eraser Algorithm</b>: For each candidate pair, checks if both operations hold at least one common mutex lock. If yes → protected (safe). If no → <span style="color:var(--danger);font-weight:700">RACE CONDITION</span>.
  </div>`;

  // Summary
  html += `<div class="report-section-title">Summary</div>`;
  if (races.length === 0) {
    html += `<div class="safe-summary">
      ✅ <strong>No race conditions detected.</strong>
      All ${variables.length} shared variable${variables.length>1?'s':''} accessed by ${threads.length} threads are properly protected by mutex locks.
      The program is race-free under the Eraser/Lockset analysis model.
    </div>`;
  } else {
    html += `<div class="race-card" style="border-color:rgba(255,71,87,0.3)">
      <div style="font-size:14px;color:#9aa3c0;line-height:1.7">
        Found <strong style="color:#ff4757">${races.length} race condition${races.length>1?'s':''}</strong>
        across <strong style="color:#eef0ff">${threads.length} threads</strong>
        and <strong style="color:#eef0ff">${variables.length} shared variable${variables.length>1?'s':''}</strong>.
        ${critical > 0 ? `<br><span style="color:#ff4757">⚠ ${critical} CRITICAL (Write-Write) — guaranteed data corruption</span>` : ''}
        ${warnings > 0 ? `<br><span style="color:#ffb142">⚠ ${warnings} WARNING (Read-Write) — possible stale reads</span>` : ''}
        ${safePairs.length > 0 ? `<br><span style="color:#2ed573">✅ ${safePairs.length} pair${safePairs.length>1?'s':''} are properly protected by common locks</span>` : ''}
      </div>
    </div>`;
  }

  // Race cards
  if (races.length > 0) {
    html += `<div class="report-section-title">Race Conditions (${races.length})</div>`;
    races.forEach((race, i) => {
      const lsAStr = race.opA.lockSet.length ? race.opA.lockSet.join(', ') : 'none';
      const lsBStr = race.opB.lockSet.length ? race.opB.lockSet.join(', ') : 'none';

      // Generate fix suggestion
      const fixSuggestion = generateFixSuggestion(race);

      html += `<div class="race-card ${race.severity}">
        <div class="race-card-header">
          <span class="severity-badge severity-${race.severity}">${race.severity === 'critical' ? '🔴 CRITICAL' : '🟡 WARNING'}</span>
          <span class="race-type-badge">${race.type} Race</span>
          <span class="race-var">${race.variable}</span>
        </div>
        <div class="race-description">${race.description}</div>
        <div class="race-threads">
          <div class="race-thread-tag">
            <span class="race-thread-dot" style="background:${race.opA.thread.color}"></span>
            ${race.opA.thread.name} · ${race.opA.op.type}(${race.variable})
          </div>
          <span style="color:#57617d;font-size:14px;font-weight:700">↔</span>
          <div class="race-thread-tag">
            <span class="race-thread-dot" style="background:${race.opB.thread.color}"></span>
            ${race.opB.thread.name} · ${race.opB.op.type}(${race.variable})
          </div>
        </div>
        <div class="race-lockset">
          <strong>Lockset analysis:</strong> ${race.opA.thread.name} holds [<span>${lsAStr}</span>],
          ${race.opB.thread.name} holds [<span>${lsBStr}</span>]
          → <strong style="color:var(--danger)">No common lock ⚡</strong>
        </div>
        <div class="race-fix">
          <strong>💡 How to fix:</strong> ${fixSuggestion}
        </div>
      </div>`;
    });
  }

  // Safe pairs
  if (safePairs.length > 0) {
    html += `<div class="report-section-title">Protected Pairs — No Race (${safePairs.length})</div>`;
    safePairs.forEach(pair => {
      html += `<div class="race-card safe">
        <div class="race-card-header">
          <span class="severity-badge severity-safe">✅ SAFE</span>
          <span class="race-var">${pair.variable}</span>
        </div>
        <div class="race-description" style="font-size:13px">
          ${pair.opA.thread.name} and ${pair.opB.thread.name} both access
          <code style="color:#00d4ff;font-family:var(--mono);background:rgba(0,212,255,0.08);padding:1px 6px;border-radius:3px">'${pair.variable}'</code>,
          but are protected by common lock(s):
          <strong style="color:#4ade80;font-family:var(--mono)">${pair.commonLocks.join(', ')}</strong>
        </div>
      </div>`;
    });
  }

  el.innerHTML = html;
  el.classList.remove('hidden');
}

function generateFixSuggestion(race) {
  const v = race.variable;
  const tA = race.opA.thread.name;
  const tB = race.opB.thread.name;
  const lsA = race.opA.lockSet;
  const lsB = race.opB.lockSet;

  if (lsA.length === 0 && lsB.length === 0) {
    return `Both <strong>${tA}</strong> and <strong>${tB}</strong> access <code>${v}</code> without any lock. Add <code>LOCK(mutex)</code> before and <code>UNLOCK(mutex)</code> after the ${v} operations in <em>both</em> threads, using the <em>same</em> mutex name.`;
  } else if (lsA.length > 0 && lsB.length === 0) {
    return `<strong>${tA}</strong> holds lock [${lsA.join(', ')}], but <strong>${tB}</strong> holds none. Add <code>LOCK(${lsA[0]})</code> before and <code>UNLOCK(${lsA[0]})</code> after ${tB}'s access to <code>${v}</code> so both threads share the same lock.`;
  } else if (lsA.length === 0 && lsB.length > 0) {
    return `<strong>${tB}</strong> holds lock [${lsB.join(', ')}], but <strong>${tA}</strong> holds none. Add <code>LOCK(${lsB[0]})</code> before and <code>UNLOCK(${lsB[0]})</code> after ${tA}'s access to <code>${v}</code> so both threads share the same lock.`;
  } else {
    return `Both threads hold different locks (${tA}: [${lsA.join(', ')}], ${tB}: [${lsB.join(', ')}]). They need to share at least one <em>common</em> lock. Choose one mutex (e.g., <code>${lsA[0]}</code>) and use it in both threads when accessing <code>${v}</code>.`;
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  const iconEl = document.getElementById('toast-icon');
  const progressEl = document.getElementById('toast-progress');

  // Set icon based on type
  if (type === 'success') {
    iconEl.textContent = '✅';
  } else if (type === 'error') {
    iconEl.textContent = '⚠️';
  } else {
    iconEl.textContent = 'ℹ️';
  }

  msgEl.textContent = msg;
  el.className = `toast ${type}`;

  // Reset progress animation
  progressEl.style.animation = 'none';
  progressEl.offsetHeight; // Trigger reflow
  progressEl.style.animation = 'toastProgress 3.5s linear forwards';

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3800);
}
