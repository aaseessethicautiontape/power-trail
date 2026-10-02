import Phaser from 'phaser';
import { LEVEL_TUNING } from '../../shared/config.js';
import { formatPower } from '../../shared/rules.js';
import { pokemonKey, itemKey } from '../assets.js';
import { paletteFor } from '../art/palettes.js';
import { getScreen, safeRect, watchResize } from '../layout/screen.js';
import {
  makeText, makeBadge, makeHearts, makeStars, makeRoundButton, makeDialog, makePanel, drawHeart, px, shade,
  FONT_TITLE, INK, BADGE, TYPE_COLOURS, COLOURS,
} from '../art/ui.js';

// "mr-mime" -> "Mr Mime"
export const displayName = (name) => name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// Runs on top of LevelScene and holds the HUD, loading overlay, intro banner, info card and
// panels (PRD 7.7). It has its own camera, so zooming the map never shrinks any of it.
export default class UIScene extends Phaser.Scene {
  constructor() {
    super('UIScene');
  }

  create(data) {
    this.level = data.level;
    this.run = data.run;
    this.power = data.level.startPower;
    this.root = null;
    this.dialog = null;
    this.dialogSpec = null; // rebuilt at the new size on resize
    this.info = null; // { data, root }
    this.loading = null; // { p, root }
    this.vignette = this.add.image(0, 0, this.vignetteTexture()).setOrigin(0).setDepth(-1);

    // LevelScene tells us when it's loading, how far along, and when the stops are ready.
    const lv = this.scene.get('LevelScene');
    const handlers = {
      'level-loading': (level) => { this.setLevel(level, this.run); this.showLoading(0); },
      'load-progress': (p) => this.showLoading(p),
      'level-ready': () => { this.hideLoading(); this.layout(); this.showIntro(); },
    };
    for (const [ev, fn] of Object.entries(handlers)) lv.events.on(ev, fn);
    this.events.once('shutdown', () => { for (const [ev, fn] of Object.entries(handlers)) lv.events.off(ev, fn); });

    this.layout();
    watchResize(this, () => this.layout(), { immediate: () => this.vignette.setDisplaySize(this.scale.width, this.scale.height) });
    if (lv.ready) handlers['level-ready']();
    else this.showLoading(0);
  }

  setLevel(level, run) {
    this.level = level;
    this.run = run;
    this.power = level.startPower;
    this.closeInfo();
    this.layout();
  }

  // While a panel or the info card is open (or images are loading) the map ignores input.
  blocksInput() {
    return !!(this.dialog || this.info || this.loading);
  }

  layout() {
    const scr = getScreen(this);
    const s = scr.ui;
    this.drawVignette(scr);
    if (this.root) {
      this.tweens.killTweensOf(this.root.getAll());
      this.root.destroy();
    }
    this.root = this.add.container(0, 0);
    const area = safeRect(scr, Math.max(10, 14 * s));
    const gap = Math.max(8, 12 * s);

    // Top left: power pill with the player's Pokémon icon.
    const pill = this.powerPill(s);
    pill.setPosition(area.left + pill.pw / 2, area.top + pill.ph / 2);

    // Top right: hearts.
    const hs = Math.max(24, 32 * s);
    const hearts = makeHearts(this, 0, 0, this.run.hearts, LEVEL_TUNING.lives, hs);
    hearts.setPosition(area.right - hearts.width / 2 - 4, area.top + pill.ph / 2);

    // Top centre: level name. On narrow screens it moves under the power pill.
    const name = this.levelName(s);
    const fitsCentre = name.nw / 2 + gap <= scr.w / 2 - (area.left + pill.pw)
      && name.nw / 2 + gap <= (area.right - hearts.width) - scr.w / 2;
    if (fitsCentre) name.setPosition(scr.w / 2, area.top + pill.ph / 2);
    else name.setPosition(area.left + name.nw / 2, area.top + pill.ph + gap + name.nh / 2);

    // Bottom right: pause.
    const size = Math.max(52, 64 * s);
    const pause = makeRoundButton(this, area.right - size / 2, area.bottom - size / 2, () => this.openPause(), size, (g, R) => {
      g.fillStyle(0xffffff, 1).fillRoundedRect(-R * 0.32, -R * 0.36, R * 0.22, R * 0.72, R * 0.08)
        .fillRoundedRect(R * 0.1, -R * 0.36, R * 0.22, R * 0.72, R * 0.08);
    });

    this.root.add([pill, name, hearts, pause]);
    Object.assign(this, { pill, hearts, heartSize: hs });

    // Overlays are rebuilt at the new size.
    if (this.loading) this.showLoading(this.loading.p);
    if (this.info) this.showInfo(this.info.data, false);
    if (this.dialog) {
      this.dialog.root.destroy();
      this.openDialog(this.dialogSpec, false);
    }
  }

