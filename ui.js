const OP_TYPES = ['READ', 'WRITE', 'LOCK', 'UNLOCK', 'WAIT', 'SIGNAL'];
// WAIT and SIGNAL use Dijkstra's P and V, since W is taken by WRITE.
const OP_ABBR = { READ:'R', WRITE:'W', LOCK:'L', UNLOCK:'U', WAIT:'P', SIGNAL:'V' };

const TL = {
  LABEL_W: 110, OP_W: 84, OP_GAP: 8, OP_H: 48,
  LANE_H: 76, LANE_PAD: 14, HEADER_H: 24, PAD: 16
};

// ── State ─────────────────────────────────────────────────────────────────────

// Must stay 6-digit hex: SVG code appends alpha suffixes such as `${color}1a`.
const PALETTE_LIGHT = {
  threads: ['#005cbf', '#0369a1', '#dc2626', '#b45309', '#047857', '#be123c'],
  ops: { READ:'#0062cc', WRITE:'#a34a00', LOCK:'#15803d', UNLOCK:'#0e7490', WAIT:'#7e22ce', SIGNAL:'#a21caf' },
  race: '#dc2626', warn: '#b45309'
};
const PALETTE_DARK = {
  threads: ['#60a5fa', '#38bdf8', '#f87171', '#fbbf24', '#34d399', '#fb7185'],
  ops: { READ:'#60a5fa', WRITE:'#fbbf24', LOCK:'#34d399', UNLOCK:'#22d3ee', WAIT:'#c084fc', SIGNAL:'#e879f9' },
  race: '#ff453a', warn: '#fbbf24'
};

let { threads: THREAD_COLORS, ops: OP_COLORS, race: RACE_COLOR, warn: WARN_COLOR } = PALETTE_LIGHT;

function updateJsPalette(isDark) {
  ({ threads: THREAD_COLORS, ops: OP_COLORS, race: RACE_COLOR, warn: WARN_COLOR } = isDark ? PALETTE_DARK : PALETTE_LIGHT);
  // Re-assign thread colors since they hold the property locally when created
  uiThreads.forEach((t, i) => { t.color = THREAD_COLORS[i % THREAD_COLORS.length]; });
}

let uiThreads = [];
let semaphoreCounts = {}; // semaphore name -> initial count; unset means 1
let threadIdCtr = 0;
let detectionResult = null;
let currentStep = -1;
let autoPlayTimer = null;
let activePreset = null;
let onboardingSlide = 0;
let onboardingReturnFocus = null;

// localStorage throws when the browser blocks site data
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* not persisted */ } }
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  updateJsPalette(isDark);
  updateThemeButton();
  renderPresetCards();
  if (!restoreDesign()) loadPreset('counter');
  setupKeyboardShortcuts();
  setupScrollSpy();
  setupScrollTop();
  checkOnboarding();
});

// ══════════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════════════════════
function checkOnboarding() {
  if (!storage.get('raceguard-visited')) showOnboarding();
}

function setOnboardingOpen(open) {
  const overlay = document.getElementById('onboarding-overlay');
  overlay.classList.toggle('hidden', !open);
  document.body.style.overflow = open ? 'hidden' : '';
  // Keep focus inside the dialog while it is open
  [...document.body.children].forEach(el => { if (el !== overlay) el.inert = open; });
  closedDrawerIsInert();
}

function isOnboardingOpen() {
  return !document.getElementById('onboarding-overlay').classList.contains('hidden');
}

function showOnboarding() {
  onboardingSlide = 0;
  updateOnboardingSlide();
  onboardingReturnFocus = document.activeElement;
  setOnboardingOpen(true);
  document.getElementById('onboarding-next').focus();
}

function closeOnboarding() {
  if (!isOnboardingOpen()) return;
  setOnboardingOpen(false);
  if (onboardingReturnFocus) onboardingReturnFocus.focus();
  storage.set('raceguard-visited', 'true');
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
    drawer.inert = false;
    backdrop.classList.remove('hidden');
    hamburger.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

// Off-screen links must not be reachable with Tab
function closedDrawerIsInert() {
  const drawer = document.getElementById('mobile-drawer');
  if (drawer.classList.contains('hidden')) drawer.inert = true;
}

function closeDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const hamburger = document.getElementById('hamburger-btn');
  drawer.classList.add('hidden');
  closedDrawerIsInert();
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
  setExpanded(body.previousElementSibling, body, toggle);
}

function toggleLearnCard(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  setExpanded(card.querySelector('.learn-card-header'), card.querySelector('.learn-card-body'), card.querySelector('.learn-toggle'));
}

function setExpanded(header, body, toggle) {
  const expanded = !body.classList.contains('expanded');
  body.classList.toggle('expanded', expanded);
  toggle.classList.toggle('collapsed', !expanded);
  header.setAttribute('aria-expanded', expanded);
}


