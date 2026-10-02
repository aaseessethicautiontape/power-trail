import Phaser from 'phaser';
import { STARTERS, ITEMS, LUCKY_EGG } from '../../shared/config.js';
import { loadPokemon, loadItems } from '../assets.js';
import { getScreen, watchResize } from '../layout/screen.js';
import { makeText, px, FONT_TITLE, COLOURS } from '../art/ui.js';

// Fonts are already loaded by main.js. Shows a loading bar while the
// starters' art and the item art load (PRD 6.1), then opens the title.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    this.progress = 0;
    this.title = makeText(this, 0, 0, 'POWER TRAIL', {
      fontFamily: FONT_TITLE, color: '#ffffff', stroke: '#1E3A8A',
    }).setOrigin(0.5);
    this.label = makeText(this, 0, 0, 'Loading…', { fontStyle: '700', color: '#1E3A8A' }).setOrigin(0.5);
    this.track = this.add.graphics();
    this.bar = this.add.graphics();
    this.layout();
    watchResize(this, () => this.layout());

    // Fallback retries add files mid-load, which can make progress dip. Never move backwards.
    this.load.on('progress', (p) => {
      this.progress = Math.max(this.progress, p);
      this.drawBar();
    });

    loadPokemon(this, Object.values(STARTERS).map((s) => s.forms[0].id));
    loadItems(this, [...ITEMS.map((i) => i.sprite), LUCKY_EGG.sprite]);
  }

  layout() {
    const { w, h, ui } = getScreen(this);
    const s = ui;
    this.geo = { cx: w / 2, y: h / 2 + 40 * s, barW: Math.min(520 * s, w * 0.8), barH: Math.max(18, 30 * s) };
    const { cx, y, barW, barH } = this.geo;
    this.title.setPosition(cx, h / 2 - 60 * s)
      .setFontSize(px(Math.min(64 * s, (w * 0.9) / 6.5))).setStroke('#1E3A8A', Math.max(6, 10 * s));
    this.label.setPosition(cx, y + barH / 2 + 26 * s).setFontSize(px(Math.max(15, 20 * s)));
    this.track.clear()
      .fillStyle(0x1e3a8a, 0.25).fillRoundedRect(cx - barW / 2 - 6, y - barH / 2 - 6, barW + 12, barH + 12, (barH + 12) / 2)
      .fillStyle(0xffffff, 1).fillRoundedRect(cx - barW / 2, y - barH / 2, barW, barH, barH / 2);
    this.drawBar();
  }

  drawBar() {
    const { cx, y, barW, barH } = this.geo;
    const w = Math.max(barH, barW * this.progress);
    this.bar.clear()
      .fillStyle(COLOURS.main, 1).fillRoundedRect(cx - barW / 2, y - barH / 2, w, barH, barH / 2)
      .fillStyle(0xffffff, 0.35).fillRoundedRect(cx - barW / 2 + 6, y - barH / 2 + 4, w - 12, barH * 0.3, barH * 0.15);
    this.label.setText(`Loading… ${Math.round(this.progress * 100)}%`);
  }

  create() {
    this.scene.start('TitleScene');
  }
}
