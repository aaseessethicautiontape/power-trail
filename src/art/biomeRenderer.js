// Draws a level's map with Phaser Graphics and bakes it into one RenderTexture
// (PRD 7.1, 7.2). Animated bits (water shimmer, particles) are separate light layers on top.
//
// Every biome uses the same layout (src/art/layout.js). Layout decor comes in five
// "slots" (tree, bush, flowers, mushroom, rock) with fixed footprints; each biome draws
// its own art in those slots, so the "never covers a path/stop/water" rules hold everywhere.
import Phaser from 'phaser';
import { hashSeed, makeRng } from '../../shared/rng.js';
import { paletteFor } from './palettes.js';
import { RES } from '../layout/screen.js';

const V = (x, y) => new Phaser.Math.Vector2(x, y);
const lerpColour = (a, b, t) => {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(
    Phaser.Display.Color.ValueToColor(a), Phaser.Display.Color.ValueToColor(b), 100, Math.round(t * 100),
  );
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
};
const shade = (c, amt) => {
  const col = Phaser.Display.Color.ValueToColor(c);
  return (amt < 0 ? col.darken(-amt) : col.lighten(amt)).color;
};

const MAX_TEXTURE = 4096;
const MAX_PARTICLES = 70; // on screen, well under the ~80 budget (PRD 7.6)
const MAX_PARTICLES_COMPACT = 36;

// ---------- per-biome style ----------

const WOOD = { plank: 0xc99a5b, dark: 0x8a5a2b, light: 0xe0b47a, post: 0x6b4220 };
const STYLE = {
  meadow: {
    ground: 'grass', water: 'water', cliffMarks: 'vertical', path: 'pebbles', bridge: WOOD, particles: 'pollen',
    decor: { tree: 'tree', bush: 'bush', flowers: 'flowers', mushroom: 'mushroom', rock: 'rock' },
  },
  beach: {
    ground: 'sand', water: 'sea', cliffMarks: 'horizontal', path: 'planks', bridge: WOOD, particles: 'sparkles',
    decor: { tree: 'palm', bush: 'umbrella', flowers: 'shell', mushroom: 'starfish', rock: 'sandRock' },
  },
  forest: {
    ground: 'forest', water: 'water', cliffMarks: 'roots', path: 'leaves', particles: 'fireflies',
    bridge: { plank: 0x8f6a42, dark: 0x5a3f22, light: 0xb08a5c, post: 0x3f2a16 },
    decor: { tree: 'tallTree', bush: 'fern', flowers: 'glowMushroom', mushroom: 'glowMushroom', rock: 'log' },
  },
  desert: {
    ground: 'dunes', water: 'water', cliffMarks: 'horizontal', path: 'tiles', particles: 'sand',
    bridge: { plank: 0xd8b07a, dark: 0x9a7444, light: 0xf0d3a2, post: 0x8a6438 },
    decor: { tree: 'cactusOrPillar', bush: 'ruinBlock', flowers: 'dryTuft', mushroom: 'barrelCactus', rock: 'sandstone' },
  },
  snow: {
    ground: 'snow', water: 'ice', cliffMarks: 'ice', path: 'snowprints', particles: 'snow',
    bridge: { plank: 0xa8805a, dark: 0x6e4f33, light: 0xffffff, post: 0x5b4029 },
    decor: { tree: 'snowPine', bush: 'snowMound', flowers: 'iceCrystal', mushroom: 'iceCrystal', rock: 'snowRock' },
  },
  volcano: {
    ground: 'ash', water: 'lava', cliffMarks: 'glow', path: 'ash', particles: 'embers', pathEdge: 0x2b2226,
    bridge: { plank: 0x5f5558, dark: 0x2b2226, light: 0x857a7d, post: 0x1f181b },
    decor: { tree: 'spire', bush: 'darkRock', flowers: 'vent', mushroom: 'vent', rock: 'darkRock' },
  },
  haunted: {
    ground: 'haunted', water: 'swamp', cliffMarks: 'vertical', path: 'tiles', particles: 'wisps',
    bridge: { plank: 0x6a5a63, dark: 0x3a2f38, light: 0x8d7e88, post: 0x2a2028 },
    decor: { tree: 'deadTree', bush: 'lantern', flowers: 'ghostFlowers', mushroom: 'smallGrave', rock: 'grave' },
  },
  sky: {
    ground: 'clouds', water: 'sky', cliffMarks: 'cloud', path: 'gold', particles: 'sparkles',
    bridge: { plank: 0xffd86b, dark: 0xc99a2e, light: 0xfff1b0, post: 0xb8860b },
    decor: { tree: 'goldPillar', bush: 'urn', flowers: 'starOrb', mushroom: 'starOrb', rock: 'urn' },
    floating: true, // ground decor floats in the sky as islands and clouds
  },
};

export function renderMap(scene, level, L, { compact = false } = {}) {
  const pal = paletteFor(level.biome);
  const style = STYLE[level.biome] ?? STYLE.meadow;
  const rng = makeRng(hashSeed(L.seed, 'art', L.mode));
  // Smaller bake on phones (PRD 7.7), and never past the GPU's texture limit.
  const k = Math.min(compact ? 0.75 : 1, MAX_TEXTURE / L.H, MAX_TEXTURE / L.W);

  const g = scene.make.graphics({ add: false });
  GROUND[style.ground](g, L, pal, rng);
  WATER[style.water](g, L, pal, rng);
  drawPlateaus(g, L, pal, style, rng);
  drawPaths(g, L, pal, style, rng);
  drawConnectors(g, L, pal, style);
  drawSpots(g, L, pal);
  drawDecor(g, L, pal, style);

  const rt = scene.add.renderTexture(0, 0, Math.ceil(L.W * k), Math.ceil(L.H * k)).setOrigin(0);
  g.setScale(k);
  rt.draw(g, 0, 0);
  rt.setScale(1 / k);
  g.destroy();

  const shimmer = makeShimmer(scene, L, pal, style);
  const particles = makeParticles(scene, L, style.particles, compact ? MAX_PARTICLES_COMPACT : MAX_PARTICLES);
  return {
    rt, shimmer, particles,
    // Call once the camera is in place: fills the view with particles straight away,
    // so slow ones (snow, wisps) don't start out empty.
    prefill() {
      particles.fastForward(particles.lifespan, 50);
    },
    destroy() {
      scene.tweens.killTweensOf(shimmer.list);
      shimmer.destroy();
      particles.destroy();
      rt.destroy();
    },
  };
}

// ---------- shared helpers ----------

function softBlob(g, x, y, rx, ry, colour, alpha) {
  for (let i = 0; i < 3; i++) {
    const f = 1 - i * 0.22;
    g.fillStyle(colour, alpha * 0.4).fillEllipse(x, y, rx * 2 * f, ry * 2 * f);
  }
}

function baseBlotches(g, L, pal, rng, density = 9000) {
  const [a, b] = pal.ground;
  g.fillStyle(a, 1).fillRect(0, 0, L.W, L.H);
  const blobs = Math.round((L.W * L.H) / density);
  for (let i = 0; i < blobs; i++) {
    softBlob(g, rng.range(-40, L.W + 40), rng.range(-40, L.H + 40), rng.range(50, 150), rng.range(30, 80), b, rng.range(0.6, 1));
  }
  for (let i = 0; i < blobs / 3; i++) {
    softBlob(g, rng.range(0, L.W), rng.range(0, L.H), rng.range(40, 100), rng.range(20, 50), shade(a, 8), 0.5);
  }
  return blobs;
}

function tufts(g, L, rng, count, colour, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, L.W);
    const y = rng.range(0, L.H);
    g.lineStyle(2, colour, alpha);
    g.lineBetween(x - 4, y, x - 1, y - 7).lineBetween(x + 1, y, x + 3, y - 8).lineBetween(x + 5, y, x + 7, y - 5);
  }
}

// A jagged crack that glows: wide faint orange, then hot core.
function glowCrack(g, rng, x, y, len, colours = [0xff7a2f, 0xff9a3c, 0xffe08a]) {
  const pts = [V(x, y)];
  let a = rng.range(0, Math.PI * 2);
  for (let d = 0; d < len; d += rng.range(10, 18)) {
    a += rng.range(-0.7, 0.7);
    const last = pts[pts.length - 1];
    pts.push(V(last.x + Math.cos(a) * 14, last.y + Math.sin(a) * 9));
  }
  for (const [w, c, al] of [[9, colours[0], 0.22], [4, colours[1], 0.75], [1.6, colours[2], 1]]) {
    g.lineStyle(w, c, al);
    g.strokePoints(pts, false);
  }
}

// ---------- ground styles ----------

