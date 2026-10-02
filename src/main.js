import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import TitleScene from './scenes/TitleScene.js';
import LevelScene from './scenes/LevelScene.js';
import EvolutionScene from './scenes/EvolutionScene.js';
import DexScene from './scenes/DexScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 1280,
  height: 720,
  backgroundColor: '#8EC9FF',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, TitleScene, LevelScene, EvolutionScene, DexScene],
};

// Text drawn before the font arrives would bake in the fallback font, so wait for it.
async function start() {
  try {
    await Promise.all([
      document.fonts.load('40px "Lilita One"'),
      document.fonts.load('20px "Nunito"'),
    ]);
  } catch (err) {
    console.warn('Fonts failed to load, using fallbacks', err);
  }
  window.game = new Phaser.Game(config);
}

start();
