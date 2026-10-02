// Reusable UI pieces (PRD 7.4 and 7.5): buttons, panels, badges, hearts, stars.
// Everything is drawn in code. Every number shown goes through formatPower.
import Phaser from 'phaser';
import { formatPower } from '../../shared/rules.js';

export const FONT_TITLE = '"Lilita One", "Arial Black", sans-serif';
export const FONT_UI = 'Nunito, "Trebuchet MS", sans-serif';
export const INK = '#3A2A1F';

export const COLOURS = {
  main: 0xfb923c, // orange
  secondary: 0x3b82f6, // blue
  danger: 0xef4444, // red
  cream: 0xfff8ec,
  creamEdge: 0xe6cfa6,
};

export const BADGE = {
  player: 0x2563eb,
  enemy: 0xdc2626,
  item: 0x16a34a,
  egg: 0xa855f7,
};

export const TYPE_COLOURS = {
  electric: 0xf7d02c,
  fire: 0xee8130,
  grass: 0x7ac74c,
  water: 0x6390f0,
};

// Text drawn at 2x so it stays sharp when Scale.FIT blows the canvas up.
const TEXT_RES = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));

export function makeText(scene, x, y, str, style = {}) {
  return scene.add.text(x, y, str, {
    fontFamily: FONT_UI,
    fontSize: '20px',
    color: INK,
    resolution: TEXT_RES,
    ...style,
  });
}

// Accepts 'main' | 'secondary' | 'danger', a number (0xRRGGBB) or '#RRGGBB'.
export function toColour(c) {
  if (typeof c === 'number') return c;
  if (c in COLOURS) return COLOURS[c];
  if (c in BADGE) return BADGE[c];
  return Phaser.Display.Color.HexStringToColor(c).color;
}

const toCss = (n) => `#${n.toString(16).padStart(6, '0')}`;

export function shade(colour, amount) {
  const c = Phaser.Display.Color.ValueToColor(colour);
  return (amount < 0 ? c.darken(-amount) : c.lighten(amount)).color;
}

// Chunky button with a darker bottom edge. Pressing moves the face down 4px.
export function makeButton(scene, x, y, label, colour, onClick, opts = {}) {
  const fill = toColour(colour);
  const fontSize = opts.fontSize ?? 30;
  const h = opts.height ?? 72;
  const depth = 8;
  const r = Math.min(22, h / 2);

  const text = makeText(scene, 0, opts.subtitle ? -12 : -2, label, {
    fontFamily: FONT_TITLE, fontSize: `${fontSize}px`, color: '#ffffff',
    stroke: toCss(shade(fill, -35)), strokeThickness: 6,
  }).setOrigin(0.5);
  const w = opts.width ?? Math.max(200, Math.ceil(text.width) + 64);

  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.18).fillRoundedRect(-w / 2 + 2, -h / 2 + depth + 4, w, h, r);
  const edge = scene.add.graphics();
  edge.fillStyle(shade(fill, -28), 1).fillRoundedRect(-w / 2, -h / 2 + depth, w, h, r);
  const face = scene.add.graphics();
  const drawFace = (hover) => {
    const top = hover ? shade(fill, 6) : fill;
    face.clear();
    face.fillStyle(top, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
    // Glossy highlight on the upper half.
    face.fillStyle(0xffffff, 0.22).fillRoundedRect(-w / 2 + 8, -h / 2 + 6, w - 16, h * 0.38, r * 0.7);
  };
  drawFace(false);

  const faceGroup = scene.add.container(0, 0, [face, text]);
  let subtitle = null;
  if (opts.subtitle) {
    subtitle = makeText(scene, 0, 18, opts.subtitle, {
      fontStyle: '900', fontSize: '17px', color: '#ffffff',
    }).setOrigin(0.5);
    faceGroup.add(subtitle);
  }
  const btn = scene.add.container(x, y, [shadow, edge, faceGroup]);
  btn.setSize(w, h + depth);
  btn.setInteractive({ useHandCursor: true });

  let pressed = false;
  const press = (down) => {
    pressed = down;
    faceGroup.y = down ? 4 : 0;
  };
  btn.on('pointerover', () => drawFace(true));
  btn.on('pointerout', () => { drawFace(false); press(false); });
  btn.on('pointerdown', () => press(true));
  btn.on('pointerup', () => {
    if (!pressed) return;
    press(false);
    onClick?.();
  });

  btn.label = text;
  btn.face = faceGroup; // add extra decorations here so they move with the press
  btn.subtitle = subtitle;
  return btn;
}

// Cream rounded panel (radius 24) with a 4px darker border and a soft shadow.
export function makePanel(scene, x, y, w, h, opts = {}) {
  const fill = opts.fill ?? COLOURS.cream;
  const border = opts.border ?? COLOURS.creamEdge;
  const r = opts.radius ?? 24;
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.16).fillRoundedRect(-w / 2 + 4, -h / 2 + 10, w, h, r);
  g.fillStyle(border, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
  g.fillStyle(fill, 1).fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, r - 4);
  const panel = scene.add.container(x, y, [g]);
  panel.setSize(w, h);
  return panel;
}