const GROUND = {
  grass(g, L, pal, rng) {
    const blobs = baseBlotches(g, L, pal, rng);
    tufts(g, L, rng, blobs * 1.6, shade(pal.ground[1], -14), 0.55);
  },
  forest(g, L, pal, rng) {
    const blobs = baseBlotches(g, L, pal, rng, 7000);
    for (let i = 0; i < blobs / 2; i++) softBlob(g, rng.range(0, L.W), rng.range(0, L.H), rng.range(60, 140), rng.range(30, 70), 0x2c6a2e, 0.6);
    tufts(g, L, rng, blobs * 1.4, 0x2f6b33, 0.6);
    // Leaf litter.
    for (let i = 0; i < blobs * 2; i++) {
      g.fillStyle(rng.pick([0xb7792f, 0xd19a3c, 0x8a5a2b, 0x6f9e3a]), 0.7)
        .fillEllipse(rng.range(0, L.W), rng.range(0, L.H), rng.range(4, 7), rng.range(2, 4));
    }
  },
  sand(g, L, pal, rng) {
    const blobs = baseBlotches(g, L, pal, rng, 11000);
    // Wind ripples: short soft arcs.
    for (let i = 0; i < blobs * 2.2; i++) {
      const x = rng.range(0, L.W);
      const y = rng.range(0, L.H);
      const w = rng.range(18, 40);
      g.lineStyle(2, shade(pal.ground[1], -10), 0.45).beginPath().arc(x, y + w, w, Phaser.Math.DegToRad(245), Phaser.Math.DegToRad(295)).strokePath();
      g.lineStyle(1.5, 0xfffaf0, 0.5).beginPath().arc(x, y + w - 3, w, Phaser.Math.DegToRad(250), Phaser.Math.DegToRad(290)).strokePath();
    }
    // Shell bits.
    for (let i = 0; i < blobs; i++) g.fillStyle(rng.pick([0xffffff, 0xffd1dc, 0xf5d6a8]), 0.85).fillCircle(rng.range(0, L.W), rng.range(0, L.H), rng.range(1.2, 2.4));
  },
  dunes(g, L, pal, rng) {
    baseBlotches(g, L, pal, rng, 12000);
    // Long dune crests: a lit ridge with a soft shadow on the lee side.
    for (let y = rng.range(20, 80); y < L.H; y += rng.range(70, 120)) {
      const phase = rng.range(0, 6);
      const amp = rng.range(10, 22);
      const len = rng.range(260, 520);
      const x0 = rng.range(-100, L.W - 100);
      const crest = [];
      for (let x = x0; x <= x0 + len; x += 12) crest.push(V(x, y + Math.sin((x - x0) / 90 + phase) * amp));
      g.lineStyle(14, shade(pal.ground[1], -12), 0.35).strokePoints(crest.map((p) => V(p.x, p.y + 8)), false);
      g.lineStyle(6, shade(pal.ground[1], -6), 0.5).strokePoints(crest.map((p) => V(p.x, p.y + 4)), false);
      g.lineStyle(3, 0xfff1d0, 0.7).strokePoints(crest, false);
    }
    for (let i = 0; i < (L.W * L.H) / 6000; i++) g.fillStyle(0xb98a4a, 0.6).fillCircle(rng.range(0, L.W), rng.range(0, L.H), rng.range(1, 2.5));
  },
  snow(g, L, pal, rng) {
    const blobs = baseBlotches(g, L, pal, rng, 9000);
    for (let i = 0; i < blobs / 2; i++) softBlob(g, rng.range(0, L.W), rng.range(0, L.H), rng.range(60, 140), rng.range(20, 50), 0xc5d9ef, 0.7);
    for (let i = 0; i < blobs * 3; i++) g.fillStyle(0xffffff, rng.range(0.6, 1)).fillCircle(rng.range(0, L.W), rng.range(0, L.H), rng.range(0.8, 1.8));
    // Twigs poking through.
    for (let i = 0; i < blobs / 2; i++) {
      const x = rng.range(0, L.W);
      const y = rng.range(0, L.H);
      g.lineStyle(2, 0x8a7a6a, 0.6).lineBetween(x, y, x + 4, y - 8).lineBetween(x + 2, y - 4, x - 3, y - 9);
    }
  },
  ash(g, L, pal, rng) {
    const blobs = baseBlotches(g, L, pal, rng, 9000);
    for (let i = 0; i < blobs / 2; i++) softBlob(g, rng.range(0, L.W), rng.range(0, L.H), rng.range(50, 120), rng.range(20, 50), 0x3a2c30, 0.8);
    for (let i = 0; i < (L.W * L.H) / 60000; i++) glowCrack(g, rng, rng.range(0, L.W), rng.range(0, L.H), rng.range(40, 110));
    for (let i = 0; i < blobs * 1.5; i++) g.fillStyle(rng.pick([0x2b2226, 0x857a7d]), 0.7).fillCircle(rng.range(0, L.W), rng.range(0, L.H), rng.range(1, 3));
  },
  haunted(g, L, pal, rng) {
    const blobs = baseBlotches(g, L, pal, rng, 8000);
    tufts(g, L, rng, blobs * 1.2, 0x3b2f52, 0.6);
    // Low fog patches.
    for (let i = 0; i < blobs / 2; i++) softBlob(g, rng.range(0, L.W), rng.range(0, L.H), rng.range(80, 180), rng.range(25, 50), 0xb8a8e0, 0.35);
  },
  clouds(g, L, pal, rng) {
    g.fillStyle(pal.sky, 1).fillRect(0, 0, L.W, L.H);
    // Soft vertical sky gradient bands.
    for (let y = 0; y < L.H; y += 40) g.fillStyle(0xffffff, 0.04 + 0.04 * Math.sin(y / 300)).fillRect(0, y, L.W, 40);
    // Rainbow arcs behind everything.
    const bows = Math.max(2, Math.round(L.H / 1100));
    for (let i = 0; i < bows; i++) {
      const cx = rng.range(0, L.W);
      const cy = rng.range(200, L.H);
      const r = rng.range(160, 260);
      [0xff6b6b, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0xb197fc].forEach((c, j) => {
        g.lineStyle(9, c, 0.55).beginPath().arc(cx, cy, r - j * 9, Math.PI, Math.PI * 2).strokePath();
      });
    }
    // Drifting cloud banks.
    for (let i = 0; i < (L.W * L.H) / 42000; i++) cloudPuff(g, rng, rng.range(-40, L.W + 40), rng.range(0, L.H), rng.range(0.7, 1.6), 0.9);
  },
};

function cloudPuff(g, rng, x, y, s, alpha = 1) {
  const puffs = [[-34, 4, 20], [-14, -8, 26], [12, -12, 30], [36, 0, 22], [0, 6, 24]];
  for (const [dx, dy, r] of puffs) g.fillStyle(0xd6e6fa, alpha).fillCircle(x + dx * s, y + (dy + 6) * s, r * s);
  for (const [dx, dy, r] of puffs) g.fillStyle(0xffffff, alpha).fillCircle(x + dx * s, y + dy * s, r * s);
  g.fillStyle(0xffffff, alpha).fillEllipse(x - 4 * s, y - 16 * s, 26 * s, 10 * s);
}

// ---------- water styles ----------

function riverPoly(r, grow) {
  return [...r.pts.map((p) => V(p.x, p.top - grow)), ...[...r.pts].reverse().map((p) => V(p.x, p.bottom + grow))];
}
const midBand = (r, f) => ({ pts: r.pts.map((p) => ({ x: p.x, top: (p.top + p.bottom) / 2 - r.half * f, bottom: (p.top + p.bottom) / 2 + r.half * f })) });

function basicWater(g, L, pal, rng, { bank = shade(pal.ground[1], -18), bankAlpha = 0.6, foam = true, deep = 0.45 } = {}) {
  for (const r of L.rivers) {
    g.fillStyle(bank, bankAlpha).fillPoints(riverPoly(r, 12), true);
    g.fillStyle(pal.waterRim, 1).fillPoints(riverPoly(r, 7), true);
    g.fillStyle(pal.water, 1).fillPoints(riverPoly(r, 0), true);
    g.fillStyle(pal.waterDeep, deep).fillPoints(riverPoly(midBand(r, 0.35), 0), true);
    if (foam) {
      for (const p of r.pts) {
        for (const [y, dir] of [[p.top, 1], [p.bottom, -1]]) {
          for (let k = 0; k < 3; k++) g.fillStyle(pal.foam, rng.range(0.55, 0.9)).fillCircle(p.x + rng.range(-14, 14), y + dir * rng.range(1, 5), rng.range(1.6, 3.6));
        }
      }
    }
  }
  for (const o of L.ponds) {
    g.fillStyle(bank, bankAlpha).fillEllipse(o.x, o.y, (o.rx + 12) * 2, (o.ry + 10) * 2);
    g.fillStyle(pal.waterRim, 1).fillEllipse(o.x, o.y, (o.rx + 7) * 2, (o.ry + 6) * 2);
    g.fillStyle(pal.water, 1).fillEllipse(o.x, o.y, o.rx * 2, o.ry * 2);
    g.fillStyle(pal.waterDeep, deep * 0.9).fillEllipse(o.x + 6, o.y + 3, o.rx * 1.1, o.ry);
    if (foam) for (let t = 0; t < Math.PI * 2; t += 0.22) g.fillStyle(pal.foam, 0.8).fillCircle(o.x + Math.cos(t) * o.rx * 0.97, o.y + Math.sin(t) * o.ry * 0.95, rng.range(1.5, 3));
  }
}

const WATER = {
  water: (g, L, pal, rng) => basicWater(g, L, pal, rng),
  sea(g, L, pal, rng) {
    basicWater(g, L, pal, rng, { bank: 0xd9bf78, bankAlpha: 0.9 });
    // Thick foam bands and little wave crests.
    for (const r of L.rivers) {
      for (const edge of ['top', 'bottom']) {
        g.lineStyle(5, 0xffffff, 0.85).strokePoints(r.pts.map((p) => V(p.x, p[edge] + (edge === 'top' ? 4 : -4))), false);
      }
      for (const p of r.pts) {
        if (rng.chance(0.5)) continue;
        const y = rng.range(p.top + 10, p.bottom - 10);
        g.lineStyle(2.5, 0xffffff, 0.75).beginPath().arc(p.x, y + 8, 9, Phaser.Math.DegToRad(220), Phaser.Math.DegToRad(320)).strokePath();
      }
    }
  },
  ice(g, L, pal, rng) {
    basicWater(g, L, pal, rng, { bank: 0xffffff, bankAlpha: 1, foam: false, deep: 0.25 });
    // Frozen: white cracks and glossy highlights instead of foam.
    const crack = (x, y) => {
      let a = rng.range(0, Math.PI * 2);
      const pts = [V(x, y)];
      for (let i = 0; i < 4; i++) { a += rng.range(-0.8, 0.8); const l = pts[pts.length - 1]; pts.push(V(l.x + Math.cos(a) * 10, l.y + Math.sin(a) * 5)); }
      g.lineStyle(1.5, 0xffffff, 0.9).strokePoints(pts, false);
    };
    for (const r of L.rivers) for (const p of r.pts) if (rng.chance(0.6)) crack(p.x, rng.range(p.top + 6, p.bottom - 6));
    for (const o of L.ponds) for (let i = 0; i < 5; i++) crack(o.x + rng.range(-o.rx, o.rx) * 0.6, o.y + rng.range(-o.ry, o.ry) * 0.5);
    for (const r of L.rivers) g.lineStyle(3, 0xffffff, 0.5).strokePoints(r.pts.map((p) => V(p.x, p.top + 6)), false);
  },
  lava(g, L, pal, rng) {
    // A wide hot glow on the ground first, then the lava.
    for (const r of L.rivers) for (let i = 4; i >= 1; i--) g.fillStyle(0xff7a2f, 0.08).fillPoints(riverPoly(r, 10 + i * 8), true);
    for (const o of L.ponds) for (let i = 4; i >= 1; i--) g.fillStyle(0xff7a2f, 0.08).fillEllipse(o.x, o.y, (o.rx + 10 + i * 8) * 2, (o.ry + 8 + i * 6) * 2);
    basicWater(g, L, pal, rng, { bank: 0x2b2226, bankAlpha: 1, foam: false, deep: 0.6 });
    // Bright streaks and cooling crust plates.
    for (const r of L.rivers) {
      g.lineStyle(3, 0xffe08a, 0.9).strokePoints(midBand(r, 0.1).pts.map((p) => V(p.x, p.top)), false);
      for (const p of r.pts) {
        if (rng.chance(0.55)) continue;
        g.fillStyle(0x5b2a1a, 0.85).fillEllipse(p.x + rng.range(-10, 10), rng.range(p.top + 8, p.bottom - 8), rng.range(10, 20), rng.range(5, 9));
      }
    }
  },
  swamp(g, L, pal, rng) {
    basicWater(g, L, pal, rng, { bank: 0x3b2f52, bankAlpha: 0.8, foam: false, deep: 0.6 });
    const lily = (x, y, r) => {
      g.fillStyle(0x2f7a55, 1).slice(x, y, r, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(340)).fillPath();
      g.fillStyle(0x4fa874, 1).fillCircle(x - r * 0.25, y - r * 0.2, r * 0.35);
    };
    for (const r of L.rivers) for (const p of r.pts) {
      if (rng.chance(0.35)) lily(p.x + rng.range(-8, 8), rng.range(p.top + 8, p.bottom - 8), rng.range(6, 10));
      if (rng.chance(0.3)) g.lineStyle(1.5, 0xd6fff0, 0.7).strokeCircle(p.x, rng.range(p.top + 6, p.bottom - 6), rng.range(2, 4));
    }
    for (const o of L.ponds) for (let i = 0; i < 4; i++) lily(o.x + rng.range(-o.rx, o.rx) * 0.6, o.y + rng.range(-o.ry, o.ry) * 0.5, rng.range(6, 9));
  },
  sky(g, L, pal, rng) {
    // Open sky between cloud islands: a deeper blue gap with fluffy cloud edges.
    for (const r of L.rivers) {
      g.fillStyle(pal.waterDeep, 0.8).fillPoints(riverPoly(r, 0), true);
      // Fluffy cloud banks along both edges: overlapping puffs of mixed sizes, shaded underneath.
      for (const [edge, dir] of [['top', -1], ['bottom', 1]]) {
        for (let x = -30; x < L.W + 30; x += rng.range(14, 24)) {
          const p = r.pts[Math.max(0, Math.min(r.pts.length - 1, Math.round((x + 40) / 32)))];
          const rr = rng.range(12, 26);
          const y = p[edge] + dir * rr * 0.55;
          g.fillStyle(0xd6e6fa, 1).fillCircle(x, y + 4, rr);
          g.fillStyle(0xffffff, 1).fillCircle(x, y, rr);
        }
      }
    }
    for (const o of L.ponds) {
      g.fillStyle(pal.waterDeep, 0.8).fillEllipse(o.x, o.y, o.rx * 2, o.ry * 2);
      for (let t = 0; t < Math.PI * 2; t += 0.35) g.fillStyle(0xffffff, 1).fillCircle(o.x + Math.cos(t) * o.rx, o.y + Math.sin(t) * o.ry, rng.range(8, 12));
    }
  },
};

