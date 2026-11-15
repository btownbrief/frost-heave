/* Frost Heave: UI, input, rendering. Logic lives in engine.js. */
(function () {
  'use strict';
  var E = window.FHEngine, Art = window.FHArt, Sfx = window.FHSfx;
  var $ = function (id) { return document.getElementById(id); };
  var TAU = Math.PI * 2;
  var LONG_MS = 420, RING_DELAY = 250, REV_MS = 230; // a release before RING_DELAY digs; between the two nothing happens (with a wobble); a full hold cones
  var NUM_COLORS = [null, '#6fc7ff', '#ffe14d', '#ff6b6b', '#f08cff', '#ffffff', '#38e0c0', '#ff8fb8', '#c3c7d4'];

  // ---------- saves (always wrapped) ----------
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('fh.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('fh.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var settings = Object.assign({ sound: true, music: true, haptics: true }, store.get('settings', {}));
  var best = store.get('best', {});
  var stats = Object.assign({ plays: 0, wins: 0 }, store.get('stats', {}));
  var dailyRec = Object.assign({ last: null, streak: 0, bestStreak: 0, times: {} }, store.get('daily', {}));
  var seen = store.get('seen', {});

  // virtual clock so tests can fast-forward (window.__T.step)
  var tOff = 0;
  function now() { return performance.now() + tOff; }

  // ---------- elements ----------
  var app = $('app'), stage = $('stage'), cv = $('board'), ctx = cv.getContext('2d');
  var snowCv = $('snowbg'), snowCtx = snowCv.getContext('2d');
  var tipEl = $('tip'), toastEl = $('toast'), ghostEl = $('ghost');
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  // ---------- game state ----------
  var lvl = null, W = 0, H = 0, N = 0, nbT = null;
  var board = null;                 // { mine, num }
  var rv, revAt, flagAt, hazAt, wrongAt, nopeAt, wobAt, slipAt, dirX, dirY, rot, par, dist, bumpAt, dimA;
  var status = 'title', prevStatus = 'ready', mode = 'dig';
  var flags = 0, revealed = 0, timeAcc = 0, tStart = 0, hinted = 0;
  var startIdx = -1, hitIdx = -1, dailyDate = null, lossT = 0, plowT = -1, plowMineList = [], plowNext = 0;
  var chain = 0, lastRevealT = 0, safeCount = 0;
  var events = [], particles = [];
  var hintCells = null, hintFrom = null, hintUntil = 0;
  var shakeUntil = 0, shakeDur = 1, shakeAmp = 0;
  var pressIdx = -1, kbIdx = -1, kbActive = false;
  var lastResult = null, replay = false, run = null, patched = null, storm = null, slipUsed = false, plowDur = 2200;

  // ---------- view ----------
  var dpr = 1, sw = 0, sh = 0, cs = 30, ox = 0, oy = 0, fitCs = 30, minCs = 20, maxCs = 60;
  var spr = null, numSpr = null, sprNeeded = true;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function layout() {
    var W0 = window.innerWidth, H0 = window.innerHeight;
    app.style.width = W0 + 'px'; app.style.height = H0 + 'px';
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var sw0 = sw, sh0 = sh;
    sw = stage.clientWidth; sh = stage.clientHeight;
    cv.width = Math.round(sw * dpr); cv.height = Math.round(sh * dpr);
    var s = $('snowbg'); s.width = Math.round(W0 / 2); s.height = Math.round(H0 / 2);
    sceneDirty = true;
    if (lvl) {
      var ratio = cs / (fitCs || cs), bx = (sw0 / 2 - ox) / cs, by = (sh0 / 2 - oy) / cs;
      fitView(true);
      var flipped = sw0 && sh0 && (sw0 > sh0) !== (sw > sh);
      if (flipped && status !== 'title' && status !== 'won' && canPan()) { ox = sw / 2 - bx * cs; oy = sh / 2 - by * cs; clampView(); }
      if (status !== 'title' && ratio > 1.05 && sw0 && status !== 'won' && !flipped) { cs = clamp(fitCs * ratio, minCs, maxCs); ox = sw / 2 - bx * cs; oy = sh / 2 - by * cs; clampView(); updateZoomBtn(); }
      camAnim = null;
      if (status === 'won') { cs = fitCs; ox = (sw - W * cs) / 2; oy = (sh - H * cs) / 2; }
      else if (status === 'lost' && !$('result').hidden) setTimeout(liftMistake, 50);
    }
    sprNeeded = true;
  }
  // the night backdrop is drawn once per layout; the horizon sits just above the board
  var sceneDirty = true, sceneHy = 0;
  function drawSceneBg() {
    var sc = $('scene'), W0 = window.innerWidth, H0 = window.innerHeight, d = Math.min(window.devicePixelRatio || 1, 2);
    sc.width = Math.round(W0 * d); sc.height = Math.round(H0 * d);
    var g = sc.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    var st = stage.getBoundingClientRect(), top = lvl && status !== 'title' ? st.top + Math.max(0, oy) - cs * 0.5 : H0 * 0.3;
    sceneHy = clamp(top - 8, H0 * 0.12, H0 * 0.42); Art.drawScene(g, W0, H0, sceneHy, 11);
    sceneDirty = false;
  }
  var lastW = 0, lastH = 0;
  function maybeRelayout() {
    var w = window.innerWidth, h = window.innerHeight;
    // Safari's toolbar changes height only: on touch devices that must never move the layout.
    if (w !== lastW || (!coarse && h !== lastH)) { lastW = w; lastH = h; layout(); return; }
    // touch: ignore height growth (no jumping), but a shrink must re-lay out or the Dig/Cone bar falls off screen
    if (coarse && Math.abs(h - lastH) > 1) { clearTimeout(shrinkT); shrinkT = setTimeout(function relayoutShrink() { if (ptr.size) { shrinkT = setTimeout(relayoutShrink, 200); return; } lastH = window.innerHeight; layout(); }, 220); }
  }
  var shrinkT = 0;

  // the board gets nearly all the space: a slim bed rim (0.35 of a square in all) instead of a puffy snowbank
  function wFit() { return Math.min((sw - 12) / (W + 0.35), 54); }
  function hFit() { return Math.min((sh - 12) / (H + 0.35), 54); }
  var tallRoad = false, playCs = 30;
  function fitView(reset) {
    if (!lvl) return;
    fitCs = Math.max(10, Math.min(wFit(), hFit()));
    minCs = fitCs;
    // a board too tall to show whole at a thumb-sized square (Hard, the weekend Daily, landscape phones) becomes a road
    // you scroll up and down at the width-fit size; zooming out shows the whole road, zooming in stops at the width-fit
    tallRoad = !lvl.storm && fitCs < (coarse ? 27 : 22) && wFit() > fitCs * 1.12; // Storm boards always fit whole
    if (tallRoad) { playCs = Math.max(fitCs, Math.min(wFit(), coarse ? 40 : 34)); maxCs = playCs; }
    else { playCs = fitCs; maxCs = fitCs >= 44 || lvl.storm ? fitCs : Math.max(64, fitCs * 1.5); }
    if (reset) {
      cs = playCs;
      ox = (sw - W * cs) / 2; oy = (sh - H * cs) / 2;
    } else cs = clamp(cs, minCs, maxCs);
    clampView(); updateZoomBtn();
  }
  function clampView() {
    var m = cs * 0.7;
    var bw = W * cs, bh = H * cs;
    ox = bw <= sw + 0.5 ? (sw - bw) / 2 : clamp(ox, sw - bw - m, m);
    oy = bh <= sh + 0.5 ? (sh - bh) / 2 : clamp(oy, sh - bh - m, m);
  }
  function canPan() { return W * cs > sw + 1 || H * cs > sh + 1; }
  function zoomTo(newCs, ax, ay) {
    newCs = clamp(newCs, minCs, maxCs);
    if (newCs === cs) return;
    var k = newCs / cs; ox = ax - (ax - ox) * k; oy = ay - (ay - oy) * k; cs = newCs; clampView(); updateZoomBtn();
  }
  function updateZoomBtn() {
    var b = $('btnZoom'); if (!lvl) return;
    var zoomable = maxCs > minCs + 1;
    b.classList.toggle('spacer', !zoomable);
    b.classList.toggle('out', cs > fitCs * 1.08);
  }
  $('btnZoom').addEventListener('click', function () {
    Sfx.unlock(); Sfx.click();
    var target = cs > fitCs * 1.08 ? fitCs : tallRoad ? playCs : Math.max(fitCs * 1.55, 40);
    animateZoom(target);
  });
  var zoomAnim = null, camAnim = null, lastViewMove = -1e9;
  // free camera move (no clamping): used to show the whole road on a win and to lift the mistake above the result sheet
  function animateCam(tcs, tox, toy, ms) {
    zoomAnim = null; panAnim = null; fling = null;
    camAnim = { t0: now(), dur: ms || 450, fcs: cs, fox: ox, foy: oy, tcs: tcs, tox: tox, toy: toy };
  }
  function animateZoom(target, ax, ay) {
    var from = cs, t0 = now(), cx = sw / 2, cy = sh / 2;
    if (ax !== undefined) { cx = ax; cy = ay; }
    else if (lvl && target > cs && board && lastTapIdx >= 0) { cx = ox + ((lastTapIdx % W) + 0.5) * cs; cy = oy + (Math.floor(lastTapIdx / W) + 0.5) * cs; }
    fling = null;
    zoomAnim = { from: from, to: clamp(target, minCs, maxCs), t0: t0, cx: cx, cy: cy };
  }
  var lastTapIdx = -1;

  // ---------- sprites ----------
  function ensureSprites() {
    var px = Math.ceil(cs * dpr);
    if (!spr || sprNeeded || Math.abs(px - spr.px) / spr.px > (gesture && gesture.kind === 'pinch' ? 0.7 : 0.12)) {
      spr = Art.build(px); numSpr = buildNumbers(px); sprNeeded = false;
    }
  }
  function buildNumbers(px) {
    var out = [null];
    for (var n = 1; n <= 24; n++) {
      var c = document.createElement('canvas'); c.width = c.height = px; var g = c.getContext('2d');
      g.font = '900 ' + Math.round(px * 0.66) + 'px Nunito, "Avenir Next Rounded", "Trebuchet MS", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = px * 0.14; g.strokeStyle = 'rgba(8,8,14,.85)';
      g.strokeText(String(n), px / 2, px * 0.54);
      g.fillStyle = NUM_COLORS[n] || '#ff7468'; g.fillText(String(n), px / 2, px * 0.54);
      out.push(c);
    }
    return out;
  }
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('900 40px Nunito'), document.fonts.load('40px "Lilita One"')]).then(function () { sprNeeded = true; }).catch(function () {});
    // the font stylesheet loads without blocking, so rebuild the number sprites whenever a font arrives
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { sprNeeded = true; });
  }

  Art.onLoad = function () { sprNeeded = true; };

  // ---------- timing helpers ----------
  function at(t, fn) { events.push({ t: t, fn: fn }); }
  function elapsed() { return timeAcc + (status === 'playing' ? now() - tStart : 0); }
  function fmt(ms, tenths) {
    var s = ms / 1000, m = Math.floor(s / 60), r = Math.floor(s % 60);
    var out = m + ':' + (r < 10 ? '0' : '') + r;
    if (tenths) out += '.' + Math.floor((s * 10) % 10);
    return out;
  }
  function buzz(p) { if (settings.haptics && navigator.vibrate && !(navigator.userActivation && !navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(p); } catch (e) {} } }

  // ---------- tips / toasts ----------
  var tipTimer = 0, toastTimer = 0;
  // a tip never sits on squares: it goes in the gap above the board, or (when the board fills the stage) over the HUD row
  // for at most 3 s, and the next touch on the board clears it
  function showTip(msg, ms) {
    tipEl.textContent = msg;
    var inGame = lvl && status !== 'title', rim = Math.max(3, cs * 0.16);
    tipEl.classList.remove('inhud', 'inrail'); tipEl.style.top = '0px'; tipEl.style.left = tipEl.style.width = '';
    var hudEl = $('hud'), rail = getComputedStyle(hudEl).flexDirection === 'column';
    if (rail) { // landscape phones: the HUD is a side rail, so the tip sits at the top of that rail
      tipEl.classList.add('inrail'); tipEl.style.left = (hudEl.offsetLeft + 6) + 'px'; tipEl.style.width = (hudEl.offsetWidth - 12) + 'px';
      tipEl.style.top = '6px'; tipEl.dataset.where = 'hud'; ms = Math.min(ms || 3000, 3000);
    }
    var h = tipEl.offsetHeight, spot = inGame ? noteSpot(h) : -1;
    if (rail) { /* placed above */ }
    else if (spot >= 0) { tipEl.style.top = spot + 'px'; tipEl.dataset.where = 'gap'; }
    else { tipEl.classList.add('inhud'); tipEl.style.top = ($('chipMines').getBoundingClientRect().top - app.getBoundingClientRect().top) + 'px'; tipEl.dataset.where = 'hud'; ms = Math.min(ms || 3000, 3000); }
    tipEl.classList.add('show');
    clearTimeout(tipTimer); tipTimer = setTimeout(function () { tipEl.classList.remove('show'); }, ms || 3800);
  }
  function hideTip(instant) {
    clearTimeout(tipTimer);
    if (instant && tipEl.classList.contains('show')) { tipEl.style.transition = 'none'; tipEl.classList.remove('show'); void tipEl.offsetWidth; tipEl.style.transition = ''; }
    tipEl.classList.remove('show');
  }
  // a free band of the stage above the board (below the Storm clock bar), else below it: top in #app px, or -1 when neither fits
  function noteSpot(h) {
    var rim = Math.max(3, cs * 0.16), above = oy - rim - 6, belowTop = oy + H * cs + rim + 4, below = sh - belowTop;
    if (above >= h + 6) return stage.offsetTop + Math.max(2, (above - h) / 2);
    if (below >= h + 6) return stage.offsetTop + belowTop + Math.max(2, (below - h) / 2);
    return -1;
  }
  // toasts never cover the HUD (and so never the Storm clock) when the board leaves room above or below it
  function toast(msg, ms) {
    toastEl.textContent = msg; toastEl.style.top = toastEl.style.left = toastEl.style.width = ''; toastEl.classList.remove('inrail');
    var hudEl = $('hud'), free = lvl && /^(ready|playing|sweep|won|lost)$/.test(status) && $('sheet').hidden;
    if (free && getComputedStyle(hudEl).flexDirection === 'column') { // landscape phones: at the top of the HUD rail, off the board
      toastEl.classList.add('inrail'); toastEl.style.left = (hudEl.offsetLeft + 6) + 'px'; toastEl.style.width = (hudEl.offsetWidth - 12) + 'px'; toastEl.style.top = '6px';
    } else if (free) { var spot = noteSpot(toastEl.offsetHeight || 44); if (spot >= 0) toastEl.style.top = spot + 'px'; }
    toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 1800);
  }
  function markSeen(k) { if (!seen[k]) { seen[k] = 1; store.set('seen', seen); } }

  // ---------- starting a game ----------
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayLabel(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function isWeekend() { var d = new Date().getDay(); return d === 0 || d === 6; }
  function nextRoadIn() { var d = new Date(), m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) - d, h = Math.floor(m / 3600000); return h + 'h ' + Math.floor(m / 60000) % 60 + 'm'; }
  function yesterdayKey() { var d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function allocState() {
    rv = new Uint8Array(N); revAt = new Float64Array(N); flagAt = new Float64Array(N); hazAt = new Float64Array(N);
    wrongAt = new Float64Array(N); nopeAt = new Float64Array(N); wobAt = new Float64Array(N); slipAt = new Float64Array(N); dirX = new Float32Array(N); dirY = new Float32Array(N);
    rot = new Float32Array(N); par = new Int16Array(N); dist = new Int16Array(N); bumpAt = new Float64Array(N); dimA = new Float32Array(N);
    var r = E.mulberry32(77); for (var i = 0; i < N; i++) rot[i] = (r() - 0.5) * 0.7;
  }

  function startGame(key, opts) {
    opts = opts || {};
    Sfx.unlock();
    var base;
    if (key === 'run') {
      if (!opts.cont || !run) run = { stage: 1, hp: 10, maxHp: 10, xp: 0, level: 1, dug: 0, hits: 0, startBest: best.run || 0, startBestScore: best.runScore || 0, stakes: 2, perks: {}, taken: [], cones: 0 };
      var sp = FHRun.stageSpec(run.stage); run.axleLeft = run.perks.axle || 0; run.stageHits = 0; run.steady = 0; run.steadyPaid = 0; base = { name: 'Pothole Run', w: sp.w, h: sp.h, mines: sp.hazards };
    } else if (key === 'storm') {
      if (!opts.cont || !storm) storm = { stage: 1, bank: STORM_START, dug: 0, cleared: 0, hits: 0, startBest: best.storm || 0, startBestStage: best.stormStage || 0, lastTick: -1 };
      var ss = E.stormSpec(storm.stage); base = { name: 'Storm Shift', w: ss.w, h: ss.h, mines: ss.mines, maxOpen: ss.maxOpen };
    } else base = key === 'daily' ? (isWeekend() ? E.LEVELS.hard : E.LEVELS.medium) : E.LEVELS[key];
    lvl = { key: key, name: key === 'daily' ? 'Daily Road' : base.name, w: base.w, h: base.h, mines: base.mines, daily: key === 'daily', run: key === 'run', storm: key === 'storm' };
    if (lvl.run) lvl.spec = FHRun.stageSpec(run.stage);
    W = lvl.w; H = lvl.h; N = W * H; nbT = E.topo(W, H).nb;
    allocState(); patched = new Uint8Array(N); surveyed = new Uint8Array(N); setProbe(false);
    board = null; replay = false; startIdx = -1; hitIdx = -1; flags = 0; revealed = 0; timeAcc = 0; tStart = 0; hinted = 0; chain = 0; plowT = -1; slipUsed = false; plowDur = 2200;
    events = []; particles = []; texts = []; hintCells = null; lossT = 0; shakeUntil = 0; lastTapIdx = -1; kbIdx = -1; camAnim = null; stamp = null; fling = null;
    status = 'ready'; safeCount = N - lvl.mines; resetHudBits();
    if (opts.seed !== undefined) lvl.seed = opts.seed;
    if (lvl.daily) {
      dailyDate = todayKey();
      var rng = E.mulberry32(E.hashString('frost-heave-daily-' + dailyDate));
      var sx = 1 + Math.floor(rng() * (W - 2)), sy = 1 + Math.floor(rng() * (H - 2));
      startIdx = sy * W + sx;
      board = E.generate(W, H, lvl.mines, startIdx, rng, { maxOpen: base.maxOpen });
    } else if (lvl.storm) { // every stretch arrives with its start area already open, so the clock never waits on a blind tap
      if (opts.seed !== undefined) storm.rng = E.mulberry32(opts.seed); else if (!opts.cont) storm.rng = null;
      var srng = storm.rng || E.mulberry32((Math.random() * 4294967296) >>> 0);
      startIdx = (1 + Math.floor(srng() * (H - 2))) * W + 1 + Math.floor(srng() * (W - 2));
      board = E.generate(W, H, lvl.mines, startIdx, srng, { maxOpen: base.maxOpen }); lvl.mines = board.mines; safeCount = N - board.mines;
    } else if (opts.seed !== undefined) {
      lvl.rng = E.mulberry32(opts.seed);
    }
    document.body.dataset.level = key; document.body.classList.toggle('isrun', !!lvl.run); document.body.classList.toggle('isstorm', !!lvl.storm);
    if (lvl.run && !seen.run) { markSeen('run'); $('runhelp').hidden = false; }
    if (lvl.run && opts.cont && FHRun.hitExtra(run.stage) > FHRun.hitExtra(run.stage - 1)) {
      at(now() + 700, function () { showTip('The ice is meaner from here: every hit costs ' + FHRun.hitExtra(run.stage) + ' extra HP.', 4600); });
    } else if (lvl.run && opts.cont && run.stage > 1 && lvl.spec.maxStr > FHRun.stageSpec(run.stage - 1).maxStr) {
      at(now() + 700, function () { showTip('New on this stretch: strength ' + lvl.spec.maxStr + ' hazards. Numbers still add up the strength nearby.', 4600); });
    }
    hideScreens(); fitView(true); sprNeeded = true; sceneDirty = true;
    setMode('dig');
    updateHud(); setHintBtn();
    $('title').classList.add('gone');
    setTimeout(function () { if (status !== 'title') $('title').hidden = true; }, 320);
    if (board && canPan()) { // big daily road: start with the pre-opened area in view
      ox = sw / 2 - ((startIdx % W) + 0.5) * cs; oy = sh / 2 - (Math.floor(startIdx / W) + 0.5) * cs; clampView();
    }
    if (lvl.storm) {
      var oyT = oy, b0 = board, inMs = opts.cont ? 340 : 380; inputLockUntil = now() + inMs; // no taps while the board slides in
      if (opts.cont) { drawSceneBg(); oy = oyT + sh * 0.85; animateCam(cs, ox, oyT, 320); } // horizon set from where the board lands
      at(now() + inMs, function () {
        if (board !== b0 || status !== 'ready') return;
        openFrom([startIdx], now(), false); lastTapIdx = startIdx; beginPlay();
        if (!seen.first) positionGhost();
      });
      if (!seen.storm) { markSeen('storm'); at(now() + 700, function () { showTip('Beat the clock! Every cleared board adds time.', 3000); }); }
    } else if (board) { inputLockUntil = now() + 380; at(now() + 380, function () { openFrom([startIdx], now(), false); lastTapIdx = startIdx; }); }
    lastViewMove = -1e9;
    if (tallRoad && !seen.tallroad) { markSeen('tallroad'); at(now() + 900, function () { showTip('A long road! Drag up and down to scroll. Dragging never digs.', 3000); }); }
    if (!seen.first && !lvl.run && !lvl.storm) {
      if (board) at(now() + 1000, function () { if (status === 'ready') positionGhost(); }); else positionGhost();
      showTip(board ? 'The road is open here. Tap a square next!' : 'Tap any square. Your first tap is always safe.', 5000);
    }
    store.set('lastLevel', key);
    dirtyHud = true;
  }

  function restartSame() {
    if (!lvl) return;
    if (lvl.run) { startGame('run'); return; }
    if (lvl.storm) { startGame('storm'); return; }
    var key = lvl.key, had = board, st = startIdx, keepBoard = had, status0 = status, hadHazardsShown = hitIdx >= 0, revealed0 = revealed;
    Sfx.click();
    allocState();
    flags = 0; revealed = 0; timeAcc = 0; tStart = 0; hinted = 0; chain = 0; plowT = -1; hitIdx = -1; lossT = 0;
    events = []; particles = []; texts = []; hintCells = null; shakeUntil = 0; status = 'ready'; safeCount = N - lvl.mines; camAnim = null; stamp = null; slipUsed = false; fitView(true);
    board = keepBoard; startIdx = st; replay = !!keepBoard && (status0 === 'lost' || status0 === 'won' || hadHazardsShown || revealed0 > 0 || replay);
    if (!lvl.daily && board) { /* same road: first tap area opens again */ }
    hideScreens(); resetHudBits(); updateHud(); setHintBtn(); setMode('dig');
    if (board) at(now() + 250, function () { openFrom([startIdx], now(), false); });
  }
  function resetHudBits() { $('txtTime').textContent = lvl && lvl.storm ? fmt(Math.ceil(storm.bank / 1000) * 1000) : '0:00'; lastHudSec = -1; $('chipTime').classList.remove('warn'); $('timeFlash').classList.remove('show'); hideTip(); toastEl.classList.remove('show'); $('btnHint').classList.remove('has'); }
  function newRoad() { startGame(lvl.key); }

  function generateFor(i) {
    var rng = lvl.rng || E.mulberry32((Math.random() * 4294967296) >>> 0);
    var t0 = performance.now();
    if (lvl.run) {
      var rs = FHRun.makeStage(lvl.spec, i, rng); var hz = new Uint8Array(N); for (var q = 0; q < N; q++) hz[q] = rs.str[q] ? 1 : 0;
      board = { mine: hz, num: rs.num, str: rs.str }; lvl.mines = rs.hazards; safeCount = N - rs.hazards; updateHud();
    } else board = E.generate(W, H, lvl.mines, i, rng, { maxOpen: (E.LEVELS[lvl.key] || {}).maxOpen });
    startIdx = i;
    lvl.genMs = performance.now() - t0;
  }

  // ---------- core actions ----------
  function beginPlay() {
    if (status === 'ready') { status = 'playing'; tStart = now(); if ((!lvl.run || run.stage === 1) && (!lvl.storm || storm.stage === 1)) { stats.plays++; store.set('stats', stats); } hideGhost(); }
  }
  function openFrom(starts, t0, user) {
    var q = [], s, i, j;
    for (i = 0; i < starts.length; i++) { s = starts[i]; if (rv[s] !== 0) continue; rv[s] = 1; dist[s] = 0; par[s] = -1; q.push(s); }
    var hd = 0, maxd = 0;
    while (hd < q.length) {
      var c = q[hd++]; if (board.num[c] !== 0) continue;
      var l = nbT[c];
      for (j = 0; j < l.length; j++) { var m = l[j]; if (rv[m] === 0) { rv[m] = 1; dist[m] = dist[c] + 1; par[m] = c; if (dist[m] > maxd) maxd = dist[m]; q.push(m); } }
    }
    if (!q.length) return 0;
    var step = maxd > 0 ? Math.min(30, 650 / maxd) : 0, big = q.length > 40;
    for (i = 0; i < q.length; i++) {
      var cc = q[i]; revAt[cc] = t0 + dist[cc] * step + ((cc * 7) % 5);
      if (par[cc] >= 0) { var dx = (cc % W) - (par[cc] % W), dy = Math.floor(cc / W) - Math.floor(par[cc] / W); var len = Math.hypot(dx, dy) || 1; dirX[cc] = dx / len; dirY[cc] = dy / len; }
      else { dirX[cc] = (rot[cc] > 0 ? 1 : -1) * 0.6; dirY[cc] = -0.8; }
      if (!big || i % 2 === 0) (function (idx) { at(revAt[idx] + 30, function () { puff(idx, big ? 1 : 2); }); })(cc);
    }
    revealed += q.length;
    if (user && q.length >= 12) {
      // a plain "+N" in the gap above the board (never over live numbers); a big open also gets a soft whoosh
      var mx = 0; for (i = 0; i < q.length; i++) mx += q[i] % W; mx = mx / q.length + 0.5;
      var popT = t0 + Math.min(650, maxd * step) * 0.35;
      at(popT, function () { texts.push({ txt: '+' + q.length, gx: mx, t0: now() }); if (q.length >= 40) Sfx.whoosh(q.length); });
    }
    if (user) {
      if (maxd === 0) { Sfx.reveal(chain); at(t0, function () { }); }
      else {
        Sfx.reveal(chain);
        var stride = Math.max(1, Math.ceil(maxd / 12));
        for (var d = 1; d <= maxd; d += stride) (function (dd) { at(t0 + dd * step, function () { Sfx.cascadeTick(dd); }); })(d);
        buzz(q.length > 12 ? [12, 20, 18] : 10);
      }
    }
    return q.length;
  }

  function actDig(i) {
    if (status !== 'ready' && status !== 'playing') return;
    lastTapIdx = i;
    if (rv[i] === 2) { nopeAt[i] = now(); Sfx.nope(); showTip('That square has a cone on it. Tap the cone in Cone mode to pick it up.', 2600); return; }
    if (rv[i] === 1) { chord(i); return; }
    var t = now();
    if (!board) generateFor(i);
    beginPlay();
    if (t - lastRevealT > 2500) chain = 0; else chain++;
    lastRevealT = t;
    if (board.mine[i]) { hazardHit(i); return; }
    var first = revealed === 0;
    var gained = openFrom([i], t, true);
    if (lvl.run && run.perks.steady && !run.steadyPaid) { run.steady = (run.steady || 0) + gained; if (run.steady >= 25 && run.stageHits === 0) { run.steadyPaid = 1; if (run.stakes < FHRun.STAKE_CAP) { run.stakes++; setHintBtn(); updateHud(); toast('Steady Hands: +1 stake'); Sfx.hint(); } } }
    afterOpen(gained);
    if (first && lvl.run && run.perks.salt) roadSalt(2 * run.perks.salt);
    if (first && lvl.run && run.perks.radar) groundRadar(run.perks.radar);
  }
  // Ground Radar upgrade: the strongest hidden hazards get found and marked at the start of a stretch
  function groundRadar(k) {
    var b0 = board;
    whenPlaying(now() + 900, b0, function () {
      var list = []; for (var q = 0; q < N; q++) if (rv[q] === 0 && board.mine[q]) list.push(q);
      list.sort(function (a, b) { return board.str[b] - board.str[a] || Math.random() - 0.5; });
      list.slice(0, k).forEach(function (q, j) { at(now() + j * 220, function () { if (board !== b0 || rv[q] !== 0) return; rv[q] = 2; flags++; flagAt[q] = now(); surveyed[q] = 1; bumpAt[q] = now(); puffSmall(q); Sfx.flag(4); updateHud(); }); });
      toast('Ground Radar found ' + Math.min(k, list.length) + ' hazard' + (k > 1 ? 's' : ''));
    });
  }
  // Road Salt upgrade: a few extra safe squares open at the start of each stretch
  function roadSalt(k) {
    var b0 = board;
    whenPlaying(now() + 650, b0, function () {
      var pool = []; for (var q = 0; q < N; q++) if (rv[q] === 0 && !board.mine[q]) pool.push(q);
      var pick = []; while (pick.length < k && pool.length) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      if (!pick.length) return;
      var g = openFrom(pick, now(), false); pick.forEach(function (c) { puffSmall(c); });
      Sfx.whoosh(20); toast('Road Salt: +' + pick.length + ' squares'); afterOpen(g);
    });
  }
  // a dug hazard: Run loses HP, Storm Shift loses time, Classic/Daily forgive the first slip and end on the second
  function hazardHit(i) {
    if (lvl.run) runHit(i);
    else if (lvl.storm) stormHit(i);
    else if (!slipUsed) slip(i);
    else lose(i);
  }
  function markHazardCone(i, t) { rv[i] = 2; flags++; flagAt[i] = t + 120; slipAt[i] = t; bumpAt[i] = t; crumble(i); }
  function slip(i) {
    var t = now(); slipUsed = true; markHazardCone(i, t);
    timeAcc += SLIP_MS; lastHudSec = -1; updateTimer();
    flashChip('Slip! +' + SLIP_MS / 1000 + 's', 'bad'); shake(3, 200); Sfx.slip(); buzz([30, 30, 40]);
    updateHud(); pulseMines();
    if (!seen.slip) { markSeen('slip'); at(t + 500, function () { if (status === 'playing') showTip('One slip is forgiven on every road (+20 s). The next one ends it.', 3000); }); }
  }
  function flashChip(txt, kind) {
    var el = $('timeFlash'); el.textContent = txt; el.className = kind; void el.offsetWidth; el.classList.add('show');
    clearTimeout(flashChip.t); flashChip.t = setTimeout(function () { el.classList.remove('show'); }, 1500);
  }
  function afterOpen(gained) {
    if (lvl.run && gained) { run.dug += gained; gainXp(gained); }
    if (lvl.storm && gained) storm.dug += gained;
    if (!seen.first && !lvl.run) { markSeen('first'); at(now() + 500, function () { if (status === 'playing') showTip('Numbers count the hazards touching a square. Hold a square to plant a cone.', 5200); }); }
    if (revealed >= safeCount && status === 'playing') { if (lvl.run) runClear(); else if (lvl.storm) stormClear(); else win(); }
  }

  function actFlag(i) {
    if (status !== 'ready' && status !== 'playing') return;
    lastTapIdx = i;
    if (rv[i] === 1) { chord(i); return; }
    if (!board) { actDig(i); return; }
    beginPlay();
    if (rv[i] === 2) { rv[i] = 0; flags--; Sfx.unflag(); buzz(6); }
    else { rv[i] = 2; flags++; flagAt[i] = now(); Sfx.flag(); buzz(14); puffSmall(i); checkFlagTip(i); }
    pulseMines(); updateHud();
  }
  function checkFlagTip(i) {
    if (seen.chord || lvl.run) return;
    var l = nbT[i];
    for (var j = 0; j < l.length; j++) {
      var n = l[j]; if (rv[n] !== 1 || board.num[n] === 0) continue;
      var f = 0, h = 0, l2 = nbT[n];
      for (var k = 0; k < l2.length; k++) { if (rv[l2[k]] === 2) f++; else if (rv[l2[k]] === 0) h++; }
      if (f === board.num[n] && h > 0) { markSeen('chord'); showTip('Number satisfied! Tap it to open every square around it.', 4500); return; }
    }
  }

  function chord(i) {
    if (lvl.run) return;
    if (!board || rv[i] !== 1 || board.num[i] === 0) return;
    var l = nbT[i], f = 0, hidden = [], j;
    for (j = 0; j < l.length; j++) { if (rv[l[j]] === 2) f++; else if (rv[l[j]] === 0) hidden.push(l[j]); }
    var t = now();
    // smart cones: if every snowy square around this number must be a hazard, cone them all in one tap
    if (f < board.num[i] && hidden.length && f + hidden.length === board.num[i]) { autoCone(i, hidden, t); return; }
    if (f !== board.num[i]) {
      if (hidden.length) { nopeAt[i] = t; for (j = 0; j < hidden.length; j++) nopeAt[hidden[j]] = t; Sfx.nope(); buzz(25); if (!seen.nope) { markSeen('nope'); showTip(f < board.num[i] ? 'Plant ' + (board.num[i] - f) + ' more cone' + (board.num[i] - f > 1 ? 's' : '') + ' around this number first.' : 'Too many cones around this number.', 3000); } }
      return;
    }
    if (!hidden.length) return;
    beginPlay();
    if (t - lastRevealT > 2500) chain = 0; else chain++;
    lastRevealT = t;
    var safe = [], hit = -1;
    for (j = 0; j < hidden.length; j++) { if (board.mine[hidden[j]]) { if (hit < 0) hit = hidden[j]; } else safe.push(hidden[j]); }
    var gotN = safe.length ? openFrom(safe, t, true) : 0;
    Sfx.chord();
    if (hit >= 0) { if (gotN && lvl.storm) storm.dug += gotN; hazardHit(hit); if (status === 'playing' && revealed >= safeCount) afterOpen(0); return; }
    afterOpen(gotN);
  }

  function autoCone(from, list, t) {
    beginPlay(); bumpAt[from] = t;
    list.forEach(function (c, k) {
      rv[c] = 2; flags++; flagAt[c] = t + k * 70;
      at(t + k * 70, function () { if (rv[c] === 2) { puffSmall(c); Sfx.flag(k); } });
    });
    buzz(list.length > 1 ? [12, 40, 12] : 14);
    if (!seen.smartcone) { markSeen('smartcone'); at(t + 300, function () { if (status === 'playing') showTip('Smart cones! When a number can only mean hazards, tap it and the cones go down.', 4200); }); }
    pulseMines(); updateHud();
    checkFlagTip(list[list.length - 1]);
  }

  // ---------- medals: par times per level (a hinted or practice clear can only earn bronze) ----------
  var PAR = { easy: [30e3, 60e3], medium: [120e3, 240e3], hard: [270e3, 480e3], daily: [120e3, 240e3] };
  var MEDAL_NAMES = ['bronze', 'silver', 'gold'];
  var medals = store.get('medals', {});
  // Hard changed size (16x28 -> 12x32) on Nov 15, so its best time and medal start fresh under a new key
  function bestKey(k) { k = k || lvl.key; return k === 'hard' ? 'hard12' : k; }
  function medalFor(key, ms, clean) { var p = PAR[key === 'daily' && H >= 28 ? 'hard' : key]; if (!p) return -1; if (!clean) return 0; return ms <= p[0] ? 2 : ms <= p[1] ? 1 : 0; }

  // ---------- lose / win ----------
  var LOSE_TITLES = ['Heaved!', 'Pothole!', 'Axle crack!', 'Frost got you', 'Whoa, bump!'];
  function lose(hit) {
    status = 'lost'; timeAcc += now() - tStart; $('txtTime').textContent = fmt(timeAcc); hitIdx = hit; lossT = now(); hideTip();
    var hx = hit % W, hy = Math.floor(hit / W), list = [], i;
    for (i = 0; i < N; i++) {
      var x = i % W, y = Math.floor(i / W), d = Math.hypot(x - hx, y - hy);
      if (board.mine[i] && rv[i] !== 2) { hazAt[i] = lossT + (i === hit ? 0 : 140 + d * 34); list.push({ i: i, t: hazAt[i] }); }
      else if (!board.mine[i] && rv[i] === 2) wrongAt[i] = lossT + 200 + d * 34;
    }
    list.sort(function (a, b) { return a.t - b.t; });
    var ticks = 0;
    for (i = 0; i < list.length && ticks < 14; i += Math.max(1, Math.floor(list.length / 14)), ticks++) (function (k, t) { at(t, function () { Sfx.hazard(k); }); })(ticks, list[i].t);
    for (i = 0; i < list.length; i++) (function (idx) { at(hazAt[idx], function () { crumble(idx); }); })(list[i].i);
    Sfx.lose(); Sfx.duck(3200); buzz([40, 30, 80]);
    shake(10, 520);
    stats.lastLoss = 1; store.set('stats', stats);
    var maxT = list.length ? list[list.length - 1].t - lossT : 0;
    at(lossT + Math.min(1600, Math.max(900, maxT + 400)), function () { if (status === 'lost') showResult(false); });
    updateHud();
  }

  function win() {
    status = 'won'; timeAcc += now() - tStart; hideTip();
    var ms = Math.round(timeAcc), rec = false, i;
    stats.wins++; store.set('stats', stats);
    var bkey = bestKey(), firstClear = !best[bkey] && !hinted && !replay && !lvl.daily;
    if (!hinted && !replay && (!best[bkey] || ms < best[bkey])) { rec = !!best[bkey]; best[bkey] = ms; store.set('best', best); }
    var streakNow = 0;
    if (lvl.daily) {
      var d = dailyDate;
      if (dailyRec.last !== d) {
        {
          dailyRec.streak = dailyRec.last === yesterdayKey() ? dailyRec.streak + 1 : 1;
          dailyRec.bestStreak = Math.max(dailyRec.bestStreak, dailyRec.streak);
          dailyRec.last = d;
        }
      }
      if (!hinted && !replay && (!dailyRec.times[d] || ms < dailyRec.times[d])) dailyRec.times[d] = ms;
      store.set('daily', dailyRec); streakNow = dailyRec.streak;
    }
    var mkey = bestKey(), medal = medalFor(lvl.key, ms, !hinted && !replay), prevMedal = medals[mkey] === undefined ? -1 : medals[mkey];
    if (medal > prevMedal) { medals[mkey] = medal; store.set('medals', medals); }
    lastResult = { win: true, ms: ms, rec: rec && !hinted && !replay, first: firstClear, streak: streakNow, medal: medal, medalUp: medal > prevMedal && prevMedal >= 0 };
    plowMineList = [];
    for (i = 0; i < N; i++) if (board.mine[i] && rv[i] !== 2) plowMineList.push(i);
    plowMineList.sort(function (a, b) { return Math.floor(b / W) - Math.floor(a / W); });
    var lead = showWholeRoad();
    plowNext = 0; plowT = now() + lead; plowRow = -1;
    buzz([20, 40, 20, 40, 60]); Sfx.win(); Sfx.duck(4200);
    celebrate(plowT);
    at(plowT + 2900, function () { if (status === 'won' && $('result').hidden) showResult(true); });
    flags = lvl.mines; updateHud(); $('txtTime').textContent = fmt(timeAcc);
  }
  // ease the camera out so the whole finished road is on screen; returns how long that takes
  function showWholeRoad() {
    var f = Math.max(10, Math.min(wFit(), hFit()));
    var tox = (sw - W * f) / 2, toy = (sh - H * f) / 2;
    if (Math.abs(cs - f) < 0.5 && Math.abs(ox - tox) < 2 && Math.abs(oy - toy) < 2) return 0;
    animateCam(f, tox, toy, 520); return 560;
  }
  // confetti + "ROAD OPEN!" stamp as the plow finishes
  var stamp = null;
  var CONF = ['255,255,255', '169,220,245', '255,138,36']; // snow, ice, cone: the game's own colours, not a party mix
  function celebrate(t0, delay) {
    at(t0 + (delay || 1500), function () {
      if (status !== 'won') return;
      stamp = { txt: lvl.run ? 'STRETCH CLEAR!' : 'ROAD OPEN!', t0: now() };
      Sfx.stamp(); shake(4, 220); buzz(30);
      for (var k = 0; k < 90; k++) {
        var side = k % 2 ? 1 : -1, x = side < 0 ? 0 : sw, a = -Math.PI / 2 + side * -(0.25 + Math.random() * 0.75);
        var sp = 420 + Math.random() * 520;
        addP({ x: x, y: sh * 0.62, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 620, drag: 1.6, life: 0, max: 1.4 + Math.random() * 0.9,
               r: 3.5 + Math.random() * 3.5, c: CONF[k % CONF.length], sq: 1, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14 });
      }
    });
  }

  // ---------- Storm Shift: small no-guess boards against one clock ----------
  var STORM_START = 40000, STORM_CAP = 60000, STORM_PER = 1.6, STORM_DECAY = 0.85, STORM_HIT = 10000, STORM_HINT = 8000, SLIP_MS = 20000;
  function stormLeft() { return storm ? storm.bank - elapsed() : 0; }
  // clearing a board adds 1.6 s per hazard on stretch 1, and the rate shrinks 15% every stretch (S1 +11, S3 +15, S5 +18, S7 +18,
  // S10 +13, S13 +8), never past 60 s on the clock: boards get bigger while the reward fades, so every run ends. Tuned by bot play, see UPGRADE notes.
  function stormBonus(stage, mines) { return Math.max(2, Math.round(STORM_PER * mines * Math.pow(STORM_DECAY, stage - 1))) * 1000; }
  function stormScore() { return storm.dug + 50 * storm.cleared; }
  function stormHit(i) {
    var t = now(); markHazardCone(i, t);
    storm.bank -= STORM_HIT; storm.hits++;
    flashChip('-' + STORM_HIT / 1000 + 's', 'bad'); shake(3, 200); Sfx.slip(); buzz([30, 30, 40]);
    lastHudSec = -1; updateHud(); updateTimer(); pulseMines();
  }
  function stormClear() {
    status = 'sweep'; timeAcc += now() - tStart; hideTip(true); hideGhost(); cancelPress();
    var bonus = stormBonus(storm.stage, lvl.mines), leftNow = Math.max(0, storm.bank - timeAcc);
    // the clock never holds more than 60 s, so a quick player cannot bank a cushion for later boards
    storm.bank = Math.min(STORM_CAP, leftNow + bonus); bonus = storm.bank - leftNow; storm.cleared++; storm.stage++;
    storm.refill = { from: leftNow, t: now() };
    hintCells = null; $('btnHint').classList.remove('has');
    if (stormScore() > (best.storm || 0)) best.storm = stormScore();
    if (storm.cleared > (best.stormStage || 0)) best.stormStage = storm.cleared;
    store.set('best', best);
    timeAcc = 0; lastHudSec = -1; $('txtTime').textContent = fmt(Math.ceil(storm.bank / 1000) * 1000);
    flashChip('+' + Math.max(0, Math.round(bonus / 1000)) + 's', 'good');
    $('chipTime').classList.remove('warn');
    plowMineList = []; for (var q = 0; q < N; q++) if (board.mine[q] && rv[q] !== 2) plowMineList.push(q);
    plowMineList.sort(function (a, b) { return Math.floor(b / W) - Math.floor(a / W); });
    plowNext = 0; plowRow = -1; plowDur = 520; plowT = now();
    Sfx.chord(); Sfx.sweep(); buzz([15, 30, 25]); updateHud();
    var b0 = board;
    at(plowT + plowDur, function () { if (board === b0 && status === 'sweep') animateCam(cs, ox, oy - sh * 0.9, 240); });
    at(plowT + plowDur + 250, function () { if (board === b0 && status === 'sweep') startGame('storm', { cont: true }); });
  }
  function stormOver() {
    if (status !== 'playing') return;
    status = 'lost'; timeAcc += now() - tStart; storm.bank = timeAcc; lossT = now(); hideTip(); hideGhost(); cancelPress();
    $('txtTime').textContent = '0:00'; $('chipTime').classList.add('warn');
    var cx = W / 2, cy = H / 2, list = [], i;
    for (i = 0; i < N; i++) if (board.mine[i] && rv[i] !== 2) { hazAt[i] = lossT + 120 + Math.hypot(i % W - cx, Math.floor(i / W) - cy) * 40; list.push(i); }
    list.forEach(function (idx) { at(hazAt[idx], function () { crumble(idx); }); });
    var sc = stormScore();
    if (sc > (best.storm || 0)) best.storm = sc;
    if (storm.cleared > (best.stormStage || 0)) best.stormStage = storm.cleared;
    store.set('best', best);
    Sfx.lose(); Sfx.duck(3000); buzz([40, 30, 80]);
    at(lossT + 1300, function () { if (status === 'lost') showResult(false); });
    updateHud();
  }

  // ---------- Pothole Run ----------
  function runScore() { return run.dug + 100 * (run.stage - 1); }
  function gainXp(n) {
    run.xp += Math.round(n * (run.perks.night ? 1.5 : 1) * (run.perks.overtime ? 2 : 1));
    var lvlUp = false;
    while (run.xp >= FHRun.xpNeeded(run.level)) { run.xp -= FHRun.xpNeeded(run.level); run.level++; if (run.level % 2 === 0) run.maxHp++; run.hp = Math.min(run.maxHp, run.hp + 1); lvlUp = true; }
    if (lvlUp) { Sfx.levelUp(); buzz([15, 30, 15]); toast('Level ' + run.level + '!  Repaired +1' + (run.level % 2 === 0 ? ' · max HP +1' : ''), 2200); var rb = $('runbar'); rb.classList.remove('lvl'); void rb.offsetWidth; rb.classList.add('lvl'); }
    updateHud();
  }
  function runHit(i) {
    var dmg = board.str[i], t = now(), cost = dmg + FHRun.hitExtra(run.stage), saved = '';
    if (run.perks.shovel && dmg >= 2) { cost--; saved = 'Bucket -1'; }
    if (run.axleLeft > 0) { run.axleLeft--; cost = 0; saved = 'Axle took it!'; }
    if (flags && rv[i] === 2) flags--;
    rv[i] = 1; patched[i] = dmg; revAt[i] = t; dirX[i] = 0; dirY[i] = -1; run.hp -= cost; run.hits++; run.stageHits++;
    var c = cellCenter(i); texts.push({ txt: cost ? '-' + cost + ' HP' : 'No damage', x: c.x, y: c.y - cs * 0.7, t0: t, col: cost ? '#ff6b5b' : '#9fd8ff', sz: 0.8, sub: saved || null });
    run.steady = 0;
    if (cost) $('app').classList.remove('hurt'), void $('app').offsetWidth, $('app').classList.add('hurt');
    crumble(i); shake(5 + dmg * 2, 300); Sfx.hurt(cost); buzz([30, 20, 40]);
    $('chipMines').classList.remove('pulse'); void $('chipMines').offsetWidth; $('chipMines').classList.add('pulse');
    updateHud();
    if (run.hp <= 0) { run.hp = 0; updateHud(); lose(i); return; }
    // the filled hazard stops counting: nearby numbers tick down, and any that reach 0 open the road around them
    var l = nbT[i], zeroes = [], j, myBoard = board;
    for (j = 0; j < l.length; j++) { var n = l[j]; board.num[n] = Math.max(0, board.num[n] - dmg); if (rv[n] === 1 && !patched[n] && board.num[n] === 0) zeroes.push(n); }
    whenPlaying(t + 260, myBoard, function () {
      var tt = now();
      for (j = 0; j < l.length; j++) if (rv[l[j]] === 1 && !patched[l[j]]) bumpAt[l[j]] = tt;
      Sfx.tickDown();
      if (!seen.runfill) { markSeen('runfill'); showTip('Filled! Numbers around it drop by ' + dmg + '. A number that hits 0 opens the road around it.', 5200); }
      if (!zeroes.length) return;
      whenPlaying(tt + 280, myBoard, function () {
        var open = [];
        zeroes.forEach(function (z) { nbT[z].forEach(function (k) { if (rv[k] === 0 && open.indexOf(k) < 0) open.push(k); }); });
        if (!open.length) return;
        var g = openFrom(open, now(), true); afterOpen(g);
      });
    });
  }
  // run fn at time t once the game is being played (waits out a pause); dropped if the board changed or the game ended
  function whenPlaying(t, b, fn) {
    at(t, function () {
      if (board !== b) return;
      if (status === 'paused') { whenPlaying(now() + 150, b, fn); return; }
      if (status === 'playing') fn();
    });
  }
  function runClear() {
    status = 'won'; timeAcc += now() - tStart; hideTip();
    run.stage++; run.hp = Math.min(run.maxHp, run.hp + 2);
    if (!best.run || run.stage - 1 > best.run) { best.run = run.stage - 1; store.set('best', best); }
    var scoreNow = runScore(); if (!best.runScore || scoreNow > best.runScore) { best.runScore = scoreNow; store.set('best', best); }
    // every hazard you never dug pays XP automatically (no cone chores); Road Crew rewards a clean stretch
    var dodged = 0; for (var q = 0; q < N; q++) if (board.mine[q] && !patched[q]) dodged++;
    run.lastDodged = dodged; run.lastClean = run.stageHits === 0;
    if (dodged) gainXp(dodged);
    if (run.perks.crew && run.lastClean) run.hp = Math.min(run.maxHp, run.hp + 2);
    plowMineList = []; for (var i = 0; i < N; i++) if (board.mine[i] && rv[i] === 0) plowMineList.push(i);
    plowMineList.sort(function (a, b) { return Math.floor(b / W) - Math.floor(a / W); });
    plowNext = 0; plowT = now(); Sfx.win(); Sfx.duck(3500); buzz([20, 40, 20, 40, 60]); celebrate(plowT, 1100);
    setProbe(false); updateHud();
    at(plowT + 2500, function () { if (status === 'won' && lvl.run) showPerks(); });
  }

  // ---------- hint ----------
  function setHintBtn() {
    var ok = status === 'ready' || status === 'playing';
    $('btnHint').disabled = !ok || !!(lvl && lvl.run && run.stakes <= 0 && !probing);
    if (lvl && lvl.run) $('stakeN').textContent = run.stakes;
  }
  function useHint() {
    Sfx.unlock();
    if (lvl && lvl.run) { useStake(); return; }
    if (status !== 'ready' && status !== 'playing') return;
    if (!board) { Sfx.click(); showTip('Tap any square first. Your first tap is always safe, then Hint can help.', 3200); return; }
    var view = new Uint8Array(N); for (var i = 0; i < N; i++) view[i] = rv[i] === 1 ? 1 : 0;
    var h = E.hint(W, H, view, board.num);
    if (!h) { showTip('No sure move found. Check your cones for a mistake!', 3000); return; }
    hinted++;
    if (lvl.storm) { storm.bank -= STORM_HINT; flashChip('-' + STORM_HINT / 1000 + 's', 'bad'); lastHudSec = -1; updateTimer(); }
    hintCells = h.cells; hintFrom = h.from || []; hintUntil = now() + 4500;
    Sfx.hint(); buzz(10);
    var flaggedSafe = h.kind === 'safe' && h.cells.some(function (c) { return rv[c] === 2; });
    if (flaggedSafe) showTip('A cone is sitting on a safe square. Pick it up!', 4200);
    else showTip(h.kind === 'safe' ? 'These squares are safe. The glowing numbers prove it.' : 'These squares must be hazards.', 4200);
    $('btnHint').classList.add('has'); panToCells(hintCells);
  }
  function panToCells(list) {
    var minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
    list.forEach(function (c) { var x = c % W, y = Math.floor(c / W); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); });
    var vis = ox + minx * cs >= 0 && ox + (maxx + 1) * cs <= sw && oy + miny * cs >= 0 && oy + (maxy + 1) * cs <= sh;
    if (vis || !canPan()) return;
    panAnim = { t0: now(), fx: ox, fy: oy, tx: sw / 2 - ((minx + maxx + 1) / 2) * cs, ty: sh / 2 - ((miny + maxy + 1) / 2) * cs };
  }
  var panAnim = null;
  $('btnHint').addEventListener('click', useHint);

  // ---------- Pothole Run: survey stakes, upgrades ----------
  var probing = false, surveyed = null;
  function setProbe(on) { probing = !!on; document.body.classList.toggle('probing', probing); if (lvl) setHintBtn(); }
  function useStake() {
    if (status !== 'ready' && status !== 'playing') return;
    if (probing) { setProbe(false); Sfx.click(); hideTip(); return; }
    if (!board) { Sfx.click(); showTip('Dig your first square: it is always safe. Then stakes can check the risky ones.', 3200); return; }
    if (run.stakes <= 0) { Sfx.nope(); return; }
    setProbe(true); Sfx.hint(); buzz(10);
    showTip('Stake ready: tap a snowy square to check it safely.', 3000);
  }
  function survey(i) {
    setProbe(false); hideTip();
    if (rv[i] === 1) return;
    run.stakes--; beginPlay(); setHintBtn();
    var t = now(), c = cellCenter(i);
    if (board.mine[i]) {
      if (rv[i] !== 2) { rv[i] = 2; flags++; flagAt[i] = t; }
      surveyed[i] = 1; bumpAt[i] = t; puffSmall(i); Sfx.flag(3); buzz([10, 30, 10]);
      texts.push({ txt: 'Strength ' + board.str[i], x: c.x, y: c.y - cs * 0.7, t0: t, col: '#ffb066', sz: 0.75 });
    } else {
      if (rv[i] === 2) { rv[i] = 0; flags--; }
      texts.push({ txt: 'Safe!', x: c.x, y: c.y - cs * 0.7, t0: t, col: '#7dffb0', sz: 0.75 });
      actDig(i);
    }
    updateHud();
  }
  function showPerks() {
    var list = FHRun.offer(run, Math.random), box = $('pkList');
    $('pkBadge').textContent = 'Stretch ' + (run.stage - 1) + ' clear!';
    var bits = ['Repaired +2'];
    if (run.lastDodged) bits.push(run.lastDodged + ' hazards dodged: +XP');
    if (run.lastClean) bits.push(run.perks.crew ? 'Clean! Road Crew +2 HP' : 'Clean stretch!');
    bits.push('HP ' + run.hp + '/' + run.maxHp);
    $('pkSub').textContent = bits.join(' · ');
    box.innerHTML = '';
    list.forEach(function (p, k) {
      var b = document.createElement('button'); b.className = 'perk'; b.style.animationDelay = (k * 0.09) + 's';
      var have = run.perks[p.id] || 0;
      b.innerHTML = '<span class="pi">' + FHRun.icon(p.id) + '</span><span><span class="pn">' + p.name + (have ? '<span class="pc">x' + (have + 1) + '</span>' : '') + '</span><span class="pd">' + p.desc + '</span></span>';
      b.addEventListener('click', function () { pickPerk(p.id, b); });
      box.appendChild(b);
    });
    perkLock = now() + 450; // a stray tap from the stretch-clear show can't pick by accident
    $('perks').hidden = false; Sfx.record();
  }
  var perkLock = 0;
  function pickPerk(id, el) {
    if ($('perks').hidden || now() < perkLock) return;
    perkLock = now() + 5000;
    run.perks[id] = (run.perks[id] || 0) + 1; run.taken.push(id);
    if (id === 'tires') { run.maxHp += 2; run.hp = Math.min(run.maxHp, run.hp + 2); }
    else if (id === 'stakes') run.stakes = Math.min(FHRun.STAKE_CAP, run.stakes + 2);
    else if (id === 'thermos') run.hp = Math.min(run.maxHp, run.hp + 4);
    else if (id === 'overtime') { run.maxHp -= 3; run.hp = Math.min(run.hp, run.maxHp); }
    else if (id === 'lightload') { run.maxHp -= 2; run.hp = Math.min(run.hp, run.maxHp); run.stakes = Math.min(FHRun.STAKE_CAP, run.stakes + 3); }
    Sfx.unlock(); Sfx.perk(); buzz([10, 30, 20]);
    var all = $('pkList').querySelectorAll('.perk');
    Array.prototype.forEach.call(all, function (b) { b.classList.add(b === el ? 'picked' : 'gone'); });
    setTimeout(function () { $('perks').hidden = true; if (lvl && lvl.run && status === 'won') startGame('run', { cont: true }); }, el ? 380 : 0);
  }
  $('runhelpGo').addEventListener('click', function () { Sfx.unlock(); Sfx.click(); $('runhelp').hidden = true; });

  // ---------- particles ----------
  function cellCenter(i) { return { x: ox + ((i % W) + 0.5) * cs, y: oy + (Math.floor(i / W) + 0.5) * cs }; }
  function addP(p) { if (particles.length < 420) particles.push(p); }
  function puff(i, n) {
    if (status === 'title') return;
    var c = cellCenter(i);
    for (var k = 0; k < n; k++) {
      var a = Math.random() * TAU, sp = cs * (0.4 + Math.random() * 1.1);
      addP({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cs * 0.3, g: cs * 1.6, life: 0, max: 0.16 + Math.random() * 0.09, r: cs * (0.04 + Math.random() * 0.05), c: '255,255,255', rel: 1 });
    }
  }
  function puffSmall(i) {
    var c = cellCenter(i);
    for (var k = 0; k < 7; k++) { var a = Math.random() * TAU, sp = cs * (0.5 + Math.random()); addP({ x: c.x, y: c.y + cs * 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cs * 0.6, g: cs * 2.4, life: 0, max: 0.4 + Math.random() * 0.2, r: cs * 0.05, c: '255,170,70', rel: 1 }); }
  }
  function crumble(i) {
    var c = cellCenter(i);
    for (var k = 0; k < 9; k++) { var a = Math.random() * TAU, sp = cs * (0.6 + Math.random() * 1.4); addP({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cs * 0.8, g: cs * 3, life: 0, max: 0.5 + Math.random() * 0.3, r: cs * (0.04 + Math.random() * 0.05), c: k % 3 ? '230,245,255' : '40,40,48', rel: 1 }); }
  }
  function popText(txt, idx, t0, col) {
    at(t0 + 60, function () { var c = cellCenter(idx); texts.push({ txt: txt, x: c.x, y: c.y, t0: now(), col: col }); });
  }
  var texts = [];
  function shake(amp, ms) { shakeAmp = amp; shakeDur = ms; shakeUntil = now() + ms; }

  // ---------- rendering ----------
  function pathRR(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function drawRoad(c) {
    if (camAnim && lvl.storm) return; // boards sliding between stretches: no road stretching after them
    var x0 = ox - cs * 0.1, rw = W * cs + cs * 0.2, top = oy - cs * 0.4;
    var hz = sceneHy - stage.getBoundingClientRect().top, vx = x0 + rw / 2, far = rw * 0.08;
    if (top > hz + 2) {
      var g1 = c.createLinearGradient(0, hz, 0, top); g1.addColorStop(0, 'rgba(120,140,170,.05)'); g1.addColorStop(1, 'rgba(120,140,170,.42)');
      c.fillStyle = g1; c.beginPath(); c.moveTo(vx - far, hz); c.lineTo(vx + far, hz); c.lineTo(x0 + rw, top); c.lineTo(x0, top); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(30,45,70,.4)'; c.lineWidth = Math.max(2, cs * 0.16);
      [0.3, 0.7].forEach(function (k) { c.beginPath(); c.moveTo(vx + (k - 0.5) * far * 2, hz); c.lineTo(x0 + rw * k, top); c.stroke(); });
    }
    // nothing below the board: the old faded road there read as a drawing glitch
  }
  // a calm rim: a dark rounded bed about 5 px wide and one thin snow lip along the top edge.
  // In Storm Shift the lip is the clock: its length is the time left (full at 60 s), white, then amber under 20 s, red under 10 s
  function drawFrame(c, t) {
    drawRoad(c);
    var r = Math.max(3, cs * 0.16), bx = ox - r, by = oy - r, bw = W * cs + r * 2, bh = H * cs + r * 2;
    c.fillStyle = 'rgba(0,0,0,.28)'; pathRR(c, bx, by + 3, bw, bh, 10); c.fill();
    c.fillStyle = '#1b1d26'; pathRR(c, bx, by, bw, bh, 10); c.fill();
    if (lvl.storm && storm) {
      var left = Math.max(0, stormLeft()), rf = storm.refill;
      if (rf && t - rf.t < 400) { var rk = clamp((t - rf.t) / 400, 0, 1); left = rf.from + (left - rf.from) * (1 - Math.pow(1 - rk, 3)); }
      var low = left < 10000 && status === 'playing', pk = storm.pulseAt ? (t - storm.pulseAt) / 600 : 1;
      if (low && pk < 1) { c.strokeStyle = 'rgba(255,93,108,' + (0.9 * (1 - pk)) + ')'; c.lineWidth = 3; pathRR(c, bx - 1, by - 1, bw + 2, bh + 2, 11); c.stroke(); }
      var full = bw - 12, len = full * clamp(left / STORM_CAP, 0, 1);
      c.fillStyle = 'rgba(234,242,250,.12)'; pathRR(c, bx + 6, by - 2, full, 5, 2.5); c.fill();
      if (len > 0.5) { c.fillStyle = left > 20000 ? '#eaf2fa' : left > 10000 ? '#ffb347' : '#ff5d6c'; pathRR(c, bx + 6, by - 2, Math.max(len, 5), 5, 2.5); c.fill(); }
    } else if (by > -4) { c.fillStyle = '#eaf2fa'; pathRR(c, bx + 6, by - 1, bw - 12, 3, 1.5); c.fill(); }
  }

  function drawSnow(c, i, px, py, v) { c.drawImage(spr.snow[(i * 7 + (i >> 2)) & 3], px, py, cs, cs); }

  function drawCell(c, i, x, y, t) {
    var px = ox + x * cs, py = oy + y * cs, s = rv[i], v = (i * 5 + (i >> 3)) & 3;
    var haz = hazAt[i] > 0 && t >= hazAt[i];
    var wrong = wrongAt[i] > 0 && t >= wrongAt[i];
    // nope wiggle
    var wig = 0; if (nopeAt[i] && t - nopeAt[i] < 320) wig = Math.sin((t - nopeAt[i]) / 320 * TAU * 2.5) * cs * 0.06 * (1 - (t - nopeAt[i]) / 320);
    if (wobAt[i] && t - wobAt[i] < 120) wig += Math.sin((t - wobAt[i]) / 120 * TAU * 1.5) * 2 * (1 - (t - wobAt[i]) / 120); // a hold let go early
    px += wig;
    if (s === 1) {
      var ra = revAt[i];
      if (t < ra) { drawSnow(c, i, px, py); }
      else {
        var p = (t - ra) / REV_MS;
        c.drawImage(board.num[i] === 0 ? spr.zero : spr.gravel[v], px, py, cs, cs);
        if (patched[i]) {
          c.globalAlpha = 0.9; c.drawImage((i & 1) ? spr.heave[0] : spr.pothole[0], px, py, cs, cs); c.globalAlpha = 1;
          drawBadge(c, px, py, patched[i], 'rgba(255,90,70,.95)');
        } else if (board.num[i] > 0) {
          // finished numbers (nothing left to find around them) fade back so the live ones stand out
          var dimT = (status === 'playing' || status === 'ready' || status === 'paused') && isDone(i) ? 0.38 : 0;
          dimA[i] += (dimT - dimA[i]) * dimK;
          c.globalAlpha = clamp(p * 1.4, 0, 1) * (1 - dimA[i]);
          var sc = p < 1 ? 0.75 + 0.25 * easeOutBack(clamp(p, 0, 1)) : 1;
          var bk = bumpAt[i] ? (t - bumpAt[i]) / 420 : 1;
          if (bk >= 0 && bk < 1) { sc *= 1 + 0.45 * Math.sin(bk * Math.PI) * (1 - bk); c.globalAlpha = 1; }
          c.drawImage(numSpr[Math.min(24, board.num[i])], px + cs * (1 - sc) / 2, py + cs * (1 - sc) / 2, cs * sc, cs * sc);
          if (lvl.run && run.perks.counter) drawPips(c, i, px, py);
          c.globalAlpha = 1;
        } else if (bumpAt[i] && t - bumpAt[i] < 420) { // a Run number that just dropped to 0: a little flash
          var zk = (t - bumpAt[i]) / 420; c.strokeStyle = 'rgba(125,255,176,' + (0.9 * (1 - zk)) + ')'; c.lineWidth = Math.max(2, cs * 0.08); c.beginPath(); c.arc(px + cs / 2, py + cs / 2, cs * (0.15 + zk * 0.4), 0, TAU); c.stroke();
        }
        if (p < 1) {
          var e = 1 - Math.pow(1 - clamp(p, 0, 1), 2);
          c.save(); c.globalAlpha = 1 - e;
          c.translate(px + cs / 2 + dirX[i] * e * cs * 0.6, py + cs / 2 + dirY[i] * e * cs * 0.6);
          c.rotate(rot[i] * e * 2.5); var k = 1 - 0.3 * e; c.scale(k, k);
          c.drawImage(spr.snow[(i * 7 + (i >> 2)) & 3], -cs / 2, -cs / 2, cs, cs);
          c.restore();
        }
      }
    } else if (wrong) {
      c.drawImage(spr.gravel[v], px, py, cs, cs);
      c.drawImage(spr.cone, px, py, cs, cs);
      c.strokeStyle = '#ff4d3d'; c.lineWidth = Math.max(2, cs * 0.1); c.lineCap = 'round';
      c.beginPath(); c.moveTo(px + cs * 0.22, py + cs * 0.22); c.lineTo(px + cs * 0.78, py + cs * 0.78); c.moveTo(px + cs * 0.78, py + cs * 0.22); c.lineTo(px + cs * 0.22, py + cs * 0.78); c.stroke();
    } else if (haz) {
      var hp = clamp((t - hazAt[i]) / 260, 0, 1), hs = 1 + (1 - easeOutBack(hp)) * 0.0;
      var snd = (t - hazAt[i]) / 200;
      c.drawImage((i & 1) ? spr.heave[(i >> 1) & 1] : spr.pothole[(i >> 1) & 1], px, py, cs, cs);
      if (snd < 1) { // snow blown off
        var e2 = clamp(snd, 0, 1);
        c.save(); c.globalAlpha = 1 - e2; c.translate(px + cs / 2, py + cs / 2 - e2 * cs * 0.5); var k2 = 1 + e2 * 0.2; c.scale(k2, k2);
        c.drawImage(spr.snow[(i * 7 + (i >> 2)) & 3], -cs / 2, -cs / 2, cs, cs); c.restore();
      }
      if (lvl.run && board.str && board.str[i] && i !== hitIdx) drawBadge(c, px, py, board.str[i], 'rgba(40,40,52,.92)');
      if (i === hitIdx) {
        var pulse = 0.55 + 0.45 * Math.sin(t / 110);
        c.fillStyle = 'rgba(255,60,40,' + (0.28 + 0.2 * pulse) + ')'; pathRR(c, px + 1, py + 1, cs - 2, cs - 2, cs * 0.14); c.fill();
        c.strokeStyle = 'rgba(255,110,80,.95)'; c.lineWidth = Math.max(2, cs * 0.07); pathRR(c, px + 1.5, py + 1.5, cs - 3, cs - 3, cs * 0.14); c.stroke();
      }
    } else {
      var pressed = (i === pressIdx);
      if (s === 2 && slipAt[i]) { // a dug hazard you survived: it stays visible, with a cone on it
        c.drawImage((i & 1) ? spr.heave[(i >> 1) & 1] : spr.pothole[(i >> 1) & 1], px, py, cs, cs);
        c.strokeStyle = 'rgba(255,107,107,.85)'; c.lineWidth = Math.max(1.5, cs * 0.06); pathRR(c, px + 1.5, py + 1.5, cs - 3, cs - 3, cs * 0.14); c.stroke();
      } else if (pressed && status !== 'lost') { // the finger's square drops 2 px and dims, so you always see which square you have
        drawSnow(c, i, px, py + 2);
        c.fillStyle = 'rgba(16,28,48,.12)'; pathRR(c, px + cs * 0.035, py + 2 + cs * 0.035, cs * 0.93, cs * 0.93, cs * 0.16); c.fill();
      } else drawSnow(c, i, px, py);
      if (s === 2 && t >= flagAt[i]) {
        var fp = clamp((t - flagAt[i]) / 260, 0, 1), sc2 = fp < 1 ? 0.35 + 0.65 * easeOutBack(fp) : 1, yoff = fp < 1 ? -(1 - fp) * cs * 0.35 : 0;
        c.save(); c.translate(px + cs / 2, py + cs * 0.9); c.scale(sc2, sc2); c.drawImage(spr.cone, -cs / 2, -cs * 0.9 + yoff, cs, cs); c.restore();
        if (lvl.run && (status === 'won' || surveyed[i]) && board.str && board.str[i]) drawBadge(c, px, py, board.str[i], surveyed[i] ? 'rgba(255,120,30,.95)' : 'rgba(40,40,52,.92)');
      }
    }
  }
  // Hazard Counter upgrade: little pips = how many hazards (not strength) are still hidden around a Run number
  function drawPips(c, i, px, py) {
    var l = nbT[i], n = 0; for (var j = 0; j < l.length; j++) if (board.mine[l[j]] && !patched[l[j]]) n++;
    if (!n) return;
    var r = Math.max(1.6, cs * 0.055), gap = r * 2.7, x0 = px + cs / 2 - (n - 1) * gap / 2, y0 = py + cs * 0.88;
    c.fillStyle = 'rgba(10,10,16,.75)'; for (j = 0; j < n; j++) { c.beginPath(); c.arc(x0 + j * gap, y0, r + 1, 0, TAU); c.fill(); }
    c.fillStyle = '#ffffff'; for (j = 0; j < n; j++) { c.beginPath(); c.arc(x0 + j * gap, y0, r, 0, TAU); c.fill(); }
  }
  function drawBadge(c, px, py, n, col) {
    c.fillStyle = col; c.beginPath(); c.arc(px + cs * 0.74, py + cs * 0.28, cs * 0.24, 0, TAU); c.fill();
    c.fillStyle = '#fff'; c.font = '900 ' + Math.round(cs * 0.34) + 'px Nunito, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), px + cs * 0.74, py + cs * 0.3);
  }
  // a number is finished when no snowy squares remain around it and (classic) its cones match it
  function isDone(i) {
    var l = nbT[i], f = 0;
    for (var j = 0; j < l.length; j++) { var v = rv[l[j]]; if (v === 0) return false; if (v === 2) f++; }
    return lvl.run ? f === 0 : f === board.num[i];
  }
  var dimK = 0.2;
  function easeOutBack(x) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

  function render(t) {
    if (!lvl || status === 'title') return;
    ensureSprites();
    dimK = clamp(((t - (render.lt || t)) || 16) / 90, 0.05, 1); render.lt = t;
    var c = ctx, sx = 0, sy = 0;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, sw, sh);
    if (t < shakeUntil) { var k = (shakeUntil - t) / shakeDur; sx = (Math.random() - 0.5) * 2 * shakeAmp * k; sy = (Math.random() - 0.5) * 2 * shakeAmp * k; }
    c.translate(sx, sy);
    drawFrame(c, t);
    var x0 = Math.max(0, Math.floor(-ox / cs)), x1 = Math.min(W - 1, Math.floor((sw - ox) / cs));
    var y0 = Math.max(0, Math.floor(-oy / cs)), y1 = Math.min(H - 1, Math.floor((sh - oy) / cs));
    var x, y;
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) drawCell(c, y * W + x, x, y, t);
    var bcx = ox + W * cs * 0.38, bcy = oy + H * cs * 0.3, br = Math.max(W, H) * cs * 0.85;
    var lg = c.createRadialGradient(bcx, bcy, br * 0.15, bcx, bcy, br);
    lg.addColorStop(0, 'rgba(200,225,255,.07)'); lg.addColorStop(0.6, 'rgba(10,18,40,0)'); lg.addColorStop(1, 'rgba(10,18,40,.1)');
    c.fillStyle = lg; c.fillRect(Math.max(ox, 0), Math.max(oy, 0), Math.min(W * cs, sw), Math.min(H * cs, sh));

    // hint glow
    if (hintCells && t < hintUntil) {
      var a = 0.5 + 0.5 * Math.sin(t / 150), fade = clamp((hintUntil - t) / 600, 0, 1), j, h;
      c.lineWidth = Math.max(2, cs * 0.09);
      for (j = 0; j < hintFrom.length; j++) { h = hintFrom[j]; c.strokeStyle = 'rgba(255,225,80,' + (0.55 + 0.4 * a) * fade + ')'; pathRR(c, ox + (h % W) * cs + 1, oy + Math.floor(h / W) * cs + 1, cs - 2, cs - 2, cs * 0.16); c.stroke(); }
      for (j = 0; j < hintCells.length; j++) {
        h = hintCells[j]; var hx = ox + (h % W) * cs, hy = oy + Math.floor(h / W) * cs;
        c.fillStyle = 'rgba(90,255,190,' + (0.18 + 0.2 * a) * fade + ')'; pathRR(c, hx + 1, hy + 1, cs - 2, cs - 2, cs * 0.16); c.fill();
        c.strokeStyle = 'rgba(110,255,200,' + (0.7 + 0.3 * a) * fade + ')'; pathRR(c, hx + 1, hy + 1, cs - 2, cs - 2, cs * 0.16); c.stroke();
      }
    } else if (hintCells) { hintCells = null; $('btnHint').classList.remove('has'); }

    // keyboard cursor
    if (kbActive && kbIdx >= 0 && (status === 'ready' || status === 'playing')) {
      c.strokeStyle = '#ffd84a'; c.lineWidth = Math.max(2, cs * 0.08); pathRR(c, ox + (kbIdx % W) * cs + 1, oy + Math.floor(kbIdx / W) * cs + 1, cs - 2, cs - 2, cs * 0.16); c.stroke();
    }

    // long-press ring
    if (gesture && gesture.kind === 'press' && gesture.timerOn && gesture.idx >= 0 && rv[gesture.idx] !== 1) {
      var pr = (t - gesture.t0 - RING_DELAY) / (LONG_MS - RING_DELAY);
      if (pr > 0) drawRing(c, gesture.idx, pr, 1);
    }
    if (ringDrain) { // let go early: the ring visibly drains back
      var dk = (t - ringDrain.t) / 150;
      if (dk >= 1) ringDrain = null; else drawRing(c, ringDrain.idx, ringDrain.pr * (1 - dk), 1 - dk * 0.5);
    }
    if (ringPop) { // the cone landed: the full ring pops to 1.25x, then lets go
      var rpk = (t - ringPop.t) / 200;
      if (rpk >= 1) ringPop = null; else drawRing(c, ringPop.idx, 1, rpk < 0.6 ? 1 : 1 - (rpk - 0.6) / 0.4, 1 + 0.25 * Math.min(1, rpk / 0.6));
    }

    // the square that went wrong: pops up big with a red glow, then settles slightly raised
    if (status === 'lost' && hitIdx >= 0 && !lvl.run) {
      var lk = clamp((t - lossT) / 520, 0, 1), lsc = 1 + 0.75 * Math.sin(lk * Math.PI) * (1 - lk * 0.6) + 0.12 * lk, lc = cellCenter(hitIdx);
      var lgw = c.createRadialGradient(lc.x, lc.y, 0, lc.x, lc.y, cs * 1.6 * lsc); lgw.addColorStop(0, 'rgba(255,70,40,.55)'); lgw.addColorStop(1, 'rgba(255,70,40,0)');
      c.fillStyle = lgw; c.fillRect(lc.x - cs * 2.6, lc.y - cs * 2.6, cs * 5.2, cs * 5.2);
      c.save(); c.translate(lc.x, lc.y); c.scale(lsc, lsc); c.rotate(Math.sin(lk * Math.PI * 3) * 0.08 * (1 - lk));
      c.drawImage((hitIdx & 1) ? spr.heave[(hitIdx >> 1) & 1] : spr.pothole[(hitIdx >> 1) & 1], -cs / 2, -cs / 2, cs, cs);
      c.strokeStyle = 'rgba(255,120,90,' + (0.7 + 0.3 * Math.sin(t / 110)) + ')'; c.lineWidth = Math.max(2, cs * 0.08); pathRR(c, -cs / 2 + 1, -cs / 2 + 1, cs - 2, cs - 2, cs * 0.14); c.stroke();
      c.restore();
    }
    // ripple ring on loss
    if (status === 'lost' && hitIdx >= 0) {
      var rt = (t - lossT) / 1000, hc = cellCenter(hitIdx);
      if (rt < 1.3) { c.strokeStyle = 'rgba(255,150,100,' + (0.8 * (1 - rt / 1.3)) + ')'; c.lineWidth = cs * 0.14 * (1 - rt / 1.6); c.beginPath(); c.arc(hc.x, hc.y, rt * cs * 14, 0, TAU); c.stroke(); }
    }

    // plow
    if (plowT >= 0) {
      var pp = clamp((t - plowT) / plowDur, 0, 1), ep = pp < 0.5 ? 2 * pp * pp : 1 - Math.pow(-2 * pp + 2, 2) / 2;
      var startY = oy + H * cs + cs * 1.5, endY = oy - cs * 8.5, by = startY + (endY - startY) * ep;
      if (pp < 1 && t >= plowT) Art.drawPlow(c, ox + W * cs / 2, by, W * cs + cs * 0.9, cs, t);
    }
    // "ROAD OPEN!" stamp
    if (stamp) {
      var sk = (t - stamp.t0) / 1000;
      if (sk > 1.6) stamp = null;
      else {
        var sIn = clamp(sk / 0.28, 0, 1), sScale = sk < 0.28 ? 1.7 - 0.7 * easeOutBack(sIn) : 1, sAl = sk > 1.25 ? 1 - (sk - 1.25) / 0.35 : Math.min(1, sk / 0.12);
        var fs = Math.min(sw * 0.13, 58);
        c.save(); c.translate(sw / 2, sh * 0.3); c.rotate(-0.08); c.scale(sScale, sScale); c.globalAlpha = clamp(sAl, 0, 1);
        c.font = '400 ' + Math.round(fs) + 'px "Lilita One", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
        c.lineWidth = fs * 0.28; c.strokeStyle = '#5a2400'; c.strokeText(stamp.txt, 0, fs * 0.08);
        c.lineWidth = fs * 0.16; c.strokeStyle = '#fff6e0'; c.strokeText(stamp.txt, 0, 0);
        var sg = c.createLinearGradient(0, -fs / 2, 0, fs / 2); sg.addColorStop(0, '#ffe08a'); sg.addColorStop(0.55, '#ff9a2e'); sg.addColorStop(1, '#ff6a00');
        c.fillStyle = sg; c.fillText(stamp.txt, 0, 0); c.restore();
      }
    }

    // score pop-ups
    for (var ti = texts.length - 1; ti >= 0; ti--) {
      var tx = texts[ti];
      if (tx.gx !== undefined) { // "+N" lives in the gap above the board, max 20 px, gone in 500 ms
        var gk = (t - tx.t0) / 500; if (gk >= 1) { texts.splice(ti, 1); continue; }
        if (oy < 24) continue; // no gap (a scrolled long road): the cascade itself is the feedback
        var gsz = Math.min(20, oy - 6), gyy = oy - Math.min(oy, 30) / 2 - gk * 4, gxx = clamp(ox + tx.gx * cs, 30, sw - 30);
        c.save(); c.globalAlpha = gk < 0.2 ? gk / 0.2 : 1 - (gk - 0.2) / 0.8;
        c.font = '400 ' + Math.round(gsz) + 'px "Lilita One", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = gsz * 0.2; c.lineJoin = 'round'; c.strokeStyle = 'rgba(10,20,40,.85)'; c.strokeText(tx.txt, gxx, gyy); c.fillStyle = '#ffe14d'; c.fillText(tx.txt, gxx, gyy);
        c.restore(); continue;
      }
      var life = tx.sub ? 1300 : 900, tk = (t - tx.t0) / life;
      if (tk >= 1) { texts.splice(ti, 1); continue; }
      var fsz = Math.max(18, cs * 0.95) * (tx.sz || 1), pin = clamp((t - tx.t0) / 160, 0, 1), psc = 0.5 + 0.5 * easeOutBack(pin);
      var txx = tx.bx !== undefined ? ox + tx.bx * cs : tx.x, tyy = tx.by !== undefined ? oy + tx.by * cs : tx.y;
      if (tx.bx !== undefined) { txx = clamp(txx, fsz * 1.2, sw - fsz * 1.2); tyy = clamp(tyy, fsz * 1.8, sh - fsz * 0.2); }
      c.save(); c.globalAlpha = 1 - tk * tk * tk; c.translate(txx, tyy - (1 - Math.pow(1 - tk, 2)) * cs * 2.2 - cs * 0.5); c.scale(psc, psc);
      c.font = '400 ' + Math.round(fsz) + 'px "Lilita One", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = fsz * 0.22; c.lineJoin = 'round'; c.strokeStyle = 'rgba(10,20,40,.88)';
      c.strokeText(tx.txt, 0, 0); c.fillStyle = tx.col || '#ffe14d'; c.fillText(tx.txt, 0, 0);
      if (tx.sub) { var fs2 = fsz * 0.55; c.font = '400 ' + Math.round(fs2) + 'px "Lilita One", system-ui, sans-serif'; c.lineWidth = fs2 * 0.25; var syy = tx.below ? fsz * 0.72 : -fsz * 0.78; c.strokeText(tx.sub, 0, syy); c.fillStyle = '#ffffff'; c.fillText(tx.sub, 0, syy); }
      c.restore();
    }
    drawMiniMap(c, t, sx, sy);
    // particles
    for (var pi = 0; pi < particles.length; pi++) {
      var p = particles[pi], al = 1 - p.life / p.max; if (al <= 0) continue;
      if (p.sq) { // confetti: a spinning paper strip (cos of the spin fakes the 3D flip)
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = Math.min(1, al * 2.2); c.fillStyle = 'rgb(' + p.c + ')';
        c.fillRect(-p.r, -p.r * 0.45 * Math.abs(Math.cos(p.rot * 1.7)) - 0.5, p.r * 2, p.r * 0.9 * Math.abs(Math.cos(p.rot * 1.7)) + 1); c.restore(); continue;
      }
      c.fillStyle = 'rgba(' + p.c + ',' + (al * 0.9) + ')'; c.beginPath(); c.arc(p.x, p.y, p.r * (0.6 + 0.4 * al), 0, TAU); c.fill();
    }
  }

  // the hold ring is wider than a thumb (at least 64 px across) so it shows around the finger, and stays on screen at the edges
  function drawRing(c, idx, pr, al, sc) {
    var cc = cellCenter(idx), rad = Math.max(cs * 0.8, 32), m = rad * (sc || 1) + 4;
    var x = clamp(cc.x, m, sw - m), y = clamp(cc.y, m, sh - m); rad *= sc || 1;
    c.save(); c.lineCap = 'round'; c.globalAlpha = al;
    c.lineWidth = 7; c.strokeStyle = 'rgba(10,20,34,' + (0.55 * clamp(pr * 3, 0, 1)) + ')'; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.stroke();
    c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,.3)'; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.stroke();
    c.strokeStyle = mode === 'flag' ? '#7fd0ff' : '#ff9a2e'; c.beginPath(); c.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(pr, 0, 1)); c.stroke();
    c.restore();
  }
  var ringDrain = null, ringPop = null;

  // ---------- Hard: mini-map scroll indicator (shows while you pan or zoom, then fades) ----------
  function drawMiniMap(c, t, sx, sy) {
    if (!(status === 'playing' || status === 'ready') || camAnim || (W * cs <= sw + 2 && H * cs <= sh + 2)) return; // only when the road is bigger than the screen
    var since = t - lastViewMove, moving = gesture && (gesture.kind === 'pan' || gesture.kind === 'pinch');
    var a = moving ? 1 : since < 900 ? 1 : 1 - (since - 900) / 400;
    if (a <= 0) return;
    var i, x, y;
    c.save(); c.translate(-sx, -sy); c.globalAlpha = a;
    if (tallRoad && W * cs <= sw + 1) {
      // the long road: a slim scroll strip in the right gutter, outside the board (rows still snowy are lighter)
      var gx = Math.min(sw - 5, ox + W * cs + Math.max(3, cs * 0.16) + 1.5), gy = 6, gh = sh - 12, ru = gh / H;
      c.fillStyle = 'rgba(8,16,28,.7)'; c.fillRect(gx, gy, 4, gh);
      for (y = 0; y < H; y++) { var left = 0; for (x = 0; x < W; x++) if (rv[y * W + x] === 0) left++; if (left) { c.fillStyle = 'rgba(217,233,247,' + (0.25 + 0.5 * left / W) + ')'; c.fillRect(gx, gy + y * ru, 4, Math.ceil(ru)); } }
      var v0 = clamp(-oy / cs, 0, H), v1 = clamp((sh - oy) / cs, 0, H);
      c.fillStyle = '#ffd84a'; c.fillRect(gx - 0.5, gy + v0 * ru, 5, Math.max(6, (v1 - v0) * ru));
      c.restore(); return;
    }
    var mh = Math.min(108, sh * 0.19), u = mh / H, mw = W * u, mx = sw - mw - 10, my = 10;
    c.fillStyle = 'rgba(8,16,28,.82)'; pathRR(c, mx - 4, my - 4, mw + 8, mh + 8, 7); c.fill();
    c.strokeStyle = 'rgba(190,225,255,.35)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#d9e9f7'; c.fillRect(mx, my, mw, mh);
    for (i = 0; i < N; i++) {
      var v = rv[i]; if (v === 0) continue;
      c.fillStyle = v === 1 ? (patched[i] ? '#c25a4a' : '#55545f') : '#ff8a24';
      x = i % W; y = (i - x) / W; c.fillRect(mx + x * u, my + y * u, Math.ceil(u), Math.ceil(u));
    }
    var vx = clamp(-ox / cs, 0, W), vy = clamp(-oy / cs, 0, H), vx2 = clamp((sw - ox) / cs, 0, W), vy2 = clamp((sh - oy) / cs, 0, H);
    c.strokeStyle = '#ffd84a'; c.lineWidth = 2; c.strokeRect(mx + vx * u, my + vy * u, (vx2 - vx) * u, (vy2 - vy) * u);
    c.restore();
  }

  // ---------- per-frame update ----------
  var lastT = 0, plowRow = -1;
  function update(t, dt) {
    if (camAnim) {
      var cp = clamp((t - camAnim.t0) / camAnim.dur, 0, 1), ec = cp < 0.5 ? 4 * cp * cp * cp : 1 - Math.pow(-2 * cp + 2, 3) / 2;
      cs = camAnim.fcs + (camAnim.tcs - camAnim.fcs) * ec; ox = camAnim.fox + (camAnim.tox - camAnim.fox) * ec; oy = camAnim.foy + (camAnim.toy - camAnim.foy) * ec;
      if (cp >= 1) { camAnim = null; sprNeeded = true; updateZoomBtn(); }
    }
    if (zoomAnim) {
      var zp = clamp((t - zoomAnim.t0) / 260, 0, 1), ez = 1 - Math.pow(1 - zp, 3);
      zoomTo(zoomAnim.from + (zoomAnim.to - zoomAnim.from) * ez, zoomAnim.cx, zoomAnim.cy); lastViewMove = t;
      if (zp >= 1) { zoomAnim = null; sprNeeded = true; }
    }
    if (panAnim) {
      var pp0 = clamp((t - panAnim.t0) / 320, 0, 1), ee = 1 - Math.pow(1 - pp0, 3);
      ox = panAnim.fx + (panAnim.tx - panAnim.fx) * ee; oy = panAnim.fy + (panAnim.ty - panAnim.fy) * ee; clampView(); lastViewMove = t;
      if (pp0 >= 1) panAnim = null;
    }
    if (fling) {
      var f0x = ox, f0y = oy;
      ox += fling.vx * dt; oy += fling.vy * dt; clampView(); lastViewMove = t;
      if (Math.abs(ox - f0x) < 0.01) fling.vx = 0; if (Math.abs(oy - f0y) < 0.01) fling.vy = 0; // hit the edge
      var fr = Math.exp(-dt * 4.2); fling.vx *= fr; fling.vy *= fr;
      if (Math.hypot(fling.vx, fling.vy) < 25 || !(status === 'playing' || status === 'ready')) fling = null;
    }
    if (events.length) { // split first, so events scheduled by a running event (or a fresh startGame) are never dropped
      var due = [], keep = [];
      for (var i = 0; i < events.length; i++) (events[i].t <= t ? due : keep).push(events[i]);
      events = keep;
      for (i = 0; i < due.length; i++) due[i].fn();
    }
    for (var k = particles.length - 1; k >= 0; k--) {
      var p = particles[k]; p.life += dt; if (p.life >= p.max) { particles.splice(k, 1); continue; }
      p.vy += p.g * dt; if (p.drag) { var dk = Math.max(0, 1 - p.drag * dt); p.vx *= dk; p.vy *= dk; } p.x += p.vx * dt; p.y += p.vy * dt; if (p.vr) p.rot += p.vr * dt;
    }
    if (plowT >= 0 && (status === 'won' || status === 'sweep') && t >= plowT) {
      var pp = clamp((t - plowT) / plowDur, 0, 1), ep = pp < 0.5 ? 2 * pp * pp : 1 - Math.pow(-2 * pp + 2, 2) / 2;
      var startY = oy + H * cs + cs * 1.5, endY = oy - cs * 8.5, by = startY + (endY - startY) * ep;
      if (pp < 1) {
        for (var s = 0; s < 3; s++) {
          var side = Math.random() < 0.5 ? -1 : 1, bx = ox + W * cs / 2 + (Math.random() - 0.5) * W * cs;
          addP({ x: bx, y: by + cs * 0.4, vx: side * cs * (1 + Math.random() * 3), vy: -cs * (1 + Math.random() * 3), g: cs * 4, life: 0, max: 0.5 + Math.random() * 0.4, r: cs * (0.05 + Math.random() * 0.1), c: '255,255,255' });
        }
        while (plowNext < plowMineList.length) {
          var mi = plowMineList[plowNext], my = oy + (Math.floor(mi / W) + 0.5) * cs;
          if (my > by - cs * 0.2) { rv[mi] = 2; flagAt[mi] = t; puffSmall(mi); plowNext++; } else break;
        }
        var row = Math.floor((by - oy) / cs);
        if (row >= 0 && row < H && row !== plowRow) { plowRow = row; for (var rx = 0; rx < W; rx++) { var ri = row * W + rx; if (rv[ri] === 1 && board.num[ri] > 0) bumpAt[ri] = t + rx * 12; } }
        if (Math.floor(pp * 14) !== Math.floor(plowT * 0) && Math.random() < 0.3) { /* engine texture handled in audio */ }
      } else { while (plowNext < plowMineList.length) { var m2 = plowMineList[plowNext++]; rv[m2] = 2; flagAt[m2] = t; } }
    }
  }

  var dirtyHud = true, lastHudSec = -1;
  function updateHud() {
    if (!lvl) return;
    if (lvl.run) {
      $('txtMines').textContent = run.hp + '/' + run.maxHp;
      $('chipMines').classList.toggle('warn', run.hp <= 3);
      $('runTxt').textContent = 'Stretch ' + run.stage + '  ·  Level ' + run.level;
      $('stakeN').textContent = run.stakes;
      $('runXp').style.width = Math.round(run.xp / FHRun.xpNeeded(run.level) * 100) + '%';
      dirtyHud = false; return;
    }
    var left = lvl.mines - flags;
    $('txtMines').textContent = String(left);
    $('chipMines').classList.toggle('warn', left < 0);
    $('chipMines').classList.toggle('slipped', slipUsed);
    if (lvl.storm) {
      $('runTxt').textContent = 'Stretch ' + storm.stage + '  ·  Score ' + stormScore() + (storm.startBest ? '  ·  Best ' + Math.max(storm.startBest, stormScore()) : '');
      $('stakeN').textContent = '-' + STORM_HINT / 1000 + 's';
    }
    dirtyHud = false;
  }
  function pulseMines() { var c = $('chipMines'); c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); }
  function updateTimer() {
    if (!lvl) return;
    if (lvl.storm) {
      var left = stormLeft();
      if (left <= 0 && status === 'playing') { stormOver(); return; }
      var ls = Math.ceil(Math.max(0, left) / 1000);
      if (ls !== lastHudSec) {
        lastHudSec = ls; $('txtTime').textContent = fmt(ls * 1000);
        var low = ls <= 10 && status === 'playing';
        $('chipTime').classList.toggle('warn', low);
        if (low && ls !== storm.lastTick) { storm.lastTick = ls; storm.pulseAt = now(); Sfx.tick(ls <= 5); var ch = $('chipTime'); ch.classList.remove('pulse'); void ch.offsetWidth; ch.classList.add('pulse'); }
      }
      return;
    }
    var s = Math.floor(elapsed() / 1000);
    if (s !== lastHudSec) { lastHudSec = s; $('txtTime').textContent = fmt(elapsed()); }
  }

  // ---------- snow background ----------
  var flakes = [];
  (function () { var r = Math.random; var n = (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 0 : 14; for (var i = 0; i < n; i++) flakes.push({ x: r(), y: r(), r: 0.6 + r() * 1.9, v: 0.02 + r() * 0.05, ph: r() * 6.28, d: 0.02 + r() * 0.03 }); })();
  var lastSnow = 0;
  function drawSnowBg(ts, dt) {
    if (ts - lastSnow < 33) return; lastSnow = ts;
    var c = snowCtx, w = snowCv.width, h = snowCv.height, k = w / Math.max(1, window.innerWidth);
    c.clearRect(0, 0, w, h);
    // flakes fall only in the sky band between the HUD and the board: never over the HUD, the board or the bottom bar
    if (!lvl || status === 'title') return;
    var top = stage.offsetTop, band = Math.min(oy, sh) - Math.max(3, cs * 0.16) - 6;
    if (band < 24) return;
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i]; f.y += f.v * 0.033 * 2.5; f.x += Math.sin(ts / 1500 + f.ph) * f.d * 0.033;
      if (f.y > 1) { f.y = 0; f.x = Math.random(); }
      var fy = f.y < 0.15 ? f.y / 0.15 : f.y > 0.85 ? (1 - f.y) / 0.15 : 1;
      c.fillStyle = 'rgba(255,255,255,' + (0.5 * fy) + ')'; c.beginPath(); c.arc(f.x * w, (top + f.y * band) * k, f.r * 0.8, 0, TAU); c.fill();
    }
  }

  // ---------- main loop ----------
  var running = true;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!running) return;
    var t = now(), dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000)); lastT = t;
    drawSnowBg(ts, dt);
    if (sceneDirty) drawSceneBg();
    if (lvl && status !== 'title') { update(t, dt); if (status === 'playing') updateTimer(); render(t); }
  }
  requestAnimationFrame(frame);

  // ---------- input ----------
  var ptr = new Map(), gesture = null, fling = null, inputLockUntil = 0;
  function localPos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function cellAt(p) {
    var x = Math.floor((p.x - ox) / cs), y = Math.floor((p.y - oy) / cs);
    return (x >= 0 && y >= 0 && x < W && y < H) ? y * W + x : -1;
  }
  function cancelPress() { if (gesture && gesture.timer) { clearTimeout(gesture.timer); gesture.timer = 0; gesture.timerOn = false; } if (gesture && gesture.lateWait) { clearTimeout(gesture.lateWait); gesture.lateWait = 0; } pressIdx = -1; }

  function primaryAction(i, inverse) {
    if (lvl.run && probing && board) { survey(i); return; }
    var useFlag = (mode === 'flag') !== !!inverse;
    if (rv[i] === 1) { chord(i); return; }
    if (!board) { actDig(i); return; }
    if (useFlag) actFlag(i); else actDig(i);
  }

  cv.addEventListener('pointerdown', function (e) {
    e.preventDefault(); Sfx.unlock(); kbActive = false;
    // impatient? a tap during the win show jumps to the result
    if (lvl && status === 'won' && !lvl.run && plowT >= 0 && now() > plowT + 600 && $('result').hidden) { showResult(true); return; }
    if (!lvl || (status !== 'ready' && status !== 'playing') || now() < inputLockUntil) return;
    try { cv.setPointerCapture(e.pointerId); } catch (er) {}
    if (tipEl.dataset.where === 'hud' && tipEl.classList.contains('show')) hideTip();
    var p = localPos(e);
    ptr.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    hideGhost();
    var stopper = !!(fling && Math.hypot(fling.vx, fling.vy) > 260); fling = null;
    if (ptr.size === 1) {
      var idx = cellAt(p);
      gesture = { kind: 'press', id: e.pointerId, idx: idx, t0: now(), timer: 0, timerOn: false, long: false, type: e.pointerType, lx: p.x, ly: p.y, downTs: e.timeStamp || performance.now(), armT: performance.now() };
      if (stopper) { gesture.kind = 'stopper'; pressIdx = -1; return; } // catching a moving road only stops it
      if (e.pointerType === 'mouse') {
        if (e.button === 2) { if (idx >= 0) primaryAction(idx, true); gesture.kind = 'dead'; return; }
        if (e.button !== 0) { gesture.kind = 'dead'; return; }
        pressIdx = idx >= 0 && rv[idx] !== 1 ? idx : -1;
      } else if (idx >= 0) {
        pressIdx = rv[idx] !== 1 ? idx : -1;
        if (rv[idx] !== 1 && board && !(cs < 25 && maxCs > cs * 1.25)) {
          gesture.timerOn = true; gesture.armed = true;
          var g0 = gesture;
          var commitLong = function () {
            if (gesture !== g0 || gesture.kind !== 'press') return;
            gesture.long = true; gesture.timerOn = false; gesture.lateWait = 0; gesture.flash = now(); ringPop = { idx: gesture.idx, t: now() }; pressIdx = -1;
            var before = rv[gesture.idx];
            primaryAction(gesture.idx, true);
            gesture.coneFlip = (before === 0 && rv[gesture.idx] === 2) || (before === 2 && rv[gesture.idx] === 0);
          };
          gesture.timer = setTimeout(function () {
            if (gesture !== g0 || gesture.kind !== 'press') return;
            // the page was busy and this timer is late: a finger that already lifted may be queued, so let it decide
            if (performance.now() - g0.armT > LONG_MS + 45) { g0.lateWait = setTimeout(commitLong, 90); return; }
            commitLong();
          }, LONG_MS);
        }
      }
    } else if (ptr.size === 2) {
      cancelPress();
      var pts = Array.from(ptr.values());
      gesture = { kind: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, cs0: cs, mx0: (pts[0].x + pts[1].x) / 2, my0: (pts[0].y + pts[1].y) / 2, ox0: ox, oy0: oy };
    } else { cancelPress(); gesture = { kind: 'dead' }; }
  }, { passive: false });

  cv.addEventListener('pointermove', function (e) {
    var g = ptr.get(e.pointerId); if (!g || !gesture) return;
    var p = localPos(e), dx = p.x - g.x, dy = p.y - g.y; g.x = p.x; g.y = p.y;
    if ((gesture.kind === 'press' || gesture.kind === 'stopper') && gesture.id === e.pointerId) {
      var thr = e.pointerType === 'mouse' ? 6 : canPan() ? 10 : 18;
      if (Math.hypot(p.x - g.sx, p.y - g.sy) > thr && !gesture.long) {
        cancelPress();
        gesture = canPan() ? { kind: 'pan', id: e.pointerId, vx: 0, vy: 0, lt: e.timeStamp || performance.now() } : { kind: 'dead' };
        if (gesture.kind === 'pan') { ox += p.x - g.sx; oy += p.y - g.sy; clampView(); lastViewMove = now(); }
      }
    } else if (gesture.kind === 'pan' && gesture.id === e.pointerId) {
      ox += dx; oy += dy; clampView(); lastViewMove = now();
      var tn = e.timeStamp || performance.now(), dtm = Math.max(4, tn - gesture.lt), kk = Math.min(1, dtm / 50); gesture.lt = tn;
      gesture.vx += (dx / dtm * 1000 - gesture.vx) * kk; gesture.vy += (dy / dtm * 1000 - gesture.vy) * kk;
    } else if (gesture.kind === 'pinch' && ptr.size >= 2) {
      var pts = Array.from(ptr.values()), d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      var ncs = clamp(gesture.cs0 * d / gesture.d0, minCs * 0.98, maxCs);
      var bx = (gesture.mx0 - gesture.ox0) / gesture.cs0, by = (gesture.my0 - gesture.oy0) / gesture.cs0;
      cs = ncs; ox = mx - bx * cs; oy = my - by * cs; clampView(); updateZoomBtn(); lastViewMove = now();
    }
  });

  function endPointer(e, cancelled) {
    var g = ptr.get(e.pointerId); if (!g) return;
    var p = localPos(e); ptr.delete(e.pointerId); var wasPinch = gesture && gesture.kind === 'pinch';
    if (gesture && gesture.kind === 'press' && gesture.id === e.pointerId) {
      var wasLong = gesture.long, idx0 = gesture.idx;
      if (gesture.lateWait) { // the hold timer fired late: the event times say whether this was a hold or a tap
        clearTimeout(gesture.lateWait); gesture.lateWait = 0;
        if ((e.timeStamp || performance.now()) - gesture.downTs >= LONG_MS && !cancelled && idx0 >= 0) { gesture.flash = now(); ringPop = { idx: idx0, t: now() }; cancelPress(); primaryAction(idx0, true); gesture = ptr.size ? { kind: 'dead' } : null; if (!ptr.size) { pressIdx = -1; try { cv.releasePointerCapture(e.pointerId); } catch (er) {} } return; }
      }
      cancelPress();
      // the hold fired, but the event times say the finger lifted early (the page was busy): it was a tap after all
      if (wasLong && gesture.coneFlip && !cancelled && (e.timeStamp || 0) && e.timeStamp - gesture.downTs < LONG_MS - 40 && (status === 'ready' || status === 'playing')) {
        actFlag(idx0); wasLong = false;
      }
      var heldMs = (e.timeStamp || performance.now()) - (gesture.downTs || 0);
      if (!cancelled && !wasLong && idx0 >= 0 && gesture.armed && heldMs >= RING_DELAY && rv[idx0] === 0 && board) {
        // the ring was filling: lifting early means "never mind", but never silently
        cancelled = true; wobAt[idx0] = now(); Sfx.soft(); buzz(4);
        ringDrain = { idx: idx0, pr: clamp((heldMs - RING_DELAY) / (LONG_MS - RING_DELAY), 0.08, 1), t: now() };
        if (!seen.holdcancel) { markSeen('holdcancel'); showTip('Let go early and nothing happens. Hold until the ring fills for a cone.', 3000); }
      }
      if (!cancelled && !wasLong && idx0 >= 0) {
        var inside = p.x >= 0 && p.y >= 0 && p.x <= sw && p.y <= sh;
        // zoomed all the way out on a big road, squares are too small for a thumb: the tap zooms in there instead
        var tiny = e.pointerType !== 'mouse' && cs < 25 && maxCs > cs * 1.25 && board;
        if (inside && tiny && (status === 'ready' || status === 'playing')) {
          animateZoom(Math.max(fitCs * 1.55, 34), p.x, p.y); Sfx.click();
          if (!seen.tapzoom) { markSeen('tapzoom'); showTip('Zoomed out, squares are tiny, so a tap zooms in there. The zoom button (bottom right) zooms back out.', 4200); }
        } else if (inside && (status === 'ready' || status === 'playing')) primaryAction(idx0, false);
      }
      if (!ptr.size) gesture = null;
      else gesture = { kind: 'dead' };
    } else if (!ptr.size) {
      if (gesture && gesture.kind === 'pan' && !cancelled && (e.timeStamp || performance.now()) - gesture.lt < 90) {
        var sp = Math.hypot(gesture.vx, gesture.vy);
        if (sp > 140) { var cap = Math.min(1, 3200 / sp); fling = { vx: gesture.vx * cap, vy: gesture.vy * cap }; }
      }
      gesture = null;
    }
    else if (gesture && gesture.kind === 'pinch') { var rem = Array.from(ptr.keys())[0]; gesture = canPan() ? { kind: 'pan', id: rem } : { kind: 'dead' }; sprNeeded = true; }
    if (!ptr.size) { pressIdx = -1; if (wasPinch) sprNeeded = true; try { cv.releasePointerCapture(e.pointerId); } catch (er) {} }
  }
  cv.addEventListener('pointerup', function (e) { endPointer(e, false); });
  cv.addEventListener('pointercancel', function (e) { endPointer(e, true); });
  cv.addEventListener('lostpointercapture', function (e) { if (ptr.has(e.pointerId)) endPointer(e, true); });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault(); if (!lvl || maxCs <= minCs + 1) return;
    var p = localPos(e); zoomTo(cs * Math.exp(-e.deltaY * 0.0015), p.x, p.y); sprNeeded = true; lastViewMove = now();
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); }); });
  document.addEventListener('touchmove', function (e) { if (e.target === cv || stage.contains(e.target)) e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });

  // keyboard
  document.addEventListener('keydown', function (e) {
    if (!lvl || status === 'title') return;
    if (e.key === 'Escape') { if (status === 'paused') resume(); else if (status === 'playing' || status === 'ready') pause(); return; }
    if (status !== 'ready' && status !== 'playing') return;
    var k = e.key.toLowerCase(), handled = true;
    Sfx.unlock();
    if (kbIdx < 0) kbIdx = startIdx >= 0 ? startIdx : Math.floor(H / 2) * W + Math.floor(W / 2);
    var x = kbIdx % W, y = Math.floor(kbIdx / W);
    if (k === 'arrowleft' || k === 'a') x = Math.max(0, x - 1);
    else if (k === 'arrowright' || k === 'd') x = Math.min(W - 1, x + 1);
    else if (k === 'arrowup' || k === 'w') y = Math.max(0, y - 1);
    else if (k === 'arrowdown' || k === 's') y = Math.min(H - 1, y + 1);
    else if (k === ' ' || k === 'enter') { kbActive = true; if (rv[kbIdx] === 1) chord(kbIdx); else actDig(kbIdx); }
    else if (k === 'f' || k === 'x') { kbActive = true; actFlag(kbIdx); }
    else if (k === 'h') useHint();
    else if (k === 'm') setMode(mode === 'dig' ? 'flag' : 'dig');
    else if (k === 'r') restartSame();
    else handled = false;
    if (handled) { e.preventDefault(); kbActive = true; kbIdx = y * W + x; }
  });

  // ---------- mode toggle ----------
  function setMode(m) {
    mode = m;
    $('modeSeg').classList.toggle('flag', m === 'flag');
    $('btnDig').classList.toggle('on', m === 'dig'); $('btnFlag').classList.toggle('on', m === 'flag');
    $('btnDig').setAttribute('aria-checked', m === 'dig'); $('btnFlag').setAttribute('aria-checked', m === 'flag');
  }
  $('btnDig').addEventListener('click', function () { Sfx.unlock(); if (mode !== 'dig') { Sfx.click(); buzz(6); } setMode('dig'); });
  $('btnFlag').addEventListener('click', function () { Sfx.unlock(); if (mode !== 'flag') { Sfx.click(); buzz(6); } setMode('flag'); if (!seen.modeflag) { markSeen('modeflag'); showTip('Cone mode: tap to plant a cone. Hold a square to dig instead.', 3800); } });

  // ---------- ghost hand ----------
  function positionGhost() {
    if (seen.first) return;
    var cx = ox + (W / 2) * cs, cy = oy + (H / 2) * cs;
    if (board && startIdx >= 0) { var tgt = ghostTarget(); var c = cellCenter(tgt >= 0 ? tgt : startIdx); cx = c.x; cy = c.y; }
    ghostEl.style.left = cx + 'px'; ghostEl.style.top = cy + 'px'; ghostEl.hidden = false;
  }
  function hideGhost() { ghostEl.hidden = true; }
  // a square the numbers prove safe (the same logic as Hint), nearest the middle of the screen; if the solver finds none,
  // any safe snowy square bordering the opening
  function ghostTarget(anySafe) {
    var bestI = -1, bd = 1e9, proven = null;
    if (!anySafe) {
      var view = new Uint8Array(N); for (var v = 0; v < N; v++) view[v] = rv[v] === 1 ? 1 : 0;
      var hh = E.hint(W, H, view, board.num);
      if (hh && hh.kind === 'safe') { proven = {}; hh.cells.forEach(function (q) { if (rv[q] === 0) proven[q] = 1; }); }
      if (!proven || !Object.keys(proven).length) return ghostTarget(true);
    }
    for (var i = 0; i < N; i++) { if (rv[i] !== 0 || board.mine[i] || (proven && !proven[i])) continue; var l = nbT[i], edge = false; for (var j = 0; j < l.length; j++) if (rv[l[j]] === 1) edge = true; if (!edge) continue;
      var c = cellCenter(i), d = Math.hypot(c.x - sw / 2, c.y - sh * 0.45); if (c.x < cs || c.x > sw - cs || c.y < cs || c.y > sh - cs * 2) d += 1e5; if (d < bd) { bd = d; bestI = i; } }
    return bestI < 0 && !anySafe ? ghostTarget(true) : bestI;
  }

  // ---------- screens, results ----------
  function hideScreens() { $('sheet').hidden = true; $('result').hidden = true; $('perks').hidden = true; }

  function showResult(won) {
    var r = $('result');
    var stat = function (v, l, countMs) { return '<div class="stat"><b' + (countMs ? ' data-ms="' + countMs + '"' : '') + '>' + v + '</b><span>' + l + '</span></div>'; };
    var html = '', sub = '';
    $('rBadge').hidden = true; $('rMedal').hidden = true; $('rNext').hidden = true;
    if (won) {
      $('rTitle').textContent = lvl.daily ? 'Daily road open!' : 'Road open!';
      sub = replay ? 'Practice run: no best time' : lvl.daily ? dayLabel(dailyDate) + (hinted ? ' · hinted run' : '') + ' · next road in ' + nextRoadIn() : lvl.name + (hinted ? ' · hinted run (no best time)' : '');
      html += stat(fmt(lastResult.ms, true), 'Time', lastResult.ms);
      var b = best[bestKey()]; html += stat(b ? fmt(b, true) : '--', 'Best');
      if (lvl.daily) html += stat(dailyRec.streak + (dailyRec.streak === 1 ? ' day' : ' days'), 'Streak');
      else html += stat(String(stats.wins), 'Roads cleared');
      html += stat(String(hinted), hinted === 1 ? 'Hint used' : 'Hints used');
      var badge = lastResult.rec ? 'New best!' : lastResult.first ? 'First clear!' : (lvl.daily && !replay && dailyRec.streak >= 2) ? dailyRec.streak + '-day streak!' : null;
      if (badge) { $('rBadge').hidden = false; $('rBadge').textContent = badge; Sfx.record(); }
      if (lastResult.medal >= 0) {
        var md = $('rMedal'); md.className = 'medal ' + MEDAL_NAMES[lastResult.medal]; md.hidden = false; Sfx.medal(lastResult.medal); buzz([0, 520, 20, 60, 30]);
        md.querySelector('span').textContent = MEDAL_NAMES[lastResult.medal][0].toUpperCase() + MEDAL_NAMES[lastResult.medal].slice(1) + (lastResult.medalUp ? ' · upgraded!' : '');
        void md.offsetWidth; md.style.animation = 'none'; void md.offsetWidth; md.style.animation = '';
        if (lastResult.medal < 2 && PAR[lvl.key]) {
          var goal = PAR[lvl.daily && H >= 28 ? 'hard' : lvl.key][lastResult.medal === 0 ? 1 : 0];
          $('rNext').textContent = (hinted || replay) ? 'Clear it without hints for silver or gold.' : 'Clear it in ' + fmt(goal) + ' for ' + MEDAL_NAMES[lastResult.medal + 1] + '.';
          $('rNext').hidden = false;
        }
      }
    } else if (lvl.run) {
      $('rTitle').textContent = 'Road closed!';
      var cleared = run.stage - 1;
      var names = {}; run.taken.forEach(function (id) { var p = FHRun.PERKS.filter(function (q) { return q.id === id; })[0]; if (p) names[p.name] = (names[p.name] || 0) + 1; });
      var nl = Object.keys(names).map(function (k) { return k + (names[k] > 1 ? ' x' + names[k] : ''); });
      sub = 'Out of HP on stretch ' + run.stage + '.' + (nl.length ? ' Upgrades: ' + nl.join(', ') + '.' : ' Tip: low numbers next to each other are the safest place to dig.');
      html += stat(String(cleared), cleared === 1 ? 'Stretch cleared' : 'Stretches cleared'); html += stat(String(run.level), 'Level');
      var sc = runScore(), prevBestScore = run.startBestScore || 0;
      if (sc > (best.runScore || 0)) { best.runScore = sc; store.set('best', best); }
      html += stat(String(sc), 'Score'); html += stat(String(best.runScore || sc), 'Best score');
      if (sc > prevBestScore) { $('rBadge').hidden = false; $('rBadge').textContent = 'New best!'; Sfx.record(); }
    } else if (lvl.storm) {
      $('rTitle').textContent = 'Snowed in!';
      var ssc = stormScore();
      sub = 'Out of time on stretch ' + storm.stage + '.';
      html += stat(String(ssc), 'Score'); html += stat(String(Math.max(best.storm || 0, ssc)), 'Best score');
      html += stat(String(storm.cleared), storm.cleared === 1 ? 'Board cleared' : 'Boards cleared'); html += stat(String(best.stormStage || storm.cleared), 'Best boards');
      if (ssc > storm.startBest && ssc > 0) { $('rBadge').hidden = false; $('rBadge').textContent = 'New best!'; Sfx.record(); }
    } else {
      var lt = (hitIdx & 1) ? ['Heaved!', 'Frost heave!', 'Whoa, bump!'] : ['Pothole!', 'Axle crack!', 'Clunk!'];
      $('rTitle').textContent = lt[(stats.plays + revealed) % lt.length];
      var pct = Math.floor(revealed / safeCount * 100);
      sub = pct + '% cleared.';
      html += stat(fmt(timeAcc, true), 'Time'); var lb = best[bestKey()]; html += stat(lb ? fmt(lb, true) : '--', 'Best');
    }
    $('rSub').textContent = sub; $('rStats').innerHTML = html;
    var again = $('rAgain'), same = $('rSame');
    // after a loss the quick retry is the main button; after a win, a fresh road is
    again.className = 'big primary'; same.className = 'big';
    if (!won) {
      if (lvl.daily) { again.textContent = 'Try again'; same.hidden = true; again.dataset.act = 'same'; }
      else { again.textContent = 'New road'; same.textContent = 'Retry (practice)'; same.hidden = false; again.dataset.act = 'new'; same.dataset.act = 'same'; }
    } else {
      if (lvl.daily) { again.textContent = 'Back to title'; again.dataset.act = 'menu'; same.textContent = 'Practice this road'; same.hidden = false; same.dataset.act = 'same'; }
      else { again.textContent = 'New road'; again.dataset.act = 'new'; same.textContent = 'Retry this road'; same.hidden = false; same.dataset.act = 'same'; }
    }
    if (lvl.run || lvl.storm) { again.textContent = 'Run again'; again.dataset.act = 'new'; same.hidden = true; }
    $('rShare').hidden = !(won && lvl.daily);
    $('rMenu').hidden = (won && lvl.daily);
    r.hidden = false; r.classList.remove('peek'); $('runhelp').hidden = true; setHintBtn();
    if (!won && !lvl.run && !lvl.storm && !seen.peek) { markSeen('peek'); at(now() + 1800, function () { if (status === 'lost' && !r.hidden) showTip('Tap the board above to hide this and study the road.', 3200); }); }
    // the time ticks up to the final value
    Array.prototype.forEach.call(r.querySelectorAll('[data-ms]'), function (el) {
      var to = +el.dataset.ms, t0 = performance.now();
      (function tick() { var k = Math.min(1, (performance.now() - t0) / 650), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e, true); if (k < 1 && !r.hidden) requestAnimationFrame(tick); else el.textContent = fmt(to, true); })();
    });
    if (!won && hitIdx >= 0) liftMistake();
  }
  // after a loss, slide the board up so the square that went wrong sits above the result sheet
  function liftMistake() {
    if (getComputedStyle($('result')).alignItems !== 'flex-end') return; // landscape: the sheet is centred, nothing to lift above
    var panel = $('result').querySelector('.panel'), top = panel.offsetTop - stage.offsetTop;
    var hy = Math.floor(hitIdx / W), hitBottom = oy + (hy + 1) * cs, want = top - cs * 1.2;
    if (hitBottom <= want) return;
    var lift = hitBottom - want, maxLift = oy + hy * cs - cs * 0.6; // keep the mistake below the HUD
    lift = Math.min(lift, Math.max(0, maxLift));
    if (lift > 2) animateCam(cs, ox, oy - lift, 480);
  }
  $('result').addEventListener('click', function (e) {
    if (e.target !== this || status !== 'lost') return;
    var peek = this.classList.toggle('peek'); Sfx.click();
    if (peek) showTip('Here is the road. Tap again for your results.', 2600); else hideTip();
  });
  function resultAct(el) { Sfx.click(); var a = el.dataset.act; if (a === 'menu') showTitle(); else if (a === 'new') newRoad(); else restartSame(); }
  $('rAgain').addEventListener('click', function () { resultAct(this); });
  $('rSame').addEventListener('click', function () { resultAct(this); });
  $('rMenu').addEventListener('click', function () { Sfx.click(); showTitle(); });
  $('rShare').addEventListener('click', function () {
    var mi = ['🥉', '🥈', '🥇'][lastResult.medal] || '', wk = ''; for (var di = 6; di >= 0; di--) { var dd = new Date(); dd.setDate(dd.getDate() - di); var dk = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0'); wk += dailyRec.times[dk] ? '🟧' : '⬜'; }
    var txt = 'Frost Heave · Daily Road ' + dailyDate + (H >= 28 ? ' (big road)' : '') + '\n' + mi + ' ' + fmt(lastResult.ms, true) + (hinted ? ' (hinted)' : '') + ' · streak ' + dailyRec.streak + '\n' + wk;
    if (navigator.share) { navigator.share({ text: txt }).catch(function () {}); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(function () { toast('Copied to clipboard'); }, function () { toast('Could not copy'); }); }
  });

  function pause() {
    if (status !== 'playing' && status !== 'ready') return;
    prevStatus = status;
    if (status === 'playing') timeAcc += now() - tStart;
    status = 'paused'; cancelPress(); ptr.clear(); gesture = null;
    $('sheet').hidden = false; syncSettingsUi();
    $('shRestart').textContent = lvl.run || lvl.storm ? 'Abandon run, start over' : 'Restart this road'; $('shNew').hidden = !!(lvl.run || lvl.storm);
  }
  function resume() {
    if (status !== 'paused') return;
    status = prevStatus; if (status === 'playing') tStart = now();
    $('sheet').hidden = true; Sfx.resume(); setHintBtn();
  }
  $('btnMenu').addEventListener('click', function () { Sfx.unlock(); Sfx.click(); if (status === 'playing' || status === 'ready') pause(); else if (status === 'won' || status === 'lost') showTitle(); });
  $('shResume').addEventListener('click', function () { Sfx.click(); resume(); });
  $('shRestart').addEventListener('click', function () {
    if (lvl && (lvl.run || lvl.storm)) { if (!(restartArmed && now() - restartArmed < 2500)) { restartArmed = now(); toast('Tap again to abandon this run'); Sfx.click(); return; } restartArmed = 0; } status = prevStatus === 'playing' ? 'playing' : 'ready'; if (status === 'playing') { tStart = now(); } restartSame(); });
  $('shNew').addEventListener('click', function () { if (lvl.daily) { status = 'ready'; restartSame(); } else startGame(lvl.key); });
  $('shQuit').addEventListener('click', function () { Sfx.click(); showTitle(); });
  $('btnRestart').addEventListener('click', function () {
    Sfx.unlock();
    if (status === 'ready' && !board) return;
    if (lvl && lvl.run) return; // a run can't be restarted from here (the button is hidden in Run)
    if (status === 'playing' && revealed > 0 && !(restartArmed && now() - restartArmed < 2500)) { restartArmed = now(); toast(lvl.storm ? 'Tap again to start the run over' : 'Tap again to restart (practice, no best time)'); Sfx.click(); return; }
    restartArmed = 0; if (status === 'paused') status = 'ready'; restartSame();
  });
  var restartArmed = 0;

  function showTitle() {
    status = 'title'; hideScreens(); $('runhelp').hidden = true; setProbe(false); hideTip(); hideGhost(); ptr.clear(); gesture = null; fling = null;
    refreshTitle(); var t = $('title'); t.hidden = false; void t.offsetWidth; t.classList.remove('gone');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); setHintBtn();
  }
  function refreshTitle() {
    var today = todayKey();
    $('dailyDate').textContent = dayLabel(today) + (isWeekend() ? ' · big road' : '');
    var streak = (dailyRec.last === today || dailyRec.last === yesterdayKey()) ? dailyRec.streak : 0;
    var meta = dailyRec.last === today && dailyRec.times[today] ? 'Cleared ' + fmt(dailyRec.times[today], true) : (dailyRec.last === today ? 'Cleared today' : 'New road today');
    if (streak) meta += '\n' + streak + '-day streak';
    if (dailyRec.bestStreak > Math.max(1, streak)) meta += (streak ? ' · ' : '\n') + 'best ' + dailyRec.bestStreak;
    $('dailyMeta').textContent = meta;
    $('bestStorm').textContent = best.storm ? 'Best ' + best.storm + '\n' + (best.stormStage || 0) + (best.stormStage === 1 ? ' board' : ' boards') : '40 s on the clock';
    $('bestRun').textContent = best.runScore ? 'Best ' + best.runScore + ' · ' + (best.run || 0) + ' stretch' + (best.run === 1 ? '' : 'es') : best.run ? 'Best ' + best.run + (best.run === 1 ? ' stretch' : ' stretches') : '';
    ['easy', 'medium', 'hard'].forEach(function (k) {
      var bk = bestKey(k), el = $('best' + k[0].toUpperCase() + k.slice(1)), m = medals[bk];
      el.innerHTML = (m >= 0 ? '<i class="mdot ' + MEDAL_NAMES[m] + '"></i>' : '<i class="mdot none"></i>') + (best[bk] ? fmt(best[bk]) : '');
    });
    var wk = '', d0 = new Date();
    for (var di = 6; di >= 0; di--) { var dd = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - di), dk = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
      wk += '<b class="' + (dailyRec.times[dk] || (dailyRec.last === dk) ? 'on' : '') + (di === 0 ? ' today' : '') + '"></b>'; }
    $('dailyWeek').innerHTML = wk;
    syncSettingsUi();
  }

  // ---------- settings ----------
  function applyAudio() {
    Sfx.setSound(settings.sound); Sfx.setMusic(settings.music && settings.sound);
    Sfx.wantMusic(settings.music && settings.sound);
    $('btnSound').classList.toggle('off', !settings.sound);
  }
  function syncSettingsUi() {
    var s = settings;
    $('shSound').textContent = 'Sound: ' + (s.sound ? 'on' : 'off');
    $('shMusic').textContent = 'Music: ' + (s.music ? 'on' : 'off');
    $('shHaptics').textContent = 'Buzz: ' + (s.haptics ? 'on' : 'off');
    [['btnTitleSound', s.sound, 'Sound'], ['btnTitleMusic', s.music, 'Music'], ['btnTitleHaptics', s.haptics, 'Vibration']].forEach(function (b) {
      $(b[0]).classList.toggle('off', !b[1]); $(b[0]).setAttribute('aria-pressed', String(!!b[1])); $(b[0]).setAttribute('aria-label', b[2] + (b[1] ? ' on' : ' off'));
    });
    $('btnSound').classList.toggle('off', !s.sound);
  }
  function toggle(k) { settings[k] = !settings[k]; store.set('settings', settings); Sfx.unlock(); applyAudio(); syncSettingsUi(); if (k === 'haptics' && settings.haptics) buzz(15); Sfx.click(); }
  ['btnTitleSound', 'shSound', 'btnSound'].forEach(function (id) { $(id).addEventListener('click', function () { toggle('sound'); }); });
  ['btnTitleMusic', 'shMusic'].forEach(function (id) { $(id).addEventListener('click', function () { toggle('music'); }); });
  ['btnTitleHaptics', 'shHaptics'].forEach(function (id) { $(id).addEventListener('click', function () { toggle('haptics'); }); });

  $('btnHelp').addEventListener('click', function () { Sfx.unlock(); Sfx.click(); $('help').hidden = false; });
  $('helpClose').addEventListener('click', function () { Sfx.click(); $('help').hidden = true; });
  document.querySelectorAll('[data-play]').forEach(function (b) {
    b.addEventListener('click', function () { var k = b.getAttribute('data-play'); applyAudio(); Sfx.unlock(); Sfx.click(); startGame(k); });
  });

  // ---------- lifecycle ----------
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      running = false; hiddenAt = now(); Sfx.suspend();
      if (ptr.size) { ptr.clear(); cancelPress(); gesture = null; }
    } else {
      // the clock must not run while the tab was hidden
      if (hiddenAt && status === 'playing') tStart += now() - hiddenAt;
      hiddenAt = 0; running = true; lastT = now();
      var settle = (lvl && lvl.key) ? 0 : 0; if (status !== 'paused') Sfx.resume();
    }
  });
  window.addEventListener('resize', maybeRelayout);
  window.addEventListener('orientationchange', function () { setTimeout(function () { lastW = 0; maybeRelayout(); }, 250); });
  window.addEventListener('blur', function () { if (ptr.size) { ptr.clear(); cancelPress(); gesture = null; } });

  // ---------- test hooks ----------
  window.__T = {
    start: function (key, seed) { startGame(key || 'easy', seed !== undefined ? { seed: seed } : {}); return this.state(); },
    step: function (ms) { tOff += ms; var t = now(); update(t, ms / 1000); if (status === 'playing') updateTimer(); render(t); return this.state(); },
    state: function () {
      return { status: status, mode: mode, level: lvl && lvl.key, w: W, h: H, mines: lvl && lvl.mines, flags: flags, revealed: revealed, safe: safeCount,
        elapsed: Math.round(elapsed()), hinted: hinted, tall: tallRoad, maxCs: maxCs, hasBoard: !!board, startIdx: startIdx, hit: hitIdx, cs: cs, ox: ox, oy: oy, sw: sw, sh: sh, fitCs: fitCs, genMs: lvl && lvl.genMs };
    },
    cellXY: function (i) { var c = cellCenter(i), r = cv.getBoundingClientRect(); return { x: r.left + c.x, y: r.top + c.y }; },
    reveal: function (i) { actDig(i); return this.state(); },
    flag: function (i) { actFlag(i); return this.state(); },
    chord: function (i) { chord(i); return this.state(); },
    setMode: setMode,
    hint: function () { useHint(); return hintCells; },
    truth: function () { return board ? { mine: Array.from(board.mine), num: Array.from(board.num) } : null; },
    cells: function () { return Array.from(rv); },
    // play the whole board with the logic solver (what a perfect player does); optional stopAt = cells left to leave
    solve: function (leave) {
      var guard = 0;
      while ((status === 'playing' || status === 'ready') && guard++ < 4000 && (leave === undefined || safeCount - revealed > leave)) {
        if (!board) { actDig(Math.floor(H / 2) * W + Math.floor(W / 2)); continue; }
        var view = new Uint8Array(N); for (var i = 0; i < N; i++) view[i] = rv[i] === 1 ? 1 : 0;
        var h = E.hint(W, H, view, board.num); if (!h || h.kind !== 'safe') break;
        for (var j = 0; j < h.cells.length; j++) if (rv[h.cells[j]] === 0) actDig(h.cells[j]);
      }
      return this.state();
    },
    flagAllMines: function () { for (var i = 0; i < N; i++) if (board && board.mine[i] && rv[i] === 0) actFlag(i); return this.state(); },
    // digs hidden hazards until the road is lost (Classic forgives one slip, so that takes two); Storm Shift runs the clock out
    lose: function () {
      if (lvl && lvl.storm) { if (status === 'ready' || status === 'playing') { if (status === 'ready') beginPlay(); storm.bank = elapsed(); updateTimer(); } return this.state(); }
      for (var k = 0; k < 3 && board && (status === 'ready' || status === 'playing'); k++) { for (var i = 0; i < N; i++) if (board.mine[i] && rv[i] === 0) { actDig(i); break; } if (lvl.run) break; }
      return this.state();
    },
    stormInfo: function () { return storm ? { stage: storm.stage, left: Math.round(stormLeft()), bank: storm.bank, dug: storm.dug, cleared: storm.cleared, hits: storm.hits, score: stormScore() } : null; },
    slipUsed: function () { return slipUsed; },
    showTitle: showTitle, pause: pause, resume: resume,
    clearSaves: function () { try { localStorage.clear(); } catch (e) {} },
    settings: function () { return settings; },
    runInfo: function () { return run ? { hp: run.hp, maxHp: run.maxHp, stage: run.stage, level: run.level, xp: run.xp, stakes: run.stakes, perks: run.perks, taken: run.taken, patched: patched ? Array.from(patched) : [], surveyed: surveyed ? Array.from(surveyed) : [] } : null; },
    pickPerk: function (k) { var b = document.querySelectorAll('#pkList .perk')[k || 0]; if (b) b.click(); return !!b; },
    probing: function () { return probing; }
  };

  // ---------- demo states for screenshots / reviewers: index.html?demo=<level>-<state> ----------
  // levels: easy medium hard daily; states: play, flags, hint, lose, win. ?demo=title shows the title.
  function runDemo(name) {
    var parts = name.split('-'), key = parts[0], st = parts[1] || 'play';
    if (!E.LEVELS[key] && key !== 'daily' && key !== 'run' && key !== 'storm') return;
    if (key === 'storm' && /^s\d+$/.test(st)) { storm = null; startGame('storm', { seed: 4242 }); storm.stage = +st.slice(1); startGame('storm', { cont: true }); window.__T.step(1200); return; }
    startGame(key, key === 'daily' ? {} : { seed: 4242 });
    $('runhelp').hidden = true; // demo states skip the first-run rules card
    var T = window.__T;
    if (!board) actDig(Math.floor(H / 2) * W + Math.floor(W / 2));
    T.step(1200);
    if (st === 'hit') { for (var hi = 0; hi < N; hi++) { if (board.mine[hi] && rv[hi] === 0 && nbT[hi].some(function (j) { return rv[j] === 1; })) { actDig(hi); break; } } T.step(250); }
    else if (st === 'flags' || st === 'hint') {
      var n = 0; for (var i = 0; i < N && n < 3; i++) if (board.mine[i] && rv[i] === 0) { var x = i % W, y = Math.floor(i / W), adj = false; nbT[i].forEach(function (j) { if (rv[j] === 1) adj = true; }); if (adj) { actFlag(i); n++; } }
      if (st === 'hint') { setMode('flag'); useHint(); }
      T.step(500);
    } else if (st === 'lose') { T.lose(); T.step(450); }
    else if (st === 'lose2') { T.lose(); T.step(2200); }
    else if (st === 'win') { T.solve(); }
    else if (st === 'win2') { T.solve(); T.step(3000); }
  }

  // ---------- boot ----------
  lastW = window.innerWidth; lastH = window.innerHeight;
  layout();
  applyAudio();
  refreshTitle();
  var demoName = (location.search.match(/[?&]demo=([\w-]+)/) || [])[1];
  if (demoName) setTimeout(function () { runDemo(demoName); }, 50);
})();
