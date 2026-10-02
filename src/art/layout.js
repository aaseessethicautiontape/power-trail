// Places plateaus, stairs, water, paths, stops and decor for a level (PRD 7.1, 7.7).
// Pure JS (no Phaser) so it can be tested in Node. Same level + mode = same layout,
// so retrying a level shows the exact same map. Only positions live here; the numbers
// all come from generateLevel.
import { hashSeed, makeRng } from '../../shared/rng.js';

// wide = landscape screens, tall = portrait screens.
export const MODES = {
  wide: {
    W: 1280, zoneH: 560, gap: 150, pw: [800, 900], offset: [120, 170], cliff: [30, 40], n: [2.6, 3.2],
    connW: 96, bottomPad: 180, topPad: 70, bossH: 260, perExtraStop: 30,
  },
  tall: {
    W: 760, zoneH: 640, gap: 150, pw: [560, 610], offset: [36, 56], cliff: [28, 36], n: [2.6, 3.2],
    connW: 86, bottomPad: 180, topPad: 70, bossH: 260, perExtraStop: 80,
  },
};

export const STOP_GAP = 140; // min distance between stops (and from gates, start, boss)
const EDGE = 72; // stops stay this far inside the plateau edge
const ANGLES = 96;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Rough footprint of each decor type, in design px at scale 1: [dx, dy, r] circles.
const SIZE = { tree: 70, bush: 40, flowers: 30, mushroom: 24, rock: 34 };
const BODY = {
  tree: [[0, -6, 16], [0, -62, 40]],
  bush: [[0, -16, 27]],
  flowers: [[0, -8, 19]],
  mushroom: [[0, -14, 17]],
  rock: [[0, -8, 20]],
};
export function bodyCircles(type, x, y, scale) {
  return BODY[type].map(([dx, dy, r]) => ({ x: x + dx * scale, y: y + dy * scale, r: r * scale }));
}

// ---------- plateau shape: a noisy superellipse stored as radius per angle ----------

function makePlateau(rng, index, cx, cy, rx, ry, cliff, n) {
  const waves = [3, 4, 5, 7].map((k) => ({ k, a: rng.range(0.006, 0.022), ph: rng.range(0, Math.PI * 2) }));
  const radii = [];
  for (let i = 0; i < ANGLES; i++) {
    const t = (i / ANGLES) * Math.PI * 2;
    const c = Math.abs(Math.cos(t)) / rx;
    const s = Math.abs(Math.sin(t)) / ry;
    let r = (c ** n + s ** n) ** (-1 / n);
    for (const w of waves) r *= 1 + w.a * Math.sin(w.k * t + w.ph);
    radii.push(r);
  }
  const poly = radii.map((r, i) => {
    const t = (i / ANGLES) * Math.PI * 2;
    return { x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r };
  });
  return { index, cx, cy, rx, ry, cliff, radii, poly };
}

function radiusAt(p, angle) {
  let a = angle % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  const f = (a / (Math.PI * 2)) * ANGLES;
  const i = Math.floor(f) % ANGLES;
  const j = (i + 1) % ANGLES;
  const k = f - Math.floor(f);
  return p.radii[i] * (1 - k) + p.radii[j] * k;
}

// Is pt inside plateau p, at least `margin` px in from the edge? (negative = outside allowance)
export function insidePlateau(p, pt, margin = 0) {
  const dx = pt.x - p.cx;
  const dy = pt.y - p.cy;
  return Math.hypot(dx, dy) <= radiusAt(p, Math.atan2(dy, dx)) - margin;
}

// y of the plateau's top (dir -1) or bottom (dir +1) edge at column x.
function edgeY(p, x, dir) {
  let inY = p.cy;
  let outY = p.cy + dir * p.ry * 1.5;
  if (!insidePlateau(p, { x, y: inY })) return null;
  for (let i = 0; i < 30; i++) {
    const mid = (inY + outY) / 2;
    if (insidePlateau(p, { x, y: mid })) inY = mid;
    else outY = mid;
  }
  return inY;
}

