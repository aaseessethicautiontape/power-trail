// Battle and map effects (PRD 6.5): dust puffs, type attacks, white flash, sparkle pops,
// floating numbers, camera shake. All textures are drawn in code once, at RES.
// Effects run in world space in LevelScene. With reduceMotion on, particles and shake are skipped.
import Phaser from 'phaser';
import { RES } from '../layout/screen.js';
import { makeBadge } from './ui.js';

const V = (x, y) => new Phaser.Math.Vector2(x, y);

function tex(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ add: false });
  draw(g, RES);
  g.generateTexture(key, Math.ceil(w * RES), Math.ceil(h * RES));
  g.destroy();
  return key;
}

const TEX = {
  dust: (s) => tex(s, 'fx-dust', 40, 40, (g, r) => {
    for (let i = 4; i >= 1; i--) g.fillStyle(0xfff8e7, 0.22 * (5 - i)).fillCircle(20 * r, 20 * r, i * 5 * r);
  }),
  spark: (s) => tex(s, 'fx-spark', 24, 24, (g, r) => {
    const c = 12 * r;
    g.fillStyle(0xfff7c2, 0.35).fillCircle(c, c, 7 * r);
    g.fillStyle(0xffffff, 1).fillPoints([V(c, 0), V(c + 3 * r, c - 3 * r), V(24 * r, c), V(c + 3 * r, c + 3 * r), V(c, 24 * r), V(c - 3 * r, c + 3 * r), V(0, c), V(c - 3 * r, c - 3 * r)], true);
  }),
  bolt: (s) => tex(s, 'fx-bolt', 46, 120, (g, r) => {
    const pts = [[26, 0], [6, 58], [22, 58], [10, 120], [42, 46], [26, 46], [38, 0]].map(([x, y]) => V(x * r, y * r));
    g.fillStyle(0xfacc15, 1).fillPoints(pts, true);
    g.lineStyle(3 * r, 0xffffff, 1).strokePoints(pts, true);
  }),
  flame: (s) => tex(s, 'fx-flame', 30, 40, (g, r) => {
    const flame = (sc, c) => {
      g.fillStyle(c, 1).fillCircle(15 * r, 26 * r, 11 * r * sc);
      g.fillTriangle((15 - 11 * sc) * r, 24 * r, (15 + 11 * sc) * r, 24 * r, 15 * r, (26 - 26 * sc) * r);
    };
    flame(1, 0xef4444);
    flame(0.72, 0xfb923c);
    flame(0.42, 0xfde047);
  }),
  leaf: (s) => tex(s, 'fx-leaf', 28, 16, (g, r) => {
    g.fillStyle(0x3f9a36, 1).fillEllipse(14 * r, 8 * r, 26 * r, 13 * r);
    g.fillStyle(0x7fd463, 1).fillEllipse(12 * r, 6 * r, 18 * r, 7 * r);
    g.lineStyle(1.5 * r, 0x2f6b33, 1).lineBetween(2 * r, 8 * r, 26 * r, 8 * r);
  }),
  drop: (s) => tex(s, 'fx-drop', 20, 28, (g, r) => {
    g.fillStyle(0x3b82f6, 1).fillCircle(10 * r, 18 * r, 9 * r).fillTriangle(1 * r, 16 * r, 19 * r, 16 * r, 10 * r, 0);
    g.fillStyle(0x93c5fd, 1).fillCircle(7 * r, 16 * r, 3.5 * r);
  }),
  ring: (s) => tex(s, 'fx-ring', 80, 80, (g, r) => {
    g.lineStyle(6 * r, 0xffffff, 1).strokeCircle(40 * r, 40 * r, 34 * r);
  }),
};

const img = (scene, key, x, y, depth = 60) => scene.add.image(x, y, key).setScale(1 / RES).setDepth(depth);

// A few soft dust puffs where the player lands.
export function dustPuff(scene, x, y, reduce, count = 3) {
  if (reduce) return;
  const key = TEX.dust(scene);
  for (let i = 0; i < count; i++) {
    const p = img(scene, key, x + (count > 1 ? (i - 1) * 12 : 0), y - 2, 9).setAlpha(count > 1 ? 0.9 : 0.6).setScale(0.4 / RES);
    scene.tweens.add({
      targets: p, x: p.x + (i - 1) * 16, y: y - 8 - Math.random() * 6, scale: 0.9 / RES, alpha: 0,
      duration: 380, ease: 'Quad.Out', onComplete: () => p.destroy(),
    });
  }
}

// Sparkle burst: the enemy "pops".
export function popSparkles(scene, x, y, reduce, { count = 12, tint = 0xffffff, spread = 70 } = {}) {
  const key = TEX.spark(scene);
  const n = reduce ? 0 : count;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = spread * (0.6 + Math.random() * 0.6);
    const p = img(scene, key, x, y).setTint(tint).setScale((0.6 + Math.random() * 0.6) / RES);
    scene.tweens.add({
      targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8, alpha: 0, angle: 90,
      scale: 0.2 / RES, duration: 450 + Math.random() * 200, ease: 'Quad.Out', onComplete: () => p.destroy(),
    });
  }
}