// ---------- plateaus: drop shadow, cliff band, top face ----------

const offsetPoly = (poly, dx, dy, scaleAbout) => poly.map((p) => {
  if (!scaleAbout) return V(p.x + dx, p.y + dy);
  const { cx, cy, s } = scaleAbout;
  return V(cx + (p.x - cx) * s + dx, cy + (p.y - cy) * s + dy);
});

function drawPlateaus(g, L, pal, style, rng) {
  const cloud = style.cliffMarks === 'cloud';
  // Shadows first so no plateau's shadow lands on another plateau. Sky islands float, so theirs fall further.
  for (const p of L.plateaus) {
    for (let i = 0; i < 4; i++) {
      const drop = cloud ? 40 + i * 8 : p.cliff + 10 + i * 4;
      g.fillStyle(cloud ? 0x3d6fa8 : 0x000000, cloud ? 0.07 : 0.06)
        .fillPoints(offsetPoly(p.poly, 8 + i * 3, drop, { cx: p.cx, cy: p.cy, s: 1 + i * 0.006 }), true);
    }
  }
  // Furthest (top of the map) first, so nearer plateaus overlap correctly.
  for (const p of [...L.plateaus].reverse()) {
    const dark = shade(pal.cliff, -16);
    const front = p.poly.filter((q) => q.y > p.cy + p.ry * 0.15);
    if (!cloud) g.fillStyle(shade(pal.cliff, -34), 0.55).fillPoints(offsetPoly(p.poly, 0, p.cliff + 3), true);
    for (let dy = p.cliff; dy > 0; dy -= 2) {
      g.fillStyle(lerpColour(pal.cliff, dark, dy / p.cliff), 1).fillPoints(offsetPoly(p.poly, 0, dy), true);
    }
    CLIFF_MARKS[style.cliffMarks](g, p, front, pal, rng, dark);

    // Top face: darker lip, then the face, then a lighter inner area.
    g.fillStyle(shade(pal.top, -10), 1).fillPoints(offsetPoly(p.poly, 0, 0), true);
    g.fillStyle(pal.top, 1).fillPoints(offsetPoly(p.poly, 0, -3, { cx: p.cx, cy: p.cy, s: 0.992 }), true);
    g.fillStyle(shade(pal.top, 5), 1).fillPoints(offsetPoly(p.poly, 0, -6, { cx: p.cx, cy: p.cy, s: 0.93 }), true);
    for (let i = 0; i < 26; i++) {
      const t = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.8);
      const tone = TOP_TONES[style.ground]?.(pal, rng) ?? (rng.chance(0.5) ? shade(pal.top, -7) : shade(pal.top, 9));
      softBlob(g, p.cx + Math.cos(t) * p.rx * r, p.cy + Math.sin(t) * p.ry * r, rng.range(40, 90), rng.range(20, 40), tone, 0.55);
    }
    TOP_EXTRAS[style.ground]?.(g, p, pal, rng);
    if (cloud) {
      // Puffy cloud rim all the way round.
      for (const q of p.poly) if (rng.chance(0.5)) g.fillStyle(0xffffff, 1).fillCircle(q.x, q.y + 2, rng.range(12, 22));
    }
    // Rim highlight along the back edge.
    g.lineStyle(4, 0xffffff, cloud ? 0.6 : 0.22);
    g.beginPath();
    p.poly.forEach((q, i) => {
      if (q.y > p.cy - p.ry * 0.2) return;
      const x = p.cx + (q.x - p.cx) * 0.97;
      const y = p.cy + (q.y - p.cy) * 0.95;
      if (i === 0 || p.poly[i - 1].y > p.cy - p.ry * 0.2) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.strokePath();
  }
}

const CLIFF_MARKS = {
  vertical(g, p, front, pal, rng, dark) {
    for (const q of front) if (rng.next() > 0.45) g.lineStyle(3, dark, 0.35).lineBetween(q.x, q.y + 7, q.x, q.y + p.cliff - 6);
  },
  roots(g, p, front, pal, rng, dark) {
    CLIFF_MARKS.vertical(g, p, front, pal, rng, dark);
    for (const q of front) {
      if (rng.next() > 0.25) continue;
      g.lineStyle(3, 0x5a3f22, 0.8).beginPath().moveTo(q.x, q.y + 2).lineTo(q.x + rng.range(-6, 6), q.y + p.cliff * 0.5).lineTo(q.x + rng.range(-8, 8), q.y + p.cliff - 4).strokePath();
    }
    // Moss dripping over the lip.
    for (const q of front) if (rng.next() > 0.5) g.fillStyle(0x3f8a3d, 1).fillEllipse(q.x, q.y + 3, rng.range(10, 18), rng.range(6, 10));
  },
  horizontal(g, p, front, pal, rng, dark) {
    // Layered sandstone: bands across the cliff.
    for (const f of [0.35, 0.62, 0.85]) {
      g.lineStyle(2.5, dark, 0.4).strokePoints(front.map((q) => V(q.x, q.y + p.cliff * f)), false);
    }
    g.lineStyle(2, shade(pal.cliff, 18), 0.5).strokePoints(front.map((q) => V(q.x, q.y + p.cliff * 0.2)), false);
  },
  ice(g, p, front, pal, rng) {
    // Pale streaks and icicles hanging from the lip.
    for (const q of front) if (rng.next() > 0.5) g.lineStyle(3, 0xe8f6ff, 0.6).lineBetween(q.x, q.y + 6, q.x + 2, q.y + p.cliff - 6);
    for (const q of front) {
      if (rng.next() > 0.6) continue;
      const h = rng.range(8, p.cliff * 0.7);
      g.fillStyle(0xdff4ff, 1).fillTriangle(q.x - 4, q.y + 1, q.x + 4, q.y + 1, q.x, q.y + h);
      g.fillStyle(0xffffff, 1).fillTriangle(q.x - 2, q.y + 1, q.x, q.y + 1, q.x - 1, q.y + h * 0.7);
    }
  },
  glow(g, p, front, pal, rng, dark) {
    CLIFF_MARKS.vertical(g, p, front, pal, rng, dark);
    // Hot seams where lava shows through the rock.
    for (const q of front) {
      if (rng.next() > 0.18) continue;
      g.lineStyle(5, 0xff7a2f, 0.35).lineBetween(q.x, q.y + 6, q.x + rng.range(-4, 4), q.y + p.cliff - 2);
      g.lineStyle(1.8, 0xffc15a, 1).lineBetween(q.x, q.y + 6, q.x + rng.range(-3, 3), q.y + p.cliff - 2);
    }
    g.lineStyle(4, 0xff7a2f, 0.35).strokePoints(front.map((q) => V(q.x, q.y + p.cliff + 2)), false);
  },
  cloud(g, p, front, pal, rng) {
    // Soft bumpy underside instead of a cliff.
    for (const q of front) if (rng.next() > 0.3) g.fillStyle(pal.cliff, 1).fillCircle(q.x, q.y + p.cliff - 4, rng.range(10, 18));
    for (const q of front) if (rng.next() > 0.5) g.fillStyle(0xe6effc, 1).fillCircle(q.x, q.y + p.cliff * 0.45, rng.range(8, 14));
  },
};

// Optional tones and extras for each biome's plateau top.
const TOP_TONES = {
  snow: (pal, rng) => (rng.chance(0.6) ? 0xd7e6f6 : 0xffffff),
  ash: (pal, rng) => (rng.chance(0.6) ? 0x5b4b4f : 0x7e6a6e),
  haunted: (pal, rng) => (rng.chance(0.5) ? 0x5c4b7a : 0x8270a6),
  clouds: () => 0xeaf2ff,
};
const TOP_EXTRAS = {
  grass(g, p, pal, rng) {
    for (let i = 0; i < 40; i++) {
      const t = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.85);
      const x = p.cx + Math.cos(t) * p.rx * r;
      const y = p.cy + Math.sin(t) * p.ry * r;
      g.lineStyle(2, shade(pal.top, -18), 0.5).lineBetween(x - 3, y, x - 1, y - 6).lineBetween(x + 1, y, x + 3, y - 7);
    }
  },
  forest(g, p, pal, rng) { TOP_EXTRAS.grass(g, p, pal, rng); },
  ash(g, p, pal, rng) {
    for (let i = 0; i < 5; i++) {
      const t = rng.range(0, Math.PI * 2);
      const r = rng.range(0.2, 0.75);
      glowCrack(g, rng, p.cx + Math.cos(t) * p.rx * r, p.cy + Math.sin(t) * p.ry * r, rng.range(40, 90));
    }
  },
  snow(g, p, pal, rng) {
    for (let i = 0; i < 60; i++) {
      const t = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.9);
      g.fillStyle(0xffffff, 1).fillCircle(p.cx + Math.cos(t) * p.rx * r, p.cy + Math.sin(t) * p.ry * r, rng.range(0.8, 1.8));
    }
  },
};