// ══════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════════════════
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); closeOnboarding(); return; }
    if (isOnboardingOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, select, textarea')) return;

    // Enter and Space belong to the focused control, not to the shortcuts
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target.closest('button, a')) return;
      const control = e.target.closest('[role="button"]');
      if (control) { e.preventDefault(); control.click(); return; }
    }

    if (e.key === 'Enter') { e.preventDefault(); runDetection(); return; }
    if (!detectionResult) return; // leave scrolling keys alone
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); stepNext(); break;
      case 'ArrowLeft':  e.preventDefault(); stepPrev(); break;
      case ' ':          e.preventDefault(); toggleAutoPlay(); break;
    }
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// PRESETS
// ══════════════════════════════════════════════════════════════════════════════
function renderPresetCards() {
  document.getElementById('presets-grid').innerHTML = Object.entries(PRESETS).map(([key, p]) => {
    const ops = p.threads.reduce((n, t) => n + t.operations.length, 0);
    return `<button class="preset-card" id="preset-${key}" onclick="loadPreset('${key}')">
      <span class="preset-emoji">${p.emoji}</span>
      <span class="preset-name">${esc(p.label)}</span>
      <span class="preset-desc">${esc(p.description)}</span>
      <span class="preset-tag">${p.threads.length} threads · ${ops} ops</span>
    </button>`;
  }).join('');
}

function setActivePreset(key) {
  activePreset = key;
  document.querySelectorAll('.preset-card').forEach(b => b.classList.toggle('active', b.id === `preset-${key}`));
}

function loadPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  setDesign(preset.threads.map(t => ({ name: t.name, ops: t.operations })), preset.semaphores, key);
}

function setDesign(threads, semaphores = {}, presetKey = null) {
  uiThreads = [];
  threadIdCtr = 0;
  semaphoreCounts = { ...semaphores };
  threads.forEach(t => addThreadData(t.name, t.ops.map(o => ({ type: o.type, target: o.target }))));
  detectionResult = null;
  currentStep = -1;
  setActivePreset(presetKey);
  renderThreads();
  resetResultViews();
  updateSharedVars();
  saveDesign();
}

// Call after every edit: results describe the old design, so drop them.
function designChanged() {
  setActivePreset(null);
  updateSharedVars();
  saveDesign();
  if (detectionResult) {
    detectionResult = null;
    currentStep = -1;
    resetResultViews();
    showToast('Design changed — run detection again');
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// SAVED DESIGN
// ══════════════════════════════════════════════════════════════════════════════
const DESIGN_KEY = 'raceguard-design';

function saveDesign() {
  storage.set(DESIGN_KEY, JSON.stringify({
    threads: uiThreads.map(({ name, ops }) => ({ name, ops })),
    semaphores: semaphoreCounts,
    preset: activePreset
  }));
}

// Returns false when there is nothing usable to restore.
function restoreDesign() {
  let saved;
  try { saved = JSON.parse(storage.get(DESIGN_KEY)); } catch { return false; }
  const threads = saved && saved.threads;
  if (!Array.isArray(threads) || threads.length === 0) return false;
  const isOp = o => o && OP_TYPES.includes(o.type) && typeof o.target === 'string';
  const isThread = t => t && typeof t.name === 'string' && Array.isArray(t.ops) && t.ops.every(isOp);
  if (!threads.every(isThread)) return false;
  const semaphores = Object.fromEntries(Object.entries(saved.semaphores || {}).filter(([, n]) => Number.isInteger(n) && n >= 0));
  setDesign(threads, semaphores, Object.hasOwn(PRESETS, saved.preset) ? saved.preset : null);
  return true;
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
  addThreadData(`Thread ${threadIdCtr + 1}`, []);
  renderThreads();
  designChanged();
  showToast('Thread added', 'success');
}

function deleteThread(id) {
  afterSlideOut(document.getElementById(`card-${id}`), 280, () => {
    uiThreads = uiThreads.filter(t => t.id !== id);
    renderThreads();
    designChanged();
  });
}

// Runs `remove` once the element has animated away.
function afterSlideOut(el, ms, remove) {
  if (!el) { remove(); return; }
  el.style.animation = `slideOut ${ms + 20}ms var(--ease) forwards`;
  setTimeout(remove, ms);
}

function addOp(threadId) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t) return;
  t.ops.push({ type: 'READ', target: 'x' });
  renderThreads();
  designChanged();
  // Auto-focus the new input
  requestAnimationFrame(() => {
    const inputs = document.querySelectorAll(`#card-${threadId} .op-target-input`);
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });
}

