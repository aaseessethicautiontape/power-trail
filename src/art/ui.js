// Reusable UI pieces (PRD 7.4, 7.5, 7.7): buttons, panels, badges, hearts, stars, dialogs.
// Everything is drawn in code at the size it shows on screen: pass the ui scale `s`
// from getScreen(). Every number shown goes through formatPower. Every tappable
// thing has at least a 44x44px hit area.
import Phaser from 'phaser';
import { playSound } from '../audio.js';
import { formatPower } from '../../shared/rules.js';
import { RES, getScreen, safeRect } from '../layout/screen.js';

export const FONT_TITLE = '"Lilita One", "Arial Black", sans-serif';
export const FONT_UI = 'Nunito, "Trebuchet MS", sans-serif';
export const INK = '#3A2A1F';
export const MIN_HIT = 44;

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

// Type colours: the four starter types come from PRD 7.5, the rest are the usual type colours.
export const TYPE_COLOURS = {
  electric: 0xf7d02c,
  fire: 0xee8130,
  grass: 0x7ac74c,
  water: 0x6390f0,
  normal: 0xa8a77a,
  ice: 0x96d9d6,
  fighting: 0xc22e28,
  poison: 0xa33ea1,
  ground: 0xe2bf65,
  flying: 0xa98ff3,
  psychic: 0xf95587,
  bug: 0xa6b91a,
  rock: 0xb6a136,
  ghost: 0x735797,
  dragon: 0x6f35fc,
  dark: 0x705746,
  steel: 0xb7b7ce,
  fairy: 0xd685ad,
};

export const px = (n) => `${Math.round(n)}px`;

export function makeText(scene, x, y, str, style = {}) {
  return scene.add.text(x, y, str, {
    fontFamily: FONT_UI,
    fontSize: '20px',
    color: INK,
    resolution: RES,
    ...style,
  });
}

// Accepts 'main' | 'secondary' | 'danger' | badge names, a number (0xRRGGBB) or '#RRGGBB'.
export function toColour(c) {
  if (typeof c === 'number') return c;
  if (c in COLOURS) return COLOURS[c];
  if (c in BADGE) return BADGE[c];
  return Phaser.Display.Color.HexStringToColor(c).color;
}

export const toCss = (n) => `#${n.toString(16).padStart(6, '0')}`;

export function shade(colour, amount) {
  const c = Phaser.Display.Color.ValueToColor(colour);
  return (amount < 0 ? c.darken(-amount) : c.lighten(amount)).color;
}

// Makes a container tappable with a hit area of at least 44x44 around its centre.
// Call after the container's children are in place.
export function makeTappable(container, w, h) {
  container.setSize(Math.max(w, MIN_HIT), Math.max(h, MIN_HIT));
  container.setInteractive({ useHandCursor: true });
  return container;
}

// Chunky button with a darker bottom edge. Pressing moves the face down 4px.
// opts: { scale, width, height, fontSize, subtitle } — sizes are design units x scale.
export function makeButton(scene, x, y, label, colour, onClick, opts = {}) {
  const s = opts.scale ?? 1;
  const fill = toColour(colour);
  const fontSize = Math.max(16, (opts.fontSize ?? 30) * s);
  const h = Math.round((opts.height ?? 72) * s);
  const depth = Math.max(4, Math.round(8 * s));
  const r = Math.min(22 * s, h / 2);
  const subSize = Math.max(13, 17 * s);

  const text = makeText(scene, 0, opts.subtitle ? -subSize * 0.62 : -2 * s, label, {
    fontFamily: FONT_TITLE, fontSize: px(fontSize), color: '#ffffff',
    stroke: toCss(shade(fill, -35)), strokeThickness: Math.max(3, 6 * s),
  }).setOrigin(0.5);
  const w = Math.round(opts.width != null ? opts.width * s : Math.max(200 * s, text.width + 64 * s));

  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.18).fillRoundedRect(-w / 2 + 2, -h / 2 + depth + 4, w, h, r);
  const edge = scene.add.graphics();
  edge.fillStyle(shade(fill, -28), 1).fillRoundedRect(-w / 2, -h / 2 + depth, w, h, r);
  const face = scene.add.graphics();
  const drawFace = (hover) => {
    face.clear();
    face.fillStyle(hover ? shade(fill, 6) : fill, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
    // Glossy highlight on the upper half.
    face.fillStyle(0xffffff, 0.22).fillRoundedRect(-w / 2 + 8 * s, -h / 2 + 6 * s, w - 16 * s, h * 0.38, r * 0.7);
  };
  drawFace(false);

  const faceGroup = scene.add.container(0, 0, [face, text]);
  let subtitle = null;
  if (opts.subtitle) {
    subtitle = makeText(scene, 0, subSize * 0.85, opts.subtitle, {
      fontStyle: '900', fontSize: px(subSize), color: '#ffffff',
    }).setOrigin(0.5);
    faceGroup.add(subtitle);
  }
  const btn = scene.add.container(x, y, [shadow, edge, faceGroup]);
  makeTappable(btn, w, h + depth);

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
    playSound('tap');
    onClick?.();
  });

  Object.assign(btn, { label: text, face: faceGroup, subtitle, btnW: w, btnH: h + depth });
  return btn;
}

