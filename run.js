/* Pothole Run: roguelike side mode. Original rules:
   - You have HP. Every hazard has a strength (1-4). Digging one costs that much HP and fills it in.
   - A number is the TOTAL strength of the hazards still hidden around the square.
   - Digging safe squares earns XP; level-ups repair you. Clearing a stretch repairs you and you pick an upgrade.
   - Stretch 1 only has strength-1 hazards (numbers work like the classic game); stronger ones join later.
   No-guess is not promised here: HP, survey stakes and upgrades are the safety net. */
(function (root) {
  'use strict';
  var E = root.FHEngine;

  // stage 1-based -> board shape and difficulty
  function stageSpec(stage) {
    var w = stage < 3 ? 8 : stage < 6 ? 9 : 10;
    var h = stage < 2 ? 10 : stage < 3 ? 11 : stage < 5 ? 12 : stage < 7 ? 13 : 14;
    var density = Math.min(0.25, 0.11 + stage * 0.01 + Math.max(0, stage - 7) * 0.005);
    var maxStr = stage < 2 ? 1 : stage < 4 ? 2 : stage < 6 ? 3 : 4;
    return { w: w, h: h, hazards: Math.round(w * h * density), maxStr: maxStr, mean: Math.max(0, stage - 6) * 0.03 };
  }

  // strength[i] = 0 for safe squares, 1..maxStr for hazards. Start tap + neighbours are always safe.
  function makeStage(spec, start, rng) {
    var T = E.topo(spec.w, spec.h), n = T.n, str = new Uint8Array(n), num = new Uint8Array(n);
    var zone = {}; zone[start] = 1; T.nb[start].forEach(function (j) { zone[j] = 1; });
    var cand = []; for (var i = 0; i < n; i++) if (!zone[i]) cand.push(i);
    var count = Math.min(spec.hazards, cand.length - 1);
    for (i = 0; i < count; i++) {
      var r = i + Math.floor(rng() * (cand.length - i)), t = cand[i]; cand[i] = cand[r]; cand[r] = t;
      // weighted: strong hazards are rarer
      var roll = Math.min(0.999, rng() + (spec.mean || 0)), s = 1; // later stretches lean toward stronger hazards
      if (spec.maxStr >= 2 && roll > 0.6) s = 2;
      if (spec.maxStr >= 3 && roll > 0.86) s = 3;
      if (spec.maxStr >= 4 && roll > 0.96) s = 4;
      str[cand[i]] = s;
    }
    for (i = 0; i < n; i++) { var sum = 0, l = T.nb[i]; for (var j = 0; j < l.length; j++) sum += str[l[j]]; num[i] = sum; }
    return { str: str, num: num, hazards: count };
  }

  function xpNeeded(level) { return 16 + level * 10; }
  // from stretch 10 the ice is meaner: every hit costs 1 more HP (2 more from stretch 15)
  function hitExtra(stage) { return stage >= 15 ? 2 : stage >= 10 ? 1 : 0; }

  // upgrades offered after each stretch (pick 1 of 3). max = how many times it can be taken.
  // Healing is deliberately small: logic, not luck, should carry a run.
  var PERKS = [
    { id: 'counter', name: 'Hazard Counter', desc: 'Numbers also show HOW MANY hazards hide around them (the little pips).', max: 1 },
    { id: 'radar',   name: 'Ground Radar',   desc: 'Each stretch starts with its strongest hazard found and marked.', max: 3 },
    { id: 'steady',  name: 'Steady Hands',   desc: 'Dig 25 squares on a stretch without a hit: earn a stake (once per stretch).', max: 1 },
    { id: 'stakes',  name: 'Survey Stakes',  desc: '+2 stakes (you can carry 5). A stake checks a square safely.', max: 9, need: function (run) { return run.stakes <= 3; } },
    { id: 'salt',    name: 'Road Salt',      desc: 'Every stretch starts with 2 extra squares dug.', max: 3 },
    { id: 'shovel',  name: 'Gravel Bucket',  desc: 'Hazards of strength 2 or more cost 1 HP less.', max: 1 },
    { id: 'axle',    name: 'Heavy Axle',     desc: 'The first hit on each stretch costs no HP.', max: 2 },
    { id: 'crew',    name: 'Road Crew',      desc: 'Clear a stretch without a single hit: repair 2.', max: 1 },
    { id: 'overtime', name: 'Overtime',      desc: 'Double XP, but max HP -3 right now.', max: 1, need: function (run) { return run.maxHp >= 13; } },
    { id: 'lightload', name: 'Light Load',   desc: '+3 stakes (you can carry 5), but max HP -2 right now.', max: 2, need: function (run) { return run.maxHp >= 12 && run.stakes <= 2; } },
    { id: 'night',   name: 'Night Shift',    desc: '+50% XP.', max: 2 },
    { id: 'tires',   name: 'Snow Tires',     desc: '+2 max HP and repair 2 now.', max: 9 },
    { id: 'thermos', name: 'Thermos',        desc: 'Repair 4 HP now.', max: 9, need: function (run) { return run.hp <= run.maxHp - 3; } }
  ];
  // code-drawn icons (24x24) so upgrades match the rest of the art
  var ICONS = {
    counter: '<rect x="3" y="3" width="18" height="18" rx="4" fill="#55504c" stroke="#2a2624" stroke-width="1.5"/><text x="12" y="15.5" font-size="11" font-weight="900" text-anchor="middle" fill="#ffe14d" font-family="Nunito,system-ui">3</text><circle cx="8" cy="18" r="1.4" fill="#fff"/><circle cx="12" cy="18" r="1.4" fill="#fff"/>',
    radar: '<circle cx="12" cy="12" r="9" fill="#123a2e" stroke="#7dffb0" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="none" stroke="#7dffb0" stroke-opacity=".5"/><path d="M12 12 L19 6 A9 9 0 0 1 21 12 Z" fill="#7dffb0" fill-opacity=".55"/><circle cx="16" cy="9" r="1.6" fill="#ff8a24"/>',
    steady: '<path d="M7 21v-8l-2-4 2-1 3 4V5a1.4 1.4 0 0 1 2.8 0v6l.2-6.5a1.4 1.4 0 0 1 2.8 0V11l.4-4a1.4 1.4 0 0 1 2.8.3L18.5 15c0 3-2 6-5.5 6Z" fill="#ffd9b8" stroke="#8a4a20" stroke-width="1.3" stroke-linejoin="round"/>',
    stakes: '<path d="M8 21 9.5 4" stroke="#e8d3b0" stroke-width="2" stroke-linecap="round"/><path d="M9.5 4 18 6.5 9 10Z" fill="#ff8a24" stroke="#a13f00" stroke-width="1.2" stroke-linejoin="round"/><path d="M5 21h7" stroke="#e8d3b0" stroke-width="2" stroke-linecap="round"/>',
    salt: '<path d="M8 9h8l1 11a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20Z" fill="#f2f7ff" stroke="#6a86a8" stroke-width="1.3"/><path d="M8.5 9 9 5h6l.5 4Z" fill="#b9c4d4" stroke="#6a86a8" stroke-width="1.3"/><circle cx="11" cy="7" r=".8" fill="#4a5a70"/><circle cx="13" cy="7" r=".8" fill="#4a5a70"/><path d="M10 14h4" stroke="#9fb3cc" stroke-width="1.3"/>',
    shovel: '<path d="M5 9h14l-1.5 11a1.5 1.5 0 0 1-1.5 1.3H8A1.5 1.5 0 0 1 6.5 20Z" fill="#4aa3c8" stroke="#1d4f66" stroke-width="1.3"/><path d="M5 9c0-3 14-3 14 0" fill="none" stroke="#1d4f66" stroke-width="1.3"/><ellipse cx="12" cy="9" rx="7" ry="1.8" fill="#77706a"/><circle cx="10" cy="8.5" r="1" fill="#a39b93"/><circle cx="14" cy="9" r="1" fill="#5a544f"/>',
    axle: '<path d="M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9Z" fill="#9aa3b2" stroke="#3b4250" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.6" fill="#3b4250"/><circle cx="12" cy="12" r="1.6" fill="#c8cfda"/>',
    overtime: '<circle cx="12" cy="13" r="8" fill="#f4f7ff" stroke="#3b4250" stroke-width="1.5"/><path d="M12 8v5l3 2" stroke="#3b4250" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M9 3h6" stroke="#3b4250" stroke-width="2" stroke-linecap="round"/><text x="19" y="9" font-size="7" font-weight="900" fill="#ff8a24" font-family="Nunito,system-ui">x2</text>',
    lightload: '<path d="M4 20h16" stroke="#7fb8e0" stroke-width="2" stroke-linecap="round"/><path d="M7 20 8 6M12 20 13 4M17 20 17.5 8" stroke="#e8d3b0" stroke-width="1.8" stroke-linecap="round"/><path d="M8 6l5 1.4L8 9ZM13 4l5 1.4-5 1.6ZM17.5 8l4 1.2-4 1.3Z" fill="#ff8a24"/>',
    crew: '<path d="M12 3 15.5 17h-7Z" fill="#ff8a24" stroke="#a13f00" stroke-width="1.2" stroke-linejoin="round"/><path d="M10.3 9.5h3.4M9.6 13h4.8" stroke="#fff" stroke-width="1.7"/><rect x="5" y="17" width="14" height="3.6" rx="1.3" fill="#2b2b33"/>',
    night: '<path d="M15.5 3.5A8.5 8.5 0 1 0 20.5 15 7 7 0 0 1 15.5 3.5Z" fill="#ffe9a8" stroke="#a37b1c" stroke-width="1.3" stroke-linejoin="round"/><circle cx="19" cy="6" r="1" fill="#fff"/>',
    tires: '<circle cx="12" cy="12" r="9" fill="#1d1d24" stroke="#000" stroke-width="1"/><circle cx="12" cy="12" r="9" fill="none" stroke="#4a4a56" stroke-width="2.4" stroke-dasharray="2.2 2"/><circle cx="12" cy="12" r="4.2" fill="#b8c0cc"/><circle cx="12" cy="12" r="1.5" fill="#55606e"/>',
    thermos: '<rect x="7.5" y="6" width="9" height="15" rx="2.5" fill="#3a8f6b" stroke="#16402f" stroke-width="1.3"/><rect x="8.5" y="3" width="7" height="3.5" rx="1" fill="#c9ced8" stroke="#555d6a" stroke-width="1.2"/><path d="M9 12h6" stroke="#a6e6c9" stroke-width="1.5"/><path d="M10 2c0-1 1-1 1 0M13 2c0-1 1-1 1 0" stroke="#cfe" stroke-width=".9" fill="none"/>'
  };
  function icon(id) { return '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">' + (ICONS[id] || '') + '</svg>'; }
  function offer(run, rng) {
    var last = run.lastOffer || [];
    var pool = PERKS.filter(function (p) { return (run.perks[p.id] || 0) < p.max && (!p.need || p.need(run)); });
    // don't show the same cards twice in a row when there are enough others
    var fresh = pool.filter(function (p) { return last.indexOf(p.id) < 0; });
    if (fresh.length >= 3) pool = fresh;
    for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    pool = pool.slice(0, 3); run.lastOffer = pool.map(function (p) { return p.id; });
    return pool;
  }

  root.FHRun = { stageSpec: stageSpec, makeStage: makeStage, xpNeeded: xpNeeded, PERKS: PERKS, offer: offer, icon: icon, hitExtra: hitExtra, STAKE_CAP: 5 };
})(typeof window !== 'undefined' ? window : globalThis);