function deleteOp(threadId, opIdx) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t || !t.ops[opIdx]) return;
  const op = t.ops[opIdx];
  afterSlideOut(document.getElementById(`op-${threadId}-${opIdx}`), 230, () => {
    // Look the op up again: indexes shift, and a second click must not remove its neighbour
    const idx = t.ops.indexOf(op);
    if (idx < 0) return;
    t.ops.splice(idx, 1);
    renderThreads();
    designChanged();
  });
}

function updateThreadName(id, val) {
  const t = uiThreads.find(t => t.id === id);
  if (!t) return;
  t.name = val;
  designChanged();
}

function updateOp(threadId, opIdx, field, val) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t || !t.ops[opIdx]) return;
  t.ops[opIdx][field] = val;
  if (field === 'type') {
    renderThreads();
    document.querySelector(`#op-${threadId}-${opIdx} .op-type-select`).focus();
  } else {
    document.querySelector(`#op-${threadId}-${opIdx} .op-target-input`).classList.toggle('invalid', !val.trim());
  }
  designChanged();
}

function updateSemaphore(name, val) {
  const n = parseInt(val, 10);
  semaphoreCounts[name] = Number.isNaN(n) ? 1 : Math.min(99, Math.max(0, n));
  designChanged();
}

// ── Move operations (drag-and-drop) ──
function moveOp(threadId, fromIdx, toIdx) {
  const t = uiThreads.find(t => t.id === threadId);
  if (!t || fromIdx === toIdx) return;
  const [op] = t.ops.splice(fromIdx, 1);
  t.ops.splice(toIdx, 0, op);
  renderThreads();
  designChanged();
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
        <span class="op-type-badge badge-${op.type.toLowerCase()}" title="${op.type}" aria-hidden="true">${OP_ABBR[op.type]}</span>
        <select class="op-type-select" name="op-type-${thread.id}-${i}" aria-label="Operation ${i+1} type" onchange="updateOp('${thread.id}',${i},'type',this.value)">
          ${OP_TYPES.map(t =>
            `<option value="${t}" ${op.type===t?'selected':''}>${t}</option>`
          ).join('')}
        </select>
        <input class="op-target-input${!op.target.trim() ? ' invalid' : ''}" type="text" name="op-target-${thread.id}-${i}" value="${esc(op.target)}"
          aria-label="Operation ${i+1} target" autocomplete="off" spellcheck="false"
          placeholder="${op.type==='READ'||op.type==='WRITE'?'variable (e.g. counter)':'lock/semaphore name'}"
          oninput="updateOp('${thread.id}',${i},'target',this.value)" />
        <button class="btn-delete-op" onclick="deleteOp('${thread.id}',${i})" title="Remove operation" aria-label="Remove operation ${i+1}">✕</button>
      </div>`
    ).join('');

    const opsCount = thread.ops.length;

    card.innerHTML = `
      <div class="thread-card-header">
        <div class="thread-color-dot" style="background:${thread.color}; box-shadow:0 0 8px ${thread.color}"></div>
        <input class="thread-name-input" type="text" name="thread-name-${thread.id}" value="${esc(thread.name)}"
          placeholder="Thread name" aria-label="Thread name" autocomplete="off" spellcheck="false"
          oninput="updateThreadName('${thread.id}',this.value)" />
        <span class="thread-ops-badge">${opsCount} op${opsCount !== 1 ? 's' : ''}</span>
        <button class="btn-delete-thread" onclick="deleteThread('${thread.id}')" title="Delete thread" aria-label="Delete thread">✕</button>
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
  const targets = (...types) => [...new Set(uiThreads.flatMap(t => t.ops)
    .filter(op => types.includes(op.type)).map(op => op.target.trim()).filter(Boolean))];
  const pills = [
    ...targets('READ', 'WRITE').map(v => `<span class="var-pill">${esc(v)}</span>`),
    ...targets('LOCK', 'UNLOCK').map(l => `<span class="lock-pill">🔒 ${esc(l)}</span>`),
    ...targets('WAIT', 'SIGNAL').map((s, i) => `<label class="sem-pill">🚦 ${esc(s)} <span class="sem-hint">starts at</span>
      <input type="number" name="sem-${i}" min="0" max="99" value="${Object.hasOwn(semaphoreCounts, s) ? semaphoreCounts[s] : 1}"
        data-sem="${esc(s)}" onchange="updateSemaphore(this.dataset.sem,this.value)" /></label>`)
  ];
  el.innerHTML = pills.join('') || '<span class="empty-hint">No variables yet — add operations above</span>';
}