// ---------- paths ----------

function stamp(g, pts, colour, r, dx = 0, dy = 0, alpha = 1) {
  for (const q of pts) g.fillStyle(colour, alpha).fillCircle(q.x + dx, q.y + dy, r);
}

function drawPaths(g, L, pal, style, rng) {
  const all = L.paths.flatMap((p) => p.pts);
  const edge = style.pathEdge ?? pal.pathEdge; // Volcano: near-black edge so the ash path stands off the rock
  stamp(g, all, shade(edge, -8), 25, 0, 2);
  stamp(g, all, edge, 24);
  stamp(g, all, pal.path, 19);
  stamp(g, all, shade(pal.path, 6), 9, -2, -3);
  PATH_DETAIL[style.path](g, L, pal, rng, all);
}

// Direction of travel at each path point, for planks/tiles/footprints.
function* along(L, every) {
  for (const path of L.paths) {
    const pts = path.pts;
    for (let i = 1; i < pts.length - 1; i += every) {
      const a = pts[i - 1];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      yield { x: pts[i].x, y: pts[i].y, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len };
    }
  }
}

function pebbles(g, pal, rng, all, chance = 0.45) {
  for (let i = 0; i < all.length; i += 3) {
    const q = all[i];
    if (rng.next() > chance) continue;
    const x = q.x + rng.range(-14, 14);
    const y = q.y + rng.range(-12, 12);
    const r = rng.range(1.8, 3.6);
    g.fillStyle(shade(pal.pathEdge, -12), 0.8).fillEllipse(x, y + 1, r * 2.4, r * 1.7);
    g.fillStyle(shade(pal.path, 10), 1).fillEllipse(x - 0.5, y - 0.5, r * 1.6, r * 1.1);
  }
}

const PATH_DETAIL = {
  pebbles: (g, L, pal, rng, all) => pebbles(g, pal, rng, all),
  leaves(g, L, pal, rng, all) {
    pebbles(g, pal, rng, all, 0.25);
    for (let i = 0; i < all.length; i += 2) {
      const q = all[i];
      if (rng.chance(0.6)) continue;
      g.fillStyle(rng.pick([0xc97a2f, 0xe0a640, 0x7a9e3a]), 0.85).fillEllipse(q.x + rng.range(-15, 15), q.y + rng.range(-12, 12), 7, 4);
    }
  },
  planks(g, L, pal) {
    // Boardwalk: planks across the direction of travel.
    for (const s of along(L, 2)) {
      const nx = -s.ty;
      const ny = s.tx;
      g.lineStyle(2, shade(pal.pathEdge, -18), 0.75).lineBetween(s.x - nx * 18, s.y - ny * 18, s.x + nx * 18, s.y + ny * 18);
    }
    for (const s of along(L, 1)) {
      for (const side of [-13, 13]) g.fillStyle(shade(pal.pathEdge, -22), 1).fillCircle(s.x - s.ty * side, s.y + s.tx * side, 1.2);
    }
  },
  tiles(g, L, pal, rng) {
    // Flagstones: offset rounded slabs with dark grout.
    for (const s of along(L, 3)) {
      for (const side of [-8, 8]) {
        const x = s.x - s.ty * side + s.tx * rng.range(-3, 3);
        const y = s.y + s.tx * side + s.ty * rng.range(-3, 3);
        g.fillStyle(shade(pal.pathEdge, -12), 0.9).fillRoundedRect(x - 8, y - 6, 16, 12, 3);
        g.fillStyle(shade(pal.path, rng.range(-6, 10)), 1).fillRoundedRect(x - 7, y - 6.5, 14, 10, 3);
      }
    }
  },
  snowprints(g, L, pal) {
    let left = true;
    for (const s of along(L, 3)) {
      const side = left ? -5 : 5;
      left = !left;
      g.fillStyle(0xa9bfd6, 0.8).fillEllipse(s.x - s.ty * side, s.y + s.tx * side, 5, 7);
    }
  },
  ash(g, L, pal, rng, all) {
    pebbles(g, { ...pal, pathEdge: 0x2b2226, path: 0x6d5245 }, rng, all, 0.5);
    for (let i = 0; i < all.length; i += 40) glowCrack(g, rng, all[i].x, all[i].y, 30);
  },
  gold(g, L, pal, rng, all) {
    for (const s of along(L, 3)) {
      g.lineStyle(1.5, shade(pal.pathEdge, -10), 0.6).lineBetween(s.x - s.ty * 18, s.y + s.tx * 18, s.x + s.ty * 18, s.y - s.tx * 18);
    }
    for (let i = 0; i < all.length; i += 4) {
      if (rng.chance(0.6)) continue;
      const q = all[i];
      sparkle(g, q.x + rng.range(-12, 12), q.y + rng.range(-10, 10), rng.range(3, 5), 0xffffff);
    }
  },
};

function sparkle(g, x, y, r, colour, alpha = 1) {
  g.fillStyle(colour, alpha).fillPoints([V(x, y - r), V(x + r * 0.28, y - r * 0.28), V(x + r, y), V(x + r * 0.28, y + r * 0.28),
    V(x, y + r), V(x - r * 0.28, y + r * 0.28), V(x - r, y), V(x - r * 0.28, y - r * 0.28)], true);
}

// ---------- stairs on the cliff band, bridges over water ----------

function drawConnectors(g, L, pal, style) {
  const wood = style.bridge;
  for (const c of L.connectors) {
    const w = c.width;
    const x0 = c.x - w / 2;
    const river = c.water && L.rivers.find((r) => r.y > c.cliffBottom && r.y < c.A.y);
    if (river) {
      const top = river.y - river.half - 16;
      const bot = river.y + river.half + 16;
      g.fillStyle(0x000000, 0.18).fillRect(x0 + 4, top + 8, w, bot - top);
      for (let y = top; y < bot; y += 11) {
        g.fillStyle(wood.dark, 1).fillRect(x0, y + 2, w, 9);
        g.fillStyle(wood.plank, 1).fillRect(x0, y, w, 8);
        g.fillStyle(wood.light, 1).fillRect(x0 + 3, y + 1, w - 6, 2);
      }
      for (const px of [x0 - 3, x0 + w + 3]) {
        g.lineStyle(4, wood.post, 1).lineBetween(px, top - 6, px, bot + 2);
        for (const py of [top - 6, (top + bot) / 2, bot + 2]) g.fillStyle(wood.post, 1).fillCircle(px, py, 6);
      }
    }
    // Stairs: light and dark stripes down the cliff, with stone sides.
    const sTop = c.top;
    const sBot = c.cliffBottom + 8;
    g.fillStyle(0x000000, 0.15).fillRect(x0 + 6, sTop + 6, w, sBot - sTop);
    g.fillStyle(shade(pal.cliff, -28), 1).fillRect(x0 - 8, sTop, w + 16, sBot - sTop);
    const steps = Math.max(4, Math.round((sBot - sTop) / 9));
    const sh = (sBot - sTop) / steps;
    for (let i = 0; i < steps; i++) {
      const y = sTop + i * sh;
      g.fillStyle(shade(pal.path, 12), 1).fillRect(x0, y, w, sh * 0.55);
      g.fillStyle(shade(pal.pathEdge, -10), 1).fillRect(x0, y + sh * 0.55, w, sh * 0.45);
    }
    g.fillStyle(shade(pal.cliff, 10), 1).fillRect(x0 - 8, sTop, 6, sBot - sTop).fillRect(x0 + w + 2, sTop, 6, sBot - sTop);
  }
}

// ---------- start pad and the boss pedestal ----------

const PEDESTAL = {
  default: { side: [0x9aa0a8, 0x6b7280], top: [0xd1d5db, 0xe5e7eb], ring: 0xfacc15, line: 0x4b5563 },
  volcano: { side: [0x3a2c30, 0x1f181b], top: [0x5b4b4f, 0x6e5a5e], ring: 0xff7a2f, line: 0xff9a3c },
  haunted: { side: [0x4b3d66, 0x2f2542], top: [0x6d5a8f, 0x8270a6], ring: 0xc084fc, line: 0x2a2038 },
  snow: { side: [0x9fc3e6, 0x6f9ccb], top: [0xdff1ff, 0xffffff], ring: 0x7dd3fc, line: 0x5b8bbf },
  sky: { side: [0xe6edf8, 0xc9dbf5], top: [0xffffff, 0xffffff], ring: 0xffd86b, line: 0xc9dbf5 },
};

function drawSpots(g, L, pal) {
  const s = L.start;
  g.fillStyle(0x000000, 0.12).fillEllipse(s.x + 3, s.y + 6, 96, 36);
  g.fillStyle(shade(pal.pathEdge, -8), 1).fillEllipse(s.x, s.y + 3, 92, 34);
  g.fillStyle(shade(pal.path, 8), 1).fillEllipse(s.x, s.y, 86, 30);

  const P = PEDESTAL[pal.key] ?? PEDESTAL.default;
  const b = L.boss;
  const rx = 104;
  const ry = 40;
  const hgt = 26;
  g.fillStyle(0x000000, 0.18).fillEllipse(b.x + 8, b.y + hgt + 14, rx * 2.15, ry * 2.1);
  for (let dy = hgt; dy > 0; dy -= 2) g.fillStyle(lerpColour(P.side[0], P.side[1], dy / hgt), 1).fillEllipse(b.x, b.y + dy, rx * 2, ry * 2);
  for (let a = -Math.PI * 0.95; a < Math.PI * 0.05; a += Math.PI / 9) {
    const x = b.x + Math.cos(a + Math.PI) * rx * 0.98;
    g.lineStyle(2, P.line, 0.5).lineBetween(x, b.y + 4 + Math.abs(Math.sin(a)) * ry * 0.3, x, b.y + hgt - 2);
  }
  g.fillStyle(P.top[0], 1).fillEllipse(b.x, b.y, rx * 2, ry * 2);
  g.fillStyle(P.top[1], 1).fillEllipse(b.x, b.y - 2, rx * 1.8, ry * 1.75);
  g.lineStyle(5, P.ring, 1).strokeEllipse(b.x, b.y - 1, rx * 1.5, ry * 1.45);
  g.lineStyle(2, 0xffffff, 0.6).strokeEllipse(b.x, b.y - 3, rx * 1.5, ry * 1.45);
}

