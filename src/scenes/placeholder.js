import Phaser from 'phaser';
import { getScreen, safeRect, watchResize } from '../layout/screen.js';
import { makeText, px, FONT_TITLE } from '../art/ui.js';

// Temporary scene that just shows its own name. Tap to go back to the title.
// Replaced phase by phase.
export function placeholderScene(key) {
  return class extends Phaser.Scene {
    constructor() {
      super(key);
    }

    create(data) {
      this.name_ = makeText(this, 0, 0, key, { fontFamily: FONT_TITLE, color: '#ffffff', stroke: '#1E3A8A' }).setOrigin(0.5);
      const run = data?.run;
      this.info = run && makeText(this, 0, 0, `${run.starter} · level ${run.level} · ${run.hearts} hearts · seed ${run.runSeed}`, {
        fontStyle: '700', color: '#1E3A8A', align: 'center',
      }).setOrigin(0.5);
      this.back = makeText(this, 0, 0, 'Tap to go back', { fontStyle: '700', color: '#1E3A8A' }).setOrigin(0.5);
      this.layout();
      watchResize(this, () => this.layout());
      this.input.once('pointerup', () => this.scene.start('TitleScene'));
    }

    layout() {
      const scr = getScreen(this);
      const s = scr.ui;
      const area = safeRect(scr, 16);
      this.name_.setPosition(area.cx, area.cy).setFontSize(px(Math.min(72 * s, area.width / 7))).setStroke('#1E3A8A', 10 * s);
      this.info?.setPosition(area.cx, area.cy + 70 * s).setFontSize(px(Math.max(14, 20 * s)))
        .setWordWrapWidth(area.width, true);
      this.back.setPosition(area.cx, area.bottom - 30 * s).setFontSize(px(Math.max(15, 20 * s)));
    }
  };
}