// ══════════════════════════════════════════════════════════════════════════════
// RESET
// ══════════════════════════════════════════════════════════════════════════════
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  storage.set('raceguard-theme', newTheme);
  updateThemeButton();
  updateJsPalette(newTheme === 'dark');
  
  // Smoothly update thread dots without triggering re-render animations
  uiThreads.forEach(t => {
    const card = document.getElementById(`card-${t.id}`);
    if (card) {
      const dot = card.querySelector('.thread-color-dot');
      if (dot) {
        dot.style.background = t.color;
        dot.style.boxShadow = `0 0 8px ${t.color}`;
      }
    }
  });

  // Update engine output objects with new colors so re-renders match theme
  if (detectionResult) {
    detectionResult.threads.forEach(dt => {
      const uiT = uiThreads.find(u => u.id === dt.id);
      if (uiT) {
        dt.color = uiT.color;
        dt.operations.forEach(op => op.threadColor = uiT.color);
      }
    });
  }

  if (typeof renderTimeline === 'function') renderTimeline(); // Redraw
  if (typeof renderHeatmap === 'function') renderHeatmap();
  if (typeof renderReport === 'function') renderReport();
  if (typeof renderCode === 'function') renderCode();
}

function updateThemeButton() {
  const btn = document.getElementById('btn-theme');
  if (btn) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.innerHTML = isDark ? '☀️<span class="theme-label"> Light</span>' : '🌙<span class="theme-label"> Dark</span>';
    btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  }
}

function resetAll() {
  setDesign([]);
  showToast('Reset complete', 'success');
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
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.id === `tab-${name}`;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `content-${name}`));
}


