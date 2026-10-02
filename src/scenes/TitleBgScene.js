import Phaser from 'phaser';
import dex from '../../shared/dex.json';
import { generateLevel } from '../../shared/level.js';
import { allStops } from '../../shared/rules.js';
import { buildLayout } from '../art/layout.js';
import { renderMap } from '../art/biomeRenderer.js';
import { paletteFor } from '../art/palettes.js';
import { loadPokemon, pokemonKey } from '../assets.js';
import { getScreen, watchResize } from '../layout/screen.js';

const IDLE = 6; // idle Pokémon on the title map

// Title background (PRD 6.2): a slow pan across a real Sunny Meadow map built by the biome
// renderer, with a few idle Pokémon. Runs underneath TitleScene, which draws the UI on top.
export default class TitleBgScene extends Phaser.Scene {
  constructor() {
    super('TitleBgScene');
  }

  create() {
    this.level = generateLevel({ dex, level: 1, starter: 'pikachu', runSeed: 'title' });
    this.mode = null;
    this.map = null;
    this.idle = [];
    // The wild Pokémon of the first two zones stand around the map.
    this.idleStops = allStops(this.level).filter((s) => s.kind === 'wild' && s.zone < 2).slice(0, IDLE);
    loadPokemon(this, this.idleStops.map((s) => s.pokemon.id));
    this.load.once('complete', () => this.placeIdle());
    this.load.start();
    this.build();
    watchResize(this, () => this.build());
    this.events.once('shutdown', () => this.map?.destroy());
  }

  // Rebuilds the map when the orientation changes; otherwise just refits the camera.
  build() {
    const scr = getScreen(this);
    const mode = scr.portrait ? 'tall' : 'wide';
    if (mode !== this.mode) {
      this.mode = mode;
      this.map?.destroy();
      this.L = buildLayout(this.level, mode);
      this.map = renderMap(this, this.level, this.L, { compact: scr.compact });
      this.map.rt.setDepth(0);
      this.map.shimmer.setDepth(1);
      this.map.particles.setDepth(50);
      this.cameras.main.setBackgroundColor(paletteFor(this.level.biome).ground[1]);
      this.placeIdle();
    }
    // Cover the screen with the map's width, then pan slowly up and down its height.
    const cam = this.cameras.main;
    cam.setZoom(Math.max(scr.w / this.L.W, scr.h / (this.L.H * 0.6)) * 1.05);
    cam.setBounds(0, 0, this.L.W, this.L.H);
    const viewH = scr.h / cam.zoom;
    const travel = Math.max(0, this.L.H - viewH);
    this.tweens.killTweensOf(cam);
    const o = this.panState ?? (this.panState = { t: 1 });
    this.tweens.killTweensOf(o);
    const set = () => cam.centerOn(this.L.W / 2, viewH / 2 + travel * o.t);
    set();
    this.tweens.add({
      targets: o, t: o.t > 0.5 ? 0 : 1, duration: Math.max(20000, travel * 30), yoyo: true, repeat: -1, ease: 'Sine.InOut', onUpdate: set,
    });
    const map = this.map;
    this.time.delayedCall(0, () => { if (this.map === map) map.prefill(); });
  }

  placeIdle() {
    for (const c of this.idle) { this.tweens.killTweensOf([c, ...c.list]); c.hopEvent.remove(); c.destroy(); }
    this.idle = [];
    if (!this.L) return;
    for (const stop of this.idleStops) {
      const key = pokemonKey(stop.pokemon.id);
      const pos = this.L.stops[stop.id];
      if (!pos || !this.textures.exists(key)) continue;
      const h = 100;
      const shadow = this.add.ellipse(0, 0, h * 0.7, h * 0.21, 0x000000, 0.22);
      const art = this.add.image(0, h * 0.06, key).setOrigin(0.5, 1);
      art.setScale(h / art.height).setFlipX(pos.x < this.L.W / 2);
      const c = this.add.container(pos.x, pos.y, [shadow, art]).setDepth(10 + pos.y / 10000);
      this.tweens.add({ targets: art, y: art.y - 3, duration: Phaser.Math.Between(900, 1300), yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: Phaser.Math.Between(0, 900) });
      // Now and then one hops on the spot.
      c.hopEvent = this.time.addEvent({
        delay: Phaser.Math.Between(2500, 5000), loop: true,
        callback: () => this.tweens.add({ targets: c, y: pos.y - 16, duration: 160, yoyo: true, ease: 'Quad.Out' }),
      });
      this.idle.push(c);
    }
  }
}
