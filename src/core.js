/* Kart sim core: track geometry, racing line, speed profile, vehicle dynamics, AI.
   Physics frame: X right, Y "up the map" (Y = -z in three.js), angles CCW. */
(function (root) {
  const G = 9.81;
  const KARTS = {
    adult: { name: 'Adult', mass: 245, Iz: 52, L: 1.05, power: 14900, fMax: 1250, vMax: 15.65, regen: 300,
      brakeMax: 2900, vRev: 5.5, revForce: 1700, grip: 2.1, yawResp: 11.5, latGrip: 20, steerMax: 0.62, steerFade: 1000, cda: 0.62, crr: 0.018 },
    drift: { name: 'Drift', mass: 240, Iz: 50, L: 1.05, power: 12500, fMax: 1150, vMax: 13.4, regen: 200,
      brakeMax: 2500, vRev: 5, revForce: 1600, grip: 1.75, yawResp: 9, latGrip: 13, steerMax: 0.7, steerFade: 1000, cda: 0.62, crr: 0.016, drift: true },
    junior: { name: 'Junior', mass: 190, Iz: 40, L: 1.0, power: 4500, fMax: 720, vMax: 8.94, regen: 200,
      brakeMax: 2200, vRev: 4, revForce: 1300, grip: 2.1, yawResp: 11.5, latGrip: 20, steerMax: 0.62, steerFade: 1000, cda: 0.5, crr: 0.018 },
  };
  const wrap = (i, n) => ((i % n) + n) % n;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function curvature3(ax, ay, bx, by, cx, cy) {
    const d1x = bx - ax, d1y = by - ay, d2x = cx - bx, d2y = cy - by;
    const cr = d1x * d2y - d1y * d2x;
    return (2 * cr) / (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y) * Math.hypot(cx - ax, cy - ay) + 1e-9);
  }
  function buildTrack(T, field) {
    const N = T.x.length, F = () => new Float64Array(N);
    const tr = { N, x: F(), y: F(), tx: F(), ty: F(), nx: F(), ny: F(), wl: F(), wr: F(), k: F(),
      s: new Float64Array(N + 1), ledL: new Uint8Array(N), ledR: new Uint8Array(N) };
    for (let i = 0; i < N; i++) {
      tr.x[i] = T.x[i]; tr.y[i] = -T.z[i]; tr.wl[i] = T.wl[i]; tr.wr[i] = T.wr[i];
      tr.ledL[i] = T.bl.charCodeAt(i) === 49 ? 1 : 0; tr.ledR[i] = T.br.charCodeAt(i) === 49 ? 1 : 0;
    }
    for (let i = 0; i < N; i++) {
      const a = wrap(i - 1, N), b = wrap(i + 1, N);
      let dx = tr.x[b] - tr.x[a], dy = tr.y[b] - tr.y[a]; const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      tr.tx[i] = dx; tr.ty[i] = dy; tr.nx[i] = -dy; tr.ny[i] = dx;
      tr.k[i] = curvature3(tr.x[a], tr.y[a], tr.x[i], tr.y[i], tr.x[b], tr.y[b]);
    }
    for (let i = 0; i < N; i++) { // inner edge never folds over in hairpins
      let km = 0;
      for (let j = -3; j <= 3; j++) { const kk = tr.k[wrap(i + j, N)]; if (Math.abs(kk) > Math.abs(km)) km = kk; }
      const lim = 0.82 / Math.max(Math.abs(km), 1e-4);
      if (km > 0) tr.wl[i] = Math.min(tr.wl[i], lim); else tr.wr[i] = Math.min(tr.wr[i], lim);
      tr.wl[i] = Math.max(tr.wl[i], 1.5); tr.wr[i] = Math.max(tr.wr[i], 1.5);
    }
    for (let i = 0; i < N; i++) { const b = wrap(i + 1, N); tr.s[i + 1] = tr.s[i] + Math.hypot(tr.x[b] - tr.x[i], tr.y[b] - tr.y[i]); }
    if (field) { tr.field = field;
      // re-centre the traced centreline between the real walls, then rebuild its frame
      const frame = () => { for (let i = 0; i < N; i++) { const a = wrap(i - 1, N), b = wrap(i + 1, N); let dx = tr.x[b] - tr.x[a], dy = tr.y[b] - tr.y[a]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        tr.tx[i] = dx; tr.ty[i] = dy; tr.nx[i] = -dy; tr.ny[i] = dx; tr.k[i] = curvature3(tr.x[a], tr.y[a], tr.x[i], tr.y[i], tr.x[b], tr.y[b]); } };
      const march = (i, side) => { let d = 0; while (d < 12 && sdf(field, tr.x[i] + tr.nx[i] * d * side, tr.y[i] + tr.ny[i] * d * side) > 0.05) d += 0.1; return d; };
      for (let it = 0; it < 40; it++) {
        frame();
        const sh = new Float64Array(N);
        for (let i = 0; i < N; i++) { const l = march(i, 1), r = march(i, -1); sh[i] = clamp((l - r) * 0.35, -0.6, 0.6); }
        for (let i = 0; i < N; i++) { tr.x[i] += tr.nx[i] * sh[i]; tr.y[i] += tr.ny[i] * sh[i]; }
        for (let p = 0; p < 2; p++) for (let i = 0; i < N; i++) { const a = wrap(i - 1, N), b = wrap(i + 1, N);
          const px = tr.x[i] * 0.5 + (tr.x[a] + tr.x[b]) * 0.25, py = tr.y[i] * 0.5 + (tr.y[a] + tr.y[b]) * 0.25;
          if (sdf(field, px, py) > 0.8) { tr.x[i] = px; tr.y[i] = py; } }
        const cum = [0]; for (let i = 0; i < N; i++) { const b2 = wrap(i + 1, N); cum.push(cum[i] + Math.hypot(tr.x[b2] - tr.x[i], tr.y[b2] - tr.y[i])); }
        const X = Float64Array.from(tr.x), Y = Float64Array.from(tr.y), Lt = cum[N]; let j = 0;
        for (let i = 0; i < N; i++) { const t = (i * Lt) / N; while (cum[j + 1] < t) j++; const f = (t - cum[j]) / (cum[j + 1] - cum[j] || 1), b2 = wrap(j + 1, N);
          tr.x[i] = X[j] + (X[b2] - X[j]) * f; tr.y[i] = Y[j] + (Y[b2] - Y[j]) * f; }
      }
      frame();
      for (let i = 0; i < N; i++) { const b = wrap(i + 1, N); tr.s[i + 1] = tr.s[i] + Math.hypot(tr.x[b] - tr.x[i], tr.y[b] - tr.y[i]); }
      for (let i = 0; i < N; i++) for (const side of [1, -1]) { let d = 0; while (d < 14 && sdf(field, tr.x[i] + tr.nx[i] * d * side, tr.y[i] + tr.ny[i] * d * side) > 0.05) d += 0.1; if (side > 0) tr.wl[i] = d; else tr.wr[i] = d; }
      for (let i = 0; i < N; i++) { let km = 0; for (let j = -2; j <= 2; j++) { const kk = tr.k[wrap(i + j, N)]; if (Math.abs(kk) > Math.abs(km)) km = kk; } const lim = 0.95 / Math.max(Math.abs(km), 1e-4); if (km > 0) tr.wl[i] = Math.min(tr.wl[i], lim); else tr.wr[i] = Math.min(tr.wr[i], lim); tr.wl[i] = Math.max(tr.wl[i], 1.2); tr.wr[i] = Math.max(tr.wr[i], 1.2); } }
    tr.length = tr.s[N];
    return tr;
  }
  function project(tr, px, py, hint, back = 6, fwd = 10) {
    const N = tr.N; let best = 1e18, bi = hint, bt = 0;
    for (let j = -back; j <= fwd; j++) {
      const i = wrap(hint + j, N), b = wrap(i + 1, N);
      const ax = tr.x[i], ay = tr.y[i], dx = tr.x[b] - ax, dy = tr.y[b] - ay;
      const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const qx = ax + dx * t - px, qy = ay + dy * t - py, d = qx * qx + qy * qy;
      if (d < best) { best = d; bi = i; bt = t; }
    }
    const b = wrap(bi + 1, N);
    let nx = tr.nx[bi] * (1 - bt) + tr.nx[b] * bt, ny = tr.ny[bi] * (1 - bt) + tr.ny[b] * bt;
    const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    const cx = tr.x[bi] + (tr.x[b] - tr.x[bi]) * bt, cy = tr.y[bi] + (tr.y[b] - tr.y[bi]) * bt;
    return { i: bi, t: bt, lat: (px - cx) * nx + (py - cy) * ny, nx, ny,
      wl: tr.wl[bi] * (1 - bt) + tr.wl[b] * bt, wr: tr.wr[bi] * (1 - bt) + tr.wr[b] * bt,
      s: tr.s[bi] + (tr.s[bi + 1] - tr.s[bi]) * bt };
  }
  function racingLine(tr, margin = 0.9, iters = 2500) {
    const N = tr.N, o = new Float64Array(N), X = new Float64Array(N), Y = new Float64Array(N);
    const upd = (i) => { X[i] = tr.x[i] + tr.nx[i] * o[i]; Y[i] = tr.y[i] + tr.ny[i] * o[i]; };
    for (let i = 0; i < N; i++) upd(i);
    for (let it = 0; it < iters; it++) for (let i = 0; i < N; i++) {
      const a2 = wrap(i - 2, N), a = wrap(i - 1, N), b = wrap(i + 1, N), b2 = wrap(i + 2, N);
      const mx = (-X[a2] + 4 * X[a] + 4 * X[b] - X[b2]) / 6, my = (-Y[a2] + 4 * Y[a] + 4 * Y[b] - Y[b2]) / 6;
      const d = (mx - X[i]) * tr.nx[i] + (my - Y[i]) * tr.ny[i];
      o[i] = clamp(o[i] + 0.5 * d, -(tr.wr[i] - margin), tr.wl[i] - margin); upd(i);
    }
    return { o, x: X, y: Y };
  }
  function driveForce(kp, v, thr, over = 0) {
    if (thr <= 0) return 0;
    let f = thr * Math.min(kp.fMax, kp.power / Math.max(v, 0.5));
    const vm = kp.vMax + over; if (v > vm - 0.4) f *= clamp((vm - v) / 0.4, 0, 1); // speed governor (a draft lets you creep a little over it)
    return f;
  }
  function speedProfile(px, py, kp, muScale = 0.95) {
    const N = px.length, ds = new Float64Array(N), k = new Float64Array(N), v = new Float64Array(N), ks = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = wrap(i - 1, N), b = wrap(i + 1, N);
      ds[i] = Math.hypot(px[b] - px[i], py[b] - py[i]); k[i] = curvature3(px[a], py[a], px[i], py[i], px[b], py[b]);
    }
    for (let i = 0; i < N; i++) ks[i] = (k[wrap(i - 1, N)] + 2 * k[i] + k[wrap(i + 1, N)]) / 4;
    const mu = kp.grip * muScale, m = kp.mass;
    for (let i = 0; i < N; i++) v[i] = Math.min(kp.vMax, Math.sqrt((mu * G) / Math.max(Math.abs(ks[i]), 1e-5)));
    const ell = (vv, i) => Math.sqrt(Math.max(0, 1 - Math.min(1, (vv * vv * Math.abs(ks[i])) / (mu * G)) ** 2));
    const res = (vv) => (0.6 * kp.cda * vv * vv + kp.crr * m * G) / m;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < N; i++) {
        const b = wrap(i + 1, N), vv = v[i];
        const a = driveForce(kp, vv, 1) / m * Math.max(0.6, ell(vv, i)) - res(vv);
        const vn = Math.sqrt(Math.max(0.1, vv * vv + 2 * a * ds[i])); if (vn < v[b]) v[b] = vn;
      }
      for (let j = N - 1; j >= 0; j--) {
        const i = wrap(j + 1, N), vv = v[i];
        const brk = (kp.brakeMax / m) * Math.max(0.6, ell(vv, i)) * 0.85;
        const vn = Math.sqrt(vv * vv + 2 * (brk + res(vv)) * ds[j]); if (vn < v[j]) v[j] = vn;
      }
    }
    let t = 0; const time = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) { const b = wrap(i + 1, N); t += ds[i] / ((v[i] + v[b]) / 2); time[i + 1] = t; }
    return { v, ds, k: ks, lap: t, time };
  }
  function makeKart(kp) {
    return { kp, x: 0, y: 0, psi: 0, vx: 0, vy: 0, r: 0, ax: 0, ay: 0, delta: 0, throttle: 0, brake: 0, steer: 0,
      slipF: 0, slipR: 0, locked: false, under: false, reversing: false, revT: 0, wallT: 0, hint: 0, lat: 0, s: 0, hit: 0, bump: 0, wheelRot: 0,
      slide: 0, draft: 0, bumpG: 1, bumpH: 0, scrape: 0 };
  }
  function sdf(f, x, y) {
    let gx = (x - f.x0) / f.res - 0.5, gz = (-y - f.z0) / f.res - 0.5;
    gx = clamp(gx, 0, f.w - 1.001); gz = clamp(gz, 0, f.h - 1.001);
    const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz, w = f.w, D = f.d, o = iz * w + ix;
    return ((D[o] * (1 - fx) + D[o + 1] * fx) * (1 - fz) + (D[o + w] * (1 - fx) + D[o + w + 1] * fx) * fz - 128) / 100;
  }
  // Bumpy braking zones: a patch of uneven concrete. Returns surface height (m) and a grip/brake factor (<1 on the crests).
  function bumpAt(zones, x, y) {
    let wgt = 0;
    for (const z of zones) { const d = Math.hypot(x - z.x, y - z.y); if (d < z.r) wgt = Math.max(wgt, Math.min(1, (z.r - d) / 4)); }
    if (wgt <= 0) return { g: 1, h: 0 };
    const h = 0.6 * Math.sin(x * 2.1 + y * 0.9) * Math.sin(y * 2.7 - x * 0.6) + 0.4 * Math.sin(x * 4.7 + y * 3.9 + 1.3);
    const q = Math.sin(x * 1.7 - y * 2.3 + 0.4) * Math.sin(x * 0.8 + y * 3.1);
    return { g: 1 - wgt * 0.34 * Math.max(0, q) - wgt * 0.08, h: wgt * 0.018 * h };
  }
  // Grip-first kart model: the tyres hold whatever line you ask for up to the grip limit, past it the front washes wide.
  // The rear can still let go: karts brake on the rear axle only, so heavy braking while turning hard (or a bump
  // mid-corner) overloads the rear tyres and the kart starts to rotate. Lift and countersteer to catch it, or it spins.
  function stepKart(k, dt) {
    const kp = k.kp, m = kp.mass, L = kp.L;
    const v = k.vx, av = Math.abs(v);
    const lock = kp.steerMax / (1 + av / kp.steerFade);
    k.delta += clamp(k.steer * lock - k.delta, -4.2 * dt, 4.2 * dt); // ~1.3x the original 3.2 rad/s rack
    const thr = k.throttle, brk = k.brake, bg = k.bumpG == null ? 1 : k.bumpG, dr = k.draft || 0;
    let F = 0;
    if (thr > 0.05) { if (v > -0.3) F += driveForce(kp, Math.max(v, 0), thr, k.vLim ? Math.min(dr * 0.6, k.vLim - kp.vMax) : dr * 0.6); else F += kp.brakeMax * thr; }
    if (k.vLim && v > k.vLim + 0.3) F -= kp.brakeMax * 0.35; // pit limiter pulls you down to the limit
    k.reversing = false;
    if (brk > 0.05) {
      if (v > 0.35) { F -= brk * kp.brakeMax * bg; k.revT = 0; }
      else {
        k.revT = (k.revT || 0) + dt;
        if (k.revT > 0.12 && thr < 0.05) { k.reversing = true; if (v > -kp.vRev) F -= brk * kp.revForce; }
        else if (v > 0) { k.vx = 0; }
      }
    } else k.revT = 0;
    if (thr < 0.05 && brk < 0.05 && av > 0.5) F -= Math.sign(v) * kp.regen; // lift-off regen
    F -= 0.6 * kp.cda * (1 - 0.45 * dr) * v * av + (av > 0.05 ? kp.crr * m * G * Math.sign(v) : 0);
    const ax = F / m;
    const gmax = kp.grip * G * (0.8 + 0.2 * bg);
    const fc = Math.sqrt(Math.max(0.6, 1 - (ax / gmax) ** 2));
    const rWant = (k.vx * Math.tan(k.delta)) / L;
    const rMax = (gmax * fc) / Math.max(av, 0.5);
    const rT = clamp(rWant, -rMax, rMax);
    k.under = Math.abs(rWant) > rMax * 1.02 && av > 3;
    const over = Math.abs(rWant) / Math.max(rMax, 1e-6) - 1;
    if (over > 0 && av > 2) { const sc = Math.sign(v) * m * G * 0.45 * Math.min(1, over * 1.5); k.vx -= (sc / m) * dt; }
    // rear breakaway
    const brkF = v > 0.35 ? brk : 0;
    const rearCap = gmax * (kp.drift ? (0.74 - 0.18 * thr) : 1) * (1 - 0.5 * brkF) * (0.72 + 0.28 * bg);
    const demand = Math.abs(k.vx * k.r);
    const counter = k.r * k.delta < 0 && Math.abs(k.delta) > 0.04 ? Math.min(1, Math.abs(k.delta) / 0.25) : 0;
    if (av > 5 && demand > rearCap * 1.06) k.slide += (demand / rearCap - 1.06) * 6 * dt;
    else k.slide -= (kp.drift ? (thr < 0.05 ? 1.1 : 0.35) : (thr < 0.05 && brkF < 0.1 ? 1.5 : 0.9)) * dt;
    k.slide -= counter * (kp.drift ? 0.9 : 1.6) * dt;
    k.slide = clamp(k.slide, 0, kp.drift ? 1 : 1.6);
    const sl = Math.min(1, k.slide);
    const wt = k.wallT > 0 ? Math.min(1, k.wallT / 0.25) : 0;
    k.r += (rT - k.r) * Math.min(1, kp.yawResp * (1 - 0.88 * sl) * (1 - 0.55 * wt) * dt);
    if (sl > 0.02 && av > 1) k.r += Math.sign(k.r) * sl * sl * (kp.drift ? 7 : 12) * Math.min(1, av / 8) * (1 - (kp.drift ? 0.95 : 0.7) * counter) * dt;
    if (kp.drift && av > 2) { const beta = Math.atan2(k.vy, Math.max(Math.abs(k.vx), 0.5)); const ex = Math.abs(beta) - 0.5; if (ex > 0 && k.r * beta < 0) k.r -= Math.sign(k.r) * ex * 9 * dt; } // past ~30 deg the hard rear bites back: drifts hold an angle instead of spinning
    k.r = clamp(k.r, -7, 7);
    const lg = kp.latGrip * (1 - 0.45 * wt) * (1 - 0.85 * sl);
    let nvx = k.vx + (ax + k.vy * k.r) * dt;
    let nvy = (k.vy - k.vx * k.r * dt + k.vx * rT * dt) * Math.exp(-lg * dt);
    if (sl > 0.05) { const sp = Math.hypot(nvx, nvy); if (sp > 0.1) { const f = Math.max(0, 1 - sl * (kp.drift ? 0.9 : 2.5) * dt / Math.max(sp, 1)); nvx *= f; nvy *= f; } }
    if (k.wallT > 0) k.wallT -= dt;
    if (Math.abs(nvx) < 0.03 && thr < 0.05 && !k.reversing) nvx = 0;
    k.vx = nvx; k.vy = nvy; k.ax = ax; k.ay = nvx * k.r;
    const c = Math.cos(k.psi), s = Math.sin(k.psi);
    k.x += (c * nvx - s * nvy) * dt; k.y += (s * nvx + c * nvy) * dt; k.psi += k.r * dt;
    k.slipR = Math.atan2(Math.abs(nvy), Math.max(av, 1)); k.slipF = k.under ? 0.3 : 0; k.locked = sl > 0.35 && brkF > 0.5;
    k.wheelRot += (nvx / 0.13) * dt;
  }
  const CORNERS = [[1,0],[-0.94,0],[1,0.25],[1,-0.25],[0.99,0.45],[0.99,-0.45],[0.86,0.55],[0.86,-0.55],[0.72,0.6],[0.72,-0.6],[0.58,0.67],[0.58,-0.67],[0.45,0.63],[0.45,-0.63],[0.38,0.69],[0.38,-0.69],[0.2,0.69],[0.2,-0.69],[0,0.69],[0,-0.69],[-0.2,0.69],[-0.2,-0.69],[-0.34,0.69],[-0.34,-0.69],[-0.42,0.68],[-0.42,-0.68],[-0.5,0.68],[-0.5,-0.68],[-0.6,0.68],[-0.6,-0.68],[-0.7,0.72],[-0.7,-0.72],[-0.78,0.78],[-0.78,-0.78],[-0.85,0.7],[-0.85,-0.7],[-0.9,0.58],[-0.9,-0.58],[-0.93,0.4],[-0.93,-0.4],[-0.935,0.2],[-0.935,-0.2]]; // full kart outline
  // Barrier contact: proper rigid-body impulses at each touching corner (restitution ~0.2, plastic-on-plastic friction ~0.25),
  // including the yaw the hit puts into the kart. No heading snaps: a nose-first hit turns the kart away from the wall
  // because the push lands ahead of the centre of mass; a rear clip kicks the tail. For a moment after a hit the tyres
  // are sliding, so that rotation is allowed to play out before grip takes over again.
  function collideWalls(k, tr, dt = 1 / 240) {
    const p = project(tr, k.x, k.y, k.hint); k.hint = p.i; k.lat = p.lat; k.s = p.s;
    const f = tr.cfield || tr.field, kp = k.kp, hits = [];
    let cnX = 0, cnY = 0, front = false;
    { const c = Math.cos(k.psi), s = Math.sin(k.psi);
      for (const [bx, by] of CORNERS) {
        const wx = k.x + c * bx - s * by, wy = k.y + s * bx + c * by, d = sdf(f, wx, wy);
        if (d >= 0.03) continue;
        let nX = sdf(f, wx + 0.1, wy) - sdf(f, wx - 0.1, wy), nY = sdf(f, wx, wy + 0.1) - sdf(f, wx, wy - 0.1);
        const nl = Math.hypot(nX, nY); if (nl < 1e-6) continue; nX /= nl; nY /= nl;
        const pen = 0.03 - d; k.x += nX * pen; k.y += nY * pen;
        hits.push({ bx, by, nX, nY, d }); cnX += nX; cnY += nY; if (bx > 0.5) front = true;
      } }
    let impact = 0;
    if (hits.length) {
      hits.sort((a, b) => a.d - b.d);
      for (const h of hits) {
        const c = Math.cos(k.psi), s = Math.sin(k.psi), rx = c * h.bx - s * h.by, ry = s * h.bx + c * h.by, { nX, nY } = h;
        const WX = c * k.vx - s * k.vy, WY = s * k.vx + c * k.vy;
        const vpx = WX - k.r * ry, vpy = WY + k.r * rx, vn = vpx * nX + vpy * nY;
        if (vn >= 0) continue;
        impact = Math.max(impact, -vn);
        const IZ = kp.Iz * 6; // compliant bumper: the hit is spread out, so the tyres soak up much of the yaw
        const rxn = rx * nY - ry * nX, j = (-(1 + 0.15) * vn) / (1 / kp.mass + (rxn * rxn) / IZ);
        const tX = -nY, tY = nX, vt = vpx * tX + vpy * tY, rxt = rx * tY - ry * tX;
        const jt = clamp(-vt / (1 / kp.mass + (rxt * rxt) / IZ), -0.22 * j, 0.22 * j);
        const nVx = WX + (j * nX + jt * tX) / kp.mass, nVy = WY + (j * nY + jt * tY) / kp.mass;
        k.r += clamp((rxn * j + rxt * jt) / IZ, -1.2, 1.2);
        k.vx = c * nVx + s * nVy; k.vy = -s * nVx + c * nVy;
      }
      if (impact > 0.3) k.wallT = Math.max(k.wallT || 0, Math.min(0.22, 0.06 + impact * 0.03));
      // Pinned nose-first at low speed: let steering (or the wall's slope) pivot the nose off so you can always drive away.
      const cl = Math.hypot(cnX, cnY);
      if (front && cl > 1e-6 && Math.abs(k.vx) < 2.5) {
        const nx = cnX / cl, ny = cnY / cl, c2 = Math.cos(k.psi), s2 = Math.sin(k.psi), into = c2 * nx + s2 * ny;
        if (into < -0.3) {
          let side = c2 * -ny + s2 * nx; if (Math.abs(side) < 0.35) side = tr.tx[k.hint] * -ny + tr.ty[k.hint] * nx;
          const tA = Math.atan2(side > 0 ? nx : -nx, side > 0 ? -ny : ny);
          let dA = tA - k.psi; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
          const turn = Math.abs(k.steer) > 0.3 ? k.steer * 2.0 * dt : clamp(dA, -1.5 * dt, 1.5 * dt);
          const WX = c2 * k.vx - s2 * k.vy, WY = s2 * k.vx + c2 * k.vy; k.psi += turn;
          const c3 = Math.cos(k.psi), s3 = Math.sin(k.psi); k.vx = c3 * WX + s3 * WY; k.vy = -s3 * WX + c3 * WY;
        }
      }
      k.scrape = 1; if (Math.abs(k.vx) > 1) k.vx *= 1 - 0.7 * dt; // rubbing the barrier always costs a little
    } else k.scrape = 0;
    // Centre ever ends up past the wall line: put it back on the track.
    const dc = sdf(f, k.x, k.y);
    if (dc < 0.5) { let gX = sdf(f, k.x + 0.15, k.y) - sdf(f, k.x - 0.15, k.y), gY = sdf(f, k.x, k.y + 0.15) - sdf(f, k.x, k.y - 0.15); const gl = Math.hypot(gX, gY);
      if (gl > 1e-6) { k.x += (gX / gl) * (0.5 - dc) * 0.5; k.y += (gY / gl) * (0.5 - dc) * 0.5; } }
    k.hit = impact; return impact;
  }
  // Kart-to-kart: big plastic bumpers. Contact shoves and scrubs speed but only nudges the heading;
  // a hard side hit can unsettle the rear a little.
  function collideKarts(karts) {
    const R = 0.66, offs = [0.55, -0.1, -0.6];
    for (let a = 0; a < karts.length; a++) for (let b = a + 1; b < karts.length; b++) {
      const A = karts[a], Bk = karts[b];
      if ((A.x - Bk.x) ** 2 + (A.y - Bk.y) ** 2 > 9) continue;
      let best = null;
      const ca = Math.cos(A.psi), sa = Math.sin(A.psi), cb = Math.cos(Bk.psi), sb = Math.sin(Bk.psi);
      for (const oa of offs) for (const ob of offs) {
        const dx = Bk.x + cb * ob - (A.x + ca * oa), dy = Bk.y + sb * ob - (A.y + sa * oa), dist = Math.hypot(dx, dy);
        if (dist < 2 * R && dist > 1e-6 && (!best || dist < best.dist)) best = { dx: dx / dist, dy: dy / dist, dist, oa, ob };
      }
      if (!best) continue;
      const { dx, dy, oa, ob } = best, pen = 2 * R - best.dist;
      A.x -= (dx * pen) / 2; A.y -= (dy * pen) / 2; Bk.x += (dx * pen) / 2; Bk.y += (dy * pen) / 2;
      const VAx = ca * A.vx - sa * A.vy, VAy = sa * A.vx + ca * A.vy, VBx = cb * Bk.vx - sb * Bk.vy, VBy = sb * Bk.vx + cb * Bk.vy;
      const rel = (VBx - VAx) * dx + (VBy - VAy) * dy; if (rel >= 0) continue;
      const ma = A.kp.mass, mb = Bk.kp.mass, inv = 1 / ma + 1 / mb, j = (-1.12 * rel) / inv;
      const tX = -dy, tY = dx, relt = (VBx - VAx) * tX + (VBy - VAy) * tY, jt = clamp(-relt / inv, -0.3 * j, 0.3 * j);
      const nAx = VAx - (j * dx + jt * tX) / ma, nAy = VAy - (j * dy + jt * tY) / ma, nBx = VBx + (j * dx + jt * tX) / mb, nBy = VBy + (j * dy + jt * tY) / mb;
      A.vx = ca * nAx + sa * nAy; A.vy = -sa * nAx + ca * nAy; Bk.vx = cb * nBx + sb * nBy; Bk.vy = -sb * nBx + cb * nBy;
      A.r -= (oa * (-sa * dx + ca * dy) * j * 0.12) / A.kp.Iz; Bk.r += (ob * (-sb * dx + cb * dy) * j * 0.12) / Bk.kp.Iz;
      const side = Math.abs(-sa * dx + ca * dy);
      A.slide = Math.min(1.2, (A.slide || 0) + Math.min(0.3, -rel * 0.05 * side)); Bk.slide = Math.min(1.2, (Bk.slide || 0) + Math.min(0.3, -rel * 0.05 * Math.abs(-sb * dx + cb * dy)));
      A.wallT = Bk.wallT = 0.1;
      A.bump = Math.max(A.bump, -rel); Bk.bump = Math.max(Bk.bump, -rel);
    }
  }
  // Slipstream: sitting 1-9 m behind another kart, roughly in line, cuts drag and lets the governor creep over.
  function slipstream(karts, dt) {
    for (const a of karts) {
      let best = 0; const c = Math.cos(a.psi), s = Math.sin(a.psi);
      for (const b of karts) {
        if (b === a || b.vx < 6) continue;
        const dx = b.x - a.x, dy = b.y - a.y, fwd = c * dx + s * dy, lat = -s * dx + c * dy;
        if (fwd > 1.2 && fwd < 9 && Math.abs(lat) < 1.2) best = Math.max(best, (1 - (fwd - 1.2) / 7.8) * (1 - Math.abs(lat) / 1.2) * 1.4);
      }
      a.draft += (Math.min(1, best) - a.draft) * Math.min(1, 6 * dt);
    }
  }
  // Free elastic-band racing line: minimise curvature while staying `margin` metres off every wall.
  function racingLine2(tr, margin = 0.95, iters = 6000) {
    const f = tr.field, N = tr.N, X = Float64Array.from(tr.x), Y = Float64Array.from(tr.y);
    const push = (i) => { for (let r = 0; r < 4; r++) { const d = sdf(f, X[i], Y[i]); if (d >= margin) return;
      const gx = sdf(f, X[i] + 0.1, Y[i]) - sdf(f, X[i] - 0.1, Y[i]), gy = sdf(f, X[i], Y[i] + 0.1) - sdf(f, X[i], Y[i] - 0.1), l = Math.hypot(gx, gy);
      if (l < 1e-6) return; X[i] += (gx / l) * (margin - d); Y[i] += (gy / l) * (margin - d); } };
    const resample = () => { const cum = [0]; for (let i = 0; i < N; i++) { const b = wrap(i + 1, N); cum.push(cum[i] + Math.hypot(X[b] - X[i], Y[b] - Y[i])); }
      const X0 = Float64Array.from(X), Y0 = Float64Array.from(Y), Lt = cum[N]; let j = 0;
      for (let i = 0; i < N; i++) { const t = (i * Lt) / N; while (cum[j + 1] < t) j++; const u = (t - cum[j]) / (cum[j + 1] - cum[j] || 1), b = wrap(j + 1, N); X[i] = X0[j] + (X0[b] - X0[j]) * u; Y[i] = Y0[j] + (Y0[b] - Y0[j]) * u; } };
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a2 = wrap(i - 2, N), a = wrap(i - 1, N), b = wrap(i + 1, N), b2 = wrap(i + 2, N);
        const tx = X[b] - X[a], ty = Y[b] - Y[a], l = Math.hypot(tx, ty) || 1, nx = -ty / l, ny = tx / l;
        const mx = (-X[a2] + 4 * X[a] + 4 * X[b] - X[b2]) / 6, my = (-Y[a2] + 4 * Y[a] + 4 * Y[b] - Y[b2]) / 6;
        const d = clamp(((mx - X[i]) * nx + (my - Y[i]) * ny) * 0.5, -0.12, 0.12);
        X[i] += nx * d; Y[i] += ny * d; push(i);
      }
      if (it % 50 === 49) resample();
    }
    resample();
    const L = { N, x: X, y: Y, nx: new Float64Array(N), ny: new Float64Array(N), wl: new Float64Array(N), wr: new Float64Array(N), s: new Float64Array(N + 1) };
    for (let i = 0; i < N; i++) { const a = wrap(i - 1, N), b = wrap(i + 1, N); const tx = X[b] - X[a], ty = Y[b] - Y[a], l = Math.hypot(tx, ty) || 1; L.nx[i] = -ty / l; L.ny[i] = tx / l;
      L.s[i + 1] = L.s[i] + Math.hypot(X[b] - X[i], Y[b] - Y[i]); }
    L.k = new Float64Array(N); for (let i = 0; i < N; i++) { const a = wrap(i - 2, N), b = wrap(i + 2, N); L.k[i] = curvature3(X[a], Y[a], X[i], Y[i], X[b], Y[b]); }
    L.length = L.s[N];
    return L;
  }
  // AI driver. Personality: pace (target speed vs the ideal profile), cons (consistency: line accuracy,
  // braking-point scatter, mistakes), aggr (how readily it attacks and defends).
  function makeAI(level, rnd = Math.random) {
    const d = clamp(level, 0, 1), j = (a) => (rnd() * 2 - 1) * a;
    return { pace: clamp(0.86 + 0.14 * d + j(0.018), 0.8, 1.01), cons: clamp(0.5 + 0.46 * d + j(0.1), 0.3, 0.99), aggr: clamp(0.25 + 0.5 * d + j(0.25), 0.05, 1),
      li: null, offset: 0, offTarget: 0, wander: 0, wTgt: 0, wT: 0, errMul: 1, errT: 0, passSide: 0, passT: 0, sNoise: 0, rnd };
  }
  function signedGap(a, b, L) { let ds = b.s - a.s; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L; return ds; }
  function driveAI(k, ai, tr, line, prof, others, dt) {
    if (ai.pace == null) Object.assign(ai, makeAI(ai.skill != null ? (ai.skill - 0.9) / 0.1 : 0.7));
    if (ai.path) return followPath(k, ai);
    const N = line.N, spd = Math.hypot(k.vx, k.vy), L = tr.length, rnd = ai.rnd || Math.random;
    const p = project(line, k.x, k.y, ai.li == null ? nearest(line, k.x, k.y) : ai.li, 6, 10); ai.li = p.i;
    const myLat = p.lat;
    // Inconsistency: braking-point / corner-speed scatter and a wandering line, re-rolled every few seconds.
    ai.errT -= dt; if (ai.errT <= 0) { ai.errT = 2 + rnd() * 3; const e = (1 - ai.cons); ai.errMul = 1 + (rnd() - 0.4) * e * 0.16; if (rnd() < e * 0.18) ai.errMul += 0.06 + rnd() * 0.06; }
    ai.wT -= dt; if (ai.wT <= 0) { ai.wT = 1 + rnd() * 2; ai.wTgt = (rnd() * 2 - 1) * (1 - ai.cons) * 1.1; }
    ai.wander += clamp(ai.wTgt - ai.wander, -0.5 * dt, 0.5 * dt);
    // Traffic: nearest kart ahead and behind.
    let ahead = null, gapA = 1e9, behind = null, gapB = 1e9;
    for (const o of others) { if (o === k) continue; const ds = signedGap(k, o, L);
      if (ds > 0 && ds < 14 && ds < gapA) { gapA = ds; ahead = o; }
      if (ds < 0 && ds > -6 && -ds < gapB) { gapB = -ds; behind = o; } }
    let aLat = 0, aSpd = 0, alongside = false;
    if (ahead) { aLat = project(line, ahead.x, ahead.y, p.i, 2, 18).lat; aSpd = Math.hypot(ahead.vx, ahead.vy); }
    for (const o of others) { if (o === k) continue; const ds = signedGap(k, o, L); if (Math.abs(ds) < 2.2) { const ol = project(line, o.x, o.y, p.i, 4, 4).lat; if (Math.abs(ol - myLat) < 2.2) { alongside = true; ai.offTarget = myLat + Math.sign(myLat - ol || 1) * 0.5; } } }
    // curvature sign a little ahead tells which side is the inside of the next corner
    let ksum = 0; for (let q = 4; q < 22; q += 3) ksum += line.k ? line.k[wrap(p.i + q, N)] : 0;
    const inside = Math.sign(ksum) || 1;
    const myTarget = Math.min(prof.v[p.i], prof.v[wrap(p.i + 6, N)]) * ai.pace;
    ai.passT -= dt;
    if (!alongside && !ai.formation) {
      if (ahead && gapA < 9 && (myTarget > aSpd * 0.98 || k.vx > aSpd + 0.3) && rnd() < 0.5 + ai.aggr) {
        if (ai.passT <= 0 || !ai.passSide) {
          // pick the side with room, leaning toward the inside of the next corner
          let bestS = 0, bestScore = -1e9;
          for (const sd of [-1, 1]) { const off = aLat + sd * 1.9, j2 = wrap(p.i + Math.round(gapA) + 2, N);
            const room = tr.field ? sdf(tr.field, line.x[j2] + line.nx[j2] * off, line.y[j2] + line.ny[j2] * off) : 1;
            const score = room + (sd === inside ? 0.6 * ai.aggr : 0); if (score > bestScore) { bestScore = score; bestS = sd; } }
          ai.passSide = bestScore > 0.7 ? bestS : 0; ai.passT = 1.5;
        }
        if (ai.passSide) ai.offTarget = aLat + ai.passSide * 1.9;
      } else if (behind && gapB < 4 && ai.aggr > 0.55) {
        const bl = project(line, behind.x, behind.y, p.i, 6, 4).lat;
        ai.offTarget = Math.abs(bl) > 0.5 && Math.sign(bl) === inside ? inside * 0.7 : ai.offTarget * Math.pow(0.5, dt); // cover the inside once
      } else { ai.passSide = 0; ai.offTarget *= Math.pow(0.45, dt); }
    }
    ai.offset += clamp(ai.offTarget + ai.wander - ai.offset, -1.4 * dt, 1.4 * dt);
    // Pure pursuit to a point on the (offset) racing line; shrink the offset if it would put the target near a wall.
    const Ld = 2.0 + 0.2 * spd; let j = p.i, acc = (1 - p.t) * (line.s[p.i + 1] - line.s[p.i]);
    while (acc < Ld) { j = wrap(j + 1, N); acc += line.s[j + 1] - line.s[j]; }
    let off = ai.offset, gx = line.x[j] + line.nx[j] * off, gy = line.y[j] + line.ny[j] * off;
    for (let t = 0; t < 4 && tr.field && sdf(tr.field, gx, gy) < 0.85; t++) { off *= 0.6; gx = line.x[j] + line.nx[j] * off; gy = line.y[j] + line.ny[j] * off; }
    if (tr.field && sdf(tr.field, gx, gy) < 0.85) { gx = line.x[j]; gy = line.y[j]; ai.offset *= 0.5; }
    gx -= k.x; gy -= k.y; const c = Math.cos(k.psi), s = Math.sin(k.psi);
    const lx = c * gx + s * gy, ly = -s * gx + c * gy, alpha = Math.atan2(ly, lx);
    ai.sNoise += ((rnd() * 2 - 1) * (1 - ai.cons) * 0.12 - ai.sNoise) * Math.min(1, 3 * dt);
    let st = Math.atan2(2 * k.kp.L * Math.sin(alpha), Math.hypot(lx, ly)) / (k.kp.steerMax / (1 + spd / k.kp.steerFade)) + ai.sNoise;
    if ((k.slide || 0) > 0.25) st = clamp(-Math.sign(k.r) * 0.6 * k.slide, -1, 1); // catch a slide with opposite lock
    k.steer = clamp(st, -1, 1);
    // Speed: an off-line target corner costs a little speed; mistakes = overspeed into the braking zone.
    const look = wrap(p.i + Math.round(1 + spd * 0.12), N);
    let vt = Math.min(prof.v[p.i], prof.v[look]) * ai.pace * (1 - 0.025 * Math.min(1.5, Math.abs(ai.offset)));
    if (vt < k.vx) vt *= ai.errMul;
    if (ahead && gapA < 3.2 && Math.abs(aLat - myLat) < 1.3) vt = Math.min(vt, aSpd * (0.96 + 0.05 * ai.aggr)); // don't punt the kart ahead (much)
    if (ai.formation) { vt = Math.min(vt, prof.v[p.i] * 0.5); if (ahead && gapA < 7) vt = Math.min(vt, aSpd * (gapA < 4.5 ? 0.6 : 0.95)); ai.offTarget = 0; }
    const err = vt - k.vx;
    if ((k.slide || 0) > 0.3) { k.throttle = 0; k.brake = 0; return; }
    if (err > 0) { k.throttle = clamp(0.35 + err * 0.9, 0, 1); k.brake = 0; }
    else if (err > -0.5) { k.throttle = 0; k.brake = 0; }
    else { k.throttle = 0; k.brake = clamp(-err * 0.35, 0, 0.9); }
  }
  // Pure pursuit along a polyline {x:[],y:[]} at a capped speed; optionally stop at the end (pit box, grid slot).
  function followPath(k, ai) {
    const P = ai.path, n = P.x.length, spd = Math.hypot(k.vx, k.vy);
    while (ai.pi < n - 1 && Math.hypot(P.x[ai.pi] - k.x, P.y[ai.pi] - k.y) < 1.2 + 0.15 * spd) ai.pi++;
    const tx = P.x[ai.pi], ty = P.y[ai.pi], ex = P.x[n - 1] - k.x, ey = P.y[n - 1] - k.y, dEnd = Math.hypot(ex, ey);
    const c = Math.cos(k.psi), s = Math.sin(k.psi), gx = tx - k.x, gy = ty - k.y, lx = c * gx + s * gy, ly = -s * gx + c * gy;
    const alpha = Math.atan2(ly, lx);
    k.steer = clamp(Math.atan2(2 * k.kp.L * Math.sin(alpha), Math.max(0.6, Math.hypot(lx, ly))) / k.kp.steerMax, -1, 1);
    let vt = ai.pathV || 6; if (ai.pathStop) vt = Math.min(vt, Math.sqrt(2 * 2.2 * Math.max(0, dEnd - 0.15)));
    if (ai.pathStop && (dEnd < 0.35 || (ai.pi >= n - 1 && lx < 0))) { k.throttle = 0; k.brake = 1; ai.parked = true; return; }
    if (!ai.pathStop && ai.pi >= n - 1 && dEnd < 2) { ai.path = null; ai.li = null; return; }
    const err = vt - k.vx;
    if (err > 0) { k.throttle = clamp(0.3 + err * 0.8, 0, 1); k.brake = 0; } else if (err > -0.4) { k.throttle = 0; k.brake = 0; } else { k.throttle = 0; k.brake = clamp(-err * 0.4, 0, 0.9); }
  }
  function nearest(L, x, y) { let b = 0, bd = 1e18; for (let i = 0; i < L.N; i++) { const d = (L.x[i] - x) ** 2 + (L.y[i] - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; }
  root.KartCore = { nearest, followPath, makeAI, bumpAt, slipstream, KARTS, sdf, buildTrack, project, racingLine, racingLine2, speedProfile, makeKart, stepKart, collideWalls, collideKarts, driveAI, wrap, clamp, G };
})(typeof window !== 'undefined' ? window : globalThis);
