// The living train map. views.js says where everything should be (mapLayout); this file moves it there:
// springs for stops, stations and trains, plucked strings for station lines, and dragging.
const TrainMap = (() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const STIFFNESS = 150, DAMPING = 19, CAR_GAP = 42;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  let dom, callbacks, model = null, layout = null;
  const present = { v: 0, to: 0, dv: 0 }; // where the 'now' line is
  let frameId = 0, lastTime = 0, clock = 0, drag = null, suppressClick = false, structure = '';
  const stops = new Map();    // op uid -> { el, x, y, t, o }
  const lines = new Map();    // thread id -> { home, end, train, adder, head, svg parts }
  const stations = new Map(); // station key -> { y, amp, plate, ... }

  // ── Springs ────────────────────────────────────────────────────────────────
  const spring = v => ({ v, to: v, dv: 0 });
  function advance(s, dt) {
    s.dv += (STIFFNESS * (s.to - s.v) - DAMPING * s.dv) * dt;
    s.v += s.dv * dt;
    if (Math.abs(s.to - s.v) < 0.1 && Math.abs(s.dv) < 1) { s.v = s.to; s.dv = 0; return false; }
    return true;
  }
  function snap(s) { s.v = s.to; s.dv = 0; }
  function allSprings() {
    const out = [present];
    for (const s of stops.values()) out.push(s.x, s.y);
    for (const l of lines.values()) out.push(l.home, l.end, l.train);
    for (const s of stations.values()) out.push(s.y);
    return out;
  }

  // ── Small DOM helpers ──────────────────────────────────────────────────────
  const html = (tag, className, parent) => { const el = document.createElement(tag); el.className = className; parent.append(el); return el; };
  const svg = (tag, className, parent) => { const el = document.createElementNS(SVG, tag); if (className) el.setAttribute('class', className); parent.append(el); return el; };
  const set = (el, attrs) => { for (const k in attrs) el.setAttribute(k, attrs[k]); };
  function prune(map, keep, destroy) {
    for (const [key, item] of map) if (!keep.has(key)) { destroy(item); map.delete(key); }
  }

  // ── Sync DOM with the model ────────────────────────────────────────────────
  function update(nextModel) {
    model = nextModel;
    layout = mapLayout(model, dom.scroller.clientWidth);
    present.to = layout.now;
    dom.popover.hidden = !model.selection; // now, so callers can focus its field
    syncStations();
    syncLines();
    syncStops();
    syncTicks();
    syncStructure();
    dom.root.style.setProperty('--map-height', `${layout.height}px`);
    set(dom.svg, { width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}` });
    dom.layer.style.width = `${layout.width}px`;
    dom.layer.style.height = `${layout.height}px`;
    follow();
    if (reduced.matches) { allSprings().forEach(snap); draw(); } else wake();
  }

  function syncStations() {
    prune(stations, new Set(layout.stations.map(s => s.key)), s => s.plate.remove());
    for (const s of layout.stations) {
      let st = stations.get(s.key);
      if (!st) {
        const plate = html('div', 'station-plate', dom.plates);
        st = { y: spring(s.y), amp: 0, plate, name: html('span', 'station-name', plate), value: html('span', 'station-value', plate), start: null };
        stations.set(s.key, st);
      }
      st.y.to = s.y;
      st.info = s;
      st.plate.className = `station-plate is-${s.kind}${s.conflicts ? ' is-exposed' : ''}`;
      st.name.textContent = s.name || 'unnamed';
      st.name.title = s.name;
      const value = stationValue(model, s);
      if (st.value.textContent !== value) {
        const first = st.value.textContent === '';
        st.value.textContent = value;
        if (!first && !reduced.matches) st.value.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(-25deg)', offset: 0.6 }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
      }
      if (s.kind === 'semaphore') {
        if (!st.start) {
          const label = html('label', 'station-start', st.plate);
          label.append('starts at ');
          st.start = html('input', '', label);
          set(st.start, { type: 'number', min: 0, max: 99, name: 'semaphore-start', 'data-input': 'semaphore' });
        }
        st.start.dataset.name = s.name;
        if (document.activeElement !== st.start) st.start.value = model.countOf(s.name);
      }
    }
  }

  function syncLines() {
    prune(lines, new Set(model.threads.map(t => t.id)), l => { l.head.remove(); l.adder.remove(); });
    model.threads.forEach((thread, t) => {
      const target = layout.threads[t];
      let l = lines.get(thread.id);
      if (!l) {
        const head = html('div', '', dom.heads);
        head.innerHTML = `<button type="button" class="head-remove" data-action="remove-thread"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
          <input class="head-name" data-input="name" autocomplete="off" spellcheck="false"><label class="head-num"></label>`;
        const adder = html('button', '', dom.layer);
        adder.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v10M1 6h10"/></svg>';
        l = { home: spring(target.homeY), end: spring(target.endX), train: spring(0), head, adder };
        lines.set(thread.id, l);
      }
      l.t = t;
      l.home.to = target.homeY;
      l.end.to = target.endX;
      l.train.to = target.trainX;
      l.head.className = `head ${inkClass(t)}`;
      const num = l.head.querySelector('.head-num');
      num.textContent = t + 1;
      num.htmlFor = `name-${t}`;
      const name = l.head.querySelector('input');
      set(name, { id: `name-${t}`, 'data-t': t, 'aria-label': `Thread ${t + 1} name` });
      if (name.value !== thread.name) name.value = thread.name;
      set(l.head.querySelector('button'), { id: `remove-thread-${t}`, 'data-t': t, 'aria-label': `Remove thread ${t + 1}`, title: 'Remove thread' });
      l.adder.className = `adder ${inkClass(t)}`;
      set(l.adder, { type: 'button', id: `add-${t}`, 'data-action': 'add-op', 'data-t': t, 'aria-label': `Add operation to thread ${t + 1}`, title: 'Add operation' });
    });
  }

  function syncStops() {
    const keep = new Set(model.threads.flatMap(t => t.ops.map(op => op.uid)));
    prune(stops, keep, s => s.el.remove());
    model.threads.forEach((thread, t) => thread.ops.forEach((op, o) => {
      const p = layout.threads[t].points[o], a = stopAttrs(model, t, o);
      let s = stops.get(op.uid);
      if (!s) {
        const el = html('button', '', dom.layer);
        el.innerHTML = '<span class="stop-disc"></span><span class="stop-type"></span>';
        s = { el, x: spring(p.x), y: spring(p.y + 30), type: null };
        stops.set(op.uid, s);
      }
      Object.assign(s, { t, o, reached: p.reached });
      s.x.to = p.x;
      s.y.to = p.y;
      s.el.className = a.className + (p.reached ? '' : ' is-unreached') + (drag && drag.s === s ? ' is-dragged' : '');
      set(s.el, { type: 'button', id: `stop-${t}-${o}`, 'data-action': 'select', 'data-t': t, 'data-o': o, 'aria-pressed': a.selected, 'aria-label': a.label, title: `${op.type} ${op.target}` });
      if (s.type !== op.type) {
        s.type = op.type;
        s.el.querySelector('.stop-disc').innerHTML = symbolSvg(op.type);
        s.el.querySelector('.stop-type').textContent = op.type;
      }
    }));
    // Keep Tab order and reading order: by thread, then by position
    const ordered = [...stops.values()].sort((a, b) => a.t - b.t || a.o - b.o).map(s => s.el);
    const current = [...dom.layer.querySelectorAll('.stop')];
    if (ordered.some((el, i) => el !== current[i])) {
      const focused = document.activeElement;
      ordered.forEach(el => dom.layer.append(el));
      if (focused && focused.isConnected && focused !== document.activeElement) focused.focus({ preventScroll: true });
    }
  }

  function syncTicks() {
    const ticks = model.state ? model.schedule : [];
    while (dom.ticks.children.length > ticks.length) dom.ticks.lastChild.remove();
    ticks.forEach((t, k) => {
      const el = dom.ticks.children[k] || html('button', '', dom.ticks);
      el.className = `tick ${inkClass(t)}${k < model.cursor ? ' is-past' : ''}`;
      el.textContent = t + 1;
      el.style.left = `${(k + 0.5) * layout.step}px`;
      const text = `Step ${k + 1}: ${describeStep(model, k)}`;
      set(el, { type: 'button', 'data-action': 'jump', 'data-k': k + 1, title: text, 'aria-label': text, tabindex: -1 });
    });
  }

  // Rebuild the SVG skeleton only when its shape changes; draw() then moves it
  function syncStructure() {
    const key = JSON.stringify([layout.stations.map(s => [s.key, s.kind]), model.threads.map((t, i) => [t.id, layout.threads[i].holds.length, layout.threads[i].cargo.length]), layout.arcs.map(a => a.key)]);
    if (key !== structure) {
      structure = key;
      dom.svg.replaceChildren();
      const back = svg('g', '', dom.svg);
      for (const s of layout.stations) {
        const st = stations.get(s.key);
        st.band = svg('rect', `band band-${s.kind}`, back);
        st.string = svg('path', `string string-${s.kind}`, back);
      }
      dom.now = svg('line', 'now', dom.svg);
      const arcs = svg('g', '', dom.svg);
      dom.arcs = layout.arcs.map(() => svg('path', '', arcs));
      const tracks = svg('g', '', dom.svg), trains = svg('g', '', dom.svg);
      model.threads.forEach((thread, t) => {
        const l = lines.get(thread.id);
        const g = svg('g', '', tracks);
        l.g = g;
        l.sheaths = layout.threads[t].holds.map(() => svg('path', 'sheath', g));
        l.ahead = svg('path', 'track-ahead', g);
        l.behind = svg('path', 'track-behind', g);
        const tg = l.trainG = svg('g', '', trains);
        l.cars = layout.threads[t].cargo.map(() => {
          const car = svg('g', 'car', tg);
          set(svg('rect', 'car-body', car), { x: -18, y: -14, width: 36, height: 28, rx: 8 });
          svg('text', 'car-text', car);
          return car;
        });
        l.engine = svg('g', 'engine', tg);
        set(svg('rect', 'engine-body', l.engine), { x: -24, y: -16, width: 48, height: 32, rx: 15 });
        set(svg('text', 'engine-text', l.engine), { x: 0, y: 7.5 });
        l.signal = svg('g', 'signal', tg);
        set(svg('path', 'signal-post', l.signal), { d: 'M0 0V-34' });
        set(svg('path', 'signal-arm', l.signal), { d: 'M0 -34h22v9H0z' });
      });
    }
    model.threads.forEach((thread, t) => {
      const l = lines.get(thread.id), target = layout.threads[t];
      for (const g of [l.g, l.trainG]) g.setAttribute('class', inkClass(t));
      l.engine.lastChild.textContent = t + 1;
      l.signal.style.display = target.blocked ? '' : 'none';
      l.cars.forEach((car, i) => {
        const c = target.cargo[i];
        car.setAttribute('class', `car${c.stale ? ' is-stale' : ''}`);
        car.lastChild.textContent = target.cargo.length > 1 ? `${c.name[0]}${c.value}` : c.value;
        set(car.lastChild, { x: 0, y: 7 });
      });
      l.sheaths.forEach((el, i) => el.setAttribute('class', `sheath${target.holds[i].to === null ? ' is-open' : ''}`));
    });
    layout.arcs.forEach((a, i) => dom.arcs[i].setAttribute('class', `arc arc-${a.tone}${a.focus ? ' is-focus' : ''}${a.dim ? ' is-dim' : ''}`));
  }

  // ── Frame loop ─────────────────────────────────────────────────────────────
  function wake() {
    if (frameId || document.hidden) return;
    lastTime = performance.now();
    frameId = requestAnimationFrame(tick);
  }
  function tick(now) {
    frameId = 0;
    const dt = Math.min(0.032, (now - lastTime) / 1000);
    lastTime = now;
    clock += dt;
    let moving = !!drag;
    for (const s of allSprings()) {
      const a = advance(s, dt / 2), b = advance(s, dt / 2);
      moving = a || b || moving;
    }
    for (const st of stations.values()) {
      const rest = st.info.conflicts ? 1.7 : 0; // an unprotected variable never quite settles
      st.amp = rest + (st.amp - rest) * Math.exp(-2.4 * dt);
      if (st.amp > 0.15) moving = true;
    }
    draw();
    if (moving) wake();
  }

  function pointsOf(t) {
    return model.threads[t].ops.map(op => { const s = stops.get(op.uid); return { x: s.x.v, y: s.y.v }; }).sort((a, b) => a.x - b.x);
  }
  // Sample a thread's route between x0 and x1
  function trace(knots, x0, x1) {
    if (x1 <= x0) return '';
    const xs = [x0];
    let a = knots[0];
    for (const b of knots) {
      const n = b.y === a.y ? 1 : 16;
      for (let i = 1; i <= n; i++) { const x = a.x + (b.x - a.x) * i / n; if (x > x0 && x < x1) xs.push(x); }
      a = b;
    }
    xs.push(x1);
    return 'M' + xs.map(x => `${x.toFixed(1)} ${routeY(knots, x).toFixed(1)}`).join('L');
  }

  function draw() {
    const { width, step } = layout, still = reduced.matches;
    for (const st of stations.values()) {
      const y = st.y.v, half = (Math.max(model.threads.length, 2) * LANE) / 2 + 8;
      set(st.band, { x: 0, y: y - half, width, height: half * 2 });
      const amp = still ? 0 : st.amp;
      let d = `M0 ${y.toFixed(1)}`;
      if (amp > 0.15) {
        for (let x = 12; x < width; x += 12) {
          const u = x / width;
          const w = Math.sin(Math.PI * 4 * u) * Math.cos(clock * 21) + 0.6 * Math.sin(Math.PI * 9 * u) * Math.cos(clock * 33) + 0.3 * Math.sin(Math.PI * 17 * u) * Math.cos(clock * 47);
          d += `L${x} ${(y + amp * w).toFixed(1)}`;
        }
      }
      st.string.setAttribute('d', `${d}L${width} ${y.toFixed(1)}`);
      st.plate.style.transform = `translateY(${y.toFixed(1)}px) translateY(-50%)`;
    }

    model.threads.forEach((thread, t) => {
      const l = lines.get(thread.id), target = layout.threads[t], points = pointsOf(t);
      const home = l.home.v, x = l.train.v, end = l.end.v;
      const knots = routeKnots(points, home, step);
      const yAt = px => routeY(knots, px);
      l.behind.setAttribute('d', trace(knots, 0, Math.min(x, end)));
      l.ahead.setAttribute('d', trace(knots, Math.max(0, x), end));
      l.sheaths.forEach((el, i) => {
        const h = target.holds[i], at = o => stops.get(thread.ops[o].uid).x.v;
        el.setAttribute('d', trace(knots, at(h.from), h.to === null ? end : at(h.to)));
      });
      const place = (el, px) => {
        const slope = Math.atan2(yAt(px + 5) - yAt(px - 5), 10) * 180 / Math.PI;
        el.setAttribute('transform', `translate(${px.toFixed(1)} ${yAt(px).toFixed(1)}) rotate(${slope.toFixed(1)})`);
        el.lastChild.setAttribute('transform', `rotate(${(-slope).toFixed(1)})`); // numbers stay upright
      };
      place(l.engine, Math.max(x, 26));
      l.cars.forEach((car, i) => place(car, Math.max(x, 26) - CAR_GAP * (i + 1) - 4));
      const sx = Math.max(x, 26) + 34;
      l.signal.setAttribute('transform', `translate(${sx.toFixed(1)} ${(yAt(sx) + 8).toFixed(1)})`);
      l.adder.style.transform = `translate(${end.toFixed(1)}px, ${yAt(end).toFixed(1)}px) translate(-50%, -50%)`;
      l.head.style.transform = `translateY(${home.toFixed(1)}px) translateY(-50%)`;
    });
    set(dom.now, { x1: present.v, x2: present.v, y1: 0, y2: layout.height });

    for (const s of stops.values()) s.el.style.transform = `translate(${s.x.v.toFixed(1)}px, ${s.y.v.toFixed(1)}px) translate(-50%, -50%)`;

    layout.arcs.forEach((a, i) => {
      const A = stops.get(model.threads[a.a.t].ops[a.a.o].uid), B = stops.get(model.threads[a.b.t].ops[a.b.o].uid);
      const [x1, y1, x2, y2] = [A.x.v, A.y.v, B.x.v, B.y.v];
      const lift = 46 + Math.abs(x2 - x1) * 0.14;
      dom.arcs[i].setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${((x1 + x2) / 2).toFixed(1)} ${(Math.min(y1, y2) - lift).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    });
    placePopover();
  }

  // The editor floats beside the stop it edits
  function placePopover() {
    const s = model.selection && [...stops.values()].find(v => v.t === model.selection.t && v.o === model.selection.o);
    dom.popover.hidden = !s;
    if (!s) return;
    const box = dom.root.getBoundingClientRect(), w = dom.popover.offsetWidth, h = dom.popover.offsetHeight;
    const x = dom.scroller.offsetLeft + s.x.v - dom.scroller.scrollLeft;
    const below = s.y.v + 44 + h < Math.max(layout.height, box.height);
    const left = Math.max(8, Math.min(box.width - w - 8, x - w / 2));
    const top = below ? s.y.v + 44 : Math.max(8, s.y.v - 44 - h);
    dom.popover.style.transform = `translate(${left.toFixed(0)}px, ${top.toFixed(0)}px)`;
  }

  function follow() {
    const x = layout.now, sc = dom.scroller;
    if (sc.scrollWidth <= sc.clientWidth) return;
    if (x < sc.scrollLeft + 60 || x > sc.scrollLeft + sc.clientWidth - 120) {
      sc.scrollTo({ left: x - sc.clientWidth * 0.5, behavior: reduced.matches ? 'auto' : 'smooth' });
    }
  }

  // ── Events the app asks for ────────────────────────────────────────────────
  function pluck(key, amp) {
    const st = stations.get(key);
    if (st) { st.amp = Math.min(14, st.amp + amp); wake(); }
  }
  // A ring spreads from the stop that just ran
  function ring(t, o, danger) {
    const s = stops.get(model.threads[t].ops[o].uid);
    if (!s || reduced.matches) return;
    const el = html('span', `ring ${inkClass(t)}${danger ? ' is-danger' : ''}`, dom.layer);
    el.style.left = `${s.x.to}px`;
    el.style.top = `${s.y.to}px`;
    el.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0.9 }, { transform: `translate(-50%,-50%) scale(${danger ? 3.4 : 2.2})`, opacity: 0 }], { duration: danger ? 900 : 520, easing: 'ease-out' }).onfinish = () => el.remove();
  }
  // A lost value falls off the track
  function drop(t, o, value) {
    const s = stops.get(model.threads[t].ops[o].uid);
    if (!s || reduced.matches) return;
    const el = html('span', 'lost-value', dom.layer);
    el.textContent = value;
    el.style.left = `${s.x.to}px`;
    el.style.top = `${s.y.to}px`;
    const fall = Math.max(160, layout.height - s.y.to + 60);
    el.animate([
      { transform: 'translate(-50%,-50%)', opacity: 1 },
      { transform: 'translate(-10%,-150%) rotate(24deg)', opacity: 1, offset: 0.22, easing: 'cubic-bezier(.5,0,.9,.5)' },
      { transform: `translate(120%, ${fall}px) rotate(260deg)`, opacity: 0.9 }
    ], { duration: 1500, easing: 'ease-out' }).onfinish = () => el.remove();
    dom.root.animate([{ transform: 'none' }, { transform: 'translate(-4px,2px)' }, { transform: 'translate(3px,-2px)' }, { transform: 'translate(-2px,1px)' }, { transform: 'none' }], { duration: 260 });
  }

  // ── Dragging a stop: sideways reorders, up or down retargets ───────────────
  function nearestStation(kind, y) {
    return layout.stations.filter(s => s.kind === kind).reduce((best, s) => !best || Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best, null);
  }
  function markTarget(key) { for (const [k, s] of stations) s.plate.classList.toggle('is-target', k === key); }

  function onDown(e) {
    const el = e.target.closest('.stop');
    if (!el || e.button !== 0) return;
    const s = [...stops.values()].find(v => v.el === el);
    drag = { s, uid: model.threads[s.t].ops[s.o].uid, x0: e.clientX, y0: e.clientY, live: false, id: e.pointerId };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.live) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
      drag.live = true;
      drag.s.el.setPointerCapture(e.pointerId);
      drag.s.el.classList.add('is-dragged');
      callbacks.onDragStart();
      wake();
    }
    const box = dom.layer.getBoundingClientRect();
    const { x, y } = drag.s;
    x.v = x.to = e.clientX - box.left;
    y.v = y.to = e.clientY - box.top;
    x.dv = y.dv = 0;
    const op = model.threads[drag.s.t].ops[drag.s.o];
    const target = nearestStation(STATION_KIND[op.type], y.v);
    markTarget(target && target.key);
    if (reduced.matches) draw();
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { s, live } = drag;
    drag = null;
    markTarget(null);
    if (!live) return;
    s.el.classList.remove('is-dragged');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (e.type === 'pointercancel') { update(model); return; }
    const ops = model.threads[s.t].ops, op = ops[s.o];
    const station = nearestStation(STATION_KIND[op.type], s.y.v);
    const index = ops.filter((other, i) => i !== s.o && layout.threads[s.t].points[i].x < s.x.v).length;
    const name = station ? station.name : op.target.trim();
    if (index === s.o && name === op.target.trim()) update(model); // springs back
    else callbacks.onDrop(s.t, s.o, index, name);
  }

  function init(elements, handlers) {
    dom = elements;
    callbacks = handlers;
    dom.layer.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    dom.layer.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    dom.scroller.addEventListener('scroll', () => { if (model) placePopover(); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    reduced.addEventListener('change', () => { if (model) update(model); });
    new ResizeObserver(() => { if (model) update(model); }).observe(dom.scroller);
  }

  return { init, update, pluck, ring, drop };
})();
