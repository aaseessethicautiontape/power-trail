// Stops on the map (PRD 6.4, 7.3, 7.4): Pokémon with shadow, idle bob, badge, Alpha crown
// and aura; mystery boxes; the Lucky Egg on its pedestal; the player.
// Everything sits in world space inside LevelScene. Badges live in a `badgeGroup` that
// LevelScene counter-scales so they never drop under 18px on screen.
import Phaser from 'phaser';
import { pokemonKey, itemKey } from '../assets.js';
import { makeBadge, makeText, px, FONT_TITLE } from './ui.js';
import { RES } from '../layout/screen.js';

// Display heights in world px (PRD 7.3).
export const ART_H = { wild: 110, gate: 150, boss: 210, player: 130 };
const BADGE_FONT = { wild: 30, gate: 34, boss: 42, player: 32, item: 28, egg: 30 };
export const MIN_BADGE_PX = 18;

// ---------- shared textures (drawn once at RES) ----------

function tex(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ add: false });
  draw(g, RES);
  g.generateTexture(key, Math.ceil(w * RES), Math.ceil(h * RES));
  g.destroy();
  return key;
}

const V = (x, y) => new Phaser.Math.Vector2(x, y);

function crownTexture(scene) {
  return tex(scene, 'stop-crown', 44, 30, (g, r) => {
    const pts = (dy) => [V(4, 26 + dy), V(2, 8 + dy), V(12, 16 + dy), V(22, 3 + dy), V(32, 16 + dy), V(42, 8 + dy), V(40, 26 + dy)].map((p) => V(p.x * r, p.y * r));
    g.fillStyle(0x92400e, 1).fillPoints(pts(2), true);
    g.fillStyle(0xfacc15, 1).fillPoints(pts(0), true);
    g.fillStyle(0xfde68a, 1).fillRect(5 * r, 18 * r, 34 * r, 4 * r);
    for (const [x, y, c] of [[2, 8, 0xfde68a], [22, 3, 0xfde68a], [42, 8, 0xfde68a], [22, 21, 0xef4444], [12, 21, 0x3b82f6], [32, 21, 0x3b82f6]]) {
      g.fillStyle(c, 1).fillCircle(x * r, y * r, 2.6 * r);
    }
  });
}

// Original mystery box: rounded wooden crate, gold bands and corners.
function boxTexture(scene) {
  return tex(scene, 'stop-box', 68, 64, (g, r) => {
    const R = (x, y, w, h, rad, c, a = 1) => g.fillStyle(c, a).fillRoundedRect(x * r, y * r, w * r, h * r, rad * r);
    R(2, 16, 64, 46, 9, 0x6b3f1d);            // body edge
    R(4, 18, 60, 40, 7, 0xa0662f);            // body
    for (const y of [28, 40]) R(6, y, 56, 2, 1, 0x7a4a22, 0.8); // planks
    R(0, 6, 68, 16, 7, 0x6b3f1d);             // lid edge
    R(2, 6, 64, 12, 6, 0xc98a4a);             // lid
    R(6, 8, 56, 3, 2, 0xe8b277, 0.9);         // lid shine
    R(29, 4, 10, 58, 3, 0xb7791f);            // gold band
    R(30, 4, 6, 58, 3, 0xfacc15);
    R(4, 34, 60, 6, 3, 0xb7791f, 0.9);
    R(4, 34, 60, 4, 2, 0xfacc15, 0.9);
    for (const [x, y] of [[4, 20], [58, 20], [4, 52], [58, 52]]) R(x, y, 6, 6, 2, 0xfde68a);
    R(28, 30, 12, 12, 3, 0x92400e);           // lock plate
    g.fillStyle(0xfde68a, 1).fillCircle(34 * r, 36 * r, 2.5 * r);
  });
}

function bubbleTexture(scene) {
  return tex(scene, 'stop-bubble', 44, 46, (g, r) => {
    g.fillStyle(0x1d4ed8, 1).fillCircle(22 * r, 20 * r, 19 * r);
    g.fillTriangle(12 * r, 32 * r, 22 * r, 36 * r, 10 * r, 44 * r);
    g.fillStyle(0xffffff, 1).fillCircle(22 * r, 19 * r, 16 * r);
    g.fillTriangle(14 * r, 30 * r, 21 * r, 33 * r, 12 * r, 40 * r);
  });
}