// ---------- decor ----------

function shadowUnder(g, x, y, w, alpha = 0.16) {
  g.fillStyle(0x000000, alpha).fillEllipse(x + w * 0.06, y + 2, w, w * 0.32);
}

// Soft glow halo for lanterns, mushrooms, crystals.
function halo(g, x, y, r, colour, alpha = 0.18) {
  for (let i = 3; i >= 1; i--) g.fillStyle(colour, alpha * (1 - i * 0.2)).fillCircle(x, y, r * (0.5 + i * 0.25));
}

const TREE_GREENS = [[0x3f9a36, 0x55b545, 0x7fd463], [0x3b8f3a, 0x4fae46, 0x86d86a], [0x4a9e30, 0x62bd3e, 0x9be06a]];
const PETALS = [0xffffff, 0xfff176, 0xff9ecb, 0xc4a1ff];
const pickBy = (arr, hue) => arr[Math.min(arr.length - 1, Math.floor(hue * arr.length))];

const DECOR = {
  // --- Sunny Meadow ---
  tree(g, x, y, s, hue) {
    const [d, m, l] = pickBy(TREE_GREENS, hue);
    shadowUnder(g, x, y, 78 * s);
    g.fillStyle(0x6b4423, 1).fillRoundedRect(x - 7 * s, y - 34 * s, 14 * s, 36 * s, 5 * s);
    g.fillStyle(0x8b5a2b, 1).fillRoundedRect(x - 6 * s, y - 34 * s, 7 * s, 34 * s, 3 * s);
    g.fillStyle(d, 1).fillCircle(x - 20 * s, y - 50 * s, 24 * s).fillCircle(x + 20 * s, y - 50 * s, 24 * s).fillCircle(x, y - 66 * s, 30 * s);
    g.fillStyle(m, 1).fillCircle(x - 16 * s, y - 56 * s, 20 * s).fillCircle(x + 16 * s, y - 58 * s, 19 * s).fillCircle(x, y - 72 * s, 25 * s);
    g.fillStyle(l, 1).fillCircle(x - 8 * s, y - 78 * s, 13 * s).fillCircle(x - 19 * s, y - 62 * s, 9 * s);
    g.fillStyle(0xffffff, 0.35).fillEllipse(x - 10 * s, y - 84 * s, 12 * s, 7 * s);
  },
  bush(g, x, y, s, hue) {
    const [d, m, l] = pickBy(TREE_GREENS, hue);
    shadowUnder(g, x, y, 54 * s);
    g.fillStyle(d, 1).fillCircle(x - 14 * s, y - 12 * s, 14 * s).fillCircle(x + 14 * s, y - 12 * s, 14 * s).fillCircle(x, y - 20 * s, 18 * s);
    g.fillStyle(m, 1).fillCircle(x - 10 * s, y - 16 * s, 11 * s).fillCircle(x + 10 * s, y - 17 * s, 11 * s).fillCircle(x, y - 24 * s, 14 * s);
    g.fillStyle(l, 1).fillCircle(x - 5 * s, y - 29 * s, 7 * s);
    if (hue > 0.6) for (const [dx, dy] of [[-12, -18], [8, -26], [14, -12]]) g.fillStyle(0xff6b8a, 1).fillCircle(x + dx * s, y + dy * s, 3 * s);
  },
  flowers(g, x, y, s, hue) {
    shadowUnder(g, x, y, 36 * s);
    g.fillStyle(0x4fae46, 1);
    for (const [dx, dy] of [[-10, -4], [8, -6], [0, -10], [-4, 0], [12, 0]]) g.fillEllipse(x + dx * s, y + dy * s, 12 * s, 6 * s);
    const petal = pickBy(PETALS, hue);
    for (const [dx, dy] of [[-9, -12], [7, -15], [0, -20], [12, -7], [-13, -4]]) {
      const cx = x + dx * s;
      const cy = y + dy * s;
      g.fillStyle(petal, 1);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.fillCircle(cx + Math.cos(a) * 3.2 * s, cy + Math.sin(a) * 3.2 * s, 2.6 * s);
      }
      g.fillStyle(0xfacc15, 1).fillCircle(cx, cy, 2 * s);
    }
  },
  mushroom(g, x, y, s, hue) {
    shadowUnder(g, x, y, 28 * s);
    const cap = hue > 0.5 ? 0xe5483b : 0xf08a24;
    g.fillStyle(0xe8d9b8, 1).fillRoundedRect(x - 5 * s, y - 16 * s, 10 * s, 16 * s, 4 * s);
    g.fillStyle(shade(cap, -20), 1).fillEllipse(x, y - 17 * s, 30 * s, 14 * s);
    g.fillStyle(cap, 1).fillEllipse(x, y - 20 * s, 28 * s, 18 * s);
    g.fillStyle(0xffffff, 1).fillCircle(x - 6 * s, y - 23 * s, 2.6 * s).fillCircle(x + 5 * s, y - 25 * s, 2.2 * s).fillCircle(x + 1 * s, y - 18 * s, 1.8 * s);
  },
  rock: (g, x, y, s) => rockShape(g, x, y, s, [0x7c7470, 0xa8a29e, 0xd6d3d1]),

  // --- Coral Beach ---
  palm(g, x, y, s, hue) {
    shadowUnder(g, x + 14 * s, y, 70 * s);
    const lean = hue > 0.5 ? 1 : -1;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const px = x + lean * Math.sin(t * 1.4) * 22 * s;
      const py = y - t * 80 * s;
      g.fillStyle(i % 2 ? 0xa0703f : 0xb98654, 1).fillEllipse(px, py, (12 - t * 4) * s, 10 * s);
    }
    const tx = x + lean * Math.sin(1.4) * 22 * s;
    const ty = y - 82 * s;
    const frond = (a, len, col) => {
      const ex = tx + Math.cos(a) * len * s;
      const ey = ty + Math.sin(a) * len * s * 0.7 + 10 * s;
      const mx = (tx + ex) / 2 - Math.sin(a) * 8 * s;
      const my = (ty + ey) / 2 - 10 * s;
      g.fillStyle(col, 1).fillTriangle(tx, ty, mx, my, ex, ey);
      g.fillStyle(shade(col, 14), 1).fillTriangle(tx, ty - 2 * s, mx, my - 2 * s, (tx + ex) / 2, (ty + ey) / 2 - 4 * s);
    };
    for (const [a, len] of [[Math.PI * 1.05, 44], [Math.PI * 1.9, 44], [Math.PI * 1.3, 40], [Math.PI * 1.65, 40], [Math.PI * 0.85, 34], [Math.PI * 0.15, 34]]) frond(a, len, 0x2f9e5a);
    g.fillStyle(0x7a4b22, 1).fillCircle(tx - 4 * s, ty + 4 * s, 4 * s).fillCircle(tx + 4 * s, ty + 5 * s, 4 * s);
  },
  umbrella(g, x, y, s, hue) {
    shadowUnder(g, x + 6 * s, y, 56 * s, 0.2);
    const [a, b] = pickBy([[0xef4444, 0xffffff], [0x3b82f6, 0xffffff], [0xf59e0b, 0xfff7ed]], hue);
    g.fillStyle(pickBy([0x60a5fa, 0xf472b6, 0x34d399], 1 - hue), 1).fillRoundedRect(x - 16 * s, y - 6 * s, 32 * s, 12 * s, 3 * s); // towel
    g.lineStyle(3 * s, 0xe5e7eb, 1).lineBetween(x, y - 2 * s, x + 2 * s, y - 38 * s);
    for (let i = 0; i < 6; i++) {
      const a0 = Math.PI + (i / 6) * Math.PI;
      const a1 = Math.PI + ((i + 1) / 6) * Math.PI;
      g.fillStyle(i % 2 ? a : b, 1).slice(x + 2 * s, y - 34 * s, 26 * s, a0, a1).fillPath();
    }
    g.fillStyle(0x000000, 0.12).fillEllipse(x + 2 * s, y - 34 * s, 52 * s, 6 * s);
    g.fillStyle(0xffffff, 1).fillCircle(x + 2 * s, y - 60 * s, 2.5 * s);
  },
  shell(g, x, y, s, hue) {
    shadowUnder(g, x, y, 26 * s);
    const c = pickBy([0xffc6d3, 0xffe1b8, 0xfff7ed], hue);
    g.fillStyle(shade(c, -12), 1).slice(x, y - 2 * s, 13 * s, Math.PI * 1.08, Math.PI * 1.92).fillPath();
    g.fillStyle(c, 1).slice(x, y - 3 * s, 12 * s, Math.PI * 1.1, Math.PI * 1.9).fillPath();
    for (let i = 1; i < 6; i++) {
      const a = Math.PI * (1.1 + i * 0.133);
      g.lineStyle(1.2 * s, shade(c, -22), 0.9).lineBetween(x, y - 3 * s, x + Math.cos(a) * 11 * s, y - 3 * s + Math.sin(a) * 11 * s);
    }
    g.fillStyle(shade(c, -18), 1).fillRect(x - 3 * s, y - 3 * s, 6 * s, 3 * s);
  },
  starfish(g, x, y, s, hue) {
    shadowUnder(g, x, y, 26 * s);
    const c = pickBy([0xff7a59, 0xfb923c, 0xf472b6], hue);
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 ? 5 : 13) * s;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(V(x + Math.cos(a) * r, y - 8 * s + Math.sin(a) * r * 0.75));
    }
    g.fillStyle(shade(c, -18), 1).fillPoints(pts.map((p) => V(p.x, p.y + 2 * s)), true);
    g.fillStyle(c, 1).fillPoints(pts, true);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      g.fillStyle(0xfff3e0, 1).fillCircle(x + Math.cos(a) * 6 * s, y - 8 * s + Math.sin(a) * 4.5 * s, 1.3 * s);
    }
  },
  sandRock: (g, x, y, s) => rockShape(g, x, y, s, [0xb08a5a, 0xd4b07a, 0xf0dcb0]),

  // --- Deep Forest ---
  tallTree(g, x, y, s, hue) {
    const greens = pickBy([[0x1f4d27, 0x2f6b33, 0x3f8a3d], [0x1c4a30, 0x2a6a44, 0x3c8a5a], [0x24502a, 0x346f35, 0x4a8f40]], hue);
    shadowUnder(g, x, y, 70 * s, 0.25);
    g.fillStyle(0x4a3220, 1).fillRoundedRect(x - 6 * s, y - 30 * s, 12 * s, 32 * s, 4 * s);
    // Tiers, widest at the bottom.
    const tiers = [[-30, 34, 20], [-56, 28, 18], [-80, 21, 16], [-100, 14, 13]];
    for (const [dy, rx, ry] of tiers) {
      g.fillStyle(greens[0], 1).fillEllipse(x, y + (dy + 4) * s, rx * 2 * s, ry * 2 * s);
      g.fillStyle(greens[1], 1).fillEllipse(x - 2 * s, y + dy * s, rx * 1.8 * s, ry * 1.7 * s);
      g.fillStyle(greens[2], 1).fillEllipse(x - rx * 0.35 * s, y + (dy - ry * 0.4) * s, rx * 0.8 * s, ry * 0.7 * s);
    }
  },
  fern(g, x, y, s, hue) {
    shadowUnder(g, x, y, 50 * s, 0.22);
    const c = hue > 0.5 ? 0x2f7a3a : 0x3a8a3a;
    for (const a of [-2.6, -2.2, -1.85, -1.57, -1.3, -0.95, -0.55]) {
      const ex = x + Math.cos(a) * 30 * s;
      const ey = y - 6 * s + Math.sin(a) * 26 * s;
      g.fillStyle(shade(c, -14), 1).fillTriangle(x - 4 * s, y - 4 * s, x + 4 * s, y - 4 * s, ex, ey);
      g.fillStyle(c, 1).fillTriangle(x - 2 * s, y - 6 * s, x + 3 * s, y - 6 * s, ex, ey);
    }
  },
  glowMushroom(g, x, y, s, hue) {
    const cap = pickBy([0x5ef2e0, 0x7cf0a8, 0x9ad7ff], hue);
    halo(g, x, y - 16 * s, 34 * s, cap, 0.22);
    for (const [dx, sc] of [[0, 1], [10, 0.65], [-9, 0.55]]) {
      const cx = x + dx * s;
      const k = s * sc;
      g.fillStyle(0xd8f5ee, 1).fillRoundedRect(cx - 3.5 * k, y - 18 * k, 7 * k, 18 * k, 3 * k);
      g.fillStyle(shade(cap, -25), 1).fillEllipse(cx, y - 18 * k, 26 * k, 11 * k);
      g.fillStyle(cap, 1).fillEllipse(cx, y - 21 * k, 24 * k, 14 * k);
      g.fillStyle(0xffffff, 0.9).fillCircle(cx - 5 * k, y - 23 * k, 2 * k).fillCircle(cx + 4 * k, y - 24 * k, 1.6 * k);
    }
  },
  log(g, x, y, s) {
    shadowUnder(g, x, y, 60 * s, 0.24);
    g.fillStyle(0x5a3a20, 1).fillRoundedRect(x - 28 * s, y - 16 * s, 50 * s, 16 * s, 8 * s);
    g.fillStyle(0x7a5232, 1).fillRoundedRect(x - 28 * s, y - 16 * s, 50 * s, 7 * s, 4 * s);
    g.fillStyle(0xc9a06a, 1).fillEllipse(x + 22 * s, y - 8 * s, 12 * s, 16 * s);
    g.lineStyle(1.2 * s, 0x8a6438, 1).strokeEllipse(x + 22 * s, y - 8 * s, 7 * s, 10 * s);
    g.fillStyle(0x4f9a3a, 1).fillEllipse(x - 12 * s, y - 16 * s, 16 * s, 6 * s).fillEllipse(x + 4 * s, y - 15 * s, 10 * s, 4 * s);
  },

  // --- Desert Ruins ---
  cactusOrPillar(g, x, y, s, hue) {
    if (hue < 0.55) DECOR.cactus(g, x, y, s, hue);
    else DECOR.pillar(g, x, y, s, hue);
  },
  cactus(g, x, y, s) {
    shadowUnder(g, x + 6 * s, y, 44 * s, 0.22);
    const body = (bx, by, w, h) => {
      g.fillStyle(0x3f7d3a, 1).fillRoundedRect(bx - w / 2, by - h, w, h, w / 2);
      g.fillStyle(0x5aa04b, 1).fillRoundedRect(bx - w / 2 + 2 * s, by - h, w * 0.55, h - 2 * s, w / 3);
      g.lineStyle(1.2 * s, 0x2f6a2c, 0.8).lineBetween(bx, by - h + 6 * s, bx, by - 4 * s);
    };
    body(x, y, 18 * s, 78 * s);
    body(x - 16 * s, y - 30 * s, 10 * s, 24 * s);
    g.fillStyle(0x3f7d3a, 1).fillRoundedRect(x - 18 * s, y - 34 * s, 12 * s, 8 * s, 4 * s);
    body(x + 15 * s, y - 40 * s, 10 * s, 20 * s);
    g.fillStyle(0x3f7d3a, 1).fillRoundedRect(x + 6 * s, y - 44 * s, 12 * s, 8 * s, 4 * s);
    g.fillStyle(0xff6b9a, 1).fillCircle(x, y - 80 * s, 3.5 * s);
  },
  pillar(g, x, y, s) {
    shadowUnder(g, x + 8 * s, y, 50 * s, 0.22);
    g.fillStyle(0xb9853f, 1).fillRect(x - 20 * s, y - 10 * s, 40 * s, 10 * s);
    g.fillStyle(0xe8c48a, 1).fillRect(x - 20 * s, y - 12 * s, 40 * s, 4 * s);
    const top = y - 70 * s;
    g.fillStyle(0xd9ad6a, 1).fillPoints([V(x - 13 * s, y - 10 * s), V(x + 13 * s, y - 10 * s), V(x + 13 * s, top + 6 * s), V(x + 6 * s, top), V(x + 1 * s, top + 8 * s), V(x - 5 * s, top - 4 * s), V(x - 13 * s, top + 4 * s)], true);
    for (const dx of [-7, 0, 7]) g.lineStyle(2 * s, 0xb9853f, 0.7).lineBetween(x + dx * s, y - 12 * s, x + dx * s, top + 10 * s);
    g.fillStyle(0xf2d29a, 1).fillRect(x - 13 * s, y - 60 * s, 4 * s, 48 * s);
    g.fillStyle(0xd9ad6a, 1).fillRoundedRect(x + 16 * s, y - 9 * s, 16 * s, 9 * s, 3 * s); // fallen chunk
  },
  ruinBlock(g, x, y, s) {
    shadowUnder(g, x + 4 * s, y, 56 * s, 0.22);
    const block = (bx, by, w, h) => {
      g.fillStyle(0xb9853f, 1).fillRect(bx, by - h, w, h);
      g.fillStyle(0xe2b875, 1).fillRect(bx, by - h, w, h * 0.35);
      g.lineStyle(1.2 * s, 0x8a6438, 0.7).strokeRect(bx, by - h, w, h);
    };
    block(x - 24 * s, y, 26 * s, 18 * s);
    block(x + 2 * s, y, 22 * s, 14 * s);
    block(x - 16 * s, y - 18 * s, 24 * s, 15 * s);
    g.lineStyle(1.5 * s, 0x6e4f2a, 0.8).lineBetween(x - 10 * s, y - 30 * s, x - 6 * s, y - 22 * s);
  },
  dryTuft(g, x, y, s, hue) {
    shadowUnder(g, x, y, 28 * s, 0.12);
    for (const a of [-2.4, -2, -1.6, -1.2, -0.8]) g.lineStyle(2 * s, 0xb8954a, 1).lineBetween(x, y, x + Math.cos(a) * 16 * s, y + Math.sin(a) * 18 * s);
    if (hue > 0.5) g.fillStyle(0xff8fb8, 1).fillCircle(x + 3 * s, y - 16 * s, 3 * s);
  },
  barrelCactus(g, x, y, s) {
    shadowUnder(g, x, y, 32 * s, 0.2);
    g.fillStyle(0x3f7d3a, 1).fillEllipse(x, y - 11 * s, 26 * s, 22 * s);
    g.fillStyle(0x5aa04b, 1).fillEllipse(x - 3 * s, y - 13 * s, 14 * s, 16 * s);
    for (const dx of [-7, 0, 7]) g.lineStyle(1 * s, 0x2f6a2c, 0.9).lineBetween(x + dx * s, y - 21 * s, x + dx * 1.2 * s, y - 2 * s);
    g.fillStyle(0xffd166, 1).fillCircle(x - 3 * s, y - 22 * s, 2.5 * s).fillCircle(x + 3 * s, y - 22 * s, 2.5 * s);
  },
  sandstone: (g, x, y, s) => rockShape(g, x, y, s, [0xa8743a, 0xd09a55, 0xf0c98a]),

  // --- Snow Peaks ---
  snowPine(g, x, y, s) {
    shadowUnder(g, x + 8 * s, y, 60 * s, 0.14);
    g.fillStyle(0x5b4029, 1).fillRect(x - 4 * s, y - 14 * s, 8 * s, 16 * s);
    const tiers = [[-14, 30, 30], [-38, 24, 26], [-60, 17, 22], [-78, 11, 18]];
    for (const [dy, hw, h] of tiers) {
      const by = y + dy * s;
      g.fillStyle(0x2f6457, 1).fillTriangle(x - hw * s, by, x + hw * s, by, x, by - h * s);
      g.fillStyle(0x3e7c6e, 1).fillTriangle(x - hw * 0.8 * s, by - 2 * s, x + hw * 0.2 * s, by - 2 * s, x, by - h * s);
      // Snow cap on each tier.
      g.fillStyle(0xffffff, 1).fillTriangle(x - hw * 0.55 * s, by - h * 0.45 * s, x + hw * 0.55 * s, by - h * 0.45 * s, x, by - h * s);
      g.fillStyle(0xffffff, 1).fillEllipse(x - hw * 0.6 * s, by - 2 * s, hw * 0.7 * s, 5 * s);
    }
  },
  snowMound(g, x, y, s, hue) {
    shadowUnder(g, x, y, 54 * s, 0.1);
    if (hue > 0.4) g.fillStyle(0x3e7c6e, 1).fillCircle(x - 10 * s, y - 16 * s, 10 * s).fillCircle(x + 8 * s, y - 18 * s, 9 * s);
    g.fillStyle(0xd7e6f6, 1).fillEllipse(x, y - 8 * s, 50 * s, 22 * s);
    g.fillStyle(0xffffff, 1).fillEllipse(x - 3 * s, y - 12 * s, 42 * s, 18 * s);
    g.fillStyle(0xffffff, 1).fillCircle(x - 12 * s, y - 16 * s, 9 * s).fillCircle(x + 6 * s, y - 19 * s, 10 * s);
  },
  iceCrystal(g, x, y, s, hue) {
    halo(g, x, y - 14 * s, 26 * s, 0xa8e6ff, 0.18);
    shadowUnder(g, x, y, 28 * s, 0.1);
    const shard = (dx, h, w, lean) => {
      const bx = x + dx * s;
      const tip = V(bx + lean * s, y - h * s);
      g.fillStyle(0x7cc8ec, 1).fillPoints([V(bx - w * s, y), V(bx - w * s, y - h * 0.6 * s), tip, V(bx + w * s, y - h * 0.6 * s), V(bx + w * s, y)], true);
      g.fillStyle(0xa8e6ff, 1).fillPoints([V(bx - w * s, y), V(bx - w * s, y - h * 0.6 * s), tip, V(bx, y - h * 0.55 * s), V(bx, y)], true);
      g.lineStyle(1.2 * s, 0xffffff, 0.9).lineBetween(bx - w * 0.5 * s, y - 2 * s, tip.x, tip.y + 3 * s);
    };
    shard(-8, 16 + hue * 6, 5, -3);
    shard(7, 14, 4, 3);
    shard(0, 26 + hue * 6, 6, 0);
  },
  snowRock: (g, x, y, s) => {
    rockShape(g, x, y, s, [0x6f7f92, 0x95a6ba, 0xc9d6e4]);
    g.fillStyle(0xffffff, 1).fillEllipse(x - 2 * s, y - 18 * s, 28 * s, 9 * s);
  },

  // --- Volcano ---
  spire(g, x, y, s, hue) {
    shadowUnder(g, x + 8 * s, y, 58 * s, 0.3);
    const h = (78 + hue * 20) * s;
    const pts = [V(x - 22 * s, y), V(x - 16 * s, y - h * 0.45), V(x - 8 * s, y - h * 0.7), V(x - 2 * s, y - h), V(x + 6 * s, y - h * 0.75), V(x + 14 * s, y - h * 0.5), V(x + 22 * s, y)];
    g.fillStyle(0x1f181b, 1).fillPoints(pts, true);
    g.fillStyle(0x3a2c30, 1).fillPoints([pts[0], pts[1], pts[2], pts[3], V(x + 2 * s, y - h * 0.3), V(x - 2 * s, y)], true);
    g.fillStyle(0x6e5a5e, 1).fillPoints([V(x - 14 * s, y - h * 0.45), V(x - 7 * s, y - h * 0.68), V(x - 2 * s, y - h * 0.95), V(x - 6 * s, y - h * 0.5)], true);
    g.lineStyle(4 * s, 0xff7a2f, 0.35).lineBetween(x + 4 * s, y - h * 0.6, x + 8 * s, y - 4 * s);
    g.lineStyle(1.6 * s, 0xffc15a, 1).lineBetween(x + 4 * s, y - h * 0.6, x + 8 * s, y - 4 * s);
  },
  darkRock: (g, x, y, s) => {
    rockShape(g, x, y, s, [0x1f181b, 0x3a2c30, 0x6e5a5e], 0.3);
    g.lineStyle(1.4 * s, 0xff9a3c, 0.9).lineBetween(x - 6 * s, y - 4 * s, x + 2 * s, y - 12 * s);
  },
  vent(g, x, y, s, hue) {
    halo(g, x, y - 4 * s, 26 * s, 0xff7a2f, 0.22);
    g.fillStyle(0x1f181b, 1).fillEllipse(x, y - 4 * s, 30 * s, 13 * s);
    g.fillStyle(0xff7a2f, 1).fillEllipse(x, y - 5 * s, 18 * s, 7 * s);
    g.fillStyle(0xffe08a, 1).fillEllipse(x - 1 * s, y - 6 * s, 9 * s, 3.5 * s);
    if (hue > 0.5) g.fillStyle(0x6e5a5e, 0.8).fillCircle(x + 3 * s, y - 18 * s, 4 * s).fillCircle(x - 2 * s, y - 26 * s, 3 * s); // a puff of smoke
  },

  // --- Haunted Ruins ---
  deadTree(g, x, y, s, hue) {
    shadowUnder(g, x, y, 56 * s, 0.25);
    const c = 0x2a2038;
    const branch = (x0, y0, a, len, w) => {
      const x1 = x0 + Math.cos(a) * len * s;
      const y1 = y0 + Math.sin(a) * len * s;
      g.lineStyle(w * s, c, 1).lineBetween(x0, y0, x1, y1);
      return [x1, y1];
    };
    g.fillStyle(c, 1).fillTriangle(x - 9 * s, y, x + 9 * s, y, x, y - 70 * s);
    g.fillStyle(0x4b3d66, 1).fillTriangle(x - 7 * s, y, x - 1 * s, y, x - 1 * s, y - 60 * s);
    const [ax, ay] = branch(x, y - 46 * s, -2.4 - hue * 0.3, 30, 5);
    branch(ax, ay, -2.0, 14, 3);
    branch(ax, ay, -2.9, 12, 2.5);
    const [bx, by] = branch(x, y - 58 * s, -0.7 + hue * 0.2, 28, 4.5);
    branch(bx, by, -1.3, 14, 2.5);
    branch(bx, by, -0.2, 12, 2);
    branch(x, y - 68 * s, -1.6, 16, 3);
  },
  lantern(g, x, y, s, hue) {
    const glow = hue > 0.5 ? 0xc084fc : 0xa78bfa;
    halo(g, x, y - 44 * s, 42 * s, glow, 0.28);
    shadowUnder(g, x, y, 26 * s, 0.25);
    g.lineStyle(4 * s, 0x2a2038, 1).lineBetween(x, y, x, y - 48 * s).lineBetween(x, y - 48 * s, x + 12 * s, y - 48 * s);
    g.lineStyle(1.5 * s, 0x2a2038, 1).lineBetween(x + 12 * s, y - 48 * s, x + 12 * s, y - 42 * s);
    g.fillStyle(0x2a2038, 1).fillRoundedRect(x + 4 * s, y - 42 * s, 16 * s, 20 * s, 3 * s);
    g.fillStyle(glow, 1).fillRoundedRect(x + 6 * s, y - 40 * s, 12 * s, 16 * s, 2 * s);
    g.fillStyle(0xf5e8ff, 1).fillEllipse(x + 12 * s, y - 32 * s, 5 * s, 8 * s);
  },
  ghostFlowers(g, x, y, s, hue) {
    halo(g, x, y - 10 * s, 18 * s, 0x9fe8ff, 0.16);
    for (const [dx, h] of [[-8, 14], [0, 20], [8, 12], [-3, 9]]) {
      g.lineStyle(1.5 * s, 0x6f5e93, 1).lineBetween(x + dx * s, y, x + dx * s, y - h * s);
      g.fillStyle(hue > 0.5 ? 0xc9f2ff : 0xe7d6ff, 1).fillEllipse(x + dx * s, y - h * s, 6 * s, 8 * s);
    }
  },
  smallGrave(g, x, y, s) {
    shadowUnder(g, x, y, 22 * s, 0.25);
    g.fillStyle(0x6b6478, 1).fillRect(x - 2.5 * s, y - 22 * s, 5 * s, 22 * s).fillRect(x - 8 * s, y - 17 * s, 16 * s, 4.5 * s);
    g.fillStyle(0x8d869a, 1).fillRect(x - 2.5 * s, y - 22 * s, 2 * s, 22 * s);
  },
  grave(g, x, y, s, hue) {
    shadowUnder(g, x, y, 38 * s, 0.28);
    g.fillStyle(0x3b2f52, 1).fillEllipse(x, y - 2 * s, 34 * s, 9 * s); // dirt mound
    const h = 30 * s;
    const w = 22 * s;
    const lean = (hue - 0.5) * 6 * s;
    g.fillStyle(0x5d566b, 1).fillRoundedRect(x - w / 2 + lean, y - h, w, h, { tl: w / 2, tr: w / 2, bl: 0, br: 0 });
    g.fillStyle(0x8d869a, 1).fillRoundedRect(x - w / 2 + lean + 2 * s, y - h + 2 * s, w * 0.45, h - 4 * s, { tl: w / 3, tr: 0, bl: 0, br: 0 });
    g.lineStyle(2 * s, 0x3b3547, 0.9).lineBetween(x - 5 * s + lean, y - h * 0.6, x + 5 * s + lean, y - h * 0.6).lineBetween(x - 5 * s + lean, y - h * 0.42, x + 3 * s + lean, y - h * 0.42);
    g.fillStyle(0x4f7a4a, 0.9).fillEllipse(x - w * 0.4 + lean, y - 3 * s, 10 * s, 5 * s); // moss
  },

  // --- Sky Temple ---
  goldPillar(g, x, y, s, hue) {
    shadowUnder(g, x + 6 * s, y, 44 * s, 0.12);
    const h = (80 + hue * 14) * s;
    g.fillStyle(0xe0b84a, 1).fillRect(x - 17 * s, y - 9 * s, 34 * s, 9 * s);
    g.fillStyle(0xffd86b, 1).fillRect(x - 17 * s, y - 11 * s, 34 * s, 4 * s);
    g.fillStyle(0xe8eef8, 1).fillRect(x - 11 * s, y - h, 22 * s, h - 9 * s);
    g.fillStyle(0xffffff, 1).fillRect(x - 11 * s, y - h, 8 * s, h - 9 * s);
    for (const dx of [-4, 3]) g.lineStyle(1.5 * s, 0xc9dbf5, 1).lineBetween(x + dx * s, y - h + 4 * s, x + dx * s, y - 12 * s);
    g.fillStyle(0xe0b84a, 1).fillRect(x - 16 * s, y - h - 8 * s, 32 * s, 9 * s);
    g.fillStyle(0xffd86b, 1).fillRect(x - 16 * s, y - h - 9 * s, 32 * s, 4 * s);
    sparkle(g, x + 9 * s, y - h - 14 * s, 5 * s, 0xffffff);
  },
  urn(g, x, y, s) {
    shadowUnder(g, x, y, 30 * s, 0.12);
    g.fillStyle(0xc99a2e, 1).fillEllipse(x, y - 14 * s, 24 * s, 24 * s);
    g.fillStyle(0xffd86b, 1).fillEllipse(x - 2 * s, y - 15 * s, 18 * s, 20 * s);
    g.fillStyle(0xc99a2e, 1).fillRect(x - 6 * s, y - 30 * s, 12 * s, 6 * s).fillRect(x - 8 * s, y - 3 * s, 16 * s, 4 * s);
    g.fillStyle(0xfff1b0, 1).fillEllipse(x - 5 * s, y - 19 * s, 5 * s, 9 * s);
  },
  starOrb(g, x, y, s, hue) {
    halo(g, x, y - 12 * s, 20 * s, 0xffe08a, 0.2);
    sparkle(g, x, y - 12 * s, (8 + hue * 4) * s, 0xffd86b);
    sparkle(g, x, y - 12 * s, (4 + hue * 2) * s, 0xffffff);
  },
  floatingIsland(g, x, y, s, hue) {
    g.fillStyle(0x3d6fa8, 0.12).fillEllipse(x + 10 * s, y + 40 * s, 60 * s, 14 * s);
    g.fillStyle(0x8e7a6a, 1).fillTriangle(x - 30 * s, y - 6 * s, x + 30 * s, y - 6 * s, x + 4 * s, y + 30 * s);
    g.fillStyle(0xb09a86, 1).fillTriangle(x - 30 * s, y - 6 * s, x, y - 6 * s, x + 2 * s, y + 24 * s);
    g.fillStyle(0x7ed36a, 1).fillEllipse(x, y - 8 * s, 64 * s, 16 * s);
    g.fillStyle(0x9be070, 1).fillEllipse(x - 4 * s, y - 10 * s, 52 * s, 10 * s);
    if (hue > 0.4) DECOR.goldPillar(g, x + 8 * s, y - 10 * s, s * 0.45, hue);
    else DECOR.tree(g, x, y - 10 * s, s * 0.5, hue);
  },
  cloudPuff: (g, x, y, s) => cloudPuff(g, null, x, y - 14 * s, s * 0.7),
};

