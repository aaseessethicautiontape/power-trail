import Phaser from 'phaser';
import { LEVEL_TUNING } from '../../shared/config.js';
import { biomeFor, formFor } from '../../shared/level.js';
import { load } from '../save.js';
import { getScreen, safeRect, watchResize, RES } from '../layout/screen.js';
import {
  makeButton, makeText, makePanel, makeHearts, makeStars, makeTappable, drawStar, drawHeart, px, shade,
  FONT_TITLE, INK,
} from '../art/ui.js';
import {
  TRAIL, trailGeometry, bandRect, roadBetween, bandDecor, visibleBands, trailCount, thin, heroSpot,
} from '../art/trail.js';
import { renderTrailBand } from '../art/biomeRenderer.js';
import { paletteFor } from '../art/palettes.js';
import { loadPokemon, pokemonKey } from '../assets.js';
import { runTo } from '../art/effects.js';
import { playSound } from '../audio.js';
import { drawBiomeIcon } from './UIScene.js';

const clamp = Phaser.Math.Clamp;
const HERO_H = 80; // hero art height, design px
const NODE_COLOURS = {
  done: { base: 0xf97316, light: 0xfbbf24, ring: 0xfff1a5 },
  current: { base: 0x16a34a, light: 0x4ade80, ring: 0xffffff },
  locked: { base: 0x6f7d99, light: 0x8d9ab4, ring: 0xcbd5e1 },
};

// The level-select map (Candy Crush style): one long winding trail, level 1 at the bottom, a
// round node for every level, and the biome changing every five levels. Your Pokémon stands on
// the current level and hops along the road when you move between levels. Tap the current level
// (or the PLAY button) to play it, tap a cleared level to see its score and practise it again.
//
// data: { run, arrive?: { from, to, stars } }. With `arrive`, the map opens on the level you just
// cleared and the Pokémon walks up the road to the next one.
export default class TrailMapScene extends Phaser.Scene {
  constructor() {
    super('TrailMapScene');
  }

  create(data) {
    this.run = data?.run ?? load().run;
    if (!this.run) {
      this.scene.start('TitleScene');
      return;
    }
    this.store = load();
    this.arrive = data?.arrive ?? null;
    this.scrollY = 0;
    this.vel = 0;
    this.drag = null;
    this.busy = false;
    this.bands = new Map(); // band index -> { rt, objs }
    this.nodes = new Map(); // level -> node container
    this.cardLevel = null;
    this.focusY = null; // world y at the middle of the screen, kept across resizes
    this.heroLevel = this.arrive ? this.arrive.from : this.run.level;

    this.world = this.add.container(0, 0);
    this.hud = this.add.container(0, 0).setDepth(100);
    this.cameras.main.setBackgroundColor('#8fd460');

    // Hero art: the form you've evolved into so far (and the next one, so it's ready).
    const formId = this.run.form ?? formFor(this.run.starter, this.run.level);
    loadPokemon(this, [formId, formFor(this.run.starter, this.run.level)]);
    if (this.load.list.size) {
      this.load.once('complete', () => this.heroArt());
      this.load.start();
    }

    this.layout(true);
    watchResize(this, () => this.layout(false));
    this.setupInput();
    this.events.once('shutdown', () => this.clearWorld());
  }

  // ---------- layout ----------

  layout(first) {
    const scr = getScreen(this);
    this.scr = scr;
    const lastFocus = this.focusY;
    this.clearWorld();
    this.tweens.killTweensOf(this.hud.list);
    this.hud.removeAll(true);

    this.z = clamp(Math.min(scr.w / 560, scr.h / 520), 0.7, 1.3);
    const W = scr.w / this.z;
    const count = trailCount(this.run.level, this.store.bestLevel ?? 0);
    this.geo = trailGeometry({ W, count, seed: 'power-trail' });
    this.maxScroll = Math.max(0, this.geo.H * this.z - scr.h);
    this.k = Math.min(2, this.z * (scr.compact ? 0.75 : 1) * Math.min(RES, 1.5));

    this.buildHero();
    this.buildHud();

    // Where to look: the current level (or where we were before a resize).
    const here = this.geo.nodes[Math.min(this.geo.count, this.heroLevel) - 1];
    const focus = lastFocus ?? here.y - (scr.h / this.z) * 0.08;
    this.setScroll(focus * this.z - scr.h * 0.5);
    this.syncBands(true);
    if (this.cardLevel != null) this.openCard(this.cardLevel);

    if (first && this.arrive) this.playArrival();
  }