// Cream rounded panel (radius 24) with a 4px darker border and a soft shadow.
// w and h are on-screen pixels; s scales the radius, border and shadow.
export function makePanel(scene, x, y, w, h, opts = {}) {
  const s = opts.scale ?? 1;
  const fill = opts.fill ?? COLOURS.cream;
  const border = opts.border ?? COLOURS.creamEdge;
  const r = (opts.radius ?? 24) * s;
  const b = Math.max(3, 4 * s);
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.16).fillRoundedRect(-w / 2 + 4 * s, -h / 2 + 10 * s, w, h, r);
  g.fillStyle(border, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
  g.fillStyle(fill, 1).fillRoundedRect(-w / 2 + b, -h / 2 + b, w - 2 * b, h - 2 * b, Math.max(2, r - b));
  const panel = scene.add.container(x, y, [g]);
  panel.setSize(w, h);
  return panel;
}

// Power badge: Lilita One, white fill, 8px coloured outline, slight drop shadow.
// Numbers go through formatPower. opts: { scale, fontSize, prefix ('+' or '×'), x, y }.
export function makeBadge(scene, value, colour = 'player', opts = {}) {
  const s = opts.scale ?? 1;
  const strokeW = Math.max(4, 8 * s);
  const fmt = (v) => (typeof v === 'number' ? `${opts.prefix ?? ''}${formatPower(v)}` : String(v));
  const badge = makeText(scene, opts.x ?? 0, opts.y ?? 0, fmt(value), {
    fontFamily: FONT_TITLE, fontSize: px(Math.max(18, (opts.fontSize ?? 36) * s)), color: '#ffffff',
    stroke: toCss(toColour(colour)), strokeThickness: strokeW,
    padding: { x: 4, y: 4 },
  }).setOrigin(0.5);
  badge.setShadow(0, 4 * s, 'rgba(0,0,0,0.35)', 2, true, true);
  badge.setValue = (v) => badge.setText(fmt(v));
  badge.setColour = (c) => badge.setStroke(toCss(toColour(c)), strokeW);
  return badge;
}