function rockShape(g, x, y, s, [dark, mid, light], shadowAlpha = 0.16) {
  shadowUnder(g, x, y, 42 * s, shadowAlpha);
  const pts = [[-18, 0], [-16, -12], [-6, -20], [8, -19], [17, -10], [18, 0]].map(([dx, dy]) => V(x + dx * s, y + dy * s));
  g.fillStyle(dark, 1).fillPoints(pts, true);
  g.fillStyle(mid, 1).fillPoints(pts.map((p) => V(p.x - 1 * s, p.y - 2 * s)).slice(0, 5).concat([V(x + 6 * s, y - 4 * s), V(x - 12 * s, y - 2 * s)]), true);
  g.fillStyle(light, 0.9).fillEllipse(x - 4 * s, y - 15 * s, 12 * s, 5 * s);
}

function drawDecor(g, L, pal, style) {
  for (const d of L.decor) {
    let kind = style.decor[d.type];
    // Sky Temple: anything off the islands floats in the sky instead.
    if (style.floating && d.layer !== 'rim') kind = d.type === 'tree' ? 'floatingIsland' : 'cloudPuff';
    DECOR[kind](g, d.x, d.y, d.scale, d.hue);
  }
}

// ---------- animated layers ----------

function ensureTexture(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ add: false });
  draw(g, RES);
  g.generateTexture(key, Math.ceil(w * RES), Math.ceil(h * RES));
  g.destroy();
}