// The starter's type attack, played at the target (x, y). Resolves after `duration` ms.
export function typeAttack(scene, type, from, to, reduce) {
  const { x, y } = to;
  if (reduce) return 160;
  if (type === 'electric') {
    const key = TEX.bolt(scene);
    for (const [dx, delay] of [[-18, 0], [16, 70], [0, 140]]) {
      const b = img(scene, key, x + dx, y - 30).setOrigin(0.5, 1).setAlpha(0).setScale(0.9 / RES, 0.2 / RES);
      scene.tweens.add({
        targets: b, alpha: 1, scaleY: 1.1 / RES, y: y + 40, duration: 90, delay, ease: 'Quad.Out',
        onComplete: () => scene.tweens.add({ targets: b, alpha: 0, duration: 120, onComplete: () => b.destroy() }),
      });
    }
    popSparkles(scene, x, y, false, { count: 8, tint: 0xfde047, spread: 50 });
    return 300;
  }
  if (type === 'fire') {
    const key = TEX.flame(scene);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const f = img(scene, key, x, y + 10).setScale(0.5 / RES).setAlpha(0.95);
      scene.tweens.add({
        targets: f, x: x + Math.cos(a) * 60, y: y + 10 + Math.sin(a) * 40 - 20, scale: 1.1 / RES, alpha: 0,
        duration: 380, delay: i * 8, ease: 'Quad.Out', onComplete: () => f.destroy(),
      });
    }
    return 300;
  }
  if (type === 'grass') {
    const key = TEX.leaf(scene);
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2;
      const l = img(scene, key, x, y);
      const o = { t: 0 };
      scene.tweens.add({
        targets: o, t: 1, duration: 420, delay: i * 12, ease: 'Sine.InOut',
        onUpdate: () => {
          const a = a0 + o.t * Math.PI * 2.2;
          const r = 70 * (1 - o.t) + 8;
          l.setPosition(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6).setAngle(Phaser.Math.RadToDeg(a) + 90).setAlpha(1 - o.t * 0.7);
        },
        onComplete: () => l.destroy(),
      });
    }
    return 340;
  }
  // water
  const key = TEX.drop(scene);
  const ring = img(scene, TEX.ring(scene), x, y + 20).setTint(0x93c5fd).setScale(0.3 / RES, 0.12 / RES);
  scene.tweens.add({ targets: ring, scaleX: 1.6 / RES, scaleY: 0.6 / RES, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI * (0.1 + 0.8 * (i / 11));
    const d = img(scene, key, x, y + 10).setScale(0.7 / RES);
    const vx = Math.cos(a) * 70;
    const vy = Math.sin(a) * 90;
    const o = { t: 0 };
    scene.tweens.add({
      targets: o, t: 1, duration: 420,
      onUpdate: () => d.setPosition(x + vx * o.t, y + 10 + vy * o.t + 120 * o.t * o.t).setAlpha(1 - o.t * 0.6),
      onComplete: () => d.destroy(),
    });
  }
  return 320;
}

// Flash a sprite white twice.
export function flashWhite(scene, art) {
  if (!art.setTintFill) return;
  art.setTintFill(0xffffff);
  scene.time.delayedCall(70, () => art.clearTint());
  scene.time.delayedCall(140, () => art.setTintFill(0xffffff));
  scene.time.delayedCall(210, () => art.clearTint());
}

// "+4,452" rising 60px (on screen) and fading over 700ms (PRD 7.4). `scale` keeps it readable when zoomed out.
export function floatNumber(scene, x, y, value, colour, prefix, scale = 1) {
  const badge = makeBadge(scene, value, colour, { fontSize: 34, prefix, x, y }).setDepth(70).setScale(scale);
  const zoom = scene.cameras.main.zoom;
  scene.tweens.add({ targets: badge, y: y - 60 / zoom, alpha: 0, duration: 700, ease: 'Quad.Out', onComplete: () => badge.destroy() });
  return badge;
}

export function shake(scene, reduce, intensity = 0.006) {
  if (!reduce) scene.cameras.main.shake(160, intensity);
}