  clearWorld() {
    for (const [b] of this.bands) this.destroyBand(b);
    this.bands.clear();
    this.nodes.clear();
    if (this.hero) this.tweens.killTweensOf([this.hero, ...this.hero.list]);
    this.tweens.killTweensOf(this.world.list);
    this.world.removeAll(true);
    this.hero = null;
  }

  // Crisp text inside the scaled world.
  crisp(text) {
    return text.setResolution(Math.min(3, RES * this.z));
  }

  // ---------- scrolling and bands ----------

  setScroll(y) {
    this.scrollY = clamp(y, 0, this.maxScroll);
    this.world.setPosition(0, -this.scrollY).setScale(this.z);
    this.focusY = (this.scrollY + this.scr.h / 2) / this.z;
    this.syncBands(false);
    this.updatePill();
  }

  // Bands (biome stretches) exist only while they're near the screen. A band that is on screen is
  // baked at once; the ones just off screen are baked one at a time when scrolling has stopped
  // (a bake takes ~100-300 ms, which would stutter a drag), and far ones are destroyed.
  syncBands(force) {
    if (!this.geo) return;
    const top = this.scrollY / this.z;
    const bottom = (this.scrollY + this.scr.h) / this.z;
    const want = new Set(visibleBands(this.geo, top, bottom));
    for (const b of want) {
      const r = bandRect(this.geo, b);
      if (!this.bands.has(b) && r.bottom >= top && r.top <= bottom) this.buildBand(b);
    }
    for (const [b] of [...this.bands]) if (!want.has(b)) this.destroyBand(b);
    this.wantBands = want;
    if (force) this.sortWorld();
  }

  // Bakes one wanted-but-missing band, if the map is at rest.
  bakeNeighbour() {
    if (!this.wantBands || this.drag || Math.abs(this.vel) > 0.02 || this.busy) return;
    if (this.time.now - (this.lastBake ?? 0) < 150) return;
    for (const b of this.wantBands) {
      if (this.bands.has(b)) continue;
      this.lastBake = this.time.now;
      this.buildBand(b);
      return;
    }
  }

  sortWorld() {
    // Bands first (behind), then signs, nodes, then the hero.
    this.world.list.forEach((o) => { if (o.trailLayer == null) o.trailLayer = 1; });
    this.world.sort('trailLayer');
  }

  buildBand(b) {
    const { geo } = this;
    const rect = bandRect(geo, b);
    const key = biomeFor(b * TRAIL.band + 1).key;
    const above = b + 1 < geo.bands ? biomeFor((b + 1) * TRAIL.band + 1).key : null;
    const below = b > 0 ? biomeFor((b - 1) * TRAIL.band + 1).key : null;
    const rt = renderTrailBand(this, key, {
      geo, rect, decor: bandDecor(geo, b, key), band: b, above, below, k: this.k,
    });
    this.world.add(rt);
    rt.setPosition(0, rect.top);
    rt.trailLayer = 0;
    const objs = [];
    // Level nodes in this band.
    for (let n = b * TRAIL.band + 1; n <= Math.min(geo.count, (b + 1) * TRAIL.band); n++) {
      const node = this.makeNode(n);
      this.world.add(node);
      this.nodes.set(n, node);
      objs.push(node);
    }
    // The sign where this biome begins (or the start sign for the first one).
    const sign = this.makeSign(b, key);
    this.world.add(sign);
    objs.push(sign);
    this.bands.set(b, { rt, objs });
    this.world.sort('trailLayer');
    if (this.hero) this.world.bringToTop(this.hero);
  }

  destroyBand(b) {
    const band = this.bands.get(b);
    if (!band) return;
    for (const o of band.objs) {
      this.tweens.killTweensOf([o, ...(o.list ?? [])]);
      if (o.level != null) this.nodes.delete(o.level);
      o.destroy();
    }
    band.rt.destroy();
    this.bands.delete(b);
  }

  // ---------- nodes ----------

  stateOf(level) {
    if (level < this.run.level) return 'done';
    if (level === this.run.level) return 'current';
    return 'locked';
  }

  // Best known score for a level: the best-ever record, or this run's result.
  scoreOf(level) {
    const rec = this.store.bestByLevel?.[level];
    if (rec) return rec;
    const r = this.run.results?.find((x) => x.level === level);
    return r ? { stars: r.stars, power: r.power, best: r.best, starter: this.run.starter } : null;
  }