// Slow shimmering highlight lines that drift along the water (glints on ice, glow on lava).
function makeShimmer(scene, L, pal, style) {
  ensureTexture(scene, 'fx-shimmer', 30, 6, (g, r) => {
    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 30 * r, 4 * r, 2 * r);
  });
  const layer = scene.add.container(0, 0);
  const rng = makeRng(hashSeed(L.seed, 'shimmer'));
  const tint = { lava: 0xffe08a, sky: 0xffffff, ice: 0xffffff }[style.water] ?? pal.waterRim;
  const spots = [];
  for (const r of L.rivers) for (let i = 0; i < Math.round(L.W / 70); i++) {
    const p = r.pts[Math.floor(rng.next() * r.pts.length)];
    spots.push({ x: p.x + rng.range(-10, 10), y: rng.range(p.top + 8, p.bottom - 8) });
  }
  for (const o of L.ponds) for (let i = 0; i < 4; i++) spots.push({ x: o.x + rng.range(-o.rx, o.rx) * 0.6, y: o.y + rng.range(-o.ry, o.ry) * 0.5 });
  for (const s of spots) {
    const img = scene.add.image(s.x, s.y, 'fx-shimmer').setScale(rng.range(0.5, 1) / RES).setAlpha(0).setTint(tint);
    layer.add(img);
    scene.tweens.add({
      targets: img, alpha: { from: 0, to: 0.85 }, x: s.x + 16,
      duration: rng.range(1100, 1900), yoyo: true, repeat: -1, delay: rng.range(0, 2500), repeatDelay: rng.range(400, 2000), ease: 'Sine.InOut',
    });
  }
  return layer;
}

