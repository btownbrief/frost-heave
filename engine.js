/* Frost Heave engine: board generation + logic solver. Pure functions, no DOM.
   Runs in the browser (window.FHEngine) and in node (require). Deterministic for a given seed. */
(function (root) {
  'use strict';

  // ---------- seeded random ----------
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) { // FNV-1a
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------- topology (neighbour tables, cached per size) ----------
  var topoCache = {};
  function topo(w, h) {
    var key = w + 'x' + h;
    if (topoCache[key]) return topoCache[key];
    var n = w * h, nb = new Array(n);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var list = [];
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) list.push(ny * w + nx);
        }
        nb[y * w + x] = Int16Array.from(list);
      }
    }
    return (topoCache[key] = { w: w, h: h, n: n, nb: nb });
  }

  // ---------- the solver ----------
  // st: 0 unknown, 1 revealed, 2 known mine. num[i] is only read for revealed cells.
  // Rules: (1) single-cell: number satisfied -> neighbours safe; unknowns == need -> all mines.
  //        (2) pair/overlap: two numbers sharing squares. d = needA - needB.
  //            d == |A\B|  -> A\B all hazards, B\A all safe (and the mirror).
  // opts.first: stop at the first deduction and return it (used by Hint) instead of applying it.
  function solve(T, num, st, first) {
    var n = T.n, nb = T.nb;
    var act = [];
    var i, a, j, k;
    for (i = 0; i < n; i++) if (st[i] === 1 && num[i] > 0) act.push(i);
    var newAct = [];
    var stack = [];
    var stamp = new Int32Array(n);
    var stampId = 0;

    function reveal(c) {
      if (st[c] !== 0) return;
      st[c] = 1;
      if (num[c] !== 0) { newAct.push(c); return; }
      stack.push(c);
      while (stack.length) {
        var cur = stack.pop(), l = nb[cur];
        for (var q = 0; q < l.length; q++) {
          var m = l[q];
          if (st[m] === 0) {
            st[m] = 1;
            if (num[m] === 0) stack.push(m); else newAct.push(m);
          }
        }
      }
    }

    for (;;) {
      // ---- singles, repeated until quiet ----
      var changed = true;
      while (changed) {
        changed = false;
        k = 0;
        for (a = 0; a < act.length; a++) {
          i = act[a];
          var l = nb[i], unk = 0, mines = 0;
          for (j = 0; j < l.length; j++) { var s = st[l[j]]; if (s === 0) unk++; else if (s === 2) mines++; }
          if (unk === 0) continue;
          var need = num[i] - mines;
          if (need === 0) {
            if (first) { var sf = []; for (j = 0; j < l.length; j++) if (st[l[j]] === 0) sf.push(l[j]); return { kind: 'safe', cells: sf, from: [i] }; }
            for (j = 0; j < l.length; j++) if (st[l[j]] === 0) reveal(l[j]);
            changed = true;
          } else if (need === unk) {
            if (first) { var mf = []; for (j = 0; j < l.length; j++) if (st[l[j]] === 0) mf.push(l[j]); return { kind: 'mine', cells: mf, from: [i] }; }
            for (j = 0; j < l.length; j++) if (st[l[j]] === 0) st[l[j]] = 2;
            changed = true;
          } else {
            act[k++] = i;
          }
        }
        act.length = k;
        if (newAct.length) { for (j = 0; j < newAct.length; j++) act.push(newAct[j]); newAct.length = 0; changed = true; }
      }
      if (!act.length) break;

      // ---- pair rules ----
      var cons = [], cellCons = {};
      for (a = 0; a < act.length; a++) {
        i = act[a];
        var ln = nb[i], cells = [], m2 = 0;
        for (j = 0; j < ln.length; j++) { var sv = st[ln[j]]; if (sv === 0) cells.push(ln[j]); else if (sv === 2) m2++; }
        if (!cells.length) continue;
        var ci = cons.length;
        cons.push({ cells: cells, need: num[i] - m2, src: i });
        for (j = 0; j < cells.length; j++) (cellCons[cells[j]] || (cellCons[cells[j]] = [])).push(ci);
      }
      var foundSafe = [], foundMine = [], foundFrom = null;
      var seen = new Int32Array(cons.length);
      var mark = stamp;
      for (var ai = 0; ai < cons.length; ai++) {
        var A = cons[ai];
        stampId++;
        for (j = 0; j < A.cells.length; j++) mark[A.cells[j]] = stampId;
        for (j = 0; j < A.cells.length; j++) {
          var lst = cellCons[A.cells[j]];
          for (var q = 0; q < lst.length; q++) {
            var bi = lst[q];
            if (bi <= ai || seen[bi] === ai + 1) continue;
            seen[bi] = ai + 1;
            var B = cons[bi], common = 0;
            for (var z = 0; z < B.cells.length; z++) if (mark[B.cells[z]] === stampId) common++;
            var aOnly = A.cells.length - common, bOnly = B.cells.length - common;
            var d = A.need - B.need;
            if (d === aOnly && (aOnly > 0 || bOnly > 0)) {
              for (z = 0; z < A.cells.length; z++) if (mark[A.cells[z]] === stampId && !inCells(B.cells, A.cells[z])) foundMine.push(A.cells[z]);
              for (z = 0; z < B.cells.length; z++) if (mark[B.cells[z]] !== stampId) foundSafe.push(B.cells[z]);
              foundFrom = foundFrom || [A.src, B.src];
            }
            if (-d === bOnly && (aOnly > 0 || bOnly > 0)) {
              for (z = 0; z < B.cells.length; z++) if (mark[B.cells[z]] !== stampId) foundMine.push(B.cells[z]);
              for (z = 0; z < A.cells.length; z++) if (!inCells(B.cells, A.cells[z])) foundSafe.push(A.cells[z]);
              foundFrom = foundFrom || [A.src, B.src];
            }
          }
        }
        if (first && (foundSafe.length || foundMine.length)) break;
      }
      if (!foundSafe.length && !foundMine.length) break; // stuck
      if (first) {
        if (foundSafe.length) return { kind: 'safe', cells: uniq(foundSafe), from: foundFrom };
        return { kind: 'mine', cells: uniq(foundMine), from: foundFrom };
      }
      for (j = 0; j < foundMine.length; j++) if (st[foundMine[j]] === 0) st[foundMine[j]] = 2;
      for (j = 0; j < foundSafe.length; j++) reveal(foundSafe[j]);
      for (j = 0; j < newAct.length; j++) act.push(newAct[j]);
      newAct.length = 0;
    }
    return first ? null : st;
  }
  function inCells(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }
  function uniq(arr) { var o = [], s = {}; for (var i = 0; i < arr.length; i++) if (!s[arr[i]]) { s[arr[i]] = 1; o.push(arr[i]); } return o; }

  // ---------- generation ----------
  function countNumbers(T, mine, num) {
    var nb = T.nb;
    for (var i = 0; i < T.n; i++) {
      var l = nb[i], c = 0;
      for (var j = 0; j < l.length; j++) c += mine[l[j]];
      num[i] = c;
    }
  }

  // evaluate: how many safe squares can logic NOT reach from the start tap?
  function evaluate(T, mine, num, start, st) {
    var n = T.n, i;
    st.fill(0);
    // flood from start (start is a zero)
    var stack = [start]; st[start] = 1;
    while (stack.length) {
      var cur = stack.pop();
      if (num[cur] !== 0) continue;
      var l = T.nb[cur];
      for (var j = 0; j < l.length; j++) if (st[l[j]] === 0) { st[l[j]] = 1; stack.push(l[j]); }
    }
    solve(T, num, st, false);
    var bad = 0;
    for (i = 0; i < n; i++) if (st[i] === 0 && !mine[i]) bad++;
    return bad;
  }

  /* generate(w,h,mines,start,rng) -> { mine, num, mines, attempts, steps }
     The start tap and its neighbours are always hazard-free (so the tap opens an area). A random layout is
     made, then nudged (hazards swapped inside the region logic cannot reach) until the solver clears it. */
  function generate(w, h, mines, start, rng, opts) {
    opts = opts || {};
    var T = topo(w, h), n = T.n;
    var zone = new Uint8Array(n); zone[start] = 1;
    var sl = T.nb[start]; for (var q = 0; q < sl.length; q++) zone[sl[q]] = 1;
    var cand = [];
    for (var i = 0; i < n; i++) if (!zone[i]) cand.push(i);
    var maxMines = cand.length - 1;
    if (mines > maxMines) mines = maxMines;
    var mine = new Uint8Array(n), num = new Uint8Array(n), st = new Uint8Array(n);
    var LS = opts.localSteps || 70;          // nudges per attempt
    var maxAttempts = opts.maxAttempts || 60; // fresh layouts before easing the hazard count by one
    var attempts = 0, steps = 0, solveFails = 0, capRejects = 0;
    var pool = cand.slice();
    // optional: the first tap may open at most this share of the safe squares (so Easy/Medium still need solving)
    var maxOpen = opts.maxOpen || 0, seen = new Uint8Array(n), stack = [];
    function openTooBig() {
      if (!maxOpen || capRejects >= 400) return false; // never loop forever: after 400 rejections take what we have
      seen.fill(0); stack.length = 0; stack.push(start); seen[start] = 1; var cnt = 0;
      while (stack.length) { var c = stack.pop(); cnt++; if (num[c] !== 0) continue; var l = T.nb[c]; for (var j = 0; j < l.length; j++) if (!seen[l[j]]) { seen[l[j]] = 1; stack.push(l[j]); } }
      if (cnt > maxOpen * (n - mines)) { capRejects++; return true; }
      return false;
    }

    for (;;) {
      attempts++;
      // random layout: partial Fisher-Yates over candidates
      mine.fill(0);
      for (i = 0; i < mines; i++) {
        var r = i + Math.floor(rng() * (pool.length - i));
        var tmp = pool[i]; pool[i] = pool[r]; pool[r] = tmp;
        mine[pool[i]] = 1;
      }
      countNumbers(T, mine, num);
      var bad = evaluate(T, mine, num, start, st);
      steps++;
      if (bad === 0) { if (openTooBig()) continue; return finish(); }

      var capped = false;
      for (var it = 0; it < LS; it++) {
        // gather undetermined cells (st==0): the region logic cannot see into
        var undetMines = [], undetSafe = [];
        for (i = 0; i < n; i++) if (st[i] === 0) { if (mine[i]) undetMines.push(i); else undetSafe.push(i); }
        if (!undetMines.length) break;
        var from = undetMines[Math.floor(rng() * undetMines.length)];
        var to;
        if (undetSafe.length && rng() < 0.8) to = undetSafe[Math.floor(rng() * undetSafe.length)];
        else { to = cand[Math.floor(rng() * cand.length)]; if (mine[to]) continue; }
        if (zone[to]) continue;
        // apply the swap, keeping numbers current
        mine[from] = 0; mine[to] = 1; bumpNums(T, num, from, -1); bumpNums(T, num, to, +1);
        var st2 = new Uint8Array(n);
        var bad2 = evaluate(T, mine, num, start, st2);
        steps++;
        if (bad2 <= bad) {
          bad = bad2; st.set(st2);
          if (bad === 0) { if (openTooBig()) { capped = true; break; } return finish(); }
        } else { // revert
          mine[from] = 1; mine[to] = 0; bumpNums(T, num, from, +1); bumpNums(T, num, to, -1);
        }
      }
      if (capped) continue;
      solveFails++;
      if (solveFails % maxAttempts === 0 && mines > 1) mines--; // safety valve; essentially never needed
    }
    function finish() { return { mine: mine, num: num, mines: mines, attempts: attempts, steps: steps, capRejects: capRejects }; }
  }
  function bumpNums(T, num, cell, delta) { var l = T.nb[cell]; for (var j = 0; j < l.length; j++) num[l[j]] += delta; }

  // Hint: given what the player can see, find a deduction. view.revealed[i] (0/1), view.num[i]. Flags are ignored.
  // Returns {kind:'safe', cells, from, mines} (mines = hazards deduced on the way, handy for showing why),
  // or {kind:'mine', ...} if only hazards can be deduced, or null if logic is stuck.
  function hint(w, h, revealed, num) {
    var T = topo(w, h), st = new Uint8Array(T.n), i;
    for (i = 0; i < T.n; i++) st[i] = revealed[i] ? 1 : 0;
    var mines = [], lastMine = null;
    for (;;) {
      var r = solve(T, num, st, true);
      if (!r) return lastMine;
      if (r.kind === 'safe') { r.mines = mines; return r; }
      lastMine = lastMine || r;
      for (i = 0; i < r.cells.length; i++) { st[r.cells[i]] = 2; mines.push(r.cells[i]); }
    }
  }

  var LEVELS = {
    easy:   { key: 'easy',   name: 'Easy',   w: 9,  h: 9,  mines: 10, maxOpen: 0.4 },
    medium: { key: 'medium', name: 'Medium', w: 12, h: 18, mines: 40, maxOpen: 0.25 },
    hard:   { key: 'hard',   name: 'Hard',   w: 16, h: 28, mines: 90 }
  };

  var api = { mulberry32: mulberry32, hashString: hashString, topo: topo, solve: solve, evaluate: evaluate,
              generate: generate, hint: hint, countNumbers: countNumbers, LEVELS: LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FHEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
