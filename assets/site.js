/* SPIRE CONSTRUCTORS | shared behavior for every page
   nav, header state, entrances, the plumb line, dimension frames, counters,
   the hold-to-level moment, lightbox, lead form, hidden-tab pause, reduced motion */
(function () {
  'use strict';
  var doc = document, body = doc.body, root = doc.documentElement;
  var reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = reduceMQ.matches;
  var LEAD_ENDPOINT = (/(^|\.)spireconstructors\.com$|\.pages\.dev$/.test(location.hostname))
    ? '/api/lead'
    : 'https://spire-constructors-site.pages.dev/api/lead';

  /* ---------- mobile nav ---------- */
  doc.addEventListener('click', function (e) {
    var links = doc.querySelector('.nav-links');
    if (!links) return;
    var btn = e.target.closest('.menu-btn');
    if (btn) { var open = links.classList.toggle('open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); return; }
    if (links.classList.contains('open') && (e.target.closest('.nav-links a') || !e.target.closest('.nav-links'))) {
      links.classList.remove('open');
      var mb = doc.querySelector('.menu-btn'); if (mb) mb.setAttribute('aria-expanded', 'false');
    }
  });

  /* ---------- hidden-tab pause (hits every element and pseudo-element via one body class) ---------- */
  doc.addEventListener('visibilitychange', function () { body.classList.toggle('paused', doc.hidden); });

  /* ---------- entrances: IntersectionObserver adds .in, then retires stagger delays ---------- */
  var entr = doc.querySelectorAll('.rise, .stagger, .dim');
  function finishStagger(el) {
    if (!el.classList.contains('stagger')) return;
    var n = el.children.length;
    setTimeout(function () { el.classList.add('done'); }, 900 + n * 90);
  }
  if (reduced) {
    entr.forEach(function (el) { el.classList.add('in', 'done'); });
  } else if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); finishStagger(en.target); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    entr.forEach(function (el) { io.observe(el); });
  } else {
    entr.forEach(function (el) { el.classList.add('in', 'done'); });
  }

  /* ---------- dimension frames: inject the drawing SVG into every .dim ---------- */
  doc.querySelectorAll('.dim').forEach(function (d) {
    if (d.querySelector('svg.dl')) return;
    var label = d.getAttribute('data-dim') || '';
    var s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'dl'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('preserveAspectRatio', 'none');
    s.innerHTML =
      '<line x1="0" y1="6" x2="100" y2="6" vector-effect="non-scaling-stroke"/>' +
      '<line x1="0" y1="2" x2="0" y2="10" vector-effect="non-scaling-stroke"/>' +
      '<line x1="100" y1="2" x2="100" y2="10" vector-effect="non-scaling-stroke"/>' +
      '<line x1="6" y1="0" x2="6" y2="100" vector-effect="non-scaling-stroke"/>' +
      '<line x1="2" y1="100" x2="10" y2="100" vector-effect="non-scaling-stroke"/>';
    d.appendChild(s);
    if (label) {
      var t = doc.createElement('span');
      t.className = 'dim-label'; t.textContent = label;
      t.style.cssText = 'position:absolute;left:0;top:-30px;font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--metal-deep);opacity:0;transition:opacity .6s var(--ease) 1.1s';
      d.appendChild(t);
      var obs = new MutationObserver(function () { if (d.classList.contains('in')) { t.style.opacity = '1'; obs.disconnect(); } });
      obs.observe(d, { attributes: true, attributeFilter: ['class'] });
      if (d.classList.contains('in')) t.style.opacity = '1';
    }
  });

  /* ---------- counters (count up once when seen; delta-gated writes) ---------- */
  var counters = doc.querySelectorAll('[data-count]');
  function runCounter(el) {
    var target = parseFloat(el.getAttribute('data-count')), prefix = el.getAttribute('data-prefix') || '', suffix = el.getAttribute('data-suffix') || '';
    var dur = 1400, t0 = null, last = '';
    function step(now) {
      if (t0 === null) t0 = now;
      var p = Math.min(1, (now - t0) / dur); p = 1 - Math.pow(1 - p, 3);
      var v = Math.round(target * p), s = prefix + v + suffix;
      if (s !== last) { el.textContent = s; last = s; }
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function pinCounters() { counters.forEach(function (el) { el.textContent = (el.getAttribute('data-prefix') || '') + el.getAttribute('data-count') + (el.getAttribute('data-suffix') || ''); }); }
  if (counters.length) {
    if (reduced || !('IntersectionObserver' in window)) pinCounters();
    else {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { runCounter(en.target); cio.unobserve(en.target); } });
      }, { threshold: 0.5 });
      counters.forEach(function (el) { cio.observe(el); });
    }
  }

  /* ---------- the plumb line: fixed track, ticks per [data-floor] section, bob rides scroll ---------- */
  var plumb = doc.querySelector('.plumb');
  var floors = doc.querySelectorAll('[data-floor]');
  var ticks = [], fill, bob, lastPf = -1, lastActive = -1, plumbRaf = null;
  if (plumb && floors.length) {
    fill = plumb.querySelector('.fill'); bob = plumb.querySelector('.bob');
    floors.forEach(function (sec, i) {
      var t = doc.createElement('div'); t.className = 'tick';
      var s = doc.createElement('span'); s.textContent = sec.getAttribute('data-floor'); t.appendChild(s);
      plumb.appendChild(t); ticks.push({ el: t, sec: sec });
    });
    function layoutTicks() {
      var docH = Math.max(1, root.scrollHeight - innerHeight);
      ticks.forEach(function (t) {
        var y = t.sec.getBoundingClientRect().top + scrollY;
        t.el.style.top = (Math.min(1, y / docH) * 100) + '%';
      });
    }
    function drivePlumb() {
      plumbRaf = null;
      var docH = Math.max(1, root.scrollHeight - innerHeight);
      var pf = Math.min(1, scrollY / docH);
      var pct = Math.round(pf * 1000) / 10;
      if (pct !== lastPf) {
        lastPf = pct;
        fill.style.height = pct + '%';
        if (bob) bob.style.top = pct + '%';
        plumb.style.setProperty('--pf', pct + '%');
      }
      var active = -1, mid = scrollY + innerHeight * 0.35;
      ticks.forEach(function (t, i) { if (t.sec.getBoundingClientRect().top + scrollY <= mid) active = i; });
      if (active !== lastActive) {
        lastActive = active;
        ticks.forEach(function (t, i) { t.el.classList.toggle('on', i === active); });
      }
    }
    function onPlumbScroll() { if (plumbRaf === null) plumbRaf = requestAnimationFrame(drivePlumb); }
    addEventListener('scroll', onPlumbScroll, { passive: true });
    addEventListener('resize', function () { layoutTicks(); onPlumbScroll(); });
    addEventListener('load', function () { layoutTicks(); drivePlumb(); plumb.classList.add('show'); });
    layoutTicks(); drivePlumb();
    setTimeout(function () { layoutTicks(); drivePlumb(); plumb.classList.add('show'); }, 1200);
  }

  /* ---------- header: dark over the cinematic hero (index only, body[data-hero]) ---------- */
  var header = doc.querySelector('header');
  var heroEl = doc.querySelector('[data-hero-pin]');
  if (header && heroEl) {
    var lastDark = null;
    function headerState() {
      var r = heroEl.getBoundingClientRect();
      var dark = r.bottom > 90, exiting = dark && r.bottom < innerHeight;
      header.classList.toggle('exiting', exiting);
      if (dark !== lastDark) { lastDark = dark; header.classList.toggle('on-dark', dark); body.classList.toggle('on-dark', dark); }
    }
    addEventListener('scroll', headerState, { passive: true });
    addEventListener('resize', headerState);
    headerState();
  }

  /* ---------- the hold-to-level moment ---------- */
  var level = doc.querySelector('.level');
  if (level) {
    var btn = level.querySelector('.hold'), bubble = level.querySelector('.bubble'), line = level.querySelector('.plumbline'), readout = level.querySelector('.readout');
    var lit = doc.querySelectorAll('[data-lit]');
    var prog = 0, holding = false, raf = null, lastT = 0, done = false, lastR = '';
    var HOLD_MS = 1500, RELEASE_MS = 900;
    function paint() {
      var x = (1 - prog) * 46;           // bubble slides 46px off-center to true center
      var deg = (1 - prog) * 7;          // plumb line swings from 7 degrees to plumb
      bubble.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
      line.style.transform = 'rotate(' + (-deg).toFixed(2) + 'deg)';
      var r = prog < 1 ? ((1 - prog) * 7).toFixed(1) + '° off' : 'PLUMB';
      if (r !== lastR) { lastR = r; readout.textContent = r; }
    }
    function complete() {
      if (done) return; done = true;
      level.classList.add('done');
      btn.textContent = 'Level. Plumb. Square.';
      lit.forEach(function (el, i) { setTimeout(function () { el.classList.add('lit'); }, 160 * i); });
    }
    function tick(now) {
      var dt = Math.min(60, now - (lastT || now)); lastT = now;
      if (holding) prog = Math.min(1, prog + dt / HOLD_MS); else prog = Math.max(0, prog - dt / RELEASE_MS);
      paint();
      if (prog >= 1) { complete(); raf = null; lastT = 0; return; }
      if (holding || prog > 0) raf = requestAnimationFrame(tick); else { raf = null; lastT = 0; }
    }
    function start(e) { if (done) return; if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return; if (e.cancelable) e.preventDefault(); holding = true; level.classList.add('holding'); if (raf === null) raf = requestAnimationFrame(tick); }
    function stop() { holding = false; level.classList.remove('holding'); if (raf === null && prog > 0 && !done) raf = requestAnimationFrame(tick); }
    btn.addEventListener('pointerdown', start); btn.addEventListener('pointerup', stop); btn.addEventListener('pointercancel', stop); btn.addEventListener('pointerleave', stop);
    btn.addEventListener('keydown', start); btn.addEventListener('keyup', stop);
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    paint();
    if (reduced) { prog = 1; paint(); complete(); }
    window.__levelComplete = function () { prog = 1; paint(); complete(); };
    window.__levelReset = function () { done = false; prog = 0; level.classList.remove('done'); lit.forEach(function (el) { el.classList.remove('lit'); }); btn.textContent = btn.getAttribute('data-label'); paint(); };
  }

  /* ---------- lightbox ---------- */
  var lb = doc.getElementById('lb');
  if (lb) {
    var lbimg = doc.getElementById('lbimg');
    doc.querySelectorAll('.grid-imgs img, .gallery img, .gallery-full img, .ba-card img').forEach(function (im) {
      im.addEventListener('click', function () { lbimg.src = im.src; lbimg.alt = im.alt || ''; lb.classList.add('open'); });
    });
    lb.addEventListener('click', function () { lb.classList.remove('open'); lbimg.src = ''; });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.classList.remove('open'); });
  }

  /* ---------- designed video player: nothing loads until the visitor asks ---------- */
  doc.querySelectorAll('.player[data-yt]').forEach(function (p) {
    var cover = p.querySelector('.cover');
    if (!cover) return;
    cover.addEventListener('click', function () {
      var f = doc.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + p.getAttribute('data-yt') + '?rel=0&autoplay=1';
      f.title = p.getAttribute('data-title') || 'Video';
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      f.allowFullscreen = true;
      p.appendChild(f); cover.remove();
    });
  });

  /* ---------- lead form: posts to the existing Spire lead endpoint (GoHighLevel via Cloudflare function) ---------- */
  doc.querySelectorAll('form.form[data-lead]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button[type=submit]'), msg = f.querySelector('.msg');
      if (f.querySelector('.hp input') && f.querySelector('.hp input').value) { f.classList.add('sent'); return; }
      var data = {
        fullName: (f.fullName.value || '').trim(), email: (f.email.value || '').trim(), phone: (f.phone.value || '').trim(),
        service: f.service ? f.service.value : '', budget: f.budget ? f.budget.value : '', details: (f.details.value || '').trim(),
        source: 'spireconstructors.com ' + (f.getAttribute('data-lead') || 'form')
      };
      var orig = btn.innerHTML; btn.disabled = true; btn.textContent = 'Sending…'; msg.className = 'msg';
      fetch(LEAD_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { if (!r.ok) throw new Error('request failed'); f.reset(); f.classList.add('sent'); })
        .catch(function () { msg.className = 'msg err'; msg.innerHTML = 'Something went wrong. Please call <a href="tel:18447747342">(844) SPIRE-GC</a> and we will pick up.'; })
        .then(function () { btn.disabled = false; btn.innerHTML = orig; });
    });
  });

  /* ---------- reduced motion, honored live in both directions ---------- */
  function pinToFinalStates() {
    body.classList.add('reduce');
    entr.forEach(function (el) { el.classList.add('in', 'done'); });
    pinCounters();
    if (window.__levelComplete) window.__levelComplete();
    if (plumb) plumb.classList.add('show');
  }
  function unpinFinalStates() { body.classList.remove('reduce'); }
  reduceMQ.addEventListener('change', function (e) {
    reduced = e.matches;
    if (e.matches) pinToFinalStates(); else unpinFinalStates();
    if (window.__applyHeroMode) window.__applyHeroMode();
  });
  window.__pinToFinalStates = pinToFinalStates;
  window.__unpinFinalStates = unpinFinalStates;
})();