// Run in straight lines through `points` (usually just [from, to]; via the stairs when changing
// zone). Speed scales with distance and the whole move, little hop at the end included, is capped
// at maxMs. Small bounces and dust puffs while running. Calls onTurn(dx) when the direction
// changes and onStep(x, y) every frame. Returns total ms.
export function runTo(scene, target, points, { onTurn, onStep, reduce, maxMs = 700 } = {}) {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.5);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  if (total < 1) return 0;
  const hopMs = 150;
  const runMs = Math.round(Math.min(maxMs - hopMs, 120 + total * 0.38));
  let seg = 1;
  let lastDust = 0;
  const at = (s) => {
    while (seg < pts.length - 1 && cum[seg] < s) seg++;
    const a = pts[seg - 1];
    const b = pts[seg];
    const t = (s - cum[seg - 1]) / Math.max(1e-6, cum[seg] - cum[seg - 1]);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x, seg };
  };
  let facing = 0;
  const o = { t: 0 };
  scene.tweens.add({
    targets: o, t: 1, duration: runMs, ease: 'Sine.InOut',
    onUpdate: (tw) => {
      const p = at(o.t * total);
      if (facing !== p.seg && Math.abs(p.dx) > 3) { facing = p.seg; onTurn?.(p.dx); }
      const elapsed = tw.elapsed;
      const bounce = Math.abs(Math.sin(elapsed / 55)) * 4; // quick little running bounces
      target.setPosition(p.x, p.y - bounce);
      onStep?.(p.x, p.y);
      if (elapsed - lastDust > 90) {
        lastDust = elapsed;
        dustPuff(scene, p.x, p.y + 2, reduce, 1);
      }
    },
    onComplete: () => {
      const end = pts[pts.length - 1];
      const h = { t: 0 };
      scene.tweens.add({
        targets: h, t: 1, duration: hopMs, ease: 'Linear',
        onUpdate: () => target.setPosition(end.x, end.y - Math.sin(h.t * Math.PI) * 14),
        onComplete: () => {
          target.setPosition(end.x, end.y);
          dustPuff(scene, end.x, end.y + 2, reduce);
        },
      });
    },
  });
  return runMs + hopMs;
}

// Confetti burst: drawn rectangles in party colours, spray up then flutter down.
// Works in world space (LevelScene) and screen space (UIScene). Returns the pieces' max life in ms.
const CONFETTI = [0xef4444, 0xfacc15, 0x22c55e, 0x3b82f6, 0xa855f7, 0xf97316, 0xec4899];
export function confetti(scene, x, y, reduce, { count = 60, spread = 260, rise = 260, fall = 420, depth = 70, scale = 1 } = {}) {
  if (reduce) return 0;
  for (let i = 0; i < count; i++) {
    const w = (6 + Math.random() * 6) * scale;
    const h = (10 + Math.random() * 8) * scale;
    const p = scene.add.rectangle(x, y, w, h, CONFETTI[i % CONFETTI.length]).setDepth(depth).setAngle(Math.random() * 360);
    const vx = (Math.random() - 0.5) * 2 * spread;
    const vy = -rise * (0.5 + Math.random() * 0.8);
    const life = 1100 + Math.random() * 700;
    const o = { t: 0 };
    const spin = (Math.random() - 0.5) * 900;
    const wob = Math.random() * Math.PI * 2;
    scene.tweens.add({
      targets: o, t: 1, duration: life, delay: Math.random() * 120,
      onUpdate: () => {
        const t = o.t;
        p.setPosition(x + vx * t + Math.sin(wob + t * 12) * 10 * scale, y + vy * t * 1.6 + fall * 1.6 * t * t);
        p.setAngle(p.angle + spin / 60).setScale(Math.abs(Math.cos(wob + t * 9)) * 0.7 + 0.3, 1);
        p.setAlpha(t > 0.75 ? (1 - t) / 0.25 : 1);
      },
      onComplete: () => p.destroy(),
    });
  }
  return 1900;
}

// Gold glow running up a flight of stairs (a gate just fell). x, top..bottom in world px.
export function lightStairs(scene, x, top, bottom, width, reduce) {
  const g = scene.add.graphics().setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
  const h = bottom - top;
  for (let i = 3; i >= 1; i--) g.fillStyle(0xfde68a, 0.12 * i).fillRoundedRect(x - width / 2 - i * 8, top - i * 6, width + i * 16, h + i * 12, 14);
  g.setAlpha(0);
  scene.tweens.chain({
    targets: g,
    tweens: [
      { alpha: 1, duration: 260, ease: 'Quad.Out' },
      { alpha: 0.45, duration: 500, yoyo: true, repeat: 1, ease: 'Sine.InOut' },
      { alpha: 0.35, duration: 300 },
    ],
  });
  if (!reduce) {
    const key = TEX.spark(scene);
    for (let i = 0; i < 10; i++) {
      const p = img(scene, key, x + (Math.random() - 0.5) * width, bottom - Math.random() * 20, 45).setTint(0xfde047).setScale(0.6 / RES);
      scene.tweens.add({
        targets: p, y: top - 30, alpha: 0, duration: 700 + Math.random() * 400, delay: i * 60, ease: 'Quad.Out', onComplete: () => p.destroy(),
      });
    }
  }
  return g;
}