  makeNode(level) {
    const n = this.geo.nodes[level - 1];
    const state = this.stateOf(level);
    const boss = level % LEVEL_TUNING.legendEvery === 0;
    const r = TRAIL.nodeR * (boss ? 1.18 : 1);
    const c = NODE_COLOURS[state];
    const node = this.add.container(n.x, n.y);
    node.level = level;
    node.state = state;
    node.r = r;
    node.trailLayer = 2;

    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.24).fillEllipse(2, r * 0.95, r * 2.1, r * 0.8);
    g.fillStyle(shade(c.base, -32), 1).fillCircle(0, 6, r + 3); // the chunky lower lip
    g.fillStyle(boss ? 0xfacc15 : c.ring, 1).fillCircle(0, 0, r + 4);
    g.fillStyle(c.base, 1).fillCircle(0, 0, r - 1);
    g.fillStyle(c.light, 0.85).fillEllipse(0, -r * 0.38, r * 1.35, r * 0.72);
    if (boss) g.lineStyle(3, 0xb45309, 1).strokeCircle(0, 0, r + 4);
    node.add(g);

    const label = makeText(this, 0, 1, `${level}`, {
      fontFamily: FONT_TITLE, fontSize: px(r * (level >= 100 ? 0.78 : 1.02)), color: '#ffffff',
      stroke: toCssShade(c.base), strokeThickness: Math.max(4, r * 0.18),
    }).setOrigin(0.5);
    this.crisp(label);
    if (state === 'locked') label.setAlpha(0.8);
    node.add(label);

