/* Frost Heave art. Everything is code-drawn stand-in art, built so a painted PNG can replace any piece:
   set ASSETS.<key>.src to a path (see IMAGE-PROMPTS.md) and that image is used instead of the drawing. */
(function (root) {
  'use strict';
  var E = root.FHEngine;
  var TAU = Math.PI * 2;

  var ASSETS = {
    snow:    { src: null, size: 128 },  // snow-covered tile (variants optional: snow_0..3)
    gravel:  { src: null, size: 128 },  // cleared gravel tile
    pothole: { src: null, size: 128 },  // hazard: pothole, on gravel
    heave:   { src: null, size: 128 },  // hazard: frost heave, on gravel
    cone:    { src: null, size: 128 },  // orange road cone, transparent bg
    plow:    { src: null, size: 512 },  // top-down snowplow truck, transparent bg
    titleArt:{ src: null, size: 1024 }, // title backdrop
    scene:   { src: null, size: 1024 }  // in-game night backdrop (sky, mountains, pines, snowy field)
  };
  var loaded = {};
  Object.keys(ASSETS).forEach(function (k) {
    if (!ASSETS[k].src) return;
    var im = new Image(); im.onload = function () { loaded[k] = im; if (root.FHArt && root.FHArt.onLoad) root.FHArt.onLoad(); }; im.src = ASSETS[k].src;
  });

  function mk(px) { var c = document.createElement('canvas'); c.width = c.height = px; return c; }
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function withImage(key, c, px) { // painted override, if present
    if (!loaded[key]) return false;
    c.getContext('2d').drawImage(loaded[key], 0, 0, px, px); return true;
  }

  function snowTile(px, v) {
    var c = mk(px), g = c.getContext('2d'), r = E.mulberry32(100 + v * 17);
    if (withImage('snow', c, px)) return c;
    // one calm vertical gradient and a 2 px darker bottom edge: no gloss, no sparkle (hundreds of these sit side by side)
    var gap = px * 0.035, s = px - gap * 2, rad = px * 0.16, edge = Math.max(2, px * 0.06);
    rr(g, gap, gap, s, s, rad); g.fillStyle = '#aebfd4'; g.fill();
    var gr = g.createLinearGradient(0, gap, 0, gap + s - edge);
    gr.addColorStop(0, '#f3f7fc'); gr.addColorStop(1, '#d9e5f1');
    rr(g, gap, gap, s, s - edge, rad); g.fillStyle = gr; g.fill();
    r();
    return c;
  }

  function gravelTile(px, v, cleanZero) {
    var c = mk(px), g = c.getContext('2d'), r = E.mulberry32(500 + v * 31);
    if (withImage('gravel', c, px)) return c;
    var gap = px * 0.02, s = px - gap * 2, rad = px * 0.13;
    var gr = g.createLinearGradient(0, 0, px, px);
    gr.addColorStop(0, cleanZero ? '#5d5753' : '#6b645f'); gr.addColorStop(1, cleanZero ? '#45403f' : '#524c4a');
    rr(g, gap, gap, s, s, rad); g.fillStyle = gr; g.fill();
    g.save(); rr(g, gap, gap, s, s, rad); g.clip();
    var n = Math.round(px * 0.5);
    for (var i = 0; i < n; i++) {
      var shade = r();
      g.fillStyle = shade < 0.4 ? 'rgba(20,20,26,.17)' : shade < 0.75 ? 'rgba(120,118,130,.14)' : 'rgba(165,160,172,.11)';
      g.beginPath(); g.ellipse(gap + r() * s, gap + r() * s, px * (0.01 + r() * 0.022), px * (0.008 + r() * 0.016), r() * 3, 0, TAU); g.fill();
    }
    // sunken look: dark inner edge top-left, faint light bottom-right
    g.lineWidth = px * 0.07; g.strokeStyle = 'rgba(0,0,0,.28)';
    g.beginPath(); g.moveTo(gap, gap + s); g.lineTo(gap, gap); g.lineTo(gap + s, gap); g.stroke();
    g.lineWidth = px * 0.04; g.strokeStyle = 'rgba(255,255,255,.07)';
    g.beginPath(); g.moveTo(gap + s, gap); g.lineTo(gap + s, gap + s); g.lineTo(gap, gap + s); g.stroke();
    // a little leftover frost in the corners
    for (i = 0; i < 5; i++) { var fx = r() < 0.5 ? gap + r() * s * 0.25 : gap + s - r() * s * 0.25, fy = r() < 0.5 ? gap + r() * s * 0.25 : gap + s - r() * s * 0.25;
      g.fillStyle = 'rgba(200,228,255,' + (0.05 + r() * 0.08) + ')'; g.beginPath(); g.arc(fx, fy, px * (0.02 + r() * 0.03), 0, TAU); g.fill(); }
    g.restore();
    return c;
  }

  function pothole(px, v) {
    var c = gravelTile(px, 1, false), g = c.getContext('2d'), r = E.mulberry32(900 + v);
    if (loaded.pothole) { g.drawImage(loaded.pothole, 0, 0, px, px); return c; }
    var cx = px * 0.5, cy = px * 0.54;
    g.save();
    // icy rim
    g.beginPath(); g.ellipse(cx, cy, px * 0.37, px * 0.3, -0.15, 0, TAU);
    var rim = g.createLinearGradient(0, cy - px * 0.3, 0, cy + px * 0.3); rim.addColorStop(0, '#d8f1ff'); rim.addColorStop(1, '#7aa7c7');
    g.fillStyle = rim; g.fill();
    // hole
    var hole = g.createRadialGradient(cx - px * 0.04, cy - px * 0.03, px * 0.02, cx, cy, px * 0.31);
    hole.addColorStop(0, '#05050a'); hole.addColorStop(0.7, '#14141b'); hole.addColorStop(1, '#2a2a34');
    g.beginPath(); g.ellipse(cx, cy + px * 0.01, px * 0.31, px * 0.23, -0.15, 0, TAU); g.fillStyle = hole; g.fill();
    // cracks
    g.strokeStyle = 'rgba(10,10,14,.9)'; g.lineWidth = Math.max(1, px * 0.025); g.lineCap = 'round';
    for (var i = 0; i < 5; i++) {
      var a = r() * TAU, l1 = px * (0.34 + r() * 0.1), l2 = l1 + px * (0.06 + r() * 0.07);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * px * 0.3, cy + Math.sin(a) * px * 0.22);
      g.lineTo(cx + Math.cos(a + 0.12) * l1, cy + Math.sin(a + 0.12) * l1 * 0.8);
      g.lineTo(cx + Math.cos(a - 0.05) * l2, cy + Math.sin(a - 0.05) * l2 * 0.8); g.stroke();
    }
    // glint
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.ellipse(cx - px * 0.15, cy - px * 0.17, px * 0.06, px * 0.022, -0.5, 0, TAU); g.fill();
    g.restore();
    return c;
  }

  function heave(px, v) {
    var c = gravelTile(px, 2, false), g = c.getContext('2d'), r = E.mulberry32(700 + v);
    if (loaded.heave) { g.drawImage(loaded.heave, 0, 0, px, px); return c; }
    var cx = px * 0.5, cy = px * 0.55;
    // broken asphalt chunks
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * TAU + r(), d = px * (0.3 + r() * 0.08);
      g.save(); g.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8); g.rotate(r() * 3);
      g.fillStyle = '#25252c'; g.fillRect(-px * 0.05, -px * 0.035, px * 0.1, px * 0.07); g.restore();
    }
    // ice dome
    var dome = g.createRadialGradient(cx - px * 0.1, cy - px * 0.14, px * 0.02, cx, cy, px * 0.36);
    dome.addColorStop(0, '#f1fbff'); dome.addColorStop(0.45, '#9fd2ee'); dome.addColorStop(1, '#2f6288');
    g.beginPath(); g.ellipse(cx, cy, px * 0.33, px * 0.27, 0, 0, TAU); g.fillStyle = dome; g.fill();
    g.lineWidth = Math.max(1, px * 0.02); g.strokeStyle = 'rgba(20,50,80,.85)'; g.stroke();
    // cracks
    g.strokeStyle = 'rgba(25,60,95,.85)'; g.lineWidth = Math.max(1, px * 0.02); g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - px * 0.2, cy + px * 0.05); g.lineTo(cx - px * 0.05, cy - px * 0.02); g.lineTo(cx + px * 0.02, cy + px * 0.08); g.lineTo(cx + px * 0.2, cy - px * 0.04); g.stroke();
    g.beginPath(); g.moveTo(cx - px * 0.05, cy - px * 0.02); g.lineTo(cx - px * 0.02, cy - px * 0.17); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(cx - px * 0.12, cy - px * 0.12, px * 0.07, px * 0.03, -0.6, 0, TAU); g.fill();
    return c;
  }

  function cone(px) {
    var c = mk(px), g = c.getContext('2d');
    if (withImage('cone', c, px)) return c;
    // soft shadow
    g.fillStyle = 'rgba(40,60,100,.32)'; g.beginPath(); g.ellipse(px * 0.54, px * 0.83, px * 0.3, px * 0.075, 0, 0, TAU); g.fill();
    // base slab
    var bs = g.createLinearGradient(0, px * 0.68, 0, px * 0.82); bs.addColorStop(0, '#3b3b45'); bs.addColorStop(1, '#202026');
    rr(g, px * 0.2, px * 0.68, px * 0.6, px * 0.14, px * 0.04); g.fillStyle = bs; g.fill();
    var topY = px * 0.16, botY = px * 0.72, hwTop = px * 0.065, hwBot = px * 0.27, mx = px * 0.5;
    function hw(y) { return hwTop + (y - topY) / (botY - topY) * (hwBot - hwTop); }
    g.beginPath(); g.moveTo(mx - hwTop, topY); g.lineTo(mx + hwTop, topY); g.lineTo(mx + hwBot, botY); g.lineTo(mx - hwBot, botY); g.closePath();
    var bd = g.createLinearGradient(mx - hwBot, 0, mx + hwBot, 0);
    bd.addColorStop(0, '#ff9a3c'); bd.addColorStop(0.35, '#ff7a14'); bd.addColorStop(1, '#d94f00');
    g.fillStyle = bd; g.fill();
    g.save(); g.clip();
    [[0.34, 0.43], [0.5, 0.6]].forEach(function (b) {
      var y0 = px * b[0], y1 = px * b[1];
      g.beginPath(); g.moveTo(mx - hw(y0), y0); g.lineTo(mx + hw(y0), y0); g.lineTo(mx + hw(y1), y1); g.lineTo(mx - hw(y1), y1); g.closePath();
      var wb = g.createLinearGradient(mx - hwBot, 0, mx + hwBot, 0); wb.addColorStop(0, '#ffffff'); wb.addColorStop(1, '#d6e4f0');
      g.fillStyle = wb; g.fill();
    });
    g.restore();
    g.beginPath(); g.moveTo(mx - hwTop, topY); g.lineTo(mx + hwTop, topY); g.lineTo(mx + hwBot, botY); g.lineTo(mx - hwBot, botY); g.closePath();
    g.lineWidth = Math.max(1, px * 0.025); g.strokeStyle = '#9c3a00'; g.stroke();
    g.fillStyle = '#ff8a24'; g.beginPath(); g.ellipse(mx, topY, hwTop, px * 0.03, 0, 0, TAU); g.fill(); g.stroke();
    return c;
  }

  // sprite bundle for a given pixel size
  function build(px) {
    px = Math.max(8, Math.round(px));
    var S = { px: px, snow: [], gravel: [], pothole: [], heave: [] };
    for (var v = 0; v < 4; v++) { S.snow.push(snowTile(px, v)); S.gravel.push(gravelTile(px, v, false)); }
    S.zero = gravelTile(px, 9, true);
    S.pothole.push(pothole(px, 0), pothole(px, 1));
    S.heave.push(heave(px, 0), heave(px, 1));
    S.cone = cone(px);
    return S;
  }

  // top-down snowplow facing up. cx = centre of the blade, y = blade's leading edge, bw = blade width.
  function drawPlow(g, cx, y, bw, unit, t) {
    var u = unit, i;
    if (loaded.plow) { var ph = bw * 1.5; g.drawImage(loaded.plow, cx - bw / 2, y - u * 0.6, bw, ph); return; }
    var tw = Math.min(bw * 0.5, u * 3.3), cabH = u * 1.9, bedH = u * 3.6, ty = y + u * 1.35;
    g.save();
    // headlight beams ahead of the blade
    var hl = g.createLinearGradient(0, y, 0, y - u * 6); hl.addColorStop(0, 'rgba(255,246,200,.5)'); hl.addColorStop(1, 'rgba(255,246,200,0)');
    g.fillStyle = hl; g.beginPath(); g.moveTo(cx - tw * 0.42, y); g.lineTo(cx - tw * 1.1, y - u * 6); g.lineTo(cx + tw * 1.1, y - u * 6); g.lineTo(cx + tw * 0.42, y); g.closePath(); g.fill();
    // shadow under the whole truck
    g.fillStyle = 'rgba(0,0,20,.32)'; rr(g, cx - tw / 2 + u * 0.18, ty + u * 0.25, tw, cabH + bedH + u * 0.2, u * 0.5); g.fill();
    // tires with tread
    function tire(x, yy) { g.fillStyle = '#121218'; rr(g, x, yy, u * 0.42, u * 1.05, u * 0.12); g.fill(); g.fillStyle = '#34343e'; for (var k = 0; k < 4; k++) g.fillRect(x + u * 0.06, yy + u * (0.12 + k * 0.24), u * 0.3, u * 0.08); }
    [[-1, ty + u * 0.35], [-1, ty + cabH + u * 1.4], [1, ty + u * 0.35], [1, ty + cabH + u * 1.4]].forEach(function (w) { tire(w[0] < 0 ? cx - tw / 2 - u * 0.28 : cx + tw / 2 - u * 0.14, w[1]); });
    // dump bed with ribs and a salt spinner at the back
    var bedY = ty + cabH + u * 0.15;
    var bed = g.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0); bed.addColorStop(0, '#d9650a'); bed.addColorStop(0.45, '#ffa23a'); bed.addColorStop(1, '#c95a05');
    rr(g, cx - tw / 2, bedY, tw, bedH, u * 0.3); g.fillStyle = bed; g.fill();
    g.lineWidth = Math.max(1, u * 0.07); g.strokeStyle = '#7a3300'; g.stroke();
    // a mounded load of road salt and sand: shaded heap with fine grain
    var lx = cx - tw * 0.36, ly = bedY + u * 0.22, lw = tw * 0.72, lh = bedH - u * 0.55;
    g.fillStyle = '#5a4a3c'; rr(g, lx, ly, lw, lh, u * 0.18); g.fill();
    var heap = g.createRadialGradient(cx - lw * 0.15, ly + lh * 0.4, u * 0.1, cx, ly + lh * 0.5, Math.max(lw, lh) * 0.62);
    heap.addColorStop(0, '#f3ede2'); heap.addColorStop(0.55, '#c9b9a2'); heap.addColorStop(1, '#7d6a57');
    g.fillStyle = heap; rr(g, lx + u * 0.08, ly + u * 0.08, lw - u * 0.16, lh - u * 0.16, u * 0.35); g.fill();
    g.strokeStyle = 'rgba(120,100,80,.35)'; g.lineWidth = Math.max(1, u * 0.05); // furrows left by the spreader chain
    for (i = 1; i < 4; i++) { g.beginPath(); g.moveTo(lx + lw * i / 4, ly + u * 0.2); g.lineTo(lx + lw * i / 4, ly + lh - u * 0.2); g.stroke(); }
    var gr2 = E.mulberry32(31);
    for (i = 0; i < 60; i++) { var ga = gr2() * TAU, gd = Math.sqrt(gr2()) * 0.45; g.fillStyle = gr2() < 0.5 ? 'rgba(255,255,255,.7)' : 'rgba(90,70,50,.45)'; g.fillRect(cx + Math.cos(ga) * lw * gd, ly + lh * 0.5 + Math.sin(ga) * lh * gd, Math.max(1, u * 0.05), Math.max(1, u * 0.05)); }
    g.strokeStyle = 'rgba(120,45,0,.55)'; g.lineWidth = Math.max(1, u * 0.09);
    for (i = 1; i < 5; i++) { var ry = bedY + bedH * i / 5; g.beginPath(); g.moveTo(cx - tw / 2 + u * 0.06, ry); g.lineTo(cx - tw * 0.38, ry); g.moveTo(cx + tw * 0.38, ry); g.lineTo(cx + tw / 2 - u * 0.06, ry); g.stroke(); }
    var sp = t / 90, spx = cx, spy = bedY + bedH + u * 0.25;
    g.fillStyle = '#3a3a44'; g.beginPath(); g.arc(spx, spy, u * 0.38, 0, TAU); g.fill();
    g.strokeStyle = '#c9ced8'; g.lineWidth = Math.max(1, u * 0.08); for (i = 0; i < 3; i++) { var a = sp + i * TAU / 3; g.beginPath(); g.moveTo(spx, spy); g.lineTo(spx + Math.cos(a) * u * 0.34, spy + Math.sin(a) * u * 0.34); g.stroke(); }
    // cab: body, roof with highlight, windshield with a glint, side mirrors
    var cab = g.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0); cab.addColorStop(0, '#e0680a'); cab.addColorStop(0.5, '#ffb04a'); cab.addColorStop(1, '#d25f06');
    rr(g, cx - tw / 2, ty, tw, cabH, u * 0.42); g.fillStyle = cab; g.fill(); g.strokeStyle = '#7a3300'; g.lineWidth = Math.max(1, u * 0.07); g.stroke();
    g.fillStyle = '#16263a'; rr(g, cx - tw * 0.4, ty + u * 0.16, tw * 0.8, u * 0.5, u * 0.14); g.fill();
    g.fillStyle = 'rgba(170,215,255,.55)'; g.beginPath(); g.moveTo(cx - tw * 0.3, ty + u * 0.22); g.lineTo(cx - tw * 0.12, ty + u * 0.22); g.lineTo(cx - tw * 0.24, ty + u * 0.6); g.lineTo(cx - tw * 0.36, ty + u * 0.6); g.closePath(); g.fill();
    var roof = g.createLinearGradient(0, ty + u * 0.75, 0, ty + cabH); roof.addColorStop(0, '#ffd08a'); roof.addColorStop(1, '#f59a2c');
    rr(g, cx - tw * 0.36, ty + u * 0.78, tw * 0.72, cabH - u * 0.95, u * 0.22); g.fillStyle = roof; g.fill();
    g.fillStyle = '#23232b'; rr(g, cx - tw / 2 - u * 0.32, ty + u * 0.22, u * 0.3, u * 0.22, u * 0.06); g.fill(); rr(g, cx + tw / 2 + u * 0.02, ty + u * 0.22, u * 0.3, u * 0.22, u * 0.06); g.fill();
    // light bar with two rotating amber beacons
    var lbY = ty + u * 0.88;
    g.fillStyle = '#2a2a33'; rr(g, cx - tw * 0.34, lbY, tw * 0.68, u * 0.26, u * 0.1); g.fill();
    [-1, 1].forEach(function (sd, k) {
      var bx = cx + sd * tw * 0.22, by = lbY + u * 0.13, ph = (t / 260 + k * 0.5) % 1, br = 0.5 + 0.5 * Math.cos(ph * TAU);
      g.fillStyle = 'rgb(255,' + Math.round(150 + 80 * br) + ',30)'; g.beginPath(); g.arc(bx, by, u * 0.16, 0, TAU); g.fill();
      var gl = g.createRadialGradient(bx, by, 0, bx, by, u * (1.2 + br * 1.6)); gl.addColorStop(0, 'rgba(255,200,60,' + (0.25 + br * 0.35) + ')'); gl.addColorStop(1, 'rgba(255,200,60,0)');
      g.fillStyle = gl; g.fillRect(bx - u * 3, by - u * 3, u * 6, u * 6);
    });
    // plow frame arms
    g.strokeStyle = '#2b2b33'; g.lineWidth = u * 0.22; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - tw * 0.3, ty + u * 0.1); g.lineTo(cx - tw * 0.18, y + u * 0.9); g.moveTo(cx + tw * 0.3, ty + u * 0.1); g.lineTo(cx + tw * 0.18, y + u * 0.9); g.stroke();
    // snow rolling off the blade
    var roll = g.createLinearGradient(0, y - u * 0.7, 0, y + u * 0.2); roll.addColorStop(0, 'rgba(255,255,255,0)'); roll.addColorStop(0.5, 'rgba(255,255,255,.95)'); roll.addColorStop(1, '#dbe9f7');
    g.fillStyle = roll; g.beginPath(); g.moveTo(cx - bw / 2 - u * 0.4, y + u * 0.3);
    for (i = 0; i <= 16; i++) { var k2 = i / 16, wob = Math.sin(k2 * 23 + t / 120) * u * 0.12; g.lineTo(cx - bw / 2 + bw * k2, y - u * (0.35 + 0.25 * Math.sin(k2 * Math.PI)) + wob); }
    g.lineTo(cx + bw / 2 + u * 0.4, y + u * 0.3); g.closePath(); g.fill();
    // blade: curved moldboard (dark top edge to bright lip), black-and-yellow chevrons on the lower strip
    var bh = u * 1.2, bx = cx - bw / 2;
    g.fillStyle = 'rgba(0,0,0,.3)'; rr(g, bx + u * 0.1, y + u * 0.18, bw, bh, u * 0.3); g.fill();
    var bl = g.createLinearGradient(0, y, 0, y + bh); bl.addColorStop(0, '#b88a00'); bl.addColorStop(0.25, '#ffd23a'); bl.addColorStop(0.6, '#fff07a'); bl.addColorStop(1, '#e0a800');
    rr(g, bx, y, bw, bh, u * 0.3); g.fillStyle = bl; g.fill();
    g.save(); rr(g, bx, y, bw, bh, u * 0.3); g.clip();
    var sy0 = y + bh * 0.62; g.fillStyle = '#ffd400'; g.fillRect(bx, sy0, bw, bh * 0.38);
    g.fillStyle = '#23232a';
    for (var sx = bx - bh; sx < bx + bw; sx += u * 1.1) { g.beginPath(); g.moveTo(sx, y + bh); g.lineTo(sx + u * 0.5, y + bh); g.lineTo(sx + u * 0.5 + bh * 0.38, sy0); g.lineTo(sx + bh * 0.38, sy0); g.closePath(); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(bx, y + bh * 0.3, bw, Math.max(1, u * 0.06));
    g.restore();
    g.lineWidth = Math.max(1, u * 0.08); g.strokeStyle = '#6b4f00'; rr(g, bx, y, bw, bh, u * 0.3); g.stroke();
    // blade-end marker flags
    [-1, 1].forEach(function (sd) { var fx = cx + sd * (bw / 2 - u * 0.15); g.strokeStyle = '#ddd'; g.lineWidth = Math.max(1, u * 0.06); g.beginPath(); g.moveTo(fx, y + u * 0.2); g.lineTo(fx, y - u * 1.0); g.stroke(); g.fillStyle = '#ff4d2e'; g.beginPath(); g.arc(fx, y - u * 1.0, u * 0.12, 0, TAU); g.fill(); });
    g.restore();
  }


  // ---------- night backdrop: sky, stars, moon, two mountain ridges, pine treelines, snowy field ----------
  // drawn once per layout; hy = horizon (just above the board's top edge)
  function drawScene(g, w, h, hy, seed) {
    var r = E.mulberry32(seed || 7), i, x;
    if (loaded.scene) { g.drawImage(loaded.scene, 0, 0, w, h); return; }
    var sky = g.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, '#0a1426'); sky.addColorStop(0.55, '#16304f'); sky.addColorStop(0.9, '#2d4f74'); sky.addColorStop(1, '#4d6a8c');
    g.fillStyle = sky; g.fillRect(0, 0, w, hy + 2);
    var glow = g.createRadialGradient(w * 0.5, hy, 0, w * 0.5, hy, w * 0.75); // warm town glow on the horizon
    glow.addColorStop(0, 'rgba(255,170,110,.32)'); glow.addColorStop(0.45, 'rgba(255,140,90,.08)'); glow.addColorStop(1, 'rgba(255,140,90,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, hy + 2);
    for (i = 0; i < 70; i++) { var sy = r() * hy * 0.8, a = 0.25 + r() * 0.6 * (1 - sy / hy); g.fillStyle = 'rgba(235,245,255,' + a + ')'; g.fillRect(r() * w, sy, r() < 0.12 ? 2 : 1, r() < 0.12 ? 2 : 1); }
    var mx = w * 0.8, my = Math.max(100, hy * 0.45), mr = Math.max(9, Math.min(w, h) * 0.035); // moon
    var mg = g.createRadialGradient(mx, my, 0, mx, my, mr * 5); mg.addColorStop(0, 'rgba(220,235,255,.28)'); mg.addColorStop(1, 'rgba(220,235,255,0)');
    g.fillStyle = mg; g.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    g.fillStyle = '#eef5ff'; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
    g.fillStyle = 'rgba(160,180,210,.35)'; g.beginPath(); g.arc(mx - mr * 0.3, my + mr * 0.2, mr * 0.25, 0, TAU); g.arc(mx + mr * 0.35, my - mr * 0.3, mr * 0.15, 0, TAU); g.fill();
    function ridge(base, amp, col, rough, snow) {
      g.beginPath(); g.moveTo(0, h); var y = base; var pts = [];
      for (x = 0; x <= w + 8; x += 8) { var k = x / w; y = base - amp * (0.55 + 0.45 * Math.sin(k * 5.1 + rough) * Math.sin(k * 2.3 + rough * 2)) - r() * amp * 0.08; pts.push([x, y]); g.lineTo(x, y); }
      g.lineTo(w + 8, h); g.closePath(); g.fillStyle = col; g.fill();
      if (snow) { g.save(); g.clip(); g.strokeStyle = snow; g.lineWidth = 3; g.beginPath(); pts.forEach(function (p, j) { j ? g.lineTo(p[0], p[1] + 1.5) : g.moveTo(p[0], p[1] + 1.5); }); g.stroke(); g.restore(); }
    }
    ridge(hy + 2, Math.min(70, hy * 0.42), '#29466a', 1.3, 'rgba(210,230,255,.45)');
    ridge(hy + 4, Math.min(40, hy * 0.24), '#1d3554', 3.7, 'rgba(200,225,255,.25)');
    function pines(base, size, col, dens) { // a row of pine silhouettes
      g.fillStyle = col;
      for (x = -10; x < w + 10; x += size * (0.45 + r() * dens)) {
        var th = size * (0.7 + r() * 0.6), tw = th * 0.42, ty = base + r() * size * 0.15;
        g.beginPath(); g.moveTo(x, ty - th);
        for (var t = 1; t <= 3; t++) { var ly = ty - th + th * t / 3; g.lineTo(x + tw * (0.35 + t * 0.2), ly); g.lineTo(x + tw * 0.15, ly - th * 0.06); }
        g.lineTo(x + tw * 0.08, ty); g.lineTo(x - tw * 0.08, ty);
        for (t = 3; t >= 1; t--) { var ly2 = ty - th + th * t / 3; g.lineTo(x - tw * 0.15, ly2 - th * 0.06); g.lineTo(x - tw * (0.35 + t * 0.2), ly2); }
        g.closePath(); g.fill();
      }
    }
    pines(hy + 6, Math.min(34, hy * 0.22), '#132842', 0.9);
    var field = g.createLinearGradient(0, hy, 0, h); // snowy ground down to the bottom
    field.addColorStop(0, '#2c4669'); field.addColorStop(0.25, '#223a59'); field.addColorStop(1, '#101d30');
    g.fillStyle = field; g.fillRect(0, hy + 5, w, h - hy);
    pines(hy + 12, Math.min(26, hy * 0.18), '#0e1f35', 0.7);
    for (i = 0; i < 26; i++) { // soft drifts catching the moonlight
      var dx = r() * w, dy = hy + 30 + r() * (h - hy - 30), dr = 30 + r() * 90;
      var dg = g.createRadialGradient(dx, dy, 0, dx, dy, dr); dg.addColorStop(0, 'rgba(150,185,230,.10)'); dg.addColorStop(1, 'rgba(150,185,230,0)');
      g.fillStyle = dg; g.fillRect(dx - dr, dy - dr, dr * 2, dr * 2);
    }
  }

  root.FHArt = { ASSETS: ASSETS, build: build, drawPlow: drawPlow, drawScene: drawScene, rr: rr, onLoad: null };
})(window);
