import Phaser from 'phaser';
import dex from '../../shared/dex.json';
import { generateLevel } from '../../shared/level.js';
import { STARTERS, LEVEL_TUNING } from '../../shared/config.js';
import { allStops, isAvailable, canBeat, playLevel, starsFor } from '../../shared/rules.js';
import { load, save, clearRun } from '../save.js';
import { dustPuff, popSparkles, typeAttack, flashWhite, floatNumber, shake, hopTo } from '../art/effects.js';
import { loadPokemon, loadItems } from '../assets.js';
import { buildLayout } from '../art/layout.js';
import { renderMap } from '../art/biomeRenderer.js';
import { paletteFor } from '../art/palettes.js';
import { makePokemonStop, makeItemStop, makeEggStop, makePlayer, lockTexture, MIN_BADGE_PX } from '../art/stops.js';
import { getScreen, watchResize, RES } from '../layout/screen.js';

const TAP_SLOP = 10; // px of movement before a press becomes a drag
const HOLD_MS = 500; // hold this long on a Pokémon for its info card
const ZOOM_MIN = 0.8; // x the default (fit-width) zoom
const ZOOM_MAX = 2;
const byId = new Map(dex.map((p) => [p.id, p]));
const STAND_OFF = { wild: 78, gate: 96, boss: 130, item: 62, egg: 62 }; // how far from a stop the player lands

// The level map (PRD 6.4). HUD, banners and the info card live in UIScene so camera zoom never shrinks them.
// Flow: build map art -> load this level's images (UIScene shows a loading overlay) -> build stops ->
// intro banner (UIScene) -> playable.
export default class LevelScene extends Phaser.Scene {
  constructor() {
    super('LevelScene');
  }

  create(data) {
    this.run = data?.run ?? load().run;
    if (!this.run) {
      this.scene.start('TitleScene');
      return;
    }
    this.settings = load().settings;
    this.debugN = 0;
    this.levelNum = this.run.level;
    this.seed = this.run.runSeed;
    this.mode = null;
    this.map = null;
    this.stops = null;
    this.fog = [];
    this.inertia = { vx: 0, vy: 0 };
    this.overview = false;
    this.playable = false;
    this.ready = false;
    this.debug = false; // set by the debug keys: a debug level never touches the save
    this.attackType = byId.get(STARTERS[this.run.starter].forms[0].id).types[0]; // electric, fire, grass, water

    // Cheat hook kept for teaching (PRD 10): changes the screen, the server will ignore it.
    window.powerTrail = {
      getPower: () => this.power,
      setPower: (n) => this.showPower(Math.max(0, Math.round(Number(n) || 0))),
    };
    this.events.once('shutdown', () => {
      delete window.powerTrail;
      this.loadToken = -1; // drop any load still in flight
    });

    this.startLevel();
    this.setupInput();

    this.scene.launch('UIScene', { level: this.level, run: this.run });
    this.events.once('shutdown', () => this.scene.stop('UIScene'));
    watchResize(this, () => this.onResize());

    // Debug: B rebuilds the map with a new seed, N jumps to the next biome, F toggles a whole-map overview.
    this.input.keyboard.on('keydown-B', () => this.rerollSeed());
    this.input.keyboard.on('keydown-N', () => this.nextBiome());
    this.input.keyboard.on('keydown-F', () => this.toggleOverview());
  }

  // Generates the level, draws the map, then loads its images and places the stops.
  startLevel() {
    this.level = generateLevel({ dex, level: this.levelNum, starter: this.run.starter, runSeed: this.seed });
    this.open = 1; // zones open (zone 1 is open at the start)
    this.taken = new Set();
    this.clicks = []; // stop ids tapped this attempt, in order (saved for the server to replay)
    this.lastStop = null; // where the player is standing
    this.busy = false;
    this.power = this.level.startPower;
    this.playable = false;
    this.ready = false;
    this.buildMap();
    this.events.emit('level-loading', this.level);
    this.loadLevelArt(() => {
      this.ready = true;
      this.buildStops();
      this.events.emit('level-ready', this.level);
    });
  }

  // Called by UIScene when the intro banner has finished.
  onIntroDone() {
    this.playable = true;
  }