    // Stars under cleared levels; a faint set on locked ones that an earlier run already beat.
    const score = this.scoreOf(level);
    if (state === 'done' || (state === 'locked' && score)) {
      const sg = this.add.graphics();
      const ss = 17;
      const stars = score?.stars ?? 0;
      for (let k = 0; k < 3; k++) drawStar(sg, (k - 1) * ss * 1.12, r + 16, ss, k < stars);
      sg.setAlpha(state === 'locked' ? 0.5 : 1);
      node.add(sg);
      node.starsG = sg;
    }
    if (boss) node.add(this.makeCrown(0, -r - 6));
    if (level % LEVEL_TUNING.heartEvery === 0) {
      const hg = this.add.graphics();
      drawHeart(hg, r * 0.82, -r * 0.8, 21, true);
      node.add(hg);
    }
    if (state === 'locked') node.add(this.makeLock(r * 0.74, r * 0.7));
    if (state === 'current') this.decorateCurrent(node, r);
    return node;
  }

  makeCrown(x, y) {
    const g = this.add.graphics();
    const V = (px_, py) => new Phaser.Math.Vector2(x + px_, y + py);
    const pts = (dy) => [V(-17, 4 + dy), V(-19, -12 + dy), V(-9, -4 + dy), V(0, -17 + dy), V(9, -4 + dy), V(19, -12 + dy), V(17, 4 + dy)];
    g.fillStyle(0x92400e, 1).fillPoints(pts(2), true);
    g.fillStyle(0xfacc15, 1).fillPoints(pts(0), true);
    g.fillStyle(0xef4444, 1).fillCircle(x, y - 2, 3);
    g.fillStyle(0x3b82f6, 1).fillCircle(x - 9, y - 1, 2.4).fillCircle(x + 9, y - 1, 2.4);
    return g;
  }

  makeLock(x, y) {
    const g = this.add.graphics();
    g.lineStyle(4, 0x475569, 1).beginPath().arc(x, y - 6, 7, Math.PI, 0).strokePath();
    g.fillStyle(0x334155, 1).fillRoundedRect(x - 11, y - 4, 22, 17, 4);
    g.fillStyle(0xfacc15, 1).fillRoundedRect(x - 10, y - 4, 20, 14, 3);
    g.fillStyle(0x92400e, 1).fillCircle(x, y + 2, 2.4);
    return g;
  }

  // The level you're on: a pulsing glow and a bobbing PLAY flag.
  decorateCurrent(node, r) {
    const glow = this.add.graphics();
    glow.lineStyle(7, 0xfff7c2, 0.9).strokeCircle(0, 0, r + 12);
    glow.fillStyle(0xfff7c2, 0.18).fillCircle(0, 0, r + 12);
    node.addAt(glow, 0);
    this.tweens.add({ targets: glow, scale: 1.2, alpha: 0.25, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    const flag = this.add.container(0, -r - 44);
    const fg = this.add.graphics();
    fg.fillStyle(0x000000, 0.2).fillRoundedRect(-37, -13, 78, 34, 14);
    fg.fillStyle(0x1e3a8a, 1).fillRoundedRect(-39, -17, 78, 34, 14);
    fg.fillStyle(0xffffff, 1).fillRoundedRect(-36, -14, 72, 28, 12);
    fg.fillStyle(0xffffff, 1).fillTriangle(-9, 14, 9, 14, 0, 26);
    fg.fillStyle(0x1e3a8a, 1).fillTriangle(-11, 16, 11, 16, 0, 30).fillStyle(0xffffff, 1).fillTriangle(-9, 14, 9, 14, 0, 26);
    const t = makeText(this, 0, -1, 'PLAY', { fontFamily: FONT_TITLE, fontSize: '22px', color: '#16a34a', stroke: '#ffffff', strokeThickness: 1 }).setOrigin(0.5);
    this.crisp(t);
    flag.add([fg, t]);
    node.add(flag);
    this.tweens.add({ targets: flag, y: flag.y - 9, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  // A roadside sign where each biome begins; "START" at the very bottom.
  makeSign(b, key) {
    const { geo } = this;
    const pal = paletteFor(key);
    const rect = bandRect(geo, b);
    const first = b * TRAIL.band + 1;
    const lastLevel = (b + 1) * TRAIL.band;
    // Beside the road, on the emptier side, where the biome starts (the seam below this band's first level).
    // The sign keeps clear of the road and of the level nodes near the seam, shrinking on narrow screens.
    const y = b === 0 ? geo.nodes[0].y + 92 : rect.bottom - 6;
    const top = y - 124;
    const near = [
      ...geo.road.filter((p) => p.y > top - 30 && p.y < y + 30).map((p) => ({ x: p.x, pad: 66 })),
      ...geo.nodes.filter((n) => n.y > top - 80 && n.y < y + 80).map((n) => ({ x: n.x, pad: TRAIL.nodeR + 52 })),
    ];
    const left = Math.min(...near.map((o) => o.x - o.pad)) - 8;
    const right = geo.W - 8 - Math.max(...near.map((o) => o.x + o.pad));
    const onRight = right >= left;
    const room = Math.max(left, right);
    const w = clamp(room, 150, 214);
    // Just past the clearance on the emptier side (and always inside the world).
    const x = onRight
      ? clamp(geo.W - right - 8 + 18 + w / 2, 8 + w / 2, geo.W - 8 - w / 2)
      : clamp(left + 8 - 18 - w / 2, 8 + w / 2, geo.W - 8 - w / 2);

    const sign = this.add.container(x, y);
    sign.trailLayer = 1;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillEllipse(2, 4, 84, 18);
    g.fillStyle(0x6b4220, 1).fillRoundedRect(-5, -56, 10, 58, 3); // post
    const h = 62;
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-w / 2 + 3, -h - 52, w, h, 16);
    g.fillStyle(shade(pal.cliff, -30), 1).fillRoundedRect(-w / 2, -h - 56 + 5, w, h, 16);
    g.fillStyle(0xfff8ec, 1).fillRoundedRect(-w / 2, -h - 56, w, h, 16);
    g.lineStyle(4, shade(pal.cliff, -10), 1).strokeRoundedRect(-w / 2, -h - 56, w, h, 16);
    sign.add(g);
    const icon = this.add.graphics();
    drawBiomeIcon(icon, key, 20);
    icon.setPosition(-w / 2 + 32, -h / 2 - 56);
    sign.add(icon);
    const t1 = makeText(this, -w / 2 + 62, -h / 2 - 56 - 11, biomeFor(first).label, { fontFamily: FONT_TITLE, fontSize: '23px', color: INK }).setOrigin(0, 0.5);
    if (t1.width > w - 76) t1.setScale((w - 76) / t1.width);
    const t2 = makeText(this, -w / 2 + 62, -h / 2 - 56 + 15, `Levels ${first}-${lastLevel}`, { fontStyle: '900', fontSize: '15px', color: '#8A7058' }).setOrigin(0, 0.5);
    if (t2.width > w - 76) t2.setScale((w - 76) / t2.width);
    this.crisp(t1);
    this.crisp(t2);
    sign.add([t1, t2]);
    return sign;
  }

  // ---------- hero ----------

  heroSpot(level) {
    return heroSpot(this.geo, level);
  }

  buildHero() {
    const spot = this.heroSpot(this.heroLevel);
    const hero = this.add.container(spot.x, spot.y);
    hero.trailLayer = 5;
    hero.add(this.add.ellipse(0, 0, 58, 17, 0x000000, 0.24));
    this.hero = hero;
    this.world.add(hero);
    this.heroArt();
  }

  heroArt() {
    const hero = this.hero;
    if (!hero?.active) return;
    const id = this.run.form ?? formFor(this.run.starter, this.run.level);
    const key = pokemonKey(id);
    if (hero.art) this.tweens.killTweensOf(hero.art);
    hero.art?.destroy();
    if (!this.textures.exists(key)) {
      hero.art = null;
      return;
    }
    const art = this.add.image(0, 6, key).setOrigin(0.5, 1);
    art.setScale(HERO_H / art.height);
    art.setFlipX(hero.x < this.geo.W / 2); // HOME art faces left: look toward the road
    hero.add(art);
    hero.art = art;
    this.tweens.killTweensOf(art);
    this.tweens.add({ targets: art, y: art.y - 3, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  // Walks the hero along the road from its level to `to`, the camera following, then calls done().
  // The road is the real path; the hero hops along it.
  walkTo(to, done) {
    const hero = this.hero;
    const from = this.heroLevel;
    const target = this.heroSpot(to);
    const road = thin(roadBetween(this.geo, from, to), 14);
    const pts = [{ x: hero.x, y: hero.y }, ...road.map((p) => ({ x: p.x, y: p.y + 14 })), target];
    const reduce = !!this.store.settings?.reduceMotion;
    this.heroLevel = to;
    playSound('hop');
    runTo(this, hero, pts, {
      reduce, maxMs: 1300, msPerPx: 1.7, bounce: 9, bouncePeriod: 95, hop: 20,
      dust: (scene, x, y, red, n) => this.puff(x, y, red, n),
      onTurn: (dx) => hero.art?.setFlipX(dx > 0),
      onStep: (x, y) => {
        // The camera drifts after the hero so you can see where you're going.
        const want = (y - (this.scr.h / this.z) * 0.1) * this.z - this.scr.h * 0.5;
        this.setScroll(this.scrollY + (want - this.scrollY) * 0.14);
      },
      onDone: () => {
        // Face the road again.
        hero.art?.setFlipX(hero.x < this.geo.W / 2);
        done?.();
      },
    });
  }

  // A soft dust puff in world space.
  puff(x, y, reduce, n = 3) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const c = this.add.circle(x + (n > 1 ? (i - 1) * 10 : 0), y - 2, 7, 0xfff8e7, 0.7);
      c.trailLayer = 4;
      this.world.add(c);
      this.tweens.add({
        targets: c, y: y - 12 - Math.random() * 6, scale: 2.2, alpha: 0, duration: 420, ease: 'Quad.Out', onComplete: () => c.destroy(),
      });
    }
  }

  // ---------- opening animations ----------

  // After clearing a level: stars pop on it, then the hero hops up the road to the next one.
  playArrival() {
    const { from, to, stars } = this.arrive;
    this.busy = true;
    const node = this.nodes.get(from);
    if (node && stars > 0) {
      const sg = node.starsG ?? this.add.graphics();
      sg.clear();
      const r = node.r;
      const ss = 17;
      for (let k = 0; k < 3; k++) drawStar(sg, (k - 1) * ss * 1.12, r + 16, ss, k < stars);
      if (!node.starsG) { node.add(sg); node.starsG = sg; }
      sg.setScale(0.2).setAlpha(0);
      this.tweens.add({ targets: sg, scale: 1, alpha: 1, duration: 420, delay: 250, ease: 'Back.Out' });
      this.time.delayedCall(450, () => this.sparkle(node.x, node.y + r + 16, 0xfacc15));
    }
    this.time.delayedCall(stars > 0 ? 900 : 300, () => {
      this.walkTo(to, () => {
        this.refreshCurrent();
        this.busy = false;
        this.announce(true);
      });
    });
  }

  sparkle(x, y, tint) {
    if (this.store.settings?.reduceMotion) return;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const s = this.add.star(x, y, 4, 2.5, 7, tint);
      s.trailLayer = 6;
      this.world.add(s);
      this.tweens.add({
        targets: s, x: x + Math.cos(a) * 40, y: y + Math.sin(a) * 32, alpha: 0, angle: 90, duration: 520, ease: 'Quad.Out', onComplete: () => s.destroy(),
      });
    }
  }

  // The map re-draws the node you arrived at as the current one.
  refreshCurrent() {
    this.layout(false);
  }

  // A friendly line the first time a new biome comes into view.
  announce(arrived = false) {
    const level = this.run.level;
    if (arrived && level > 1 && (level - 1) % TRAIL.band === 0) {
      this.toast(`New world: ${biomeFor(level).label}!`, biomeFor(level).key);
    }
  }

  toast(text, biomeKey) {
    const s = Math.max(0.8, this.scr.ui);
    const area = safeRect(this.scr, 12);
    const t = makeText(this, 0, 0, text, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(20, 30 * s)), color: '#ffffff', stroke: '#1E293B', strokeThickness: 7 * s,
    }).setOrigin(0, 0.5);
    const icon = Math.max(40, 54 * s);
    const bw = Math.min(area.width, icon + t.width + 70 * s);
    if (icon + t.width + 70 * s > bw) t.setScale((bw - icon - 70 * s) / t.width);
    const bh = Math.max(64, 84 * s);
    const pal = paletteFor(biomeKey);
    const g = this.add.graphics();
    const colour = shade(pal.cliff, -10);
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-bw / 2 + 4, -bh / 2 + 8, bw, bh, bh / 2);
    g.fillStyle(shade(colour, -25), 1).fillRoundedRect(-bw / 2, -bh / 2 + 5, bw, bh, bh / 2);
    g.fillStyle(colour, 1).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    g.fillStyle(0xffffff, 0.18).fillRoundedRect(-bw / 2 + 10, -bh / 2 + 6, bw - 20, bh * 0.35, bh * 0.2);
    const ig = this.add.graphics();
    drawBiomeIcon(ig, biomeKey, icon / 2);
    ig.setPosition(-bw / 2 + bh * 0.16 + icon / 2, 0);
    t.setPosition(-bw / 2 + bh * 0.3 + icon, 0);
    const banner = this.add.container(this.scr.w / 2, area.top + bh * 1.6, [g, ig, t]).setDepth(120).setAlpha(0).setScale(0.6);
    this.tweens.chain({
      targets: banner,
      tweens: [
        { alpha: 1, scale: 1, duration: 260, ease: 'Back.Out' },
        { scale: 1, duration: 1500 },
        { alpha: 0, y: banner.y - 30, duration: 260, onComplete: () => banner.destroy() },
      ],
    });
  }

  // ---------- HUD ----------

  buildHud() {
    const scr = this.scr;
    const s = Math.max(0.8, scr.ui);
    const area = safeRect(scr, Math.max(10, 14 * s));
    this.area = area;

    const back = makeButton(this, 0, 0, '◀ Title', 'secondary', () => this.scene.start('TitleScene'), {
      scale: Math.max(0.7, Math.min(1, s)), width: 140, height: 52, fontSize: 22,
    });
    back.setPosition(area.left + back.btnW / 2, area.top + (back.btnH - 8) / 2);

    // Hearts and total stars, top right.
    const hs = Math.max(22, 30 * s);
    const hearts = makeHearts(this, 0, 0, this.run.hearts, LEVEL_TUNING.lives, hs);
    const starsTotal = this.run.stars ?? 0;
    const st = makeText(this, 0, 0, `${starsTotal}`, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(20, 26 * s)), color: '#ffffff', stroke: '#1E3A8A', strokeThickness: 5,
    }).setOrigin(0, 0.5);
    const starG = this.add.graphics();
    drawStar(starG, 0, 0, Math.max(22, 28 * s), true);
    const rowW = hearts.width + 16 + 30 + st.width;
    const ph = Math.max(46, 56 * s);
    const pillW = rowW + 28;
    const px0 = area.right - pillW / 2;
    const py0 = area.top + ph / 2;
    const pill = this.add.graphics();
    pill.fillStyle(0x0b1e4a, 0.28).fillRoundedRect(-pillW / 2 + 2, -ph / 2 + 4, pillW, ph, ph / 2);
    pill.fillStyle(0x1e3a8a, 0.82).fillRoundedRect(-pillW / 2, -ph / 2, pillW, ph, ph / 2);
    hearts.setPosition(-pillW / 2 + 14 + hearts.width / 2, 0);
    starG.setPosition(-pillW / 2 + 14 + hearts.width + 16 + 12, 0);
    st.setPosition(starG.x + 18, 0);
    const stats = this.add.container(px0, py0, [pill, hearts, starG, st]);

    // The world's name for whatever is in the middle of the screen.
    this.pill = this.add.container(scr.w / 2, area.top + ph / 2 + (scr.w < 560 ? ph + 6 : 0));
    this.pillText = makeText(this, 0, 0, '', {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(16, 22 * s)), color: '#ffffff', stroke: '#1E3A8A', strokeThickness: Math.max(4, 6 * s),
    }).setOrigin(0.5);
    this.pillBg = this.add.graphics();
    this.pill.add([this.pillBg, this.pillText]);

    this.hud.add([back, stats, this.pill]);
    this.buildPlayButton();
    this.updatePill();
  }

  buildPlayButton() {
    const scr = this.scr;
    const s = Math.max(0.8, scr.ui);
    this.play_?.destroy();
    const level = this.run.level;
    const evolves = this.run.form != null && formFor(this.run.starter, level) !== this.run.form;
    const btn = makeButton(this, scr.w / 2, 0, `PLAY LEVEL ${level}`, 'main', () => this.play(level, false), {
      scale: Math.min(1.15, s), width: Math.min(340, scr.w * 0.8 / Math.min(1.15, s)), height: 76, fontSize: 32,
      subtitle: evolves ? 'Evolution time!' : undefined,
    });
    btn.setPosition(scr.w / 2, this.area.bottom - btn.btnH / 2);
    this.play_ = btn;
    this.hud.add(btn);
    this.tweens.add({ targets: btn, scale: 1.04, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    btn.setVisible(this.cardLevel == null);
  }

  // "Level 7 · Coral Beach" for the level nearest the middle of the screen.
  updatePill() {
    if (!this.pillText || !this.geo) return;
    const wy = this.focusY;
    let best = 1;
    let bd = Infinity;
    for (const n of this.geo.nodes) {
      const d = Math.abs(n.y - wy);
      if (d < bd) { bd = d; best = n.level; }
    }
    const text = `Level ${best} · ${biomeFor(best).label}`;
    if (this.pillText.text === text) return;
    this.pillText.setText(text);
    const w = this.pillText.width + 34;
    const h = this.pillText.height + 14;
    this.pillBg.clear().fillStyle(0x1e3a8a, 0.78).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  }

  // ---------- level card (tap a cleared level) ----------

  openCard(level) {
    this.closeCard(true);
    this.cardLevel = level;
    this.play_?.setVisible(false);
    const scr = this.scr;
    const s = Math.max(0.8, scr.ui);
    const area = this.area;
    const w = Math.min(scr.w * 0.94, 480);
    const rec = this.scoreOf(level);
    const biome = biomeFor(level);
    const pad = 18 * s;

    const items = [];
    const title = makeText(this, 0, 0, `Level ${level} · ${biome.label}`, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(22, 30 * s)), color: INK,
    }).setOrigin(0.5, 0);
    if (title.width > w - pad * 2 - 50) title.setScale((w - pad * 2 - 50) / title.width);
    items.push(title);
    const stars = makeStars(this, 0, 0, rec?.stars ?? 0, 3, Math.max(34, 44 * s));
    items.push(stars);
    const detail = rec
      ? `Power ${rec.power.toLocaleString('en-US')} · Best possible ${rec.best.toLocaleString('en-US')}`
      : 'Cleared earlier in this run';
    const d = makeText(this, 0, 0, detail, { fontStyle: '800', fontSize: px(Math.max(15, 19 * s)), color: '#6B5745', align: 'center', wordWrap: { width: w - pad * 2 } }).setOrigin(0.5, 0);
    items.push(d);
    const note = makeText(this, 0, 0, 'Practice: no hearts lost, your run stays as it is.', {
      fontStyle: '700', fontSize: px(Math.max(13, 15 * s)), color: '#A08A74', align: 'center', wordWrap: { width: w - pad * 2 },
    }).setOrigin(0.5, 0);
    items.push(note);
    const btn = makeButton(this, 0, 0, 'PLAY AGAIN', 'main', () => this.play(level, true), {
      scale: Math.min(1.1, s), width: Math.min(300, (w - pad * 2) / Math.min(1.1, s)), height: 66, fontSize: 30,
    });

    const gap = 8 * s;
    let h = pad + items.reduce((sum, o) => sum + (o === stars ? stars.height : o.displayHeight) + gap, 0) + btn.btnH + pad;
    const panel = makePanel(this, scr.w / 2, 0, w, h, { scale: s });
    panel.setInteractive(); // taps on the card itself must not fall through to the map
    let y = -h / 2 + pad;
    for (const o of items) {
      const oh = o === stars ? stars.height : o.displayHeight;
      o.setPosition(0, o === stars ? y + oh / 2 : y);
      panel.add(o);
      y += oh + gap;
    }
    btn.setPosition(0, y + btn.btnH / 2 - 8 * s);
    panel.add(btn);
    // Close button.
    const close = this.add.container(w / 2 - 28, -h / 2 + 28);
    const cg = this.add.graphics();
    cg.fillStyle(0xe6cfa6, 1).fillCircle(0, 0, 18);
    cg.lineStyle(4, 0x8a7058, 1).lineBetween(-6, -6, 6, 6).lineBetween(-6, 6, 6, -6);
    close.add(cg);
    makeTappable(close, 44, 44);
    close.on('pointerup', () => { playSound('tap'); this.closeCard(); });
    panel.add(close);
    panel.setPosition(scr.w / 2, area.bottom - h / 2);
    this.card = panel;
    this.hud.add(panel);
    panel.setAlpha(0).setY(panel.y + 30);
    this.tweens.add({ targets: panel, alpha: 1, y: panel.y - 30, duration: 220, ease: 'Back.Out' });
  }

  closeCard(quiet) {
    if (this.card) {
      this.tweens.killTweensOf(this.card);
      this.card.destroy();
      this.card = null;
    }
    this.cardLevel = null;
    if (!quiet) this.play_?.setVisible(true);
  }

  // ---------- starting levels ----------

  // Walks to the level, then starts it. A cleared level is practice: the same level (seed and
  // difficulty) again, with its own hearts, which only improves the score you see on the map.
  play(level, practice) {
    if (this.busy) return;
    this.busy = true;
    this.closeCard(true);
    this.play_?.setVisible(false);
    const go = () => {
      if (!practice) {
        this.scene.start('LevelScene', { run: this.run });
        return;
      }
      const entry = this.run.history?.find((h) => h.level === level);
      const replay = {
        starter: this.run.starter, runSeed: this.run.runSeed, level, hearts: LEVEL_TUNING.lives, stars: 0,
        history: [], results: [], replay: true, difficulty: entry?.difficulty ?? 0, form: formFor(this.run.starter, level),
      };
      this.scene.start('LevelScene', { run: replay });
    };
    if (this.heroLevel === level) {
      this.tweens.add({ targets: this.hero, y: this.hero.y - 18, duration: 160, yoyo: true, onComplete: go });
      playSound('hop');
    } else this.walkTo(level, go);
  }

  // A locked node shakes and says why.
  lockedTap(level) {
    const node = this.nodes.get(level);
    if (node) {
      const x0 = node.x;
      this.tweens.add({ targets: node, x: x0 + 7, duration: 45, yoyo: true, repeat: 3, ease: 'Sine.InOut', onComplete: () => { node.x = x0; } });
    }
    this.message(level === this.run.level + 1 ? `Clear level ${this.run.level} first!` : `Clear level ${this.run.level} to move up the trail.`);
  }

  message(text) {
    this.msg?.destroy();
    const s = Math.max(0.8, this.scr.ui);
    const t = makeText(this, this.scr.w / 2, this.area.bottom - 96 * s, text, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(17, 22 * s)), color: '#ffffff', align: 'center',
      backgroundColor: '#1E3A8A', padding: { x: 16, y: 10 }, wordWrap: { width: this.scr.w * 0.86 },
    }).setOrigin(0.5, 1).setDepth(130);
    this.msg = t;
    this.time.delayedCall(1700, () => { if (this.msg === t) { t.destroy(); this.msg = null; } });
  }

  // ---------- input: drag with inertia, wheel, tap a node ----------

  setupInput() {
    const onHud = (p) => this.input.hitTestPointer(p).length > 0;
    this.input.on('pointerdown', (p) => {
      if (onHud(p) || this.busy) return;
      this.drag = { y0: p.y, ly: p.y, t: this.time.now, moved: false };
      this.vel = 0;
    });
    this.input.on('pointermove', (p) => {
      const d = this.drag;
      if (!d || !p.isDown) return;
      if (!d.moved && Math.abs(p.y - d.y0) > 10) d.moved = true;
      if (d.moved) {
        const dy = p.y - d.ly;
        this.setScroll(this.scrollY - dy);
        const dt = Math.max(1, this.time.now - d.t);
        this.vel = this.vel * 0.5 + (-dy / dt) * 0.5;
      }
      d.ly = p.y;
      d.t = this.time.now;
    });
    const end = (p) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (!d.moved) { this.vel = 0; this.tapAt(p); } else if (this.time.now - d.t > 80) this.vel = 0;
    };
    this.input.on('pointerup', end);
    this.input.on('pointerupoutside', end);
    this.input.on('wheel', (_p, _o, _dx, dy) => { if (!this.busy) this.setScroll(this.scrollY + dy); });
  }

  update(_t, delta) {
    this.bakeNeighbour();
    if (this.drag || Math.abs(this.vel) < 0.01 || this.busy) return;
    const before = this.scrollY;
    this.setScroll(this.scrollY + this.vel * delta);
    this.vel *= Math.pow(0.92, delta / 16.7);
    if (this.scrollY === before) this.vel = 0;
  }

  tapAt(p) {
    if (!this.geo || this.busy) return;
    const wx = p.x / this.z;
    const wy = (p.y + this.scrollY) / this.z;
    const reach = Math.max(TRAIL.nodeR * 1.35, 26 / this.z);
    let hit = null;
    let bd = reach;
    for (const [level, node] of this.nodes) {
      const d = Math.hypot(wx - node.x, wy - (node.y - 4));
      if (d < bd) { bd = d; hit = level; }
    }
    if (hit == null) {
      this.closeCard();
      return;
    }
    playSound('tap');
    const state = this.stateOf(hit);
    if (state === 'current') this.play(hit, false);
    else if (state === 'done') this.openCard(hit);
    else this.lockedTap(hit);
  }
}

const toCssShade = (c) => `#${shade(c, -45).toString(16).padStart(6, '0')}`;