// Is pt on a plateau's top face or hidden behind its cliff band?
function underPlateau(plateaus, pt, pad) {
  return plateaus.some((p) => insidePlateau(p, pt, -pad) || insidePlateau(p, { x: pt.x, y: pt.y - p.cliff - pad }, -pad));
}

// ---------- paths ----------

// Order stops entry -> ... -> exit: nearest neighbour, then 2-opt to remove crossings.
function orderStops(entry, stops, exit) {
  const left = [...stops];
  const order = [];
  let cur = entry;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (dist(cur, left[i]) < dist(cur, left[bi])) bi = i;
    cur = left.splice(bi, 1)[0];
    order.push(cur);
  }
  const route = [entry, ...order, exit];
  const len = (r) => r.reduce((s, p, i) => (i ? s + dist(r[i - 1], p) : 0), 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 2; i++) {
      for (let j = i + 1; j < route.length - 1; j++) {
        const next = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
        if (len(next) < len(route) - 0.5) {
          route.splice(0, route.length, ...next);
          improved = true;
        }
      }
    }
  }
  return route;
}

// Catmull-Rom through the points, sampled every ~8px.
function smooth(points) {
  const out = [];
  const P = [points[0], ...points, points[points.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const steps = Math.max(4, Math.ceil(dist(p1, p2) / 8));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// Pull any point that drifted off the plateau back inside.
function clampInside(p, pt, margin) {
  const dx = pt.x - p.cx;
  const dy = pt.y - p.cy;
  const d = Math.hypot(dx, dy);
  const max = radiusAt(p, Math.atan2(dy, dx)) - margin;
  if (d <= max || d === 0) return pt;
  return { x: p.cx + (dx / d) * max, y: p.cy + (dy / d) * max };
}

// Distance from pt to a polyline (sampled points are dense enough to use point distance).
function nearPath(paths, pt, r) {
  for (const path of paths) for (const q of path.pts) if (Math.abs(q.x - pt.x) < r && Math.abs(q.y - pt.y) < r && dist(q, pt) < r) return true;
  return false;
}

// ---------- main ----------

export function buildLayout(level, mode = 'wide') {
  const M = MODES[mode];
  const rng = makeRng(hashSeed(level.seed, 'layout', mode));
  const nz = level.zones.length;
  const W = M.W;
  // Busy zones get a bit more room so stops can stay STOP_GAP apart.
  const zoneHs = level.zones.map((z, i) => M.zoneH + Math.max(0, z.stops.length - 4) * M.perExtraStop
    + (i === nz - 1 ? M.bossH : 0));
  const H = Math.round(M.bottomPad + zoneHs.reduce((a, b) => a + b, 0) + M.topPad);

  // Plateaus, bottom (zone 1) to top, offset left/right so the path zigzags.
  const side0 = rng.chance(0.5) ? -1 : 1;
  const plateaus = [];
  let yBottom = H - M.bottomPad;
  for (let i = 0; i < nz; i++) {
    const zh = zoneHs[i];
    const side = i % 2 === 0 ? side0 : -side0;
    const cx = W / 2 + side * rng.range(M.offset[0], M.offset[1]);
    const rx = Math.min(rng.range(M.pw[0], M.pw[1]) / 2, cx - 34, W - 34 - cx);
    const ry = (zh - M.gap) / 2;
    const cy = yBottom - zh / 2; // face centred in its zone band
    const cliff = rng.range(M.cliff[0], M.cliff[1]);
    plateaus.push(makePlateau(rng, i, cx, cy, rx, ry, cliff, rng.range(M.n[0], M.n[1])));
    yBottom -= zh;
  }

  // Connectors: stairs from each plateau up to the next, with the gate on top.
  const connectors = [];
  const rivers = [];
  const ponds = [];
  for (let i = 0; i < nz - 1; i++) {
    const lo = plateaus[i];
    const up = plateaus[i + 1];
    const minX = Math.max(lo.cx - lo.rx * 0.5, up.cx - up.rx * 0.5);
    const maxX = Math.min(lo.cx + lo.rx * 0.5, up.cx + up.rx * 0.5);
    const x = minX < maxX ? rng.range(minX + (maxX - minX) * 0.3, maxX - (maxX - minX) * 0.3) : (lo.cx + up.cx) / 2;
    const aY = edgeY(lo, x, -1);
    const bY = edgeY(up, x, +1);
    const A = { x, y: aY + 26 }; // just inside the lower plateau
    const gate = { x, y: bY - 62 }; // top of the stairs, on the upper plateau

    // A river runs across the gap if there's room, clear of both plateaus everywhere.
    let upLow = -Infinity;
    let loHigh = Infinity;
    for (let sx = 0; sx <= W; sx += 16) {
      const ub = edgeY(up, sx, +1);
      const lt = edgeY(lo, sx, -1);
      if (ub != null) upLow = Math.max(upLow, ub + up.cliff);
      if (lt != null) loHigh = Math.min(loHigh, lt);
    }
    const room = loHigh - upLow;
    const water = room > 80 && rng.chance(0.6);
    if (water) {
      const yc = (upLow + loHigh) / 2;
      const half = Math.min(36, room / 2 - 16);
      const phase = rng.range(0, Math.PI * 2);
      const pts = [];
      for (let sx = -40; sx <= W + 40; sx += 32) {
        const wob = Math.sin(sx / 140 + phase) * Math.min(8, room / 2 - half - 10);
        pts.push({ x: sx, top: yc + wob - half, bottom: yc + wob + half });
      }
      rivers.push({ y: yc, half, pts });
    } else if (room > 60) {
      // No river: a small pond on the far side of the gap from the stairs.
      const px = x < W / 2 ? rng.range(W * 0.7, W * 0.86) : rng.range(W * 0.14, W * 0.3);
      const pond = { x: px, y: (upLow + loHigh) / 2, rx: Math.min(90, W * 0.1), ry: Math.min(30, room / 2 - 12) };
      const clear = [-1, 1].every((sx) => [-1, 1].every((sy) =>
        !underPlateau(plateaus, { x: pond.x + sx * pond.rx, y: pond.y + sy * pond.ry }, 10)));
      if (clear && pond.ry > 14) ponds.push(pond);
    }
    connectors.push({ from: i, to: i + 1, x, A, top: bY - 14, cliffTop: bY, cliffBottom: bY + up.cliff, gate, water, width: M.connW });
  }

  // Player start at the bottom of zone 1; boss on a pedestal at the top of the last zone.
  const p0 = plateaus[0];
  const sx = p0.cx + rng.range(-p0.rx * 0.2, p0.rx * 0.2);
  const start = { x: sx, y: edgeY(p0, sx, +1) - 78 };
  const pl = plateaus[nz - 1];
  const boss = { x: pl.cx, y: edgeY(pl, pl.cx, -1) + 140 };

  // Stops: best-candidate sampling inside each plateau, at least STOP_GAP apart.
  const stops = {};
  const paths = [];
  const warnings = [];
  for (let i = 0; i < nz; i++) {
    const p = plateaus[i];
    const zone = level.zones[i];
    if (zone.gate) stops[zone.gate.id] = { ...connectors[i - 1].gate };
    const entry = i === 0 ? start : connectors[i - 1].gate;
    const exit = i === nz - 1 ? boss : connectors[i].A;
    const fixed = [{ pt: entry, d: STOP_GAP }, { pt: exit, d: i === nz - 1 ? STOP_GAP + 50 : 110 }];
    if (i === nz - 1) fixed.push({ pt: boss, d: STOP_GAP + 50 });

    const cands = [];
    for (let y = p.cy - p.ry; y <= p.cy + p.ry; y += 14) {
      for (let x = p.cx - p.rx; x <= p.cx + p.rx; x += 14) {
        const pt = { x, y };
        if (insidePlateau(p, pt, EDGE) && fixed.every((f) => dist(f.pt, pt) >= f.d)) cands.push(pt);
      }
    }
    const placed = [];
    for (const stop of zone.stops) {
      let gapNeeded = STOP_GAP;
      let best = null;
      while (!best && gapNeeded >= 100) {
        const ok = cands.filter((c) => placed.every((q) => dist(q, c) >= gapNeeded));
        if (ok.length) {
          let bestScore = -1;
          for (let k = 0; k < 40; k++) {
            const c = ok[Math.floor(rng.next() * ok.length)];
            const score = Math.min(...placed.map((q) => dist(q, c)), ...fixed.map((f) => dist(f.pt, c) - f.d + STOP_GAP), 9999)
              + rng.range(0, 40); // a little randomness so layouts don't all look the same
            if (score > bestScore) { bestScore = score; best = c; }
          }
        } else {
          gapNeeded -= 10;
        }
      }
      if (!best) throw new Error(`layout: no room for stop ${stop.id} in zone ${i + 1}`);
      if (gapNeeded < STOP_GAP) warnings.push(`zone ${i + 1}: stop ${stop.id} spaced ${gapNeeded}px`);
      placed.push(best);
      stops[stop.id] = { x: best.x, y: best.y };
    }

    const route = orderStops(entry, placed, exit);
    const pts = smooth(route).map((q) => clampInside(p, q, 34));
    paths.push({ zone: i, kind: 'plateau', pts });
  }
  stops[level.boss.id] = { ...boss };

  // Walkways down each connector (stairs and bridge are drawn on top of these).
  for (const c of connectors) {
    const pts = [];
    for (let y = c.A.y; y >= c.gate.y; y -= 8) pts.push({ x: c.x, y });
    paths.push({ zone: c.to, kind: 'walk', pts });
  }

  // ---------- decor ----------
  // Each decor piece is checked by the circles it actually covers on screen (a tree's
  // canopy sits ~60px above its trunk), so canopies never hide a path, stop or water.
  const decor = [];
  const spots = [start, ...connectors.map((c) => c.gate), ...Object.values(stops)];
  const water = (c) => rivers.some((r) => Math.abs(c.y - r.y) < r.half + 14 + c.r)
    || ponds.some((o) => ((c.x - o.x) / (o.rx + 10 + c.r)) ** 2 + ((c.y - o.y) / (o.ry + 10 + c.r)) ** 2 < 1);
  const onConnector = (c) => connectors.some((k) => Math.abs(c.x - k.x) < k.width / 2 + 12 + c.r
    && c.y > k.gate.y - c.r && c.y < k.A.y + c.r);
  const clearOf = (type, pt, scale) => bodyCircles(type, pt.x, pt.y, scale).every((c) =>
    spots.every((sp) => dist(sp, c) > c.r + 48)
    && dist(boss, c) > c.r + 125
    && !nearPath(paths, c, c.r + 24)
    && !onConnector(c)
    && !water(c)
    && decor.every((d) => dist(d, pt) > (d.size + SIZE[type] * scale) * 0.55));
  const pickType = (weights) => {
    let r = rng.next() * weights.reduce((sum, [, w]) => sum + w, 0);
    for (const [t, w] of weights) { r -= w; if (r <= 0) return t; }
    return weights[0][0];
  };
  const add = (type, pt, scale, layer) => {
    if (!clearOf(type, pt, scale)) return false;
    decor.push({ type, x: pt.x, y: pt.y, scale, size: SIZE[type] * scale, flip: rng.chance(0.5), hue: rng.next(), layer });
    return true;
  };

  // Along the rim of each plateau, on the top face.
  for (const p of plateaus) {
    const tries = Math.round((p.rx + p.ry) / 9);
    for (let k = 0; k < tries; k++) {
      const t = rng.range(0, Math.PI * 2);
      const r = radiusAt(p, t) - rng.range(26, 58);
      const pt = { x: p.cx + Math.cos(t) * r, y: p.cy + Math.sin(t) * r };
      const type = pickType([['tree', 3], ['bush', 3], ['flowers', 3], ['mushroom', 1.2], ['rock', 0.8]]);
      add(type, pt, rng.range(0.8, 1.15), 'rim');
    }
  }
  // On the ground between and around plateaus.
  const groundTries = Math.round((W * H) / 7000);
  for (let k = 0; k < groundTries; k++) {
    const pt = { x: rng.range(10, W - 10), y: rng.range(20, H - 10) };
    const type = pickType([['tree', 4], ['bush', 3], ['flowers', 2], ['rock', 1.5], ['mushroom', 0.8]]);
    const scale = rng.range(0.85, 1.3);
    if (underPlateau(plateaus, pt, SIZE[type] * scale * 0.5 + 8)) continue;
    add(type, pt, scale, 'ground');
  }
  // Big trees along the world edges, half cut off, for depth.
  for (const edgeX of [0, W]) {
    for (let y = rng.range(40, 140); y < H; y += rng.range(130, 210)) {
      const pt = { x: edgeX + (edgeX === 0 ? 1 : -1) * rng.range(-10, 26), y };
      add('tree', pt, rng.range(1.5, 2), 'edge');
    }
  }
  decor.sort((a, b) => a.y - b.y);

  return {
    mode, W, H, seed: level.seed, plateaus, connectors, rivers, ponds, paths, stops, start, boss, decor, warnings,
  };
}

// Rule check used by the tests and the debug key: returns a list of problems.
export function checkLayout(level, L) {
  const problems = [];
  const zoneOf = new Map();
  level.zones.forEach((z, i) => {
    if (z.gate) zoneOf.set(z.gate.id, i);
    z.stops.forEach((s) => zoneOf.set(s.id, i));
  });
  zoneOf.set(level.boss.id, level.zones.length - 1);
  const ids = Object.keys(L.stops);
  if (ids.length !== zoneOf.size) problems.push(`placed ${ids.length} stops, level has ${zoneOf.size}`);
  for (const id of ids) {
    const pt = L.stops[id];
    if (!insidePlateau(L.plateaus[zoneOf.get(id)], pt, 40)) problems.push(`${id} not inside its plateau`);
    for (const id2 of ids) {
      if (id2 <= id) continue;
      const d = dist(pt, L.stops[id2]);
      if (d < STOP_GAP - 0.5) problems.push(`${id} and ${id2} only ${Math.round(d)}px apart`);
    }
    if (dist(pt, L.start) < STOP_GAP - 0.5) problems.push(`${id} too close to the start`);
  }
  for (const d of L.decor) {
    for (const c of bodyCircles(d.type, d.x, d.y, d.scale)) {
      for (const id of ids) if (dist(c, L.stops[id]) < c.r + 30) problems.push(`${d.type} decor covers stop ${id}`);
      if (nearPath(L.paths, c, c.r + 18)) problems.push(`${d.type} decor covers the path at ${Math.round(d.x)},${Math.round(d.y)}`);
      if (L.rivers.some((r) => Math.abs(c.y - r.y) < r.half + c.r)
        || L.ponds.some((o) => ((c.x - o.x) / (o.rx + c.r)) ** 2 + ((c.y - o.y) / (o.ry + c.r)) ** 2 < 1)) {
        problems.push(`${d.type} decor covers water at ${Math.round(d.x)},${Math.round(d.y)}`);
      }
    }
  }
  for (const path of L.paths) {
    if (path.kind !== 'plateau') continue;
    const p = L.plateaus[path.zone];
    if (path.pts.some((q) => !insidePlateau(p, q, 20))) problems.push(`path in zone ${path.zone + 1} leaves its plateau`);
  }
  return problems;
}