  // Only this level's images: the player's form, every Pokémon stop, item art.
  loadLevelArt(done) {
    const stops = allStops(this.level);
    const ids = [this.level.form.id, ...stops.filter((s) => s.pokemon).map((s) => s.pokemon.id)];
    loadPokemon(this, ids);
    loadItems(this, stops.filter((s) => s.sprite).map((s) => s.sprite));
    const token = (this.loadToken = (this.loadToken ?? 0) + 1);
    const onProgress = (p) => this.events.emit('load-progress', p);
    this.load.on('progress', onProgress);
    this.load.once('complete', () => {
      this.load.off('progress', onProgress);
      // Ignore loads that a newer level (or a shutdown) has replaced. Cached images complete
      // synchronously, while the scene is still being created, so don't check isActive() here.
      if (token === this.loadToken) done();
    });
    this.load.start();
  }

  // ---------- map ----------

  // Builds (or rebuilds) the layout and baked background for the current screen shape.
  buildMap() {
    const scr = getScreen(this);
    this.mode = scr.portrait ? 'tall' : 'wide';
    this.map?.destroy();
    this.clearStops();

    this.L = buildLayout(this.level, this.mode);
    this.map = renderMap(this, this.level, this.L, { compact: scr.compact });
    this.map.rt.setDepth(0);
    this.map.shimmer.setDepth(1);
    this.map.particles.setDepth(50);

    const cam = this.cameras.main;
    cam.setBackgroundColor(paletteFor(this.level.biome).ground[1]);
    this.overview = false;
    this.fitZoom(1);
    // Start at the bottom of the map, on the player.
    cam.centerOn(this.L.start.x, this.L.start.y - (cam.height / cam.zoom) * 0.2);
    // Particles spawn in the camera view, which updates on the next render.
    const map = this.map;
    this.time.delayedCall(0, () => { if (this.map === map) map.prefill(); });
  }

  clearStops() {
    if (!this.stops) return;
    for (const c of [...this.stops.values(), this.player]) {
      this.tweens.killTweensOf([c, ...c.list, ...(c.badgeGroup?.list ?? [])]);
      c.destroy();
    }
    for (const f of this.fog) this.destroyFog(f);
    this.stops = null;
    this.player = null;
    this.fog = [];
  }

  // Is this stop in a zone that isn't open yet? (The next gate is open: it stands on the stairs.)
  lockedLook(stop) {
    return stop.kind === 'gate' ? stop.zone > this.open : stop.zone >= this.open;
  }

  buildStops() {
    this.clearStops();
    const { level, L } = this;
    const start = L.start;
    this.stops = new Map();
    for (const stop of allStops(level)) {
      if (this.taken.has(stop.id)) continue;
      const pos = L.stops[stop.id];
      let c;
      if (stop.kind === 'item') c = makeItemStop(this, stop, pos);
      else if (stop.kind === 'egg') c = makeEggStop(this, stop, pos);
      else {
        // Hint mode: beatable Pokémon get a green badge instead of red (PRD 6.10).
        const colour = this.settings?.hint && canBeat(this.power, stop.power) ? 'item' : 'enemy';
        c = makePokemonStop(this, stop, pos, { faceLeft: start.x < pos.x, badgeColour: colour });
      }
      if (this.lockedLook(stop)) {
        if (c.art.setTint) c.art.setTint(0xa3a8b3);
        c.badgeGroup.setAlpha(0.8);
      }
      this.stops.set(stop.id, c);
    }
    const p0 = L.plateaus[0];
    const spot = this.playerSpot();
    this.player = makePlayer(this, level.form, spot, this.power, p0.cx < spot.x);
    for (let z = this.open; z < level.zones.length; z++) this.fog.push(this.makeFog(z));
    this.updateBadgeScale();
  }

  // ---------- locked zones: desaturating veil + soft fog clouds ----------

  fogTexture() {
    const key = 'fog-puff';
    if (this.textures.exists(key)) return key;
    const g = this.make.graphics({ add: false });
    const r = RES;
    for (let i = 6; i >= 1; i--) g.fillStyle(0xffffff, 0.09 * (7 - i)).fillEllipse(90 * r, 50 * r, (60 + i * 18) * r, (34 + i * 9) * r);
    g.generateTexture(key, 180 * r, 100 * r);
    g.destroy();
    return key;
  }

