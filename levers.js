// Physical levers: drag one across, click it, or press its number. Elements persist between updates so a
// drag is never interrupted by a re-render.
const Levers = (() => {
  const REST = -24, PULLED = 26;
  let host, onPull, dragging = null, suppressClick = false;
  const levers = [];

  function build(t) {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = `lever-${t}`;
    el.innerHTML = `<svg viewBox="0 0 150 168" aria-hidden="true">
        <path class="quadrant" d="M13 150a64 64 0 0 1 124 0z"/><path class="notches" d="M30 108l8 8M43 96l6 9M107 96l-6 9M120 108l-8 8"/>
        <path class="slot" d="M34 128a52 52 0 0 1 82 0"/>
        <g class="arm"><path class="shaft" d="M70 46h10l3 100H67z"/><path class="shaft-shine" d="M73 48l-1.5 96"/>
          <rect class="collar" x="62" y="72" width="26" height="36" rx="4"/><text class="collar-num" x="75" y="98"></text>
          <path class="catch" d="M85 10c9 4 9 22 1 30"/><rect class="grip" x="64" y="4" width="22" height="46" rx="10"/><path class="grip-shine" d="M69 13v26"/></g>
        <path class="floor" d="M8 150h134v10a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z"/><path class="bolt" d="M24 96l46 18"/></svg>
      <span class="lever-text"><span class="lever-name"></span><span class="lever-status"></span></span>`;
    const lever = { el, t, arm: el.querySelector('.arm'), state: null };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      dragging = { lever, x: e.clientX, id: e.pointerId, angle: REST, moved: false };
    });
    el.addEventListener('click', () => { if (!suppressClick) act(lever); });
    return lever;
  }

  function act(lever) {
    if (onPull(lever.t)) swing(lever); else refuse(lever);
  }
  function setAngle(lever, deg) { lever.arm.style.transform = `rotate(${deg}deg)`; }
  function still() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function swing(lever) {
    if (still()) return;
    lever.arm.animate([{ transform: `rotate(${REST}deg)` }, { transform: `rotate(${PULLED}deg)`, offset: 0.35, easing: 'cubic-bezier(.3,1.5,.5,1)' }, { transform: `rotate(${REST}deg)` }], { duration: 560, easing: 'cubic-bezier(.4,0,.6,1)' });
  }
  function refuse(lever) {
    if (still()) return;
    lever.arm.animate([{ transform: `rotate(${REST}deg)` }, { transform: `rotate(${REST + 9}deg)` }, { transform: `rotate(${REST - 3}deg)` }, { transform: `rotate(${REST}deg)` }], { duration: 260 });
  }

  function onMove(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = e.clientX - dragging.x, { lever } = dragging;
    if (!dragging.moved && Math.abs(dx) < 6) return;
    if (!dragging.moved) { dragging.moved = true; lever.el.setPointerCapture(e.pointerId); lever.el.classList.add('is-held'); }
    const travel = Math.max(0, dx) * 0.75;
    // A locked lever gives a little, then stops against the bolt
    dragging.angle = lever.state === 'free' ? Math.min(PULLED, REST + travel) : REST + 9 * (1 - Math.exp(-travel / 18));
    setAngle(lever, dragging.angle);
  }
  function onUp(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    const { lever, angle, moved } = dragging;
    dragging = null;
    if (!moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    lever.el.classList.remove('is-held');
    setAngle(lever, REST); // springs back through its CSS transition
    if (e.type !== 'pointercancel' && lever.state === 'free' && angle > 8) onPull(lever.t);
  }

  function update(model) {
    while (levers.length > model.threads.length) levers.pop().el.remove();
    while (levers.length < model.threads.length) { const l = build(levers.length); levers.push(l); host.append(l.el); setAngle(l, REST); }
    levers.forEach((lever, t) => {
      const p = leverParts(model, t);
      lever.state = p.state;
      lever.el.className = `lever lever-${p.state} ${inkClass(t)}${dragging && dragging.lever === lever && dragging.moved ? ' is-held' : ''}`;
      if (p.state === 'free') lever.el.removeAttribute('aria-disabled'); else lever.el.setAttribute('aria-disabled', 'true');
      lever.el.querySelector('.collar-num').textContent = t + 1;
      lever.el.querySelector('.lever-name').textContent = clip(p.name, 18);
      lever.el.querySelector('.lever-status').textContent = clip(p.status, 40);
    });
  }

  function init(element, pull) {
    host = element;
    onPull = pull;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }
  return { init, update, swing: t => levers[t] && swing(levers[t]), refuse: t => levers[t] && refuse(levers[t]) };
})();