// ══════════════════════════════════════════════════════════════════════════════
// MAIN DETECTION
// ══════════════════════════════════════════════════════════════════════════════
function runDetection() {
  // Validation
  if (uiThreads.length < 2) {
    showToast('Add at least 2 threads to detect races', 'error'); return;
  }
  if (uiThreads.some(t => t.ops.length === 0)) {
    showToast('Each thread needs at least one operation', 'error'); return;
  }
  const emptyTargets = uiThreads.some(t => t.ops.some(op => !op.target.trim()));
  if (emptyTargets) {
    showToast('Fill in all variable/lock names', 'error'); return;
  }

  engine.reset();
  uiThreads.forEach(t => engine.addThread(t.id, t.name, t.color, t.ops));
  engine.setSemaphores(semaphoreCounts);
  const conflicts = engine.nameConflicts();
  if (conflicts.length > 0) {
    showToast(`'${conflicts[0]}' is used as more than one of: variable, lock, semaphore`, 'error'); return;
  }
  stopAutoPlay();
  detectionResult = engine.detect();

  const raceCount = detectionResult.races.length;

  // Show results section
  const resultsEl = document.getElementById('results-section');
  resultsEl.classList.remove('hidden');

  // Explain text
  const explainEl = document.getElementById('results-explain');
  const varCount = detectionResult.variables.length;
  if (raceCount === 0) {
    explainEl.innerHTML = `<strong style="color:var(--success)">✅ No race conditions found.</strong> Every conflicting access is protected by a common lock or ordered by a semaphore.`;
  } else {
    explainEl.innerHTML = `Found <strong style="color:var(--danger)">${raceCount} possible race condition${raceCount>1?'s':''}</strong> across ${uiThreads.length} threads and ${varCount} shared variable${varCount!==1?'s':''}. Scroll down to see the timeline visualization, memory heatmap, and detailed report with <strong>fix suggestions</strong>.`;
  }
  if (detectionResult.deadlock) explainEl.innerHTML += `<br>${deadlockHtml(detectionResult.deadlock)}`;

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
  renderCode();

  // Scroll to results
  setTimeout(() => scrollToSection('results-section'), 250);

  if (raceCount > 0) {
    showToast(`${raceCount} race condition${raceCount>1?'s':''} detected!`, 'error');
  } else if (detectionResult.deadlock) {
    showToast('No races, but the simulated schedule deadlocks', 'error');
  } else {
    showToast('No race conditions found', 'success');
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
  const { threads, races, interleaving, deadlock } = detectionResult;

  // Columns are schedule steps. Operations a deadlock leaves unreached follow after the last step.
  const colOf = new Map(interleaving.map(s => [s.op.id, s.stepNum]));
  const reached = new Set(colOf.keys());
  let cols = interleaving.length;
  threads.forEach(t => t.operations.filter(op => !reached.has(op.id)).forEach((op, k) => {
    colOf.set(op.id, interleaving.length + k);
    cols = Math.max(cols, interleaving.length + k + 1);
  }));
  const stuckIds = new Set(deadlock ? deadlock.blocked.map(b => b.op.id) : []);

  const svgW = TL.LABEL_W + cols * (TL.OP_W + TL.OP_GAP) + TL.PAD * 2;
  const svgH = threads.length * TL.LANE_H + TL.HEADER_H + TL.PAD;

  const svg = document.getElementById('timeline-svg');
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.classList.remove('hidden');
  document.getElementById('timeline-legend').classList.remove('hidden');

  const racingIds = new Set(races.flatMap(r => [r.opA.op.id, r.opB.op.id]));

  const opPos = {};
  threads.forEach((thread, row) => {
    thread.operations.forEach(op => {
      const x = TL.LABEL_W + colOf.get(op.id) * (TL.OP_W + TL.OP_GAP);
      const y = TL.HEADER_H + row * TL.LANE_H;
      opPos[op.id] = { x, y };
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
    if (row % 2) html += `<rect x="0" y="${y}" width="${svgW}" height="${TL.LANE_H}" fill="var(--bg-hover)"/>`;
    html += `<rect x="4" y="${y+12}" width="${TL.LABEL_W-12}" height="50" rx="6" fill="${thread.color}18" stroke="${thread.color}40" stroke-width="1"/>
    <circle cx="14" cy="${y+TL.LANE_H/2-6}" r="4" fill="${thread.color}"/>
    <text x="23" y="${y+TL.LANE_H/2-1}" fill="${thread.color}" font-family="JetBrains Mono,monospace" font-size="10" font-weight="700">${esc(clip(thread.name, 12))}<title>${esc(thread.name)}</title></text>
    <text x="23" y="${y+TL.LANE_H/2+12}" fill="${thread.color}" font-family="JetBrains Mono,monospace" font-size="8">${thread.operations.length} op${thread.operations.length!==1?'s':''}</text>`;
  });

  // Grid lines
  for (let col = 0; col < interleaving.length; col++) {
    const x = TL.LABEL_W + col * (TL.OP_W + TL.OP_GAP);
    html += `<line x1="${x}" y1="${TL.HEADER_H}" x2="${x}" y2="${svgH}" stroke="var(--border)" stroke-opacity="0.5" stroke-width="1"/>
    <text x="${x + TL.OP_W/2}" y="${TL.HEADER_H - 6}" fill="var(--text-3)" font-size="9" text-anchor="middle" font-family="JetBrains Mono,monospace">t${col+1}</text>`;
  }

  // Op blocks
  threads.forEach((thread, row) => {
    thread.operations.forEach(op => {
      const pos = opPos[op.id];
      const x = pos.x + 3; const y = pos.y + TL.LANE_PAD;
      const w = TL.OP_W - 3; const h = TL.OP_H;
      const isRace = racingIds.has(op.id);
      const isStuck = stuckIds.has(op.id);
      const fillColor = isRace ? RACE_COLOR : OP_COLORS[op.type];
      const isCurrentStep = currentStep >= 0 && interleaving[currentStep] && interleaving[currentStep].op.id === op.id;
      const opacity = !reached.has(op.id) && !isStuck ? 0.35 : currentStep >= 0 ? (isCurrentStep ? 1 : 0.25) : 1;

      html += `<g class="op-group" opacity="${opacity}" style="transition:opacity 0.3s">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"
          fill="${fillColor}1a" stroke="${fillColor}" stroke-width="${isRace?2:1.2}"
          ${reached.has(op.id) ? '' : 'stroke-dasharray="4,3"'} ${isRace ? `filter="url(#glow-race)"` : ''}/>
        <rect x="${x}" y="${y}" width="${w}" height="3" rx="2" fill="${fillColor}55"/>
        <text x="${x+w/2}" y="${y+17}" text-anchor="middle" fill="${fillColor}"
          font-family="JetBrains Mono,monospace" font-size="9" font-weight="700">${op.type}</text>
        <text x="${x+w/2}" y="${y+31}" text-anchor="middle" fill="var(--text)"
          font-family="JetBrains Mono,monospace" font-size="10">${esc(clip(op.target, 12))}<title>${esc(op.target)}</title></text>
        ${isStuck ? `<text x="${x+w-8}" y="${y+12}" text-anchor="middle" font-size="10">⛔<title>Blocked: deadlock</title></text>` : ''}
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
    const cx = (x1+x2)/2, cy = Math.max(4, Math.min(y1,y2) - 18 - ri*8); // stay inside the viewBox
    const color = race.severity === 'critical' ? RACE_COLOR : WARN_COLOR;
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
      const color = step.isRace ? RACE_COLOR : 'var(--text)';
      html += `<rect x="${x-2}" y="${y-2}" width="${w+4}" height="${h+4}" rx="7"
        fill="none" stroke="${color}" stroke-width="2.5" opacity="0.85" filter="url(#glow-step)"/>`;
      const container = document.getElementById('timeline-container');
      container.scrollLeft = x + w / 2 - container.clientWidth / 2;
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
    const { interleaving, threads, races, deadlock } = detectionResult;
    text.innerHTML = `This timeline shows one possible schedule: <strong>${interleaving.length} operations</strong> from <strong>${threads.length} threads</strong>. ` +
      (races.length > 0
        ? `<span class="race-highlight">⚡ ${races.length} race${races.length>1?'s':''} detected</span> — red-highlighted operations are involved in races. `
        : `<strong style="color:var(--success)">No races found</strong>. `) +
      `Click <strong>Next ▶</strong> or press <kbd>→</kbd> to step through each operation.` +
      (deadlock ? `<br>${deadlockHtml(deadlock)}` : '');
    return;
  }

  const step = detectionResult.interleaving[currentStep];
  if (!step) return;

  const target = `<em>${esc(step.op.target)}</em>`;
  const EFFECT = {
    READ:   `it loads the current value of ${target} into its local register`,
    WRITE:  `it stores a new value into shared memory`,
    LOCK:   `it acquires the mutex, so other threads must wait to lock it`,
    UNLOCK: `it releases the mutex, so a waiting thread can proceed`,
    WAIT:   `it takes one unit from the semaphore; at zero it would have to wait`,
    SIGNAL: `it adds one unit to the semaphore, which can release a waiting thread`
  };
  const KIND = { READ: 'variable', WRITE: 'variable', LOCK: 'mutex', UNLOCK: 'mutex', WAIT: 'semaphore', SIGNAL: 'semaphore' };
  let desc = `<strong style="color:${step.thread.color}">${esc(step.thread.name)}</strong> performs ` +
    `<strong style="color:${OP_COLORS[step.op.type]}">${step.op.type}</strong> on ${KIND[step.op.type]} ` +
    `<code class="inline-code">${esc(step.op.target)}</code> — ${EFFECT[step.op.type]}.`;

  step.blocked.forEach(b => {
    desc += `<br>⏳ <strong>${esc(b.thread.name)}</strong> is blocked at ${b.op.type}(<em>${esc(b.op.target)}</em>).`;
  });

  if (step.isRace) {
    const other = step.race.opA.op.id === step.op.id ? step.race.opB : step.race.opA;
    desc += `<br><span class="race-highlight">⚡ POSSIBLE RACE:</span> This conflicts with <strong>${esc(other.thread.name)}</strong>'s ${other.op.type} on the same variable — no common lock or ordering protects them.`;
  }

  if (detectionResult.deadlock && currentStep === detectionResult.interleaving.length - 1) {
    desc += `<br>${deadlockHtml(detectionResult.deadlock)}`;
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
  document.getElementById('btn-prev').disabled = currentStep < 0;
  document.getElementById('btn-next').disabled = currentStep >= total - 1;
  const step = detectionResult.interleaving[currentStep];
  el.style.color = step && step.isRace ? RACE_COLOR : '';
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
  const grid = document.getElementById('heatmap-grid');
  grid.classList.remove('hidden');
  if (variables.length === 0) {
    grid.innerHTML = '<span class="empty-hint">No shared variables are accessed.</span>';
    return;
  }

  const racingIds = new Set(races.flatMap(r => [r.opA.op.id, r.opB.op.id]));

  let html = `<table class="heatmap-table"><thead><tr>
    <th class="hm-var-label">Variable</th>`;
  interleaving.forEach((s, i) => {
    html += `<th class="hm-step-label" title="${esc(`${s.thread.name}: ${s.op.type}(${s.op.target})`)}">t${i+1}</th>`;
  });
  html += `</tr></thead><tbody>`;

  variables.forEach(varName => {
    html += `<tr><td class="hm-var-label">${esc(varName)}</td>`;
    interleaving.forEach((step, i) => {
      const isAccess = (step.op.type === 'READ' || step.op.type === 'WRITE') && step.op.target === varName;
      const isRace = isAccess && racingIds.has(step.op.id);
      if (!isAccess) {
        html += `<td class="heatmap-cell-empty"></td>`;
      } else {
        const bg = OP_COLORS[step.op.type];
        const cls = ['heatmap-cell-access', isRace ? 'heatmap-cell-race' : ''].join(' ');
        html += `<td class="${cls}" style="background:${bg}1a;border-color:${bg}55"
          title="${esc(`${step.thread.name} ${step.op.type}(${varName}) at t${i+1}${isRace ? ' ⚡ RACE' : ''}`)}">
          <div class="hm-tooltip">${step.op.type[0]}</div>
          <div class="hm-tooltip" style="color:${step.thread.color}">${esc(clip(step.thread.name.split(' ').pop(), 8))}</div>
        </td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;

  // Legend
  html += `<div style="margin-top:16px;display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text-2);font-weight:500">
    ${threads.map(t => `<span style="display:flex;align-items:center;gap:6px">
      <span style="width:10px;height:10px;border-radius:50%;background:${t.color};display:inline-block"></span>${esc(t.name)}
    </span>`).join('')}
    <span style="display:flex;align-items:center;gap:6px">
      <span style="width:10px;height:10px;border-radius:3px;background:${RACE_COLOR};box-shadow:0 0 6px ${RACE_COLOR};display:inline-block"></span>Race Window
    </span>
  </div>`;

  grid.innerHTML = html;
}


// ══════════════════════════════════════════════════════════════════════════════
// RACE REPORT (with fix suggestions)
// ══════════════════════════════════════════════════════════════════════════════
function renderReport() {
  if (!detectionResult) return;
  const { races, safePairs, variables, threads, critical, warnings, deadlock } = detectionResult;
  const el = document.getElementById('report-content');
  const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`;

  let html = `<div class="algo-box">
    <strong>Detection Algorithms Used:</strong><br>
    <b>Step 1 — Bernstein's Conditions</b>: Identifies all pairs of operations from different threads that access the same shared variable where at least one is a WRITE. These are <em>potential</em> race candidates.<br>
    <b>Step 2 — Lockset / Eraser Algorithm</b>: For each candidate pair, checks if both operations hold at least one common mutex (or a semaphore used as one). If yes → protected (safe).<br>
    <b>Step 3 — Happens-Before</b>: Checks whether a semaphore SIGNAL must come before the other thread's WAIT, which forces an order. If yes → ordered (safe). If neither → <span style="color:var(--danger);font-weight:700">POSSIBLE RACE</span>.
  </div>`;

  // Summary
  html += `<div class="report-section-title">Summary</div>`;
  if (races.length === 0) {
    html += `<div class="safe-summary">
      ✅ <strong>No race conditions detected.</strong>
      Every conflicting access across ${plural(threads.length, 'thread')} and ${plural(variables.length, 'shared variable')} is protected by a lock or ordered by a semaphore.
    </div>`;
  } else {
    html += `<div class="race-card">
      <div style="font-size:14px;color:var(--text-2);line-height:1.7">
        Found <strong style="color:var(--danger)">${plural(races.length, 'possible race condition')}</strong>
        across <strong style="color:var(--text)">${plural(threads.length, 'thread')}</strong>
        and <strong style="color:var(--text)">${plural(variables.length, 'shared variable')}</strong>.
        ${critical > 0 ? `<br><span style="color:var(--danger)">⚠ ${critical} CRITICAL (Write-Write) — possible lost update</span>` : ''}
        ${warnings > 0 ? `<br><span style="color:var(--warning)">⚠ ${warnings} WARNING (Read-Write) — possible stale read</span>` : ''}
        ${safePairs.length > 0 ? `<br><span style="color:var(--success)">✅ ${plural(safePairs.length, 'conflicting pair')} protected by a lock or ordering</span>` : ''}
      </div>
    </div>`;
  }
  if (deadlock) html += `<div class="race-card critical"><div class="race-description" style="margin:0">${deadlockHtml(deadlock)}</div></div>`;

  // Race cards
  if (races.length > 0) {
    html += `<div class="report-section-title">Race Conditions (${races.length})</div>`;
    races.forEach(race => {
      const lsAStr = esc(race.opA.lockSet.join(', ') || 'none');
      const lsBStr = esc(race.opB.lockSet.join(', ') || 'none');
      const nameA = esc(race.opA.thread.name), nameB = esc(race.opB.thread.name), varName = esc(race.variable);
      const fixSuggestion = generateFixSuggestion(race, s => `<strong>${esc(s)}</strong>`, s => `<code>${esc(s)}</code>`);

      html += `<div class="race-card ${race.severity}">
        <div class="race-card-header">
          <span class="severity-badge severity-${race.severity}">${race.severity === 'critical' ? '🔴 CRITICAL' : '🟡 WARNING'}</span>
          <span class="race-type-badge">${race.type} Race</span>
          <span class="race-var">${varName}</span>
        </div>
        <div class="race-description">${esc(race.description)}</div>
        <div class="race-threads">
          <div class="race-thread-tag">
            <span class="race-thread-dot" style="background:${race.opA.thread.color}"></span>
            ${nameA} · ${race.opA.op.type}(${varName})
          </div>
          <span style="color:var(--text-3);font-size:14px;font-weight:700">↔</span>
          <div class="race-thread-tag">
            <span class="race-thread-dot" style="background:${race.opB.thread.color}"></span>
            ${nameB} · ${race.opB.op.type}(${varName})
          </div>
        </div>
        <div class="race-lockset">
          <strong>Lockset analysis:</strong> ${nameA} holds [<span>${lsAStr}</span>],
          ${nameB} holds [<span>${lsBStr}</span>]
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
          <span class="race-var">${esc(pair.variable)}</span>
        </div>
        <div class="race-description" style="font-size:13px;margin:0">
          ${esc(describeSafePair(pair))}
        </div>
      </div>`;
    });
  }

  el.innerHTML = html;
  el.classList.remove('hidden');
}

function describeSafePair(pair) {
  if (pair.reason === 'order') {
    const { first, second } = pair;
    return `${first.thread.name}'s ${first.op.type} of '${pair.variable}' always happens before ${second.thread.name}'s ${second.op.type}, because a semaphore orders them.`;
  }
  return `${pair.opA.thread.name} and ${pair.opB.thread.name} both access '${pair.variable}', but hold a common lock: ${pair.commonLocks.join(', ')}.`;
}

function describeDeadlock(deadlock) {
  return 'In the simulated schedule, ' + deadlock.blocked
    .map(b => `${b.thread.name} is stuck at ${b.op.type}(${b.op.target})`).join(' and ') + '.';
}

function deadlockHtml(deadlock) {
  return `<strong style="color:var(--danger)">⛔ Deadlock:</strong> ${esc(describeDeadlock(deadlock))}`;
}

// `strong` and `code` wrap (and escape) user-supplied names for the output format.
function generateFixSuggestion(race, strong, code) {
  const { opA: a, opB: b, variable } = race;
  const acquire = name => detectionResult.semaphores.includes(name) ? `WAIT(${name})` : `LOCK(${name})`;
  const release = name => detectionResult.semaphores.includes(name) ? `SIGNAL(${name})` : `UNLOCK(${name})`;
  const nameA = strong(a.thread.name), nameB = strong(b.thread.name), v = code(variable);
  const oneSided = (held, holder, other) =>
    `${holder} holds [${held.map(code).join(', ')}], but ${other} holds none. Add ${code(acquire(held[0]))} before and ${code(release(held[0]))} after ${other}'s access to ${v} so both threads share the same lock.`;

  let fix;
  if (a.lockSet.length === 0 && b.lockSet.length === 0) {
    fix = `Both ${nameA} and ${nameB} access ${v} without any lock. Add ${code('LOCK(mutex)')} before and ${code('UNLOCK(mutex)')} after the ${v} operations in both threads, using the same mutex name.`;
  } else if (b.lockSet.length === 0) {
    fix = oneSided(a.lockSet, nameA, nameB);
  } else if (a.lockSet.length === 0) {
    fix = oneSided(b.lockSet, nameB, nameA);
  } else {
    fix = `The threads hold different locks (${nameA}: [${a.lockSet.map(code).join(', ')}], ${nameB}: [${b.lockSet.map(code).join(', ')}]). Choose one, such as ${code(a.lockSet[0])}, and use it in both threads when accessing ${v}.`;
  }

  const uses = (t, type, sem) => t.operations.some(op => op.type === type && op.target === sem);
  const orderer = detectionResult.semaphores.find(s => engine.semaphoreCount(s) > 0 &&
    [[a.thread, b.thread], [b.thread, a.thread]].some(([from, to]) =>
      uses(from, 'SIGNAL', s) && !uses(from, 'WAIT', s) && uses(to, 'WAIT', s) && !uses(to, 'SIGNAL', s)));
  if (orderer) fix += ` If ${code(orderer)} is meant to make one thread wait for the other, set its starting count to 0 in Shared State.`;
  return fix;
}


// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

function clip(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
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

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT & CODE GEN
// ══════════════════════════════════════════════════════════════════════════════
function exportReport() {
  if (!detectionResult) { showToast('No results to export. Run detection first.', 'error'); return; }
  const { races, safePairs, variables, threads, deadlock } = detectionResult;
  let md = `# RaceGuard Analysis Report\n\n`;
  md += `## Summary\n\n- Threads: ${threads.length}\n- Shared variables: ${variables.length}\n- Possible races: ${races.length}\n- Protected pairs: ${safePairs.length}\n\n`;
  if (deadlock) md += `⛔ **Deadlock:** ${describeDeadlock(deadlock)}\n\n`;

  if (races.length === 0) {
    md += `✅ No race conditions detected. Every conflicting access is protected by a lock or ordered by a semaphore.\n\n`;
  } else {
    md += `## Race Conditions\n\n`;
    races.forEach((r, i) => {
      md += `### ${i+1}. ${r.type} race on \`${r.variable}\` (${r.severity.toUpperCase()})\n\n`;
      md += `**Description:** ${r.description}\n\n`;
      [r.opA, r.opB].forEach(o => { md += `- **${o.thread.name}** executes \`${o.op.type}\` holding: [${o.lockSet.join(', ') || 'none'}]\n`; });
      md += `\n**Fix suggestion:** ${generateFixSuggestion(r, s => `**${s}**`, s => `\`${s}\``)}\n\n`;
    });
  }
  if (safePairs.length > 0) {
    md += `## Protected Pairs\n\n${safePairs.map(p => `- ${describeSafePair(p)}`).join('\n')}\n`;
  }

  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'raceguard_report.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Report downloaded as Markdown', 'success');
}

function renderCode() {
  const lang = document.getElementById('code-lang-select').value;
  document.getElementById('code-content').textContent = generateCode(lang, uiThreads, semaphoreCounts);
}