export function drawHeart(g, x, y, s, full) {
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

// Row of drawn hearts, each `size` x scale pixels. Returns a container with setCount(n).
export function makeHearts(scene, x, y, count, max = 3, size = 36, scale = 1) {
  const g = scene.add.graphics();
  const c = scene.add.container(x, y, [g]);
  const sz = size * scale;
  const gap = sz * 1.25;
  c.setCount = (n) => {
    g.clear();
    for (let i = 0; i < max; i++) drawHeart(g, (i - (max - 1) / 2) * gap, 0, sz, i < n);
    c.count = n;
    return c;
  };
  c.setSize(gap * max, sz * 1.2);
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
  const o = Math.max(2, size * 0.1);
  g.fillStyle(full ? 0xa16207 : 0x9ca3af, 1).fillPoints(starPoints(x, y + o / 2, R + o, (R + o) * 0.5), true);
  g.fillStyle(full ? 0xfacc15 : 0xe5e7eb, 1).fillPoints(starPoints(x, y, R, R * 0.5), true);
  if (full) g.fillStyle(0xffffff, 0.45).fillPoints(starPoints(x - R * 0.12, y - R * 0.18, R * 0.35, R * 0.17), true);
}

// Row of gold stars (empty ones grey). Returns a container with setCount(n).
export function makeStars(scene, x, y, count, max = 3, size = 40, scale = 1) {
  const g = scene.add.graphics();
  const c = scene.add.container(x, y, [g]);
  const sz = size * scale;
  const gap = sz * 1.2;
  c.setCount = (n) => {
    g.clear();
    for (let i = 0; i < max; i++) drawStar(g, (i - (max - 1) / 2) * gap, 0, sz, i < n);
    c.count = n;
    return c;
  };
  c.setSize(gap * max, sz);
  return c.setCount(count);
}

// Round blue button with a drawn icon. draw(g, R) paints the icon in white.
export function makeRoundButton(scene, x, y, onClick, size, drawIcon) {
  const g = scene.add.graphics();
  const R = size / 2;
  g.fillStyle(0x000000, 0.18).fillCircle(2, R * 0.19, R);
  g.fillStyle(0x1e3a8a, 1).fillCircle(0, R * 0.12, R);
  g.fillStyle(COLOURS.secondary, 1).fillCircle(0, 0, R);
  g.fillStyle(0xffffff, 0.2).fillEllipse(0, -R * 0.45, R * 1.3, R * 0.6);
  const icon = scene.add.graphics();
  drawIcon(icon, R);
  const c = scene.add.container(x, y, [g, icon]);
  makeTappable(c, size, size);
  c.on('pointerdown', () => { icon.y = 2; });
  c.on('pointerout', () => { icon.y = 0; });
  c.on('pointerup', () => { icon.y = 0; onClick?.(); });
  c.icon = icon;
  return c;
}

// Settings cog. size = on-screen diameter.
export function makeCog(scene, x, y, onClick, size = 64) {
  const c = makeRoundButton(scene, x, y, onClick, size, (gear, R) => {
    const tooth = R * 0.2;
    gear.fillStyle(0xffffff, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const cx = Math.cos(a) * R * 0.52;
      const cy = Math.sin(a) * R * 0.52;
      gear.fillPoints([
        [-tooth / 2, -tooth / 2], [tooth / 2, -tooth / 2], [tooth / 2, tooth / 2], [-tooth / 2, tooth / 2],
      ].map(([px_, py]) => new Phaser.Math.Vector2(
        cx + px_ * Math.cos(a) - py * Math.sin(a),
        cy + px_ * Math.sin(a) + py * Math.cos(a),
      )), true);
    }
    gear.fillCircle(0, 0, R * 0.48);
    gear.fillStyle(COLOURS.secondary, 1).fillCircle(0, 0, R * 0.2);
  });
  c.on('pointerover', () => scene.tweens.add({ targets: c.icon, angle: 45, duration: 300, ease: 'Back.Out' }));
  c.on('pointerout', () => scene.tweens.add({ targets: c.icon, angle: 0, duration: 300, ease: 'Back.Out' }));
  return c;
}

// Pill switch. w x h on screen; the hit area is at least 44px.
export function makeToggle(scene, x, y, on, onChange, s = 1) {
  const w = Math.round(88 * s);
  const h = Math.round(44 * s);
  const g = scene.add.graphics();
  const knob = scene.add.circle(0, 0, h / 2 - 5 * s, 0xffffff);
  const c = scene.add.container(x, y, [g, knob]);
  const draw = () => {
    g.clear();
    g.fillStyle(on ? 0x15803d : 0x94a3b8, 1).fillRoundedRect(-w / 2, -h / 2 + 3 * s, w, h, h / 2);
    g.fillStyle(on ? 0x22c55e : 0xcbd5e1, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    knob.x = on ? w / 2 - h / 2 : -w / 2 + h / 2;
  };
  draw();
  makeTappable(c, w, h);
  c.on('pointerup', () => {
    on = !on;
    draw();
    onChange(on);
  });
  c.toggleW = w;
  return c;
}

// Modal dialog, centred in the safe area: dark shade + cream panel.
// spec: { title, stars?, message?, rows?: [{ build }], toggles?: [{ label, get(), set(on) }], buttons: [{ label, colour, onClick }], width }
// Max 92% of the screen width; buttons stack vertically when the panel is under 420px.
// Returns { root, close } — root is a container holding everything (depth 100).
export function makeDialog(scene, spec, { animate = true, onClose } = {}) {
  const scr = getScreen(scene);
  const s = scr.ui;
  const area = safeRect(scr, 0);
  const pw = Math.round(Math.min((spec.width ?? 540) * s, scr.w * 0.92, area.width));
  const pad = Math.max(18, 28 * s);
  const gap = Math.max(10, 14 * s);
  const inner = pw - pad * 2;

  const root = scene.add.container(0, 0).setDepth(100);
  // Oversized hit area so the dim layer still blocks taps while the window grows.
  const dim = scene.add.rectangle(0, 0, scr.w, scr.h, 0x0b1630, 0.5).setOrigin(0)
    .setInteractive(new Phaser.Geom.Rectangle(0, 0, 10000, 10000), Phaser.Geom.Rectangle.Contains);
  root.add(dim);

  const items = [];
  let y = pad;
  const title = makeText(scene, 0, 0, spec.title, {
    fontFamily: FONT_TITLE, fontSize: px(Math.max(26, 40 * s)), color: INK, align: 'center',
    wordWrap: { width: inner, useAdvancedWrap: true },
  }).setOrigin(0.5, 0);
  items.push([title, y]);
  y += title.height + gap * 0.6;

  if (spec.stars != null) {
    const st = makeStars(scene, 0, 0, spec.stars, 3, Math.max(34, 48 * s));
    items.push([st, y + st.height / 2]);
    y += st.height + gap;
  }

  if (spec.message) {
    const msg = makeText(scene, 0, 0, spec.message, {
      fontStyle: '700', fontSize: px(Math.max(16, 22 * s)), color: '#6B5745', align: 'center',
      wordWrap: { width: inner, useAdvancedWrap: true },
    }).setOrigin(0.5, 0);
    items.push([msg, y]);
    y += msg.height + gap;
  }

  // Custom rows: build(scene, innerWidth, s, animate) returns a game object with rowH (its height).
  for (const row of spec.rows ?? []) {
    const obj = row.build(scene, inner, s, animate);
    if (!obj) continue;
    items.push([obj, y + obj.rowH / 2]);
    y += obj.rowH + gap;
  }

  for (const t of spec.toggles ?? []) {
    const rowH = Math.max(MIN_HIT, 56 * s);
    const toggle = makeToggle(scene, 0, 0, t.get(), (on) => t.set(on), Math.max(0.8, s));
    toggle.x = inner / 2 - toggle.toggleW / 2;
    const label = makeText(scene, -inner / 2, 0, t.label, {
      fontStyle: '900', fontSize: px(Math.max(17, 24 * s)),
      wordWrap: { width: inner - toggle.toggleW - gap, useAdvancedWrap: true },
    }).setOrigin(0, 0.5);
    items.push([label, y + rowH / 2], [toggle, y + rowH / 2]);
    y += rowH + gap * 0.5;
  }
  y += gap * 0.5;

  const stacked = pw < 420 || (spec.stackButtons && spec.buttons.length > 2);
  const btns = spec.buttons;
  const bs = Math.max(0.8, s);
  const bh = 64; // design units
  const close = () => {
    scene.tweens.killTweensOf(root.list);
    root.destroy();
    onClose?.();
  };
  const made = btns.map((b) => {
    const width = stacked ? inner / bs : (inner - gap * (btns.length - 1)) / btns.length / bs;
    return makeButton(scene, 0, 0, b.label, b.colour, () => b.onClick(close), {
      scale: bs, width, height: bh, fontSize: 28,
    });
  });
  if (stacked) {
    for (const b of made) {
      items.push([b, y + b.btnH / 2]);
      y += b.btnH + gap * 0.7;
    }
    y -= gap * 0.7;
  } else {
    const bw = made[0].btnW;
    made.forEach((b, i) => {
      b.x = -inner / 2 + bw / 2 + i * (bw + gap);
      items.push([b, y + b.btnH / 2]);
    });
    y += made[0].btnH;
  }
  const ph = Math.round(y + pad);

  const panel = makePanel(scene, area.cx, area.cy, pw, ph, { scale: s });
  for (const [obj, oy] of items) {
    obj.y = oy - ph / 2;
    panel.add(obj);
  }
  root.add(panel);
  // Short screens (a phone on its side): shrink the whole panel to fit the safe area's height.
  const fit = Math.min(1, (area.height - 8) / ph);
  panel.setScale(fit);

  if (animate) {
    panel.setScale(fit * 0.85).setAlpha(0);
    scene.tweens.add({ targets: panel, scale: fit, alpha: 1, duration: 220, ease: 'Back.Out' });
  }
  return { root, panel, close };
}

// Row of level chips: "L3" with up to 3 small stars each (PRD 4.8). entries: [{ level, stars }].
// Shows the most recent ones that fit in maxW. onTap(entry, chip) gets the chip's world position.
// Returns a container with rowH and rowW.
export function makeLevelChips(scene, entries, maxW, s, onTap) {
  const c = scene.add.container(0, 0);
  const cw = Math.max(MIN_HIT, 58 * s);
  const ch = Math.max(MIN_HIT, 50 * s);
  const gap = Math.max(4, 6 * s);
  const fit = Math.max(1, Math.floor((maxW + gap) / (cw + gap)));
  const shown = entries.slice(-fit);
  const rowW = shown.length * cw + (shown.length - 1) * gap;
  shown.forEach((e, i) => {
    const x = -rowW / 2 + cw / 2 + i * (cw + gap);
    const g = scene.add.graphics();
    g.fillStyle(0x1e3a8a, 0.18).fillRoundedRect(-cw / 2, -ch / 2 + 3, cw, ch, 12 * s);
    g.fillStyle(0xffffff, 0.95).fillRoundedRect(-cw / 2, -ch / 2, cw, ch, 12 * s);
    g.lineStyle(2, 0xe6cfa6, 1).strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, 12 * s);
    const t = makeText(scene, 0, -ch * 0.18, `L${e.level}`, { fontFamily: FONT_TITLE, fontSize: px(Math.max(13, 17 * s)), color: INK }).setOrigin(0.5);
    const st = scene.add.graphics();
    const ss = Math.max(9, 12 * s);
    for (let k = 0; k < 3; k++) drawStar(st, (k - 1) * ss * 1.15, ch * 0.22, ss, k < (e.stars ?? 0));
    const chip = scene.add.container(x, 0, [g, t, st]);
    makeTappable(chip, cw, ch);
    chip.on('pointerup', () => onTap?.(e, chip));
    c.add(chip);
  });
  Object.assign(c, { rowH: ch, rowW });
  return c;
}

// Small info bubble above a point (screen space). Closes on the next tap anywhere or after 3.5s.
export function showChipInfo(scene, x, y, lines, s = 1) {
  scene.chipInfo?.destroy();
  const t = makeText(scene, 0, 0, lines.join('\n'), {
    fontStyle: '800', fontSize: px(Math.max(14, 17 * s)), color: INK, align: 'center', lineSpacing: 4,
  }).setOrigin(0.5);
  const w = t.width + 28 * s;
  const h = t.height + 22 * s;
  const scr = getScreen(scene);
  const cx = Math.min(Math.max(x, w / 2 + 8), scr.w - w / 2 - 8);
  const cy = Math.max(h / 2 + 8, y - h / 2 - 34 * s);
  const panel = makePanel(scene, cx, cy, w, h, { scale: Math.min(1, s), radius: 14 });
  panel.add(t);
  panel.setDepth(130).setScale(0.85).setAlpha(0);
  scene.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 160, ease: 'Back.Out' });
  scene.chipInfo = panel;
  const close = () => {
    if (scene.chipInfo === panel) scene.chipInfo = null;
    panel.destroy();
  };
  scene.time.delayedCall(80, () => scene.input.once('pointerdown', close));
  scene.time.delayedCall(3500, close);
  return panel;
}

// What a level chip's bubble says. e: { level, stars, power, best } from run.results;
// rec: the all-time bestByLevel record for that level (or null).
export function levelChipLines(e, rec, starterName = (k) => k) {
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const lines = [`Level ${e.level}  ${stars(e.stars ?? 0)}`];
  if (e.power != null) lines.push(`Power ${e.power.toLocaleString('en-US')} · Best possible ${e.best.toLocaleString('en-US')}`);
  if (rec) lines.push(`Best ever: ${stars(rec.stars)} ${rec.power.toLocaleString('en-US')} (${starterName(rec.starter)})`);
  return lines;
}