function pedestalTexture(scene) {
  return tex(scene, 'stop-pedestal', 84, 44, (g, r) => {
    for (let i = 4; i >= 1; i--) g.fillStyle(0xe9d5ff, 0.12 * i).fillEllipse(42 * r, 22 * r, (44 + i * 9) * r, (16 + i * 4) * r);
    g.fillStyle(0x6b5b95, 1).fillEllipse(42 * r, 30 * r, 58 * r, 20 * r);
    g.fillStyle(0x8b7bb8, 1).fillRect(13 * r, 20 * r, 58 * r, 10 * r);
    g.fillStyle(0xc4b5fd, 1).fillEllipse(42 * r, 20 * r, 58 * r, 20 * r);
    g.fillStyle(0xede9fe, 1).fillEllipse(42 * r, 19 * r, 44 * r, 13 * r);
    g.lineStyle(2.5 * r, 0xfacc15, 1).strokeEllipse(42 * r, 20 * r, 50 * r, 16 * r);
  });
}

export function lockTexture(scene) {
  return tex(scene, 'stop-lock', 34, 40, (g, r) => {
    g.lineStyle(5 * r, 0x475569, 1).beginPath().arc(17 * r, 16 * r, 9 * r, Math.PI, 0).strokePath();
    g.lineBetween(8 * r, 16 * r, 8 * r, 20 * r).lineBetween(26 * r, 16 * r, 26 * r, 20 * r);
    g.fillStyle(0x334155, 1).fillRoundedRect(3 * r, 18 * r, 28 * r, 21 * r, 5 * r);
    g.fillStyle(0xfacc15, 1).fillRoundedRect(4 * r, 18 * r, 26 * r, 18 * r, 4 * r);
    g.fillStyle(0x92400e, 1).fillCircle(17 * r, 25 * r, 3 * r).fillRect(15.5 * r, 25 * r, 3 * r, 7 * r);
  });
}

// ---------- pieces ----------

function shadow(scene, w) {
  return scene.add.ellipse(0, 0, w, w * 0.3, 0x000000, 0.22);
}

// Idle bob: 2-3px with a random phase so stops don't bob in sync.
function bob(scene, targets, amp = 2.5) {
  for (const t of [].concat(targets)) {
    scene.tweens.add({
      targets: t, y: t.y - amp, duration: Phaser.Math.Between(900, 1300), yoyo: true, repeat: -1,
      ease: 'Sine.InOut', delay: Phaser.Math.Between(0, 1200),
    });
  }
}

function badgeGroup(scene, y, badge, extras = []) {
  const g = scene.add.container(0, y, [...extras, badge]);
  g.fontPx = parseFloat(badge.style.fontSize);
  return g;
}

function container(scene, pos, parts, data) {
  const c = scene.add.container(pos.x, pos.y, parts);
  c.setDepth(10 + pos.y / 10000);
  Object.assign(c, data);
  return c;
}

