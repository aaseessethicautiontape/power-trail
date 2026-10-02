import Phaser from 'phaser';
import dex from '../../shared/dex.json';
import { load, save } from '../save.js';
import { loadPokemon, pokemonKey } from '../assets.js';
import { popSparkles } from '../art/effects.js';
import { makeText, px, FONT_TITLE } from '../art/ui.js';
import { getScreen, safeRect, watchResize } from '../layout/screen.js';
import { displayName } from './UIScene.js';

const byId = new Map(dex.map((p) => [p.id, p]));

// Evolution (PRD 6.8): dark background, your Pokémon glows white and pulses faster and faster,
// swaps to the silhouette of the new form, then a flash reveals it. Tap to continue to the level.
// data: { run, from, to } (Pokédex ids).
export default class EvolutionScene extends Phaser.Scene {
  constructor() {
    super('EvolutionScene');
  }

  init(data) {
    this.run = data.run;
    this.from = data.from;
    this.to = data.to;
    this.reduce = !!load().settings.reduceMotion;
  }

  preload() {
    // Usually already cached: the level clear panel prefetches the next form.
    loadPokemon(this, [this.from, this.to]);
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b1023');
    this.phase = 'evolving';
    this.bg = this.add.graphics();
    this.halo = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.art = this.add.image(0, 0, pokemonKey(this.from)).setOrigin(0.5, 1);
    this.glow = this.add.image(0, 0, pokemonKey(this.from)).setOrigin(0.5, 1).setTintFill(0xffffff).setAlpha(0);
    const fromName = displayName(byId.get(this.from).name);
    const toName = displayName(byId.get(this.to).name);
    this.title = makeText(this, 0, 0, `What? ${fromName} is evolving!`, {
      fontFamily: FONT_TITLE, color: '#ffffff', stroke: '#1e1b4b', align: 'center',
    }).setOrigin(0.5);
    this.done = makeText(this, 0, 0, `${fromName} evolved into ${toName}!`, {
      fontFamily: FONT_TITLE, color: '#ffffff', stroke: '#7c2d12', align: 'center',
    }).setOrigin(0.5).setAlpha(0);
    this.tapText = makeText(this, 0, 0, 'Tap to continue', { fontStyle: '800', color: '#c7d2fe' }).setOrigin(0.5).setAlpha(0);
    this.flash = this.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0).setDepth(10);

    this.layout();
    watchResize(this, () => this.layout());
    this.play();

    this.input.on('pointerup', () => {
      if (this.phase === 'done') this.continue();
      else if (this.phase === 'evolving' && this.time.now - this.startedAt > 600) this.skip();
    });
  }

  // Art height scales with the screen; both forms share the same size.
  layout() {
    const scr = getScreen(this);
    const s = scr.ui;
    const area = safeRect(scr, 16);
    this.cx = area.cx;
    this.footY = area.cy + Math.min(area.height * 0.22, 170 * s);
    this.artH = Math.min(area.height * 0.42, area.width * 0.6, 320 * Math.max(0.8, s));
    for (const img of [this.art, this.glow]) {
      img.setPosition(this.cx, this.footY).setScale(this.artH / img.height);
    }
    this.bg.clear();
    const R = Math.hypot(scr.w, scr.h) / 2;
    for (let i = 10; i >= 1; i--) this.bg.fillStyle(0x312e81, 0.05 * (11 - i) * 0.6).fillCircle(this.cx, this.footY - this.artH / 2, (R * i) / 10);
    this.halo.clear();
    for (let i = 5; i >= 1; i--) this.halo.fillStyle(0xffffff, 0.08 * (6 - i)).fillCircle(this.cx, this.footY - this.artH / 2, this.artH * (0.35 + i * 0.1));
    const titleSize = Math.max(22, Math.min(40 * s, area.width / 14));
    this.title.setPosition(this.cx, area.top + Math.max(40, area.height * 0.12)).setFontSize(px(titleSize))
      .setStroke('#1e1b4b', 8 * Math.max(0.8, s)).setWordWrapWidth(area.width * 0.95, true);
    this.done.setPosition(this.cx, this.footY + Math.max(36, 56 * s)).setFontSize(px(titleSize))
      .setStroke('#7c2d12', 8 * Math.max(0.8, s)).setWordWrapWidth(area.width * 0.95, true);
    this.tapText.setPosition(this.cx, Math.min(area.bottom - 20 * s, this.done.y + this.done.height / 2 + 40 * s)).setFontSize(px(Math.max(16, 22 * s)));
    this.flash.setSize(scr.w, scr.h);
  }

  play() {
    this.startedAt = this.time.now;
    const art = this.art;
    const glow = this.glow;
    this.tweens.add({ targets: [art, glow], y: '-=6', duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.tweens.add({ targets: this.halo, alpha: 0.9, duration: 1200, delay: 300 });

    // Glow pulses, faster and faster. In the fast half the silhouette flickers between both forms.
    const pulses = this.reduce ? [400, 300, 200] : [520, 440, 360, 290, 230, 180, 140, 110, 90, 75, 65, 60, 60];
    let t = 500;
    pulses.forEach((d, i) => {
      this.time.delayedCall(t, () => {
        if (this.phase !== 'evolving') return;
        if (i >= pulses.length / 2) this.setForm(i % 2 ? this.to : this.from);
        this.tweens.add({ targets: glow, alpha: { from: 0.25, to: 1 }, duration: d / 2, yoyo: true });
        if (i > pulses.length / 2) art.setAlpha(0); // only the silhouette is left
      });
      t += d;
    });
    // Settle on the new form's silhouette, then flash and reveal.
    this.time.delayedCall(t, () => {
      if (this.phase !== 'evolving') return;
      this.setForm(this.to);
      art.setAlpha(0);
      glow.setAlpha(1);
      this.tweens.add({ targets: glow, scale: glow.scale * 1.06, duration: 260, yoyo: true });
    });
    this.time.delayedCall(t + 600, () => this.reveal());
  }

  setForm(id) {
    const key = pokemonKey(id);
    if (!this.textures.exists(key)) return;
    for (const img of [this.art, this.glow]) img.setTexture(key).setScale(this.artH / img.height);
  }

  skip() {
    this.time.removeAllEvents();
    this.reveal();
  }

  reveal() {
    if (this.phase !== 'evolving') return;
    this.phase = 'done';
    this.setForm(this.to);
    this.saveForm();
    this.flash.setAlpha(1);
    this.tweens.add({ targets: this.flash, alpha: 0, duration: 650, ease: 'Quad.Out' });
    this.art.setAlpha(1);
    this.glow.setAlpha(0);
    this.title.setAlpha(0);
    const cy = this.footY - this.artH / 2;
    popSparkles(this, this.cx, cy, this.reduce, { count: 22, tint: 0xfde047, spread: this.artH * 0.9 });
    popSparkles(this, this.cx, cy, this.reduce, { count: 12, tint: 0xffffff, spread: this.artH * 0.6 });
    this.tweens.add({ targets: this.done, alpha: 1, duration: 300, delay: 200 });
    this.tweens.add({ targets: this.tapText, alpha: { from: 0, to: 1 }, duration: 600, delay: 900, yoyo: true, repeat: -1, hold: 400 });
  }

  // The run remembers which form you've seen evolve, so this plays once per evolution.
  saveForm() {
    this.run.form = this.to;
    const data = load();
    if (data.run && data.run.runSeed === this.run.runSeed) {
      data.run = this.run;
      save(data);
    }
  }

  continue() {
    this.phase = 'leaving';
    this.scene.start('LevelScene', { run: this.run });
  }
}
