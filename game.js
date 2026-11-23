/* CONTEXT WINDOW — a tiny, deterministic browser game.
 *
 * Plain script: no modules, no imports, no assets. Exposes:
 *   window.CW = { W, H, create(seed), step(dt, input), draw(ctx), state() }
 *
 * The simulation is seeded and fixed-step (1/120 s substeps), so the same
 * sequence of step(dt, input) calls always produces the same run. index.html
 * drives it with requestAnimationFrame; the video renderer inside
 * video-build/timeline.html drives the same file with a fixed 1/60 dt and a
 * scripted autopilot, so the footage is the real game and not a mock-up.
 *
 * You are the cursor inside a chat window. Cyan context tokens drift in —
 * collect them for score and context. Magenta hallucinations chase you and
 * eat context on contact. At zero context the window collapses.
 */
(function () {
  'use strict';

  var W = 540, H = 960;          // logical design size (9:16)
  var FIXED = 1 / 120;           // simulation substep
  var RUN_SECONDS = 45;

  var BOUNDS = { x0: 22, y0: 150, x1: 518, y1: 932 };

  var COL = {
    bg: '#091B42',
    bgDeep: '#06132F',
    grid: 'rgba(120, 190, 255, 0.075)',
    cyan: '#4FF3E0',
    cyanDim: '#1D8FA8',
    magenta: '#FF2D78',
    ink: '#EAF1FF',
    dim: 'rgba(234, 241, 255, 0.55)',
    panel: 'rgba(5, 15, 40, 0.55)'
  };

  var S = null;      // current state
  var rng = null;    // seeded generator state

  // ---- small utilities -----------------------------------------------------

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rnd() { return rng(); }
  function rr(a, b) { return a + (b - a) * rng(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---- simulation ----------------------------------------------------------

  function spawnToken(s) {
    var edge = Math.floor(rr(0, 4));
    var x, y;
    if (edge === 0) { x = BOUNDS.x0; y = rr(BOUNDS.y0, BOUNDS.y1); }
    else if (edge === 1) { x = BOUNDS.x1; y = rr(BOUNDS.y0, BOUNDS.y1); }
    else if (edge === 2) { x = rr(BOUNDS.x0, BOUNDS.x1); y = BOUNDS.y0; }
    else { x = rr(BOUNDS.x0, BOUNDS.x1); y = BOUNDS.y1; }
    s.tokens.push({
      x: x, y: y,
      vx: rr(-42, 42), vy: rr(-42, 42),
      r: 10, phase: rr(0, 6.283), born: s.t, id: s.nextId++
    });
    // never spawn a token right on top of the player
    var last = s.tokens[s.tokens.length - 1];
    if (Math.hypot(last.x - s.p.x, last.y - s.p.y) < 70) {
      last.x = BOUNDS.x0 + (BOUNDS.x1 - BOUNDS.x0) * rr(0.15, 0.85);
      last.y = BOUNDS.y0 + (BOUNDS.y1 - BOUNDS.y0) * rr(0.2, 0.8);
    }
  }

  function spawnHazard(s) {
    var side = Math.floor(rr(0, 4)), x, y;
    if (side === 0) { x = BOUNDS.x0 - 30; y = rr(BOUNDS.y0, BOUNDS.y1); }
    else if (side === 1) { x = BOUNDS.x1 + 30; y = rr(BOUNDS.y0, BOUNDS.y1); }
    else if (side === 2) { x = rr(BOUNDS.x0, BOUNDS.x1); y = BOUNDS.y0 - 30; }
    else { x = rr(BOUNDS.x0, BOUNDS.x1); y = BOUNDS.y1 + 30; }
    s.hazards.push({
      x: x, y: y, r: rr(19, 27),
      sp: rr(78, 118), wob: rr(0, 6.283), wobSp: rr(0.6, 1.3),
      born: s.t, id: s.nextId++
    });
  }

  function burst(s, x, y, color, n, power) {
    for (var i = 0; i < n; i++) {
      var a = rr(0, 6.283), sp = rr(40, 40 + power);
      s.parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rr(0.35, 0.8), t: 0, r: rr(1.5, 3.6), color: color
      });
    }
  }

  function sim(h, input) {
    var s = S;
    s.t += h;

    // -- player movement: analog axis, smoothed like a cursor with weight
    var ax = clamp(input.ax || 0, -1, 1), ay = clamp(input.ay || 0, -1, 1);
    var mag = Math.hypot(ax, ay);
    if (mag > 1) { ax /= mag; ay /= mag; }
    var SPEED = 352;
    var k = 1 - Math.exp(-9 * h);
    s.p.vx += (ax * SPEED - s.p.vx) * k;
    s.p.vy += (ay * SPEED - s.p.vy) * k;
    s.p.x += s.p.vx * h;
    s.p.y += s.p.vy * h;
    if (s.p.x < BOUNDS.x0) { s.p.x = BOUNDS.x0; s.p.vx = 0; }
    if (s.p.x > BOUNDS.x1) { s.p.x = BOUNDS.x1; s.p.vx = 0; }
    if (s.p.y < BOUNDS.y0) { s.p.y = BOUNDS.y0; s.p.vy = 0; }
    if (s.p.y > BOUNDS.y1) { s.p.y = BOUNDS.y1; s.p.vy = 0; }
    s.trail.push({ x: s.p.x, y: s.p.y, t: s.t });
    while (s.trail.length && s.t - s.trail[0].t > 0.28) s.trail.shift();

    // -- context drain
    s.context = clamp(s.context - (2.0 + Math.min(2.2, s.t * 0.035)) * h, 0, 100);

    // -- combo window (2 s)
    if (s.combo > 0 && s.t - s.lastPick > 2.0) s.combo = 0;
    s.mult = 1 + Math.min(4, Math.floor(s.combo / 3) * 0.5);

    // -- tokens
    if (s.tokens.length < 8 && s.t > s.nextTokenAt) {
      spawnToken(s);
      s.nextTokenAt = s.t + rr(0.35, 0.85);
    }
    for (var i = s.tokens.length - 1; i >= 0; i--) {
      var tk = s.tokens[i];
      tk.x += tk.vx * h; tk.y += tk.vy * h;
      tk.vx *= (1 - 0.9 * h); tk.vy *= (1 - 0.9 * h);
      tk.phase += h * 2.4;
      if (tk.x < BOUNDS.x0 + 6) { tk.x = BOUNDS.x0 + 6; tk.vx = Math.abs(tk.vx); }
      if (tk.x > BOUNDS.x1 - 6) { tk.x = BOUNDS.x1 - 6; tk.vx = -Math.abs(tk.vx); }
      if (tk.y < BOUNDS.y0 + 6) { tk.y = BOUNDS.y0 + 6; tk.vy = Math.abs(tk.vy); }
      if (tk.y > BOUNDS.y1 - 6) { tk.y = BOUNDS.y1 - 6; tk.vy = -Math.abs(tk.vy); }

      var d = Math.hypot(tk.x - s.p.x, tk.y - s.p.y);
      if (d < tk.r + 15) {
        s.tokens.splice(i, 1);
        s.combo++;
        s.lastPick = s.t;
        s.mult = 1 + Math.min(4, Math.floor(s.combo / 3) * 0.5);
        s.score += Math.round(10 * s.mult);
        s.context = clamp(s.context + 4.5, 0, 100);
        s.pickFlash = 1;
        burst(s, tk.x, tk.y, COL.cyan, 12, 150);
      }
    }

    // -- hazards
    if (s.t > 3.4 && s.hazards.length < 6 && s.t > s.nextHazardAt) {
      spawnHazard(s);
      s.nextHazardAt = s.t + Math.max(1.6, 3.4 - s.t * 0.03);
    }
    s.invuln = Math.max(0, s.invuln - h);
    for (var j = 0; j < s.hazards.length; j++) {
      var hz = s.hazards[j];
      hz.wob += h * hz.wobSp;
      var dx = s.p.x - hz.x, dy = s.p.y - hz.y;
      var dist = Math.max(1, Math.hypot(dx, dy));
      // soft homing plus a sideways wobble so it reads as a blob, not a missile
      var wob = Math.sin(hz.wob) * 0.55;
      var ux = dx / dist, uy = dy / dist;
      var mx = ux - uy * wob, my = uy + ux * wob;
      var mm = Math.hypot(mx, my) || 1;
      hz.x += (mx / mm) * hz.sp * h;
      hz.y += (my / mm) * hz.sp * h;

      if (dist < hz.r + 15 && s.invuln <= 0 && s.t > 0.6) {
        s.context = clamp(s.context - 14, 0, 100);
        s.combo = 0;
        s.invuln = 1.1;
        s.shake = 1;
        s.hitFlash = 1;
        burst(s, s.p.x, s.p.y, COL.magenta, 16, 190);
        // knock the blob back so it does not chain-hit
        hz.x -= ux * 46; hz.y -= uy * 46;
        s.hits++;
      }
    }

    // -- particles
    for (var p = s.parts.length - 1; p >= 0; p--) {
      var pt = s.parts[p];
      pt.t += h;
      pt.x += pt.vx * h; pt.y += pt.vy * h;
      pt.vx *= (1 - 3.2 * h); pt.vy *= (1 - 3.2 * h);
      if (pt.t >= pt.life) s.parts.splice(p, 1);
    }

    s.shake = Math.max(0, s.shake - h * 3.4);
    s.pickFlash = Math.max(0, s.pickFlash - h * 4);
    s.hitFlash = Math.max(0, s.hitFlash - h * 2.2);

    // -- end of run
    if (s.context <= 0) {
      s.context = 0;
      s.over = true;
      s.collapse = 0;
      s.endReason = 'context collapsed';
      s.best = Math.max(s.best, s.score);
      try { localStorage.setItem('cw.best', String(s.best)); } catch (e) {}
    } else if (s.t >= RUN_SECONDS) {
      s.over = true;
      s.collapse = 0;
      s.endReason = 'run complete';
      s.best = Math.max(s.best, s.score);
      try { localStorage.setItem('cw.best', String(s.best)); } catch (e) {}
    }
    if (s.over) s.collapse = Math.min(1, s.collapse + h * 1.6);
  }

  function create(seed) {
    var s0 = (seed === undefined || seed === null) ? ((Date.now() >>> 0) ^ 0x9e3779b9) : (seed >>> 0);
    rng = mulberry32(s0);
    var best = 0;
    try { best = parseInt(localStorage.getItem('cw.best') || '0', 10) || 0; } catch (e) {}

    S = {
      seed: s0, t: 0, score: 0, best: best, combo: 0, mult: 1, lastPick: -9,
      context: 100, over: false, endReason: '', collapse: 0, hits: 0,
      shake: 0, pickFlash: 0, hitFlash: 0, invuln: 0,
      p: { x: W / 2, y: (BOUNDS.y0 + BOUNDS.y1) / 2, vx: 0, vy: 0 },
      tokens: [], hazards: [], parts: [], trail: [],
      nextTokenAt: 0.15, nextHazardAt: 3.4, nextId: 1
    };
    // a couple of tokens already on screen so frame one is alive
    for (var i = 0; i < 5; i++) {
      spawnToken(S);
      S.tokens[S.tokens.length - 1].x = rr(BOUNDS.x0 + 40, BOUNDS.x1 - 40);
      S.tokens[S.tokens.length - 1].y = rr(BOUNDS.y0 + 60, BOUNDS.y1 - 60);
    }
    return S;
  }

  function step(dt, input) {
    if (!S) return null;
    if (S.over) { S.collapse = Math.min(1, S.collapse + Math.max(0, dt) * 1.6); return S; }
    var remain = Math.min(Math.max(0, dt), 0.25);
    input = input || {};
    while (remain > 1e-9) {
      var h = Math.min(FIXED, remain);
      sim(h, input);
      remain -= h;
      if (S.over) break;
    }
    return S;
  }

  // ---- drawing -------------------------------------------------------------

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(ctx) {
    if (!S) return;
    var sx = ctx.canvas.width / W, sy = ctx.canvas.height / H;
    ctx.save();
    ctx.scale(sx, sy);
    var t = S.t;
    var shake = S.shake * S.shake;
    // shake is derived from time only, so a frame at time t is always identical
    var ox = Math.sin(t * 91.3) * 13 * shake;
    var oy = Math.cos(t * 77.1) * 11 * shake;
    ctx.translate(ox, oy);

    // -- background
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0B214F');
    g.addColorStop(0.55, COL.bg);
    g.addColorStop(1, COL.bgDeep);
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // -- grid, slowly breathing
    ctx.lineWidth = 1;
    ctx.strokeStyle = COL.grid;
    var gs = 54;
    var off = (t * 6) % gs;
    ctx.beginPath();
    for (var x = -gs + off; x < W + gs; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (var y = -gs + off * 0.6; y < H + gs; y += gs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // -- playfield edge
    ctx.strokeStyle = 'rgba(79, 243, 224, 0.16)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, BOUNDS.x0 - 12, BOUNDS.y0 - 12, BOUNDS.x1 - BOUNDS.x0 + 24, BOUNDS.y1 - BOUNDS.y0 + 24, 18);
    ctx.stroke();

    // -- trail
    for (var i = 0; i < S.trail.length; i++) {
      var tr = S.trail[i];
      var a = (i / S.trail.length) * (1 - (S.t - tr.t) / 0.28);
      ctx.fillStyle = 'rgba(79, 243, 224, ' + (0.05 + a * 0.14).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, 4 + a * 7, 0, 6.2832);
      ctx.fill();
    }

    // -- tokens
    for (var k = 0; k < S.tokens.length; k++) {
      var tk = S.tokens[k];
      var pulse = 1 + Math.sin(tk.phase) * 0.08;
      var sz = tk.r * pulse;
      ctx.save();
      ctx.translate(tk.x, tk.y);
      ctx.rotate(tk.phase * 0.35);
      ctx.shadowColor = 'rgba(79, 243, 224, 0.85)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = COL.cyan;
      roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 2.5);
      ctx.fill();
      ctx.restore();
      // inner tick mark, reads like a token glyph
      ctx.fillStyle = 'rgba(9, 27, 66, 0.9)';
      ctx.fillRect(tk.x - 1.6, tk.y - sz * 0.28, 3.2, sz * 0.56);
    }

    // -- hazards
    for (var j = 0; j < S.hazards.length; j++) {
      var hz = S.hazards[j];
      ctx.save();
      ctx.translate(hz.x, hz.y);
      ctx.rotate(Math.sin(hz.wob) * 0.25);
      ctx.shadowColor = 'rgba(255, 45, 120, 0.8)';
      ctx.shadowBlur = 22;
      ctx.fillStyle = COL.magenta;
      // blobby polygon: 8 vertices with a per-instance jitter
      ctx.beginPath();
      for (var v = 0; v < 10; v++) {
        var ang = (v / 10) * 6.2832;
        var rad = hz.r * (1 + Math.sin(ang * 3 + hz.wob * 1.4 + hz.id) * 0.13);
        var px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // hollow eye: the hallucination is looking at you
      ctx.fillStyle = 'rgba(9, 27, 66, 0.65)';
      ctx.beginPath();
      ctx.arc(hz.x - hz.r * 0.18, hz.y - hz.r * 0.08, hz.r * 0.26, 0, 6.2832);
      ctx.fill();
    }

    // -- particles
    for (var p = 0; p < S.parts.length; p++) {
      var pt = S.parts[p];
      var lf = 1 - pt.t / pt.life;
      ctx.globalAlpha = lf * 0.95;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.r / 2, pt.y - pt.r / 2, pt.r, pt.r);
    }
    ctx.globalAlpha = 1;

    // -- player cursor
    if (!S.over || S.collapse < 0.55) {
      var blink = S.invuln > 0 ? (Math.sin(t * 40) > -0.2) : (Math.sin(t * 3.1) > -0.75);
      ctx.globalAlpha = blink ? 1 : 0.25;
      ctx.save();
      ctx.translate(S.p.x, S.p.y);
      ctx.fillStyle = COL.ink;
      var cw = 13;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(cw * 0.78, cw * 0.9);
      ctx.lineTo(cw * 0.5, cw * 0.62);
      ctx.lineTo(cw * 0.62, cw * 1.12);
      ctx.lineTo(cw * 0.42, cw * 1.18);
      ctx.lineTo(cw * 0.3, cw * 0.7);
      ctx.lineTo(0, 0.32 * cw);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      // soft halo
      var rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
      rg.addColorStop(0, 'rgba(79, 243, 224, ' + (0.28 + S.pickFlash * 0.5).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(79, 243, 224, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    // -- HUD
    drawHud(ctx, t);

    // -- scanline + vignette
    ctx.fillStyle = 'rgba(0, 0, 0, 0.055)';
    for (var sy2 = 0; sy2 < H; sy2 += 3) ctx.fillRect(0, sy2, W, 1);
    var vg = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.22, W / 2, H * 0.5, H * 0.75);
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(3, 8, 22, 0.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // -- hit flash
    if (S.hitFlash > 0.01) {
      ctx.fillStyle = 'rgba(255, 45, 120, ' + (S.hitFlash * 0.16).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    // -- collapse / end overlay
    if (S.over) drawOver(ctx);

    ctx.restore();
  }

  function drawHud(ctx, t) {
    var pad = 26;

    // window chrome
    ctx.fillStyle = COL.panel;
    roundRect(ctx, pad, 26, W - pad * 2, 100, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.16)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // traffic lights
    var dots = ['#FF5F57', '#FEBC2E', '#28C840'];
    for (var d = 0; d < 3; d++) {
      ctx.fillStyle = dots[d];
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(pad + 22 + d * 18, 50, 4.6, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.font = '600 13px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'left';
    ctx.fillText('context window', pad + 78, 50);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(234, 241, 255, 0.4)';
    ctx.fillText('seed ' + S.seed.toString(16).slice(0, 6), W - pad - 16, 50);

    // context bar label + numbers
    ctx.textAlign = 'left';
    ctx.font = '700 12px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    var lowCol = S.context < 30 ? COL.magenta : COL.cyan;
    ctx.fillStyle = 'rgba(234, 241, 255, 0.5)';
    ctx.fillText('CONTEXT', pad + 16, 80);
    ctx.textAlign = 'right';
    ctx.fillStyle = lowCol;
    ctx.fillText(Math.ceil(S.context) + '%', W - pad - 16, 80);

    // bar
    var bx = pad + 16, by = 92, bw = W - pad * 2 - 32, bh = 14;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundRect(ctx, bx, by, bw, bh, 7); ctx.fill();
    var fw = Math.max(0, (S.context / 100) * bw);
    if (fw > 1) {
      var bg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (S.context < 30) { bg.addColorStop(0, '#FF2D78'); bg.addColorStop(1, '#FF7AA8'); }
      else { bg.addColorStop(0, '#2BD8C4'); bg.addColorStop(1, '#4FF3E0'); }
      ctx.fillStyle = bg;
      roundRect(ctx, bx, by, fw, bh, 7); ctx.fill();
      // scrollbar-ish sheen
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(bx + 4, by + 2.5, Math.max(0, fw - 8), 2);
    }
    if (S.context < 30) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 8);
      ctx.strokeStyle = COL.magenta;
      ctx.lineWidth = 2;
      roundRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, 8); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // score row
    ctx.font = '800 34px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COL.ink;
    ctx.fillText(String(S.score).padStart(4, '0'), pad + 2, 182);
    ctx.font = '700 12px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(234, 241, 255, 0.42)';
    ctx.fillText('SCORE', pad + 2, 208);

    // combo
    if (S.mult > 1) {
      ctx.textAlign = 'left';
      ctx.font = '800 20px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.fillStyle = COL.cyan;
      var pop = 1 + S.pickFlash * 0.22;
      var cx = pad + 108;
      ctx.save();
      ctx.translate(cx, 176);
      ctx.scale(pop, pop);
      ctx.fillText('x' + S.mult.toFixed(1), 0, 0);
      ctx.restore();
      ctx.font = '700 11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(234, 241, 255, 0.4)';
      ctx.fillText('combo ' + S.combo + ' · ' + Math.max(0, 2 - (S.t - S.lastPick)).toFixed(1) + 's', pad + 108, 200);
    }

    // timer
    var left = Math.max(0, RUN_SECONDS - S.t);
    ctx.textAlign = 'right';
    ctx.font = '800 24px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = left < 10 ? COL.magenta : 'rgba(234, 241, 255, 0.8)';
    ctx.fillText(left.toFixed(1).padStart(4, '0'), W - pad - 2, 180);
    ctx.font = '700 11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(234, 241, 255, 0.4)';
    ctx.fillText('RUN', W - pad - 2, 204);

    // best
    ctx.textAlign = 'right';
    ctx.font = '700 11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(234, 241, 255, 0.28)';
    ctx.fillText('BEST ' + String(Math.max(S.best, S.score)).padStart(4, '0'), W - pad - 2, 220);
  }

  function drawOver(ctx) {
    var c = S.collapse;
    ctx.fillStyle = 'rgba(6, 15, 36, ' + (0.72 * c).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);

    // the window collapsing: two half-panels sliding shut
    var gap = (1 - c) * 300;
    ctx.fillStyle = '#050D24';
    ctx.fillRect(0, 0, W, H / 2 - gap);
    ctx.fillRect(0, H / 2 + gap, W, H);

    if (c > 0.45) {
      var a = clamp((c - 0.45) / 0.55, 0, 1);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COL.magenta;
      ctx.font = '800 15px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.fillText('// WINDOW CLOSED', W / 2, H / 2 - 84);
      ctx.fillStyle = COL.ink;
      ctx.font = '800 62px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.fillText(String(S.score), W / 2, H / 2 - 20);
      ctx.fillStyle = 'rgba(234, 241, 255, 0.6)';
      ctx.font = '700 16px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.fillText(S.endReason + ' · best ' + S.best, W / 2, H / 2 + 40);
      ctx.fillStyle = COL.cyan;
      ctx.font = '700 14px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.fillText('press R or tap to run again', W / 2, H / 2 + 96);
      ctx.globalAlpha = 1;
    }
  }

  window.CW = {
    W: W, H: H, RUN_SECONDS: RUN_SECONDS, BOUNDS: BOUNDS,
    create: create, step: step, draw: draw,
    state: function () { return S; }
  };
})();