// Power badge: Lilita One, white fill, 8px coloured outline, slight drop shadow.
// Numbers go through formatPower. opts.prefix adds '+' or '×' in front.
export function makeBadge(scene, value, colour = 'player', opts = {}) {
  const stroke = toCss(toColour(colour));
  const fmt = (v) => (typeof v === 'number' ? `${opts.prefix ?? ''}${formatPower(v)}` : String(v));
  const badge = makeText(scene, opts.x ?? 0, opts.y ?? 0, fmt(value), {
    fontFamily: FONT_TITLE, fontSize: `${opts.fontSize ?? 36}px`, color: '#ffffff',
    stroke, strokeThickness: 8,
    padding: { x: 4, y: 4 },
  }).setOrigin(0.5);
  badge.setShadow(0, 4, 'rgba(0,0,0,0.35)', 2, true, true);
  badge.setValue = (v) => badge.setText(fmt(v));
  badge.setColour = (c) => badge.setStroke(toCss(toColour(c)), 8);
  return badge;
}

function drawHeart(g, x, y, s, full) {
  const fill = full ? 0xef4444 : 0xd6dbe3;
  const edge = full ? 0x9b1c1c : 0x9aa5b4;
  const shape = (scale, colour) => {
    const k = s * scale;
    g.fillStyle(colour, 1);
    g.fillCircle(x - k * 0.24, y - k * 0.1, k * 0.28);
    g.fillCircle(x + k * 0.24, y - k * 0.1, k * 0.28);
    g.fillTriangle(x - k * 0.5, y - k * 0.02, x + k * 0.5, y - k * 0.02, x, y + k * 0.48);
  };
  shape(1.16, edge);
  shape(1, fill);
  if (full) {
    g.fillStyle(0xffffff, 0.85).fillEllipse(x - s * 0.24, y - s * 0.18, s * 0.2, s * 0.13);
  }
}

// Row of drawn hearts. Returns a container with setCount(n).
export function makeHearts(scene, x, y, count, max = 3, size = 36) {
  const g = scene.add.graphics();
  const c = scene.add.container(x, y, [g]);
  const gap = size * 1.25;
  c.setCount = (n) => {
    g.clear();
    for (let i = 0; i < max; i++) drawHeart(g, (i - (max - 1) / 2) * gap, 0, size, i < n);
    c.count = n;
    return c;
  };
  c.setSize(gap * max, size * 1.2);
  return c.setCount(count);
}

function starPoints(x, y, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(new Phaser.Math.Vector2(x + Math.cos(a) * r, y + Math.sin(a) * r));
  }
  return pts;
}

export function drawStar(g, x, y, size, full) {
  const R = size / 2;
  g.fillStyle(full ? 0xa16207 : 0x9ca3af, 1).fillPoints(starPoints(x, y + 2, R + 4, (R + 4) * 0.5), true);
  g.fillStyle(full ? 0xfacc15 : 0xe5e7eb, 1).fillPoints(starPoints(x, y, R, R * 0.5), true);
  if (full) g.fillStyle(0xffffff, 0.45).fillPoints(starPoints(x - R * 0.12, y - R * 0.18, R * 0.35, R * 0.17), true);
}

// Row of gold stars (empty ones grey). Returns a container with setCount(n).
export function makeStars(scene, x, y, count, max = 3, size = 40) {
  const g = scene.add.graphics();
  const c = scene.add.container(x, y, [g]);
  const gap = size * 1.2;
  c.setCount = (n) => {
    g.clear();
    for (let i = 0; i < max; i++) drawStar(g, (i - (max - 1) / 2) * gap, 0, size, i < n);
    c.count = n;
    return c;
  };
  c.setSize(gap * max, size);
  return c.setCount(count);
}

// Round settings cog button.
export function makeCog(scene, x, y, onClick, size = 64) {
  const g = scene.add.graphics();
  const R = size / 2;
  g.fillStyle(0x000000, 0.18).fillCircle(2, 6, R);
  g.fillStyle(0x1e3a8a, 1).fillCircle(0, 4, R);
  g.fillStyle(COLOURS.secondary, 1).fillCircle(0, 0, R);
  g.fillStyle(0xffffff, 0.2).fillEllipse(0, -R * 0.45, R * 1.3, R * 0.6);
  const gear = scene.add.graphics();
  const tooth = R * 0.2;
  gear.fillStyle(0xffffff, 1);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const cx = Math.cos(a) * R * 0.52;
    const cy = Math.sin(a) * R * 0.52;
    gear.fillPoints([
      [-tooth / 2, -tooth / 2], [tooth / 2, -tooth / 2], [tooth / 2, tooth / 2], [-tooth / 2, tooth / 2],
    ].map(([px, py]) => new Phaser.Math.Vector2(
      cx + px * Math.cos(a) - py * Math.sin(a),
      cy + px * Math.sin(a) + py * Math.cos(a),
    )), true);
  }
  gear.fillCircle(0, 0, R * 0.48);
  gear.fillStyle(COLOURS.secondary, 1).fillCircle(0, 0, R * 0.2);
  const c = scene.add.container(x, y, [g, gear]);
  c.setSize(size, size).setInteractive({ useHandCursor: true });
  c.on('pointerover', () => scene.tweens.add({ targets: gear, angle: 45, duration: 300, ease: 'Back.Out' }));
  c.on('pointerout', () => scene.tweens.add({ targets: gear, angle: 0, duration: 300, ease: 'Back.Out' }));
  c.on('pointerup', () => onClick?.());
  return c;
}
