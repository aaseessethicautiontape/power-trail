import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import TitleScene from './scenes/TitleScene.js';
import LevelScene from './scenes/LevelScene.js';
import UIScene from './scenes/UIScene.js';
import EvolutionScene from './scenes/EvolutionScene.js';
import DexScene from './scenes/DexScene.js';

// Scale.RESIZE: the canvas is always exactly the window size (PRD 7.7).
// Scenes place everything themselves in layout() from src/layout/screen.js.
const config = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#8EC9FF',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  input: { activePointers: 2 }, // pinch zoom needs two pointers
  scene: [BootScene, TitleScene, LevelScene, UIScene, EvolutionScene, DexScene],
};

// Text drawn before the font arrives would bake in the fallback font, so wait for it.
async function start() {
  try {
    await Promise.all([
      document.fonts.load('40px "Lilita One"'),
      document.fonts.load('20px "Nunito"'),
      document.fonts.load('900 20px "Nunito"'),
    ]);
  } catch (err) {
    console.warn('Fonts failed to load, using fallbacks', err);
  }
  window.game = new Phaser.Game(config);
}

// The page itself must never scroll or zoom: block browser pinch-zoom (ctrl+wheel on
// trackpads, gesture events on iOS Safari). Phaser handles the canvas's own input.
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault());

start();
