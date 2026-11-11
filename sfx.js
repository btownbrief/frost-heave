/* Frost Heave: WebAudio synth sound + a gentle music loop. Starts on first tap (iOS rule). */
(function (root) {
  'use strict';
  var ctx = null, master = null, musicBus = null, noiseBuf = null;
  var soundOn = true, musicOn = true, musicWanted = false, suspended = false;

  // D major pentatonic, in Hz
  var PENT = [293.66, 329.63, 370.0, 440.0, 493.88, 587.33, 659.25, 740.0, 880.0];

  function init() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.gain.value = 0.0; musicBus.connect(master);
      var len = ctx.sampleRate * 1, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = b;
    } catch (e) { ctx = null; return false; }
    return true;
  }
  function unlock() {
    if (!init()) return;
    if (ctx.state !== 'running' && !suspended) { try { ctx.resume(); } catch (e) {} }
    if (musicWanted) startMusic();
  }

  function tone(freq, dur, type, vol, opts) {
    if (!ctx || !soundOn) return;
    opts = opts || {};
    var t = ctx.currentTime + (opts.delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(opts.dest || master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, freq, q, vol, opts) {
    if (!ctx || !soundOn) return;
    opts = opts || {};
    var t = ctx.currentTime + (opts.delay || 0);
    var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    var f = ctx.createBiquadFilter(); f.type = opts.type || 'bandpass'; f.Q.value = q || 1;
    f.frequency.setValueAtTime(freq, t);
    if (opts.slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.slide), t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }
  function pent(step) { // step may exceed the table; wrap upward by octaves
    var n = PENT.length, o = Math.floor(step / n), i = ((step % n) + n) % n;
    return PENT[i] * Math.pow(2, o - 1);
  }

  var api = {
    unlock: unlock,
    setSound: function (v) { soundOn = !!v; },
    setMusic: function (v) { musicOn = !!v; if (!v) stopMusic(); else if (musicWanted) startMusic(); },
    isReady: function () { return !!ctx; },
    // one safe square dug; chain raises the pitch up the scale
    reveal: function (chain) {
      noise(0.07, 2400, 1.2, 0.18, { slide: 900 });
      tone(pent(3 + Math.min(chain, 10)), 0.14, 'triangle', 0.16);
    },
    cascadeTick: function (depth) {
      noise(0.05, 3000, 1.5, 0.07, { slide: 1500 });
      tone(pent(1 + Math.min(depth, 12)), 0.1, 'sine', 0.07);
    },
    flag: function (k) { var u = 1 + 0.12 * Math.min(k || 0, 6); tone(210 * u, 0.09, 'square', 0.09, { slide: 330 * u }); noise(0.05, 900, 1, 0.12); },
    unflag: function () { tone(330, 0.08, 'square', 0.07, { slide: 190 }); },
    chord: function () { noise(0.14, 2000, 1, 0.2, { slide: 700 }); tone(pent(5), 0.16, 'triangle', 0.14); tone(pent(7), 0.2, 'triangle', 0.1, { delay: 0.05 }); },
    nope: function () { tone(120, 0.14, 'sawtooth', 0.09, { slide: 90 }); },
    press: function () { tone(520, 0.03, 'sine', 0.03); },
    click: function () { tone(660, 0.05, 'triangle', 0.08, { slide: 520 }); },
    hint: function () { tone(pent(5), 0.5, 'sine', 0.14); tone(pent(7), 0.6, 'sine', 0.11, { delay: 0.1 }); },
    hazard: function (k) { // ripple tick
      noise(0.09, 500 - Math.min(k, 8) * 20, 2, 0.16, { type: 'lowpass' });
      tone(160 - Math.min(k, 8) * 8, 0.12, 'sine', 0.1, { slide: 70 });
    },
    lose: function () {
      tone(140, 0.55, 'sine', 0.4, { slide: 38 });
      noise(0.4, 900, 0.8, 0.35, { type: 'lowpass', slide: 120 });
      noise(0.12, 4000, 1, 0.2, { slide: 600 });
      [pent(5), pent(3), pent(1)].forEach(function (f, i) { tone(f, 0.4, 'triangle', 0.1, { delay: 0.25 + i * 0.16 }); });
    },
    win: function () {
      [0, 2, 4, 5, 7, 9].forEach(function (s, i) { tone(pent(s + 2), 0.35, 'triangle', 0.14, { delay: i * 0.09 }); tone(pent(s + 2) * 2, 0.3, 'sine', 0.05, { delay: i * 0.09 }); });
      // plow engine rumble
      if (!ctx || !soundOn) return;
      var t = ctx.currentTime + 0.1, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(55, t); o.frequency.linearRampToValueAtTime(75, t + 1.1); o.frequency.linearRampToValueAtTime(60, t + 2.2);
      f.type = 'lowpass'; f.frequency.value = 220;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.3); g.gain.linearRampToValueAtTime(0.0001, t + 2.3);
      o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 2.4);
      noise(2.0, 1200, 0.7, 0.07, { delay: 0.2, type: 'highpass' });
    },
    // big open: a snowy swoosh that grows with the size of the open, plus a bright sparkle on top
    whoosh: function (n) {
      var k = Math.min(1, n / 90);
      noise(0.35 + k * 0.3, 700, 0.9, 0.16 + k * 0.08, { slide: 4200, type: 'bandpass' });
      [7, 9, 11].forEach(function (s, i) { tone(pent(s + Math.round(k * 2)), 0.22, 'sine', 0.06, { delay: 0.08 + i * 0.06 }); });
    },
    // "ROAD OPEN!" stamp: a soft thump and a bright chord
    stamp: function () {
      tone(110, 0.25, 'sine', 0.3, { slide: 55 }); noise(0.12, 600, 0.8, 0.22, { type: 'lowpass' });
      [pent(9), pent(11), pent(13)].forEach(function (f) { tone(f, 0.7, 'triangle', 0.07, { delay: 0.04 }); });
    },
    // Pothole Run: numbers around a filled hazard tick down
    tickDown: function () { tone(pent(6), 0.08, 'triangle', 0.09); tone(pent(4), 0.12, 'triangle', 0.08, { delay: 0.07 }); },
    // Pothole Run: a hit (deeper for bigger hits), a level-up fanfare, an upgrade pick chime
    hurt: function (cost) {
      tone(95 - Math.min(cost || 0, 4) * 8, 0.32, 'sine', 0.38, { slide: 40 }); noise(0.22, 420, 0.9, 0.3, { type: 'lowpass', slide: 90 });
      if (cost) tone(240, 0.16, 'sawtooth', 0.06, { slide: 120, delay: 0.03 }); else tone(880, 0.25, 'triangle', 0.08, { delay: 0.05 });
    },
    levelUp: function () { [0, 2, 4, 7].forEach(function (s, i) { tone(pent(s + 5), 0.22, 'square', 0.05, { delay: i * 0.07 }); tone(pent(s + 5), 0.3, 'triangle', 0.1, { delay: i * 0.07 }); }); tone(pent(14), 0.6, 'sine', 0.1, { delay: 0.3 }); },
    perk: function () { tone(pent(9), 0.5, 'sine', 0.14); tone(pent(11), 0.5, 'sine', 0.1, { delay: 0.06 }); tone(pent(13), 0.7, 'triangle', 0.08, { delay: 0.12 }); noise(0.25, 6000, 1, 0.05, { slide: 9000, delay: 0.05 }); },
    medal: function (k) { var base = [4, 6, 9][k] || 4; [0, 2, 4].forEach(function (s, i) { tone(pent(base + s), 0.8, 'sine', 0.12, { delay: 0.55 + i * 0.09 }); tone(pent(base + s) * 2, 0.5, 'sine', 0.03, { delay: 0.55 + i * 0.09 }); }); tone(70, 0.2, 'sine', 0.25, { slide: 45, delay: 0.5 }); },
    record: function () { [7, 9, 11, 14].forEach(function (s, i) { tone(pent(s), 0.5, 'sine', 0.13, { delay: 0.9 + i * 0.12 }); }); }
  };

  // ---------- music: "Back Road" loop (original) ----------
  // 92 bpm in D major, 32 bars (~84 s) before it repeats: soft bass + kick, a felt pad, a music-box arpeggio, brushed hats,
  // and a hummable melody in the middle two sections so the loop does not wear thin.
  var BPM = 92, EIGHTH = 60 / BPM / 2, MUSIC_VOL = 0.38;
  var CHORDS = [ // root (bass MIDI), triad (MIDI)
    [38, [62, 66, 69]], [35, [59, 62, 66]], [31, [59, 62, 67]], [33, [61, 64, 69]],
    [31, [59, 62, 67]], [38, [62, 66, 69]], [40, [59, 64, 67]], [33, [61, 64, 69]]
  ];
  var MEL = [
    [74, 0, 76, 78, 0, 76, 74, 0], [71, 0, 74, 0, 76, 0, 74, 71], [71, 0, 74, 0, 79, 0, 78, 76], [76, 0, 0, 0, 73, 0, 76, 0],
    [79, 0, 78, 76, 0, 74, 0, 71], [74, 0, 0, 76, 78, 0, 81, 0], [79, 0, 78, 0, 76, 0, 74, 0], [76, 0, 73, 0, 69, 0, 0, 0]
  ];
  var ARP = [0, 1, 2, 1, 0, 2, 1, 2], ARP2 = [0, 2, 1, 2, 0, 1, 2, 1];
  // B section: G A Bm D | G A D D, with its own melody
  var CHORDS_B = [
    [31, [59, 62, 67]], [33, [61, 64, 69]], [35, [59, 62, 66]], [38, [62, 66, 69]],
    [31, [59, 62, 67]], [33, [61, 64, 69]], [38, [62, 66, 69]], [38, [62, 66, 69]]
  ];
  var MEL_B = [
    [71, 0, 74, 0, 79, 78, 76, 0], [76, 0, 73, 0, 69, 0, 73, 76], [78, 0, 76, 74, 0, 71, 74, 0], [74, 0, 0, 0, 0, 0, 69, 71],
    [74, 0, 79, 0, 78, 0, 76, 74], [73, 0, 76, 0, 81, 0, 79, 76], [78, 0, 76, 0, 74, 0, 0, 0], [0, 0, 69, 71, 74, 0, 0, 0]
  ];
  // song form, one 8-bar section each: intro A (no melody), A, B, B (arpeggio only, flipped pattern)
  var FORM = [{ b: 0, mel: 0, arp: ARP }, { b: 0, mel: 1, arp: ARP }, { b: 1, mel: 1, arp: ARP2 }, { b: 1, mel: 0, arp: ARP2 }];
  var seqTimer = null, nextT = 0, step = 0;
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function mVoice(f, t, dur, type, vol, attack) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function musicBox(m, t, vol) { var f = mtof(m); mVoice(f, t, 0.9, 'sine', vol); mVoice(f * 2, t, 0.35, 'sine', vol * 0.28); mVoice(f * 4.01, t, 0.12, 'sine', vol * 0.08); }
  function pluck(m, t, vol) { var f = mtof(m); mVoice(f, t, 0.5, 'triangle', vol, 0.01); mVoice(f * 1.003, t, 0.4, 'sine', vol * 0.5, 0.01); }
  function pad(triad, t, dur) {
    triad.forEach(function (m) {
      var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = mtof(m - 12); o.detune.value = (Math.random() - 0.5) * 8;
      lp.type = 'lowpass'; lp.frequency.value = 700;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.5); g.gain.linearRampToValueAtTime(0.035, t + dur - 0.2); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
      o.connect(lp); lp.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.3);
    });
  }
  function kick(t, vol) { var o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.16); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.25); }
  function hat(t, vol) { var s = ctx.createBufferSource(); s.buffer = noiseBuf; var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; var g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random() * 0.5); s.stop(t + 0.07); }
  function scheduleStep(t) {
    var sec = FORM[Math.floor(step / 64) % FORM.length], bar = Math.floor(step / 8) % 8, e = step % 8, ch = (sec.b ? CHORDS_B : CHORDS)[bar], mel = sec.b ? MEL_B : MEL;
    if (e === 0) { pad(ch[1], t, EIGHTH * 8); pluck(ch[0], t, 0.16); kick(t, 0.16); }
    if (e === 4) { pluck(ch[0] + 7, t, 0.11); kick(t, 0.1); }
    if (e === 6 && bar % 2) pluck(ch[0] + 12, t, 0.07);
    if (e % 2 === 1) hat(t, e === 3 || e === 7 ? 0.035 : 0.022);
    // arpeggio (quieter when the melody plays)
    var melOn = !!sec.mel;
    musicBox(ch[1][sec.arp[e]] + 12, t, melOn ? 0.035 : 0.06);
    if (melOn && mel[bar][e]) musicBox(mel[bar][e], t + 0.004, 0.11);
    step++;
  }
  function tick() {
    if (!ctx || suspended) return;
    if (nextT < ctx.currentTime - 0.2) nextT = ctx.currentTime + 0.05; // fell behind (tab was busy): skip ahead, never burst
    while (nextT < ctx.currentTime + 0.3) { scheduleStep(nextT); nextT += EIGHTH; }
  }
  function startMusic() {
    musicWanted = true;
    if (!ctx || !musicOn || seqTimer || suspended) return;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, ctx.currentTime + 1.2);
    nextT = ctx.currentTime + 0.1;
    seqTimer = setInterval(tick, 90); tick();
  }
  function stopMusic() {
    if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
    if (ctx) { musicBus.gain.cancelScheduledValues(ctx.currentTime); musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime); musicBus.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4); }
  }
  // duck the music under big moments (win jingle, loss)
  api.duck = function (ms) {
    if (!ctx || !seqTimer) return; var t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t); musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(MUSIC_VOL * 0.25, t + 0.15); musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, t + (ms || 2500) / 1000);
  };
  api.wantMusic = function (v) { musicWanted = !!v; if (v) { if (ctx) startMusic(); } else stopMusic(); };
  api.suspend = function () { suspended = true; stopMusic(); if (ctx && ctx.state === 'running') ctx.suspend(); };
  api.resume = function () { suspended = false; if (ctx) { ctx.resume(); if (musicWanted && musicOn) startMusic(); } };

  root.FHSfx = api;
})(window);
