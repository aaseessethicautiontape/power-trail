import Phaser from 'phaser';
import { STARTERS, ITEMS, LUCKY_EGG } from '../../shared/config.js';
import { loadPokemon, loadItems } from '../assets.js';
import { makeText, FONT_TITLE, COLOURS } from '../art/ui.js';

// Fonts are already loaded by main.js. Shows a loading bar while the
// starters' art and the item art load (PRD 6.1), then opens the title.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    const { width, height } = this.scale;
    const barW = 520;
    const barH = 30;
    const y = height / 2 + 40;

    makeText(this, width / 2, height / 2 - 60, 'POWER TRAIL', {
      fontFamily: FONT_TITLE, fontSize: '64px', color: '#ffffff', stroke: '#1E3A8A', strokeThickness: 10,
    }).setOrigin(0.5);
    const label = makeText(this, width / 2, y + 44, 'Loading…', {
      fontStyle: '700', fontSize: '20px', color: '#1E3A8A',
    }).setOrigin(0.5);

    const track = this.add.graphics();
    track.fillStyle(0x1e3a8a, 0.25).fillRoundedRect(width / 2 - barW / 2 - 6, y - barH / 2 - 6, barW + 12, barH + 12, (barH + 12) / 2);
    track.fillStyle(0xffffff, 1).fillRoundedRect(width / 2 - barW / 2, y - barH / 2, barW, barH, barH / 2);
    const bar = this.add.graphics();

    // Fallback retries add files mid-load, which can make progress dip. Never move backwards.
    let shown = 0;
    this.load.on('progress', (p) => {
      shown = Math.max(shown, p);
      const w = Math.max(barH, barW * shown);
      bar.clear();
      bar.fillStyle(COLOURS.main, 1).fillRoundedRect(width / 2 - barW / 2, y - barH / 2, w, barH, barH / 2);
      bar.fillStyle(0xffffff, 0.35).fillRoundedRect(width / 2 - barW / 2 + 6, y - barH / 2 + 4, w - 12, barH * 0.3, barH * 0.15);
      label.setText(`Loading… ${Math.round(shown * 100)}%`);
    });

    loadPokemon(this, Object.values(STARTERS).map((s) => s.forms[0].id));
    loadItems(this, [...ITEMS.map((i) => i.sprite), LUCKY_EGG.sprite]);
  }

  create() {
    this.scene.start('TitleScene');
  }
}