  makeFog(z) {
    const p = this.L.plateaus[z];
    const veil = this.add.graphics().setDepth(4);
    const poly = p.poly.map((q) => new Phaser.Math.Vector2(q.x, q.y));
    const cliffPoly = p.poly.map((q) => new Phaser.Math.Vector2(q.x, q.y + p.cliff));
    veil.fillStyle(0xaeb4c2, 0.42).fillPoints(cliffPoly, true).fillPoints(poly, true);

    // The gate on the stairs into the next zone stays clear: it's the one you can tap.
    const gate = this.level.zones[z].gate;
    const clearSpot = gate && gate.zone === this.open ? this.L.stops[gate.id] : null;
    const key = this.fogTexture();
    const puffs = [];
    const rng = new Phaser.Math.RandomDataGenerator([`${this.level.seed}fog${z}`]);
    const count = Math.round((p.rx * p.ry) / 9000);
    for (let i = 0, tries = 0; i < count && tries < count * 6; tries++) {
      const t = rng.realInRange(0, Math.PI * 2);
      const rr = Math.sqrt(rng.frac()) * 0.85;
      const x = p.cx + Math.cos(t) * p.rx * rr;
      const y = p.cy + Math.sin(t) * p.ry * rr;
      if (clearSpot && Math.hypot(x - clearSpot.x, y - clearSpot.y) < 170) continue;
      const puff = this.add.image(x, y, key).setScale(rng.realInRange(1.1, 1.8) / RES).setAlpha(rng.realInRange(0.5, 0.75)).setDepth(40);
      this.tweens.add({ targets: puff, x: x + rng.realInRange(-30, 30), duration: rng.between(4000, 7000), yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      puffs.push(puff);
      i++;
    }
    return { zone: z, veil, puffs };
  }

  destroyFog(f) {
    this.tweens.killTweensOf([f.veil, ...f.puffs]);
    f.veil.destroy();
    f.puffs.forEach((p) => p.destroy());
  }

  // When a gate falls the fog blows away (used by gameplay in Phase 4).
  unlockZone(z) {
    const f = this.fog.find((x) => x.zone === z);
    if (!f) return;
    this.fog = this.fog.filter((x) => x !== f);
    this.tweens.add({ targets: f.veil, alpha: 0, duration: 600 });
    for (const puff of f.puffs) {
      this.tweens.killTweensOf(puff);
      this.tweens.add({ targets: puff, alpha: 0, x: puff.x + (puff.x < this.L.W / 2 ? -160 : 160), duration: 900, ease: 'Quad.In' });
    }
    this.time.delayedCall(950, () => this.destroyFog(f));
  }

  // Badges never drop under 18px on screen: counter-scale them when zoomed out.
  updateBadgeScale() {
    if (!this.stops) return;
    const zoom = this.cameras.main.zoom;
    for (const c of [...this.stops.values(), this.player]) {
      const bg = c.badgeGroup;
      bg.setScale(Math.max(1, MIN_BADGE_PX / (bg.fontPx * zoom)));
    }
  }

  // ---------- debug ----------

  rerollSeed() {
    this.debugN += 1;
    this.seed = `${this.run.runSeed}~${this.debugN}`;
    this.rebuildForDebug();
  }

  // Jump to the next biome (5 levels on). Nothing is saved.
  nextBiome() {
    this.levelNum += 5;
    this.rebuildForDebug();
  }

  rebuildForDebug() {
    this.debug = true;
    this.startLevel();
    this.scene.get('UIScene').setLevel?.(this.level, this.run);
    console.info(`[debug] level ${this.levelNum} (${this.level.biomeLabel}), runSeed "${this.seed}" (${this.mode})`);
  }

  // ---------- camera ----------

  defaultZoom() {
    return this.scale.width / this.L.W;
  }

  // Sets zoom to `rel` x the default and refreshes the bounds.
  fitZoom(rel) {
    const cam = this.cameras.main;
    this.relZoom = Phaser.Math.Clamp(rel, ZOOM_MIN, ZOOM_MAX);
    cam.setZoom(this.defaultZoom() * this.relZoom);
    this.updateBounds();
    this.updateBadgeScale();
  }

  // Keeps the camera inside the world; when the world is smaller than the view, centre it.
  updateBounds() {
    const cam = this.cameras.main;
    const dw = cam.width / cam.zoom;
    const dh = cam.height / cam.zoom;
    const bx = this.L.W < dw ? (this.L.W - dw) / 2 : 0;
    const by = this.L.H < dh ? (this.L.H - dh) / 2 : 0;
    cam.setBounds(bx, by, Math.max(this.L.W, dw), Math.max(this.L.H, dh));
  }

  // Zoom about a screen point, so whatever is under the finger/cursor stays put.
  zoomAt(sx, sy, zoom) {
    const cam = this.cameras.main;
    const def = this.defaultZoom();
    const z = Phaser.Math.Clamp(zoom, def * ZOOM_MIN, def * ZOOM_MAX);
    const wx = cam.scrollX + cam.width / 2 + (sx - cam.width / 2) / cam.zoom;
    const wy = cam.scrollY + cam.height / 2 + (sy - cam.height / 2) / cam.zoom;
    cam.setZoom(z);
    this.relZoom = z / def;
    cam.scrollX = wx - cam.width / 2 - (sx - cam.width / 2) / z;
    cam.scrollY = wy - cam.height / 2 - (sy - cam.height / 2) / z;
    this.overview = false;
    this.updateBounds();
    this.updateBadgeScale();
  }

  toggleOverview() {
    const cam = this.cameras.main;
    this.overview = !this.overview;
    if (this.overview) {
      cam.setZoom(Math.min(cam.width / this.L.W, cam.height / this.L.H) * 0.96);
      this.updateBounds();
      this.updateBadgeScale();
      cam.centerOn(this.L.W / 2, this.L.H / 2);
    } else {
      this.fitZoom(1);
      cam.centerOn(this.L.start.x, this.L.start.y);
    }
  }

  onResize() {
    const cam = this.cameras.main;
    const centre = { x: cam.midPoint.x, y: cam.midPoint.y };
    const mode = getScreen(this).portrait ? 'tall' : 'wide';
    if (mode !== this.mode) {
      // Rotated: new world shape. Rebuild map and stops (same level, same taken stops) and keep the player in view.
      this.buildMap();
      if (this.ready) this.buildStops();
      const spot = this.playerSpot();
      cam.centerOn(spot.x, spot.y);
      return;
    }
    // Same orientation: only zoom and bounds change. Keep the relative zoom and the view centre.
    this.fitZoom(this.overview ? 1 : this.relZoom);
    cam.centerOn(centre.x, centre.y);
  }

  // ---------- input: drag with inertia, pinch, wheel, tap, hold ----------

  setupInput() {
    this.input.addPointer(1); // two fingers for pinch
    this.touches = new Map();
    this.drag = null;
    this.pinch = null;
    this.hold = null;

    // Taps on HUD buttons and open panels belong to UIScene, not the map.
    const onHud = (p) => {
      const ui = this.scene.get('UIScene');
      return ui?.sys.isActive() && (ui.blocksInput?.() || ui.input.hitTestPointer(p).length > 0);
    };
    const cancelHold = () => {
      this.hold?.remove();
      this.hold = null;
    };

    this.input.on('pointerdown', (p) => {
      if (onHud(p)) return;
      this.touches.set(p.id, { x: p.x, y: p.y });
      this.inertia.vx = 0;
      this.inertia.vy = 0;
      if (this.touches.size === 1) {
        this.drag = { sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, t: this.time.now };
        // Hold (or long-press on touch) on a Pokémon opens its info card.
        const target = this.playable && this.hitTest(p);
        if (target && (target.stop?.pokemon || target === this.player)) {
          this.hold = this.time.delayedCall(HOLD_MS, () => {
            this.hold = null;
            if (!this.drag || this.drag.moved) return;
            this.drag.moved = true; // releasing now isn't a tap
            this.scene.get('UIScene').showInfo?.(this.infoFor(target));
          });
        }
      } else if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.cameras.main.zoom };
        if (this.drag) this.drag.moved = true; // a pinch is never a tap
        cancelHold();
      }
    });

    this.input.on('pointermove', (p) => {
      if (!this.touches.has(p.id)) return;
      this.touches.set(p.id, { x: p.x, y: p.y });
      const cam = this.cameras.main;
      if (this.touches.size >= 2 && this.pinch) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, this.pinch.z0 * (d / this.pinch.d0));
        return;
      }
      const dr = this.drag;
      if (!dr) return;
      if (!dr.moved && Math.hypot(p.x - dr.sx, p.y - dr.sy) > TAP_SLOP) {
        dr.moved = true;
        cancelHold();
      }
      if (dr.moved && !this.hold) {
        const dx = p.x - dr.lx;
        const dy = p.y - dr.ly;
        cam.scrollX -= dx / cam.zoom;
        cam.scrollY -= dy / cam.zoom;
        const dt = Math.max(1, this.time.now - dr.t);
        // Smoothed velocity in world px per ms, for the fling.
        this.inertia.vx = this.inertia.vx * 0.6 + (-dx / cam.zoom / dt) * 0.4;
        this.inertia.vy = this.inertia.vy * 0.6 + (-dy / cam.zoom / dt) * 0.4;
        this.overview = false;
      }
      dr.lx = p.x;
      dr.ly = p.y;
      dr.t = this.time.now;
    });

    const end = (p) => {
      if (!this.touches.has(p.id)) return;
      this.touches.delete(p.id);
      cancelHold();
      if (this.touches.size === 1) {
        // Pinch ended with one finger still down: carry on dragging from there.
        const [q] = [...this.touches.values()];
        this.pinch = null;
        this.drag = { sx: q.x, sy: q.y, lx: q.x, ly: q.y, moved: true, t: this.time.now };
        this.inertia.vx = 0;
        this.inertia.vy = 0;
        return;
      }
      if (this.touches.size === 0) {
        if (this.drag && !this.drag.moved) this.onTap(p);
        if (this.time.now - (this.drag?.t ?? 0) > 80) { this.inertia.vx = 0; this.inertia.vy = 0; }
        this.drag = null;
        this.pinch = null;
      }
    };
    this.input.on('pointerup', end);
    this.input.on('pointerupoutside', end);

    this.input.on('wheel', (p, _over, _dx, dy) => {
      if (onHud(p)) return;
      this.zoomAt(p.x, p.y, this.cameras.main.zoom * Math.exp(-dy * 0.0015));
    });
  }

  // The front-most stop (or the player) under a screen point. Targets are at least 44px on screen.
  hitTest(p) {
    if (!this.stops) return null;
    const cam = this.cameras.main;
    const w = cam.getWorldPoint(p.x, p.y);
    const minR = 22 / cam.zoom;
    let best = null;
    for (const c of [...this.stops.values(), this.player]) {
      const r = Math.max(c.hit.r, minR);
      if (Math.hypot(w.x - c.x, w.y - (c.y + c.hit.dy)) <= r && (!best || c.y > best.y)) best = c;
    }
    return best;
  }

  onTap(p) {
    if (!this.playable || this.busy) return;
    const c = this.hitTest(p);
    if (!c || !c.stop) return;
    // Every decision goes through shared/rules.js.
    if (!isAvailable(this.level, c.stop, this.open, this.taken)) {
      this.showLocked(c);
      return;
    }
    this.takeStop(c);
  }

  // ---------- gameplay ----------

  // Where the player stands: next to the last stop it took (in this layout), or the start.
  playerSpot() {
    if (!this.lastStop) return this.L.start;
    const { id, kind } = this.lastStop;
    const pos = this.L.stops[id];
    const from = this.L.start;
    const d = Math.hypot(from.x - pos.x, from.y - pos.y) || 1;
    return { x: pos.x + ((from.x - pos.x) / d) * STAND_OFF[kind] * 0.4, y: pos.y + 6 };
  }

  takeStop(c) {
    const stop = c.stop;
    this.busy = true;
    this.clicks.push(stop.id);
    const pl = this.player;
    // Land next to the stop, on the side we're coming from.
    const dx = pl.x - c.x;
    const dy = pl.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    const off = Math.min(STAND_OFF[stop.kind], d);
    const tx = c.x + (dx / d) * off;
    const ty = c.y + (dy / d) * off + 4;
    // Face the way we're hopping (HOME art faces left).
    if (Math.abs(tx - pl.x) > 4) pl.art.setFlipX(tx > pl.x);
    pl.setDepth(10 + ty / 10000 + 0.00001);
    const ms = hopTo(this, pl, tx, ty, { onLand: (x, y) => dustPuff(this, x, y + 2, this.reduce()) });
    this.followPlayer(tx, ty);
    this.time.delayedCall(ms + 20, () => {
      if (!this.sys.isActive()) return;
      // Face the stop for the battle.
      if (Math.abs(c.x - pl.x) > 4) pl.art.setFlipX(c.x > pl.x);
      if (stop.kind === 'item') this.collectItem(c);
      else if (stop.kind === 'egg') this.collectEgg(c);
      else this.battle(c);
    });
  }

  reduce() {
    return !!this.settings?.reduceMotion;
  }

  // Keep the player comfortably on screen.
  followPlayer(x, y) {
    const v = this.cameras.main.worldView;
    const mx = v.width * 0.22;
    const my = v.height * 0.22;
    if (x < v.x + mx || x > v.right - mx || y < v.y + my || y > v.bottom - my) {
      this.cameras.main.pan(x, y - 60, 450, 'Sine.easeInOut');
    }
  }

  battle(c) {
    const stop = c.stop;
    const pl = this.player;
    const win = canBeat(this.power, stop.power); // ties lose (PRD 2.4)
    const bodyY = c.y + c.hit.dy;
    const lx = (c.x - pl.x) * 0.45;
    const ly = (c.y - pl.y) * 0.45;
    if (win) {
      this.tweens.add({ targets: pl, x: pl.x + lx, y: pl.y + ly, duration: 110, yoyo: true, ease: 'Quad.Out' });
      this.time.delayedCall(100, () => {
        const ms = typeAttack(this, this.attackType, pl, { x: c.x, y: bodyY }, this.reduce());
        shake(this, this.reduce());
        flashWhite(this, c.art);
        this.time.delayedCall(Math.min(ms, 260), () => this.defeat(c));
      });
    } else {
      // Lunge and bounce off, then tip over.
      const x0 = pl.x;
      const y0 = pl.y;
      this.tweens.chain({
        targets: pl,
        tweens: [
          { x: x0 + lx, y: y0 + ly, duration: 110, ease: 'Quad.Out' },
          { x: x0 - lx * 0.8, y: y0 - ly * 0.8, duration: 260, ease: 'Back.Out' },
        ],
      });
      this.tweens.add({ targets: c, scaleX: 1.08, scaleY: 1.08, duration: 120, yoyo: true, delay: 100 });
      this.time.delayedCall(380, () => this.faint());
    }
  }

  // Enemy squashes and pops into sparkles; its power is added to ours.
  defeat(c) {
    const stop = c.stop;
    this.taken.add(stop.id);
    this.lastStop = { id: stop.id, kind: stop.kind };
    this.stops.delete(stop.id);
    this.addToDex(stop.pokemon.id);
    const bodyY = c.y + c.hit.dy;
    this.tweens.add({
      targets: c, scaleX: 1.35, scaleY: 0.55, duration: 110, ease: 'Quad.In',
      onComplete: () => {
        popSparkles(this, c.x, bodyY, this.reduce(), { count: 14 });
        this.tweens.killTweensOf([c, ...c.list, ...c.badgeGroup.list]);
        c.destroy();
      },
    });
    floatNumber(this, c.x, bodyY - 40, stop.power, 'item', '+', this.player.badgeGroup.scaleX);
    const before = this.power;
    this.countPower(this.power + stop.power, () => {
      if (stop.kind === 'gate') this.openZone(stop.zone);
      if (stop.kind === 'boss') this.levelCleared(before);
    });
  }

  collectItem(c) {
    const stop = c.stop;
    this.taken.add(stop.id);
    this.lastStop = { id: stop.id, kind: stop.kind };
    this.stops.delete(stop.id);
    // The box pops open, the item card flies up, then the value flies into your power.
    this.tweens.add({
      targets: c, scaleX: 1.25, scaleY: 0.75, duration: 90, yoyo: true,
      onComplete: () => {
        popSparkles(this, c.x, c.y - 30, this.reduce(), { count: 10, tint: 0xfde68a, spread: 50 });
        this.tweens.killTweensOf([c, ...c.list, ...c.badgeGroup.list]);
        c.destroy();
      },
    });
    this.scene.get('UIScene').showItemCard?.(stop);
    floatNumber(this, c.x, c.y - 70, stop.value, 'item', '+', this.player.badgeGroup.scaleX);
    this.countPower(this.power + stop.value);
  }

  collectEgg(c) {
    const stop = c.stop;
    this.taken.add(stop.id);
    this.lastStop = { id: stop.id, kind: stop.kind };
    this.stops.delete(stop.id);
    // Egg cracks open, gold sparkle burst, purple ×2, power doubles with a bigger bounce.
    this.tweens.add({ targets: c.art, angle: { from: -12, to: 12 }, duration: 60, yoyo: true, repeat: 2 });
    this.time.delayedCall(260, () => {
      popSparkles(this, c.x, c.y - 40, this.reduce(), { count: 18, tint: 0xfacc15, spread: 90 });
      this.tweens.killTweensOf([c, ...c.list, ...c.badgeGroup.list]);
      c.destroy();
      floatNumber(this, c.x, c.y - 80, stop.mult, 'egg', '×', this.player.badgeGroup.scaleX * 1.3);
      this.countPower(this.power * stop.mult, null, 1.45);
    });
  }

  // Power counts up (max 600ms) with a bounce; the next tap is accepted when it's done.
  countPower(target, after, bounce = 1.25) {
    const from = this.power;
    this.power = target;
    const ui = this.scene.get('UIScene');
    const o = { v: from };
    this.tweens.add({
      targets: o, v: target, duration: Math.min(600, 300 + Math.log10(Math.max(10, target - from)) * 60), ease: 'Quad.Out',
      onUpdate: () => {
        const v = Math.round(o.v);
        this.player.badge.setValue(v);
        ui.setPowerDisplay?.(v);
      },
      onComplete: () => {
        this.showPower(target, bounce);
        this.busy = false;
        after?.();
      },
    });
  }

  // Shows a power value on the player badge and the HUD (also used by the cheat hook).
  showPower(n, bounce = 1.25) {
    this.power = n;
    this.player?.badge.setValue(n);
    this.scene.get('UIScene').setPowerDisplay?.(n, bounce);
    if (this.player) this.tweens.add({ targets: this.player.badge, scale: bounce, duration: 110, yoyo: true, ease: 'Quad.Out' });
    this.refreshHints();
  }

  // Hint mode: beatable enemies get a green badge.
  refreshHints() {
    if (!this.settings?.hint || !this.stops) return;
    for (const c of this.stops.values()) {
      if (c.stop.pokemon) c.badge.setColour(canBeat(this.power, c.stop.power) ? 'item' : 'enemy');
    }
  }

  openZone(z) {
    this.open = z + 1;
    this.unlockZone(z);
    // Brighten everything that's now in reach, and clear the fog round the next gate.
    for (const c of this.stops.values()) {
      if (this.lockedLook(c.stop)) continue;
      c.art.clearTint?.();
      c.badgeGroup.setAlpha(1);
    }
    const next = this.fog.find((f) => f.zone === this.open);
    if (next) {
      this.destroyFog(next);
      this.fog = this.fog.map((f) => (f === next ? this.makeFog(this.open) : f));
    }
  }

  addToDex(id) {
    if (this.debug) return;
    const data = load();
    if (!data.dex.includes(id)) {
      data.dex.push(id);
      save(data);
    }
  }

  // Records this attempt's taps in the run history (the server replays them, PRD 10).
  recordAttempt() {
    if (this.debug) return;
    const run = this.run;
    let entry = run.history.find((h) => h.level === this.level.level);
    if (!entry) run.history.push((entry = { level: this.level.level, attempts: [] }));
    entry.attempts.push([...this.clicks]);
  }

  saveRun() {
    if (this.debug) return;
    const data = load();
    data.run = this.run;
    save(data);
  }

  faint() {
    const ui = this.scene.get('UIScene');
    const pl = this.player;
    // Tip over.
    this.tweens.add({ targets: pl.art, angle: pl.art.flipX ? 80 : -80, y: pl.art.y - 6, duration: 260, ease: 'Quad.In' });
    this.tweens.killTweensOf(pl.badgeGroup);
    this.recordAttempt();
    this.run.hearts = Math.max(0, this.run.hearts - 1);
    if (this.run.hearts === 0 && !this.debug) {
      const data = load();
      data.run = null; // out of hearts: the run is over
      save(data);
    } else {
      this.saveRun();
    }
    ui.faintSequence?.(this.run.hearts, {
      retry: () => this.scene.restart({ run: this.run }),
      quit: () => this.scene.start('TitleScene'),
      newRun: () => { clearRun(); this.scene.start('TitleScene'); },
    });
  }

  // Minimal level-clear (the full 6.6 panel comes later): check the run, save, then Next level.
  levelCleared(powerBeforeBoss) {
    const result = playLevel(this.level, this.clicks);
    const stars = starsFor(this.level, powerBeforeBoss);
    this.recordAttempt();
    const lv = this.level.level;
    if (!this.debug && result.outcome === 'cleared') {
      const run = this.run;
      run.stars += stars;
      run.level = lv + 1;
      if (lv % LEVEL_TUNING.heartEvery === 0) run.hearts = Math.min(LEVEL_TUNING.lives, run.hearts + 1);
      const data = load();
      data.run = run;
      if (lv > data.bestLevel) { data.bestLevel = lv; data.bestStars = run.stars; }
      save(data);
    }
    this.scene.get('UIScene').clearedPanel?.({
      level: lv, stars, power: powerBeforeBoss, best: this.level.solution.beforeBoss, verified: result.outcome === 'cleared',
      next: () => this.scene.restart({ run: this.run }),
      quit: () => this.scene.start('TitleScene'),
    });
  }

  // Locked stop: a small shake and a lock icon, nothing else (PRD 6.4).
  showLocked(c) {
    if (c.shaking) return;
    c.shaking = true;
    const x0 = c.x;
    this.tweens.add({
      targets: c, x: x0 + 7, duration: 45, yoyo: true, repeat: 3, ease: 'Sine.InOut',
      onComplete: () => { c.x = x0; c.shaking = false; },
    });
    const s = c.badgeGroup.scaleX;
    const lock = this.add.image(c.x, c.y + c.badgeGroup.y * 0.55, lockTexture(this)).setDepth(45).setScale(0).setOrigin(0.5);
    this.tweens.add({ targets: lock, scale: (1.3 * s) / RES, duration: 160, ease: 'Back.Out' });
    this.tweens.add({ targets: lock, alpha: 0, y: lock.y - 20, delay: 650, duration: 250, onComplete: () => lock.destroy() });
  }

  // What the info card shows: art, name, types and the power maths.
  infoFor(c) {
    if (c === this.player) {
      const f = this.level.form;
      return { id: f.id, name: f.name, types: byId.get(f.id)?.types ?? [], base: f.base, level: this.levelNum, alpha: 1, power: this.level.startPower, you: true };
    }
    const s = c.stop;
    return { id: s.pokemon.id, name: s.pokemon.name, types: s.pokemon.types, base: s.pokemon.base, level: this.levelNum, alpha: s.alpha, power: s.power, kind: s.kind };
  }

  update(_time, delta) {
    const cam = this.cameras.main;
    if (this.drag || !this.inertia) return;
    const { vx, vy } = this.inertia;
    if (Math.abs(vx) + Math.abs(vy) < 0.005) return;
    cam.scrollX += vx * delta;
    cam.scrollY += vy * delta;
    const decay = Math.pow(0.9, delta / 16.7);
    this.inertia.vx *= decay;
    this.inertia.vy *= decay;
  }
}
