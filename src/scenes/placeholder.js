import Phaser from 'phaser';
import { makeText, FONT_TITLE } from '../art/ui.js';

// Temporary scene that just shows its own name. Tap to go back to the title.
// Replaced phase by phase.
export function placeholderScene(key) {
  return class extends Phaser.Scene {
    constructor() {
      super(key);
    }

    create(data) {
      const { width, height } = this.scale;
      makeText(this, width / 2, height / 2, key, {
        fontFamily: FONT_TITLE, fontSize: '72px', color: '#ffffff', stroke: '#1E3A8A', strokeThickness: 10,
      }).setOrigin(0.5);
      if (data?.run) {
        const { starter, level, hearts, runSeed } = data.run;
        makeText(this, width / 2, height / 2 + 70, `${starter} · level ${level} · ${hearts} hearts · seed ${runSeed}`, {
          fontStyle: '700', color: '#1E3A8A',
        }).setOrigin(0.5);
      }
      makeText(this, width / 2, height - 60, 'Tap to go back', { fontStyle: '700', color: '#1E3A8A' }).setOrigin(0.5);
      this.input.once('pointerup', () => this.scene.start('TitleScene'));
    }
  };
}