// A Pokémon stop: wild, gate or boss. `faceLeft` = art faces left (HOME renders mostly do).
export function makePokemonStop(scene, stop, pos, { faceLeft = true, badgeColour = 'enemy' } = {}) {
  const kind = stop.kind;
  const h = ART_H[kind];
  const key = pokemonKey(stop.pokemon.id);
  const parts = [];
  const isAlpha = stop.alpha > 1;

  let aura = null;
  if (isAlpha) {
    aura = scene.add.ellipse(0, 0, h * 0.95, h * 0.3).setStrokeStyle(4, 0xef4444, 0.55).setFillStyle(0xef4444, 0.1);
    scene.tweens.add({ targets: aura, scaleX: 1.08, scaleY: 1.08, alpha: 0.6, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    parts.push(aura);
  }
  parts.push(shadow(scene, h * 0.7));

  let art;
  if (scene.textures.exists(key)) {
    art = scene.add.image(0, h * 0.06, key).setOrigin(0.5, 1);
    art.setScale(h / art.height);
    // HOME renders face left; flip to face the player.
    art.setFlipX(!faceLeft);
  } else {
    art = makeText(scene, 0, -h / 2, '?', { fontFamily: FONT_TITLE, fontSize: px(h * 0.5), color: '#ffffff' }).setOrigin(0.5);
  }
  parts.push(art);

  const badge = makeBadge(scene, stop.power, badgeColour, { fontSize: BADGE_FONT[kind] });
  const extras = [];
  if (isAlpha) {
    const crown = scene.add.image(0, -badge.height / 2 + 6, crownTexture(scene)).setOrigin(0.5, 1).setScale(1 / RES);
    extras.push(crown);
  }
  const bg = badgeGroup(scene, -h - 4, badge, extras);
  parts.push(bg);
  bob(scene, [art, bg]);

  return container(scene, pos, parts, {
    stop, art, badge, badgeGroup: bg, aura, artH: h,
    hit: { dy: -h * 0.45, r: h * 0.45 },
  });
}

export function makeItemStop(scene, stop, pos) {
  const box = scene.add.image(0, 2, boxTexture(scene)).setOrigin(0.5, 1).setScale(1 / RES);
  // "?" bubble pops out of the box's right side; the value badge sits above the box.
  const bubble = scene.add.image(44, -34, bubbleTexture(scene)).setOrigin(0.5, 1).setScale(1 / RES);
  const q = makeText(scene, 44, -61, '?', { fontFamily: FONT_TITLE, fontSize: '24px', color: '#1d4ed8' }).setOrigin(0.5);
  const badge = makeBadge(scene, stop.value, 'item', { fontSize: BADGE_FONT.item, prefix: '+' });
  const bg = badgeGroup(scene, -84, badge);
  bob(scene, [bubble, q], 4);
  return container(scene, pos, [shadow(scene, 74), box, bubble, q, bg], {
    stop, art: box, badge, badgeGroup: bg, hit: { dy: -34, r: 42 },
  });
}

export function makeEggStop(scene, stop, pos) {
  const ped = scene.add.image(0, 10, pedestalTexture(scene)).setOrigin(0.5, 1).setScale(1 / RES);
  scene.tweens.add({ targets: ped, alpha: 0.82, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  const key = itemKey(stop.sprite);
  const egg = scene.textures.exists(key)
    ? scene.add.image(0, -16, key).setOrigin(0.5, 1).setScale(2.6)
    : makeText(scene, 0, -36, '🥚', { fontSize: '40px' }).setOrigin(0.5);
  const badge = makeBadge(scene, stop.mult, 'egg', { fontSize: BADGE_FONT.egg, prefix: '×' });
  const bg = badgeGroup(scene, -98, badge);
  bob(scene, [egg, bg], 3);
  return container(scene, pos, [ped, egg, bg], {
    stop, art: egg, badge, badgeGroup: bg, hit: { dy: -40, r: 44 },
  });
}

export function makePlayer(scene, form, pos, power, faceLeft = false) {
  const h = ART_H.player;
  const key = pokemonKey(form.id);
  const ring = scene.add.ellipse(0, 0, h * 0.85, h * 0.26).setStrokeStyle(4, 0x2563eb, 0.6).setFillStyle(0x60a5fa, 0.18);
  const art = scene.textures.exists(key)
    ? scene.add.image(0, h * 0.06, key).setOrigin(0.5, 1).setScale(h / scene.textures.get(key).getSourceImage().height).setFlipX(!faceLeft)
    : makeText(scene, 0, -h / 2, '?', { fontFamily: FONT_TITLE, fontSize: px(h * 0.5), color: '#ffffff' }).setOrigin(0.5);
  const badge = makeBadge(scene, power, 'player', { fontSize: BADGE_FONT.player });
  const bg = badgeGroup(scene, -h - 4, badge);
  bob(scene, [art, bg]);
  return container(scene, pos, [ring, shadow(scene, h * 0.7), art, bg], {
    form, art, badge, badgeGroup: bg, artH: h, hit: { dy: -h * 0.45, r: h * 0.45 },
  });
}