  powerPill(s) {
    const ph = Math.max(48, 64 * s);
    const icon = ph * 0.86;
    const badge = makeBadge(this, this.power, 'player', { fontSize: 34, scale: Math.max(0.8, s) });
    const pw = icon + badge.width + ph * 0.45;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18).fillRoundedRect(-pw / 2 + 2, -ph / 2 + 4, pw, ph, ph / 2);
    g.fillStyle(0x1e3a8a, 1).fillRoundedRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    g.fillStyle(0xffffff, 0.95).fillRoundedRect(-pw / 2 + 3, -ph / 2 + 3, pw - 6, ph - 6, (ph - 6) / 2);
    g.fillStyle(0xdbeafe, 1).fillCircle(-pw / 2 + ph / 2, 0, icon / 2);
    g.lineStyle(3, BADGE.player, 1).strokeCircle(-pw / 2 + ph / 2, 0, icon / 2);
    const parts = [g];
    // The art is loaded by LevelScene with the rest of the level's images.
    const key = pokemonKey(this.level.form.id);
    if (this.textures.exists(key)) {
      const img = this.add.image(-pw / 2 + ph / 2, 0, key);
      img.setScale((icon * 0.95) / img.height);
      parts.push(img);
    }
    badge.setPosition(-pw / 2 + icon + ph * 0.1 + badge.width / 2, 0);
    parts.push(badge);
    const c = this.add.container(0, 0, parts);
    Object.assign(c, { pw, ph, badge });
    return c;
  }

  levelName(s) {
    const font = Math.max(16, 24 * s);
    const t = makeText(this, 0, 0, `Level ${this.level.level} · ${this.level.biomeLabel}`, {
      fontFamily: FONT_TITLE, fontSize: px(font), color: '#ffffff', stroke: '#1E3A8A', strokeThickness: Math.max(4, 6 * s),
    }).setOrigin(0.5);
    const nw = t.width + font * 1.4;
    const nh = font * 1.7;
    const g = this.add.graphics();
    g.fillStyle(0x1e3a8a, 0.35).fillRoundedRect(-nw / 2, -nh / 2, nw, nh, nh / 2);
    const c = this.add.container(0, 0, [g, t]);
    Object.assign(c, { nw, nh });
    return c;
  }

  openPause() {
    if (this.dialog) return;
    this.openDialog({
      title: 'Paused',
      width: 460,
      buttons: [
        { label: 'Resume', colour: 'main', onClick: (close) => close() },
        { label: 'Quit to title', colour: 'secondary', onClick: () => this.scene.get('LevelScene').scene.start('TitleScene') },
      ],
    });
  }

  openDialog(spec, animate = true) {
    this.dialogSpec = spec;
    this.dialog = makeDialog(this, spec, { animate, onClose: () => { this.dialog = null; this.dialogSpec = null; } });
  }

  // ---------- power ----------

  // During a count-up only the number changes; at the end the pill is rebuilt (it may be wider) and bounces.
  setPowerDisplay(v, bounce) {
    this.power = v;
    if (!bounce) {
      this.pill?.badge.setValue(v);
      return;
    }
    this.layout();
    this.tweens.add({ targets: this.pill.badge, scale: bounce, duration: 120, yoyo: true, ease: 'Quad.Out' });
  }

  // Item card flies up (art, name, stars, +value), then shrinks into the power pill.
  showItemCard(stop) {
    const scr = getScreen(this);
    const s = Math.max(0.8, scr.ui);
    const w = 230 * s;
    const h = 210 * s;
    const card = makePanel(this, scr.w / 2, scr.h * 0.55, w, h, { scale: s });
    const key = itemKey(stop.sprite);
    if (this.textures.exists(key)) card.add(this.add.image(0, -h * 0.25, key).setScale(2.4 * s));
    card.add(makeText(this, 0, h * 0.02, stop.label, { fontFamily: FONT_TITLE, fontSize: px(24 * s), color: INK }).setOrigin(0.5));
    card.add(makeStars(this, 0, h * 0.18, stop.stars, 3, 20 * s));
    card.add(makeBadge(this, stop.value, 'item', { prefix: '+', fontSize: 32, scale: s, y: h * 0.36 }));
    card.setDepth(85).setAlpha(0).setScale(0.7);
    const target = this.pill ? { x: this.pill.x, y: this.pill.y } : { x: 40, y: 40 };
    this.tweens.chain({
      targets: card,
      tweens: [
        { y: scr.h * 0.42, alpha: 1, scale: 1, duration: 220, ease: 'Back.Out' },
        { y: scr.h * 0.42, duration: 380 },
        { x: target.x, y: target.y, scale: 0.15, alpha: 0.2, duration: 300, ease: 'Quad.In', onComplete: () => card.destroy() },
      ],
    });
  }

  // ---------- fainting: red flash, banner, a heart cracks off, then Try again / Quit ----------

  faintSequence(heartsLeft, { retry, quit, newRun }) {
    const scr = getScreen(this);
    const flash = this.add.rectangle(0, 0, scr.w, scr.h, 0xef4444, 0).setOrigin(0).setDepth(85);
    this.tweens.add({ targets: flash, alpha: 0.45, duration: 120, yoyo: true, hold: 60, onComplete: () => flash.destroy() });
    this.crackHeart(heartsLeft);
    this.showBanner('You fainted!', 0xdc2626, { hold: 800 });
    this.time.delayedCall(1350, () => {
      if (heartsLeft > 0) {
        this.openDialog({
          title: 'You fainted!',
          message: `${heartsLeft} ${heartsLeft === 1 ? 'heart' : 'hearts'} left. Try the level again from the start?`,
          width: 520,
          buttons: [
            { label: 'Try again', colour: 'main', onClick: retry },
            { label: 'Quit to title', colour: 'secondary', onClick: quit },
          ],
        });
      } else {
        this.openDialog({
          title: 'Out of hearts!',
          message: `Your run ended on level ${this.level.level}.`,
          width: 520,
          buttons: [
            { label: 'New run', colour: 'main', onClick: newRun },
            { label: 'Quit to title', colour: 'secondary', onClick: quit },
          ],
        });
      }
    });
  }

  // The heart that was just lost cracks and falls off the HUD.
  crackHeart(heartsLeft) {
    const hearts = this.hearts;
    if (!hearts) return;
    const max = LEVEL_TUNING.lives;
    const size = this.heartSize;
    const gap = size * 1.25;
    hearts.setCount(heartsLeft + 1);
    const x = hearts.x + (heartsLeft - (max - 1) / 2) * gap;
    const y = hearts.y;
    const g = this.add.graphics().setDepth(86).setPosition(x, y);
    drawHeart(g, 0, 0, size, true);
    g.lineStyle(Math.max(2, size * 0.08), 0x7f1d1d, 1).beginPath()
      .moveTo(-size * 0.05, -size * 0.3).lineTo(size * 0.08, -size * 0.12).lineTo(-size * 0.06, size * 0.04).lineTo(size * 0.06, size * 0.22).strokePath();
    this.time.delayedCall(140, () => hearts.setCount(heartsLeft));
    this.tweens.chain({
      targets: g,
      tweens: [
        { x: x + 3, duration: 40, yoyo: true, repeat: 3 },
        { y: y + 120, angle: 50, alpha: 0, duration: 650, ease: 'Quad.In', onComplete: () => g.destroy() },
      ],
    });
  }

  showBanner(text, colour, { hold = 700 } = {}) {
    const scr = getScreen(this);
    const s = Math.max(0.8, scr.ui);
    const t = makeText(this, 0, 0, text, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(30, 48 * s)), color: '#ffffff', stroke: '#450a0a', strokeThickness: 10 * s,
    }).setOrigin(0.5);
    const bw = Math.min(scr.w * 0.92, t.width + 80 * s);
    if (t.width > bw - 40) t.setScale((bw - 40) / t.width);
    const bh = 96 * s;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-bw / 2 + 4, -bh / 2 + 8, bw, bh, bh / 2);
    g.fillStyle(shade(colour, -25), 1).fillRoundedRect(-bw / 2, -bh / 2 + 5, bw, bh, bh / 2);
    g.fillStyle(colour, 1).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    const banner = this.add.container(scr.w / 2, scr.h * 0.4, [g, t]).setDepth(87).setScale(0.4).setAlpha(0);
    this.tweens.chain({
      targets: banner,
      tweens: [
        { scale: 1, alpha: 1, duration: 220, ease: 'Back.Out' },
        { scale: 1, duration: hold },
        { alpha: 0, y: banner.y - 30, duration: 220, onComplete: () => banner.destroy() },
      ],
    });
  }

  // Minimal level clear (the full panel from PRD 6.6 comes later).
  clearedPanel({ level, stars, power, best, verified, next, quit }) {
    this.showBanner(`Level ${level} cleared!`, 0x16a34a, { hold: 600 });
    this.time.delayedCall(1000, () => this.openDialog({
      title: `Level ${level} cleared!`,
      stars,
      message: `Power ${formatPower(power)} · Best possible ${formatPower(best)}${verified ? '' : '\n(this run would not pass the check)'}`,
      width: 540,
      buttons: [
        { label: 'Next level', colour: 'main', onClick: next },
        { label: 'Quit to title', colour: 'secondary', onClick: quit },
      ],
    }));
  }

  // ---------- loading overlay ----------

  showLoading(p) {
    this.loading?.root.destroy();
    const scr = getScreen(this);
    const s = scr.ui;
    const root = this.add.container(0, 0).setDepth(90);
    const dim = this.add.rectangle(0, 0, scr.w, scr.h, 0x0b1630, 0.35).setOrigin(0);
    const pw = Math.min(360 * s, scr.w * 0.8);
    const ph = 110 * Math.max(0.8, s);
    const panel = makePanel(this, scr.w / 2, scr.h / 2, pw, ph, { scale: s });
    const label = makeText(this, 0, -ph * 0.18, 'Loading Pokémon…', {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(18, 26 * s)), color: INK,
    }).setOrigin(0.5);
    const bw = pw * 0.75;
    const bh = Math.max(12, 16 * s);
    const bar = this.add.graphics();
    bar.fillStyle(0xe6cfa6, 1).fillRoundedRect(-bw / 2, ph * 0.18 - bh / 2, bw, bh, bh / 2);
    bar.fillStyle(COLOURS.main, 1).fillRoundedRect(-bw / 2, ph * 0.18 - bh / 2, Math.max(bh, bw * p), bh, bh / 2);
    panel.add([label, bar]);
    root.add([dim, panel]);
    this.loading = { p, root };
  }

  hideLoading() {
    if (!this.loading) return;
    const { root } = this.loading;
    this.loading = null;
    this.tweens.add({ targets: root, alpha: 0, duration: 150, onComplete: () => root.destroy() });
  }

  // ---------- intro banner (PRD 6.3): slides in, 1.2s total, then the map is playable ----------

  showIntro() {
    const scr = getScreen(this);
    const s = Math.max(0.8, scr.ui);
    const pal = paletteFor(this.level.biome);
    const bh = 88 * s;
    const icon = bh * 0.8;
    const text = makeText(this, 0, 0, `Level ${this.level.level} · ${this.level.biomeLabel}`, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(22, 36 * s)), color: '#ffffff', stroke: '#1E293B', strokeThickness: 8 * s,
    }).setOrigin(0, 0.5);
    const maxW = scr.w * 0.94;
    const bw = Math.min(maxW, icon + text.width + bh * 0.7);
    if (icon + text.width + bh * 0.7 > maxW) text.setScale((maxW - icon - bh * 0.7) / text.width);
    const colour = shade(pal.cliff, -10);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-bw / 2 + 4, -bh / 2 + 8, bw, bh, bh / 2);
    g.fillStyle(shade(colour, -25), 1).fillRoundedRect(-bw / 2, -bh / 2 + 5, bw, bh, bh / 2);
    g.fillStyle(colour, 1).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    g.fillStyle(0xffffff, 0.18).fillRoundedRect(-bw / 2 + 10, -bh / 2 + 6, bw - 20, bh * 0.35, bh * 0.2);
    const iconG = this.add.graphics();
    drawBiomeIcon(iconG, pal.key, icon / 2);
    iconG.setPosition(-bw / 2 + bh * 0.15 + icon / 2, 0);
    text.setPosition(-bw / 2 + bh * 0.3 + icon, 0);
    const banner = this.add.container(-bw, scr.h * 0.42, [g, iconG, text]).setDepth(80);
    const done = () => {
      banner.destroy();
      this.scene.get('LevelScene').onIntroDone?.();
    };
    this.tweens.chain({
      targets: banner,
      tweens: [
        { x: scr.w / 2, duration: 300, ease: 'Back.Out' },
        { x: scr.w / 2, duration: 600 },
        { x: scr.w + bw, duration: 300, ease: 'Quad.In', onComplete: done },
      ],
    });
  }

  // ---------- info card (hold 0.5s on a Pokémon) ----------

  showInfo(info, animate = true) {
    this.info?.root.destroy();
    const scr = getScreen(this);
    const s = scr.ui;
    const area = safeRect(scr, 12);
    const cw = Math.min(480 * s, scr.w * 0.92);
    const stacked = cw < 420;
    const pad = Math.max(16, 22 * s);
    const artSize = stacked ? Math.min(140 * s, cw * 0.45) : 150 * s;
    const textW = stacked ? cw - pad * 2 : cw - artSize - pad * 3;

    const root = this.add.container(0, 0).setDepth(95);
    const dim = this.add.rectangle(0, 0, scr.w, scr.h, 0x0b1630, 0.3).setOrigin(0)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, 10000, 10000), Phaser.Geom.Rectangle.Contains);
    // Close on the next press: the release of the hold that opened the card must not close it.
    dim.on('pointerdown', () => this.closeInfo());
    root.add(dim);

    const items = [];
    const name = makeText(this, 0, 0, displayName(info.name), { fontFamily: FONT_TITLE, fontSize: px(Math.max(24, 36 * s)), color: INK });
    if (name.width > textW) name.setScale(textW / name.width);
    items.push(name);

    // Type pills (and an Alpha / You tag).
    const pills = this.add.container(0, 0);
    let px_ = 0;
    const pillFont = Math.max(12, 15 * s);
    const tags = [...info.types.map((t) => [t.toUpperCase(), TYPE_COLOURS[t] ?? 0x888888])];
    if (info.alpha > 1) tags.push([`ALPHA ×${info.alpha}`, 0xdc2626]);
    if (info.you) tags.push(['YOU', BADGE.player]);
    for (const [label, colour] of tags) {
      const t = makeText(this, 0, 0, label, { fontStyle: '900', fontSize: px(pillFont), color: '#ffffff' }).setOrigin(0, 0.5);
      const w = t.width + pillFont * 1.3;
      const h = pillFont * 1.8;
      const bg = this.add.graphics().fillStyle(colour, 1).fillRoundedRect(px_, -h / 2, w, h, h / 2);
      t.setPosition(px_ + pillFont * 0.65, 0);
      pills.add([bg, t]);
      px_ += w + 6;
    }
    pills.height_ = pillFont * 1.8;
    items.push(pills);

    // The power maths: "Bulbasaur 318 × Level 1 × Alpha 14 = 4,452"
    const maths = `${displayName(info.name)} ${formatPower(info.base)} × Level ${info.level}`
      + `${info.alpha > 1 ? ` × Alpha ${info.alpha}` : ''} = ${formatPower(info.power)}`;
    const m = makeText(this, 0, 0, maths, {
      fontStyle: '800', fontSize: px(Math.max(15, 19 * s)), color: '#6B5745', wordWrap: { width: textW, useAdvancedWrap: true },
    });
    items.push(m);
    const hint = makeText(this, 0, 0, 'Tap anywhere to close', { fontStyle: '700', fontSize: px(Math.max(12, 13 * s)), color: '#A08A74' });
    items.push(hint);

    const gap = Math.max(8, 10 * s);
    const heightOf = (o) => o.height_ ?? o.displayHeight;
    const textH = items.reduce((sum, o) => sum + heightOf(o), 0) + gap * (items.length - 1);
    const ch = stacked ? pad * 2 + artSize + gap + textH : pad * 2 + Math.max(artSize, textH);
    const panel = makePanel(this, area.cx, area.cy, cw, ch, { scale: s });

    // Art on a soft circle.
    const ax = stacked ? 0 : -cw / 2 + pad + artSize / 2;
    const ay = -ch / 2 + pad + artSize / 2;
    const disc = this.add.graphics().fillStyle(TYPE_COLOURS[info.types[0]] ?? 0xdddddd, 0.3).fillCircle(ax, ay, artSize / 2);
    panel.add(disc);
    const key = pokemonKey(info.id);
    if (this.textures.exists(key)) {
      const img = this.add.image(ax, ay, key);
      img.setScale((artSize * 0.95) / img.height);
      panel.add(img);
    }
    let y = stacked ? ay + artSize / 2 + gap : -ch / 2 + pad + Math.max(0, (artSize - textH) / 2);
    const x = stacked ? -textW / 2 : -cw / 2 + pad * 2 + artSize;
    for (const o of items) {
      if (o === pills) o.setPosition(x, y + o.height_ / 2);
      else o.setPosition(x, y);
      panel.add(o);
      y += heightOf(o) + gap;
    }
    root.add(panel);
    if (animate) {
      panel.setScale(0.85).setAlpha(0);
      this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
    }
    this.info = { data: info, root };
  }

  closeInfo() {
    if (!this.info) return;
    const { root } = this.info;
    this.info = null;
    this.tweens.killTweensOf(root.list);
    root.destroy();
  }

  // ---------- soft vignette over the map, drawn in screen space ----------

  vignetteTexture() {
    if (!this.textures.exists('ui-vignette')) this.textures.createCanvas('ui-vignette', 4, 4);
    return 'ui-vignette';
  }

  drawVignette({ w, h }) {
    // Drawn at a quarter size and stretched: it's a soft gradient, so that's plenty.
    const tw = Math.max(4, Math.ceil(w / 4));
    const th = Math.max(4, Math.ceil(h / 4));
    const tex = this.textures.get('ui-vignette');
    tex.setSize(tw, th);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, tw, th);
    const r = Math.hypot(tw, th) / 2;
    const grad = ctx.createRadialGradient(tw / 2, th / 2, r * 0.55, tw / 2, th / 2, r);
    const [rgb, edge] = paletteFor(this.level.biome).vignette; // darker for Haunted Ruins and Volcano
    grad.addColorStop(0, `rgba(${rgb},0)`);
    grad.addColorStop(1, `rgba(${rgb},${edge})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tw, th);
    tex.refresh();
    this.vignette.setTexture('ui-vignette').setDisplaySize(w, h);
  }
}

// Small round icon for each biome, drawn in code, centred on (0,0) with radius R.
function drawBiomeIcon(g, key, R) {
  g.fillStyle(0xffffff, 1).fillCircle(0, 0, R);
  g.fillStyle(0x000000, 0.08).fillCircle(0, R * 0.08, R * 0.92);
  g.fillStyle(0xffffff, 1).fillCircle(0, 0, R * 0.9);
  const r = R * 0.55;
  const V = (x, y) => new Phaser.Math.Vector2(x, y);
  switch (key) {
    case 'meadow':
      g.fillStyle(0xfacc15, 1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillTriangle(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25, Math.cos(a + 0.25) * r * 0.75, Math.sin(a + 0.25) * r * 0.75, Math.cos(a - 0.25) * r * 0.75, Math.sin(a - 0.25) * r * 0.75);
      }
      g.fillStyle(0xfb923c, 1).fillCircle(0, 0, r * 0.7);
      break;
    case 'beach':
      g.fillStyle(0x2ec4e8, 1).fillRect(-r * 1.2, r * 0.1, r * 2.4, r * 0.8);
      g.lineStyle(R * 0.1, 0xffffff, 1).beginPath().arc(-r * 0.5, r * 0.4, r * 0.35, Math.PI, 0).arc(r * 0.2, r * 0.4, r * 0.35, Math.PI, 0).strokePath();
      g.fillStyle(0xfacc15, 1).fillCircle(r * 0.4, -r * 0.45, r * 0.45);
      break;
    case 'forest':
      g.fillStyle(0x2f6b33, 1).fillTriangle(-r, r * 0.6, r, r * 0.6, 0, -r * 0.3);
      g.fillTriangle(-r * 0.75, r * 0.05, r * 0.75, r * 0.05, 0, -r * 1.1);
      g.fillStyle(0x6b4423, 1).fillRect(-r * 0.12, r * 0.6, r * 0.24, r * 0.45);
      break;
    case 'desert':
      g.fillStyle(0x3f7d3a, 1).fillRoundedRect(-r * 0.2, -r, r * 0.4, r * 1.9, r * 0.2)
        .fillRoundedRect(-r * 0.8, -r * 0.4, r * 0.3, r * 0.8, r * 0.15).fillRoundedRect(-r * 0.8, r * 0.15, r * 0.7, r * 0.3, r * 0.15)
        .fillRoundedRect(r * 0.5, -r * 0.7, r * 0.3, r * 0.8, r * 0.15).fillRoundedRect(r * 0.1, -r * 0.1, r * 0.7, r * 0.3, r * 0.15);
      break;
    case 'snow':
      g.lineStyle(R * 0.12, 0x60a5fa, 1);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        g.lineBetween(Math.cos(a) * r, Math.sin(a) * r, -Math.cos(a) * r, -Math.sin(a) * r);
      }
      g.fillStyle(0x60a5fa, 1).fillCircle(0, 0, r * 0.18);
      break;
    case 'volcano':
      g.fillStyle(0x4a3b40, 1).fillPoints([V(-r * 1.1, r * 0.8), V(-r * 0.3, -r * 0.4), V(r * 0.3, -r * 0.4), V(r * 1.1, r * 0.8)], true);
      g.fillStyle(0xff7a2f, 1).fillTriangle(-r * 0.3, -r * 0.4, r * 0.3, -r * 0.4, 0, r * 0.3);
      g.fillStyle(0xffc15a, 1).fillCircle(-r * 0.2, -r * 0.8, r * 0.22).fillCircle(r * 0.25, -r * 1, r * 0.18);
      break;
    case 'haunted':
      g.fillStyle(0xa78bfa, 1).fillCircle(0, -r * 0.2, r * 0.75).fillRect(-r * 0.75, -r * 0.2, r * 1.5, r * 0.9);
      for (let i = 0; i < 3; i++) g.fillStyle(0xffffff, 1).fillCircle(-r * 0.5 + i * r * 0.5, r * 0.72, r * 0.25);
      g.fillStyle(0x2a2038, 1).fillCircle(-r * 0.28, -r * 0.25, r * 0.13).fillCircle(r * 0.28, -r * 0.25, r * 0.13);
      break;
    default: // sky
      g.fillStyle(0x8ec9ff, 1).fillCircle(-r * 0.5, r * 0.15, r * 0.45).fillCircle(0, -r * 0.2, r * 0.6).fillCircle(r * 0.55, r * 0.15, r * 0.45)
        .fillRect(-r * 0.5, r * 0.15, r * 1.05, r * 0.45);
      g.fillStyle(0xffd86b, 1).fillCircle(r * 0.75, -r * 0.65, r * 0.25);
  }
}