// Particle looks: texture + motion. All spawn inside the camera view (plus a margin),
// so the whole budget is on screen and the count never grows with the world size.
const PARTICLES = {
  pollen: {
    tex: ['fx-pollen', 10, (g, r) => { g.fillStyle(0xfff6c2, 0.35).fillCircle(5 * r, 5 * r, 5 * r); g.fillStyle(0xfffbe0, 1).fillCircle(5 * r, 5 * r, 2.4 * r); }],
    cfg: { lifespan: 8000, speedX: { min: -14, max: 14 }, speedY: { min: -10, max: 4 }, scale: { min: 0.6, max: 1.3 }, peak: 0.9 },
  },
  sparkles: {
    tex: ['fx-sparkle', 14, (g, r) => { g.fillStyle(0xffffff, 0.3).fillCircle(7 * r, 7 * r, 4 * r); sparkle(g, 7 * r, 7 * r, 7 * r, 0xffffff); }],
    cfg: { lifespan: 1800, speedX: 0, speedY: { min: -4, max: 0 }, scale: { min: 0.5, max: 1.1 }, peak: 1, rotate: { min: 0, max: 45 } },
  },
  fireflies: {
    tex: ['fx-firefly', 14, (g, r) => { g.fillStyle(0xd9ff6b, 0.18).fillCircle(7 * r, 7 * r, 7 * r); g.fillStyle(0xeaff9a, 0.5).fillCircle(7 * r, 7 * r, 3.5 * r); g.fillStyle(0xffffff, 1).fillCircle(7 * r, 7 * r, 1.6 * r); }],
    cfg: { lifespan: 5000, speedX: { min: -18, max: 18 }, speedY: { min: -14, max: 10 }, scale: { min: 0.7, max: 1.2 }, peak: 1, blink: true, blend: 'ADD' },
  },
  sand: {
    tex: ['fx-sand', 18, (g, r) => { g.fillStyle(0xfff1d0, 0.8).fillRoundedRect(0, 7 * r, 18 * r, 2.5 * r, 1.2 * r); }],
    cfg: { lifespan: 2600, speedX: { min: 160, max: 260 }, speedY: { min: -12, max: 12 }, scale: { min: 0.5, max: 1.2 }, peak: 0.55 },
  },
  snow: {
    tex: ['fx-snow', 10, (g, r) => { g.fillStyle(0xffffff, 0.4).fillCircle(5 * r, 5 * r, 5 * r); g.fillStyle(0xffffff, 1).fillCircle(5 * r, 5 * r, 2.8 * r); }],
    cfg: { lifespan: 7000, speedX: { min: -16, max: 16 }, speedY: { min: 34, max: 64 }, scale: { min: 0.5, max: 1.3 }, peak: 0.95 },
  },
  embers: {
    tex: ['fx-ember', 10, (g, r) => { g.fillStyle(0xff7a2f, 0.3).fillCircle(5 * r, 5 * r, 5 * r); g.fillStyle(0xffc15a, 1).fillCircle(5 * r, 5 * r, 2.2 * r); }],
    cfg: { lifespan: 3500, speedX: { min: -12, max: 12 }, speedY: { min: -90, max: -40 }, scale: { min: 0.5, max: 1.2 }, peak: 1, blend: 'ADD' },
  },
  wisps: {
    tex: ['fx-wisp', 40, (g, r) => { for (let i = 4; i >= 1; i--) g.fillStyle(0xcfe9ff, 0.12 * (5 - i)).fillCircle(20 * r, 20 * r, i * 5 * r); }],
    cfg: { lifespan: 7000, speedX: { min: -10, max: 10 }, speedY: { min: -16, max: -4 }, scale: { min: 0.6, max: 1.3 }, peak: 0.55, blend: 'ADD', fewer: 0.4 },
  },
};

function makeParticles(scene, L, kind, max) {
  const P = PARTICLES[kind] ?? PARTICLES.pollen;
  const [key, size, draw] = P.tex;
  ensureTexture(scene, key, size, size, draw);
  const c = P.cfg;
  const count = Math.max(8, Math.round(max * (c.fewer ?? 1)));
  const cam = scene.cameras.main;
  const zone = {
    getRandomPoint(point) {
      const v = cam.worldView;
      const m = 60;
      point.x = Phaser.Math.Clamp(v.x - m + Math.random() * (v.width + m * 2), 0, L.W);
      point.y = Phaser.Math.Clamp(v.y - m + Math.random() * (v.height + m * 2), 0, L.H);
      if (kind === 'sand') point.x = Math.max(0, v.x - m + Math.random() * v.width * 0.5); // blow in from the left
      return point;
    },
  };
  return scene.add.particles(0, 0, key, {
    emitZone: { type: 'random', source: zone },
    lifespan: c.lifespan,
    speedX: c.speedX,
    speedY: c.speedY,
    ...(c.rotate ? { rotate: c.rotate } : {}),
    scale: { min: c.scale.min / RES, max: c.scale.max / RES },
    alpha: {
      onEmit: () => 0,
      onUpdate: (_p, _k, t) => (c.blink ? Math.abs(Math.sin(t * Math.PI * 3)) : Math.sin(t * Math.PI)) * c.peak,
    },
    blendMode: c.blend ?? 'NORMAL',
    frequency: c.lifespan / count,
    maxAliveParticles: count,
  });
}
