// Geometry for the level-select trail map (Candy Crush style). Pure JS, no Phaser, so it can be
// unit-tested in Node. The map is one long winding road: level 1 at the bottom, climbing up.
// Every BAND levels the biome changes (shared/config.js BIOMES), so the map is cut into bands,
// one per biome stretch, each baked separately by biomeRenderer.renderTrailBand.
import { hashSeed, makeRng } from '../../shared/rng.js';
import { bodyCircles } from './layout.js';

export const TRAIL = {
  step: 130, // vertical distance between level nodes (design px)
  band: 5, // levels per biome
  bottomPad: 170, // room under level 1 (start sign)
  topPad: 200, // room above the top level
  nodeR: 34, // node radius (design px)
  roadHalf: 24, // road half-width as drawn by the biome renderer
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Biome band index of a level (0 = levels 1-5, 1 = levels 6-10, ...).
export const bandOf = (level) => Math.floor((level - 1) / TRAIL.band);

// Catmull-Rom through the control points, sampled about every 8px.
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

// The whole trail for `count` levels in a world `W` design px wide.
// Returns { W, H, count, nodes: [{ level, x, y, i }], road: [{ x, y }] (dense, bottom to top),
// bands: number }. `node.i` is the node's index in `road`.
export function trailGeometry({ W, count, seed = 'trail' }) {
  const { step, bottomPad, topPad } = TRAIL;
  const H = Math.round(topPad + (count - 1) * step + bottomPad);
  const rng = makeRng(hashSeed(seed, 'trail', Math.round(W)));
  const cx = W / 2;
  const amp = Math.min(W * 0.27, 190);
  const phase = rng.range(0, Math.PI * 2);
  const nodes = [];
  for (let n = 1; n <= count; n++) {
    // A smooth S-curve with a little per-level wobble, so no two stretches look alike.
    const x = cx + amp * Math.sin(n * 1.02 + phase) + rng.range(-16, 16);
    nodes.push({ level: n, x, y: H - bottomPad - (n - 1) * step });
  }
  // Control points: a lead-in below level 1 and a lead-out above the last level.
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const ctrl = [{ x: first.x - 10, y: first.y + 90 }, ...nodes, { x: last.x + 10, y: last.y - 90 }];
  const road = smooth(ctrl);
  // Index of the road sample closest to each node.
  let from = 0;
  for (const node of nodes) {
    let bi = from;
    for (let k = from; k < road.length; k++) {
      if (dist(road[k], node) < dist(road[bi], node)) bi = k;
      else if (dist(road[k], node) > dist(road[bi], node) + 60) break;
    }
    node.i = bi;
    from = bi;
  }
  return { W, H, count, nodes, road, bands: Math.ceil(count / TRAIL.band) };
}

// Vertical extent of a band. Bands meet half way between level 5b and 5b+1 (the biome banner
// sits on that line), the first starts at the very bottom and the last runs off the top.
export function bandRect(geo, b) {
  const { step, band } = TRAIL;
  const node = (n) => geo.nodes[Math.min(geo.count, Math.max(1, n)) - 1];
  const first = b * band + 1;
  const lastLevel = Math.min(geo.count, (b + 1) * band);
  const bottom = b === 0 ? geo.H : node(first).y + step / 2;
  const top = lastLevel === geo.count ? 0 : node(lastLevel).y - step / 2;
  return { top, bottom, height: bottom - top };
}

// The y of the seam between band b and band b + 1 (where the biome banner goes).
export const seamY = (geo, b) => bandRect(geo, b).top;

// Where your Pokémon stands on a level: beside the node, on the side of the map with room.
export function heroSpot(geo, level) {
  const n = geo.nodes[Math.min(geo.count, Math.max(1, level)) - 1];
  const side = n.x < geo.W / 2 ? 1 : -1;
  return { x: n.x + side * (TRAIL.nodeR + 34), y: n.y + 22 };
}

// The stretch of road between two levels (inclusive), in the direction a -> b.
export function roadBetween(geo, a, b) {
  const ia = geo.nodes[a - 1].i;
  const ib = geo.nodes[b - 1].i;
  const pts = geo.road.slice(Math.min(ia, ib), Math.max(ia, ib) + 1);
  return ia <= ib ? pts : pts.reverse();
}

// Thins a polyline to roughly every `gap` px (keeps the ends).
export function thin(pts, gap = 24) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) if (dist(out[out.length - 1], pts[i]) >= gap) out.push(pts[i]);
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  return out;
}

// Decor for one band, seeded by biome and band index so the map never changes between visits.
// Nothing sits on the road, on a node or on the banner at either seam. Coordinates are in WORLD
// space (not band space), sorted back to front. Types are the layout.js decor slots.
export function bandDecor(geo, b, biomeKey) {
  const rect = bandRect(geo, b);
  const rng = makeRng(hashSeed('trail-decor', biomeKey, b, Math.round(geo.W)));
  const decor = [];
  const roadPts = geo.road.filter((p) => p.y > rect.top - 140 && p.y < rect.bottom + 140);
  const nodePts = geo.nodes.filter((n) => n.y > rect.top - 140 && n.y < rect.bottom + 140);
  const spots = nodePts.map((n) => heroSpot(geo, n.level));
  const types = [['tree', 4], ['bush', 3], ['flowers', 2.5], ['rock', 1.6], ['mushroom', 1]];
  const total = types.reduce((s, [, w]) => s + w, 0);
  const pick = () => {
    let r = rng.next() * total;
    for (const [t, w] of types) { r -= w; if (r <= 0) return t; }
    return 'tree';
  };
  const tries = Math.round((geo.W * rect.height) / 5200);
  for (let k = 0; k < tries; k++) {
    const type = pick();
    const scale = rng.range(0.8, 1.25);
    const x = rng.range(8, geo.W - 8);
    const y = rng.range(rect.top + 14, rect.bottom - 6);
    const circles = bodyCircles(type, x, y, scale);
    // Trees have a canopy 60px above the trunk: keep it inside this band's texture.
    if (circles.some((c) => c.y - c.r < rect.top + 4)) continue;
    const clear = circles.every((c) =>
      roadPts.every((p) => dist(p, c) > c.r + TRAIL.roadHalf + 20)
      && nodePts.every((n) => dist(n, c) > c.r + TRAIL.nodeR + 40)
      && spots.every((sp) => dist(sp, c) > c.r + 50) // room for your Pokémon to stand
      && decor.every((d) => dist(d, { x, y }) > (d.size + 30 * scale) * 0.5));
    if (!clear) continue;
    decor.push({ type, x, y, scale, size: 30 * scale, flip: rng.chance(0.5), hue: rng.next(), layer: 'ground' });
  }
  decor.sort((p, q) => p.y - q.y);
  return decor;
}

// Which bands to keep baked while looking at world-y range [top, bottom]: the visible ones plus
// one on each side, so scrolling never shows an empty strip.
export function visibleBands(geo, top, bottom) {
  const out = [];
  for (let b = 0; b < geo.bands; b++) {
    const r = bandRect(geo, b);
    if (r.bottom >= top - r.height * 0.6 && r.top <= bottom + r.height * 0.6) out.push(b);
  }
  return out;
}

// How many levels to show: always a whole number of biome bands, with room above the current
// level and above anything the player has reached before.
export function trailCount(currentLevel, bestLevel = 0) {
  const reach = Math.max(currentLevel + 6, bestLevel + 3, 15);
  return Math.ceil(reach / TRAIL.band) * TRAIL.band;
}
