import Phaser from 'phaser';
import dex from '../../shared/dex.json';
import { load } from '../save.js';
import { loadPokemon, pokemonKey } from '../assets.js';
import { getScreen, safeRect, watchResize } from '../layout/screen.js';
import { makeText, makeButton, makeTappable, px, FONT_TITLE, INK, TYPE_COLOURS, COLOURS } from '../art/ui.js';
import UIScene, { displayName } from './UIScene.js';

const GENS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // 0 = All

// Trail Dex (PRD 6.9): every Pokémon in dex.json. Beaten ones show their art (loaded lazily, only
// for the cells on screen); the rest are dark "?" silhouettes. Tabs filter by generation.
// Drag (with inertia) or the wheel scrolls. Tap a beaten one for its info card with live stats.
export default class DexScene extends Phaser.Scene {
  constructor() {
    super('DexScene');
  }

  create() {
    const data = load();
    this.beaten = new Set(data.dex);
    this.gen = 0;
    this.scrollY = 0;
    this.vel = 0;
    this.drag = null;
    this.cells = new Map(); // index -> cell container (only visible rows exist)
    this.info = null;
    this.cameras.main.setBackgroundColor('#1e3a8a');

    this.grid = this.add.container(0, 0);
    this.header = this.add.container(0, 0).setDepth(10);
    this.layout();
    watchResize(this, () => this.layout());
    this.setupInput();
    this.load.on('complete', () => this.refreshArt());
  }

  list() {
    return this.gen ? dex.filter((p) => p.gen === this.gen) : dex;
  }

  layout() {
    const scr = getScreen(this);
    const s = scr.ui;
    const area = safeRect(scr, Math.max(10, 14 * s));
    this.scr = scr;
    this.header.removeAll(true);

    // Header: back button, title, counter.
    const back = makeButton(this, 0, 0, '◀ Back', 'secondary', () => this.scene.start('TitleScene'), {
      scale: Math.max(0.75, s), width: 150, height: 54, fontSize: 24,
    });
    back.setPosition(area.left + back.btnW / 2, area.top + back.btnH / 2);
    const title = makeText(this, 0, 0, 'Trail Dex', {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(26, 44 * s)), color: '#ffffff', stroke: '#0b1630', strokeThickness: 8 * s,
    }).setOrigin(0.5);
    const count = makeText(this, 0, 0, `${this.beaten.size} / ${dex.length}`, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(20, 30 * s)), color: '#FDE68A', stroke: '#0b1630', strokeThickness: 6 * s,
    }).setOrigin(1, 0.5);
    const rowY = area.top + back.btnH / 2;
    const roomForTitle = area.width - back.btnW * 2 - 40 * s > title.width;
    title.setPosition(scr.w / 2, rowY);
    count.setPosition(area.right, rowY);
    let y = area.top + back.btnH + Math.max(8, 10 * s);
    if (!roomForTitle) {
      title.setPosition(area.left + title.width / 2, y + title.height / 2);
      count.setPosition(area.right, title.y);
      y += title.height + Math.max(6, 8 * s);
    }
    const bg = this.add.rectangle(0, 0, scr.w, 10, 0x1e3a8a, 1).setOrigin(0);
    this.header.add([bg, back, title, count]);

    // Generation tabs: wrap onto as many rows as they need, every tab at least 44px.
    const tabH = Math.max(44, 46 * s);
    const font = Math.max(14, 18 * s);
    const gap = Math.max(5, 7 * s);
    let x = area.left;
    for (const g of GENS) {
      const label = g ? `Gen ${g}` : 'All';
      const t = makeText(this, 0, 0, label, { fontStyle: '900', fontSize: px(font), color: g === this.gen ? '#1e3a8a' : '#ffffff' }).setOrigin(0.5);
      const w = Math.max(44, t.width + font * 1.4);
      if (x + w > area.right) { x = area.left; y += tabH + gap; }
      const pill = this.add.graphics();
      pill.fillStyle(g === this.gen ? 0xfde68a : 0xffffff, g === this.gen ? 1 : 0.16).fillRoundedRect(-w / 2, -tabH / 2, w, tabH, tabH / 2);
      const tab = this.add.container(x + w / 2, y + tabH / 2, [pill, t]);
      makeTappable(tab, w, tabH);
      tab.on('pointerup', () => this.setGen(g));
      this.header.add(tab);
      x += w + gap;
    }
    y += tabH + gap * 1.5;
    bg.height = y;
    this.top = y;

    // Grid: columns from the width (about 3 on a phone, 8+ on a desktop).
    const cell = Math.max(100, Math.min(150, area.width / 3.2));
    this.cols = Math.max(3, Math.floor(area.width / cell));
    this.cw = area.width / this.cols;
    this.ch = this.cw * 1.12;
    this.gridLeft = area.left;
    this.viewH = scr.h - this.top;
    this.clampScroll();
    for (const c of this.cells.values()) c.destroy();
    this.cells.clear();
    this.drawCells();
  }

  setGen(g) {
    if (g === this.gen) return;
    this.gen = g;
    this.scrollY = 0;
    this.vel = 0;
    this.closeInfo();
    this.layout();
  }

  maxScroll() {
    const rows = Math.ceil(this.list().length / this.cols);
    return Math.max(0, rows * this.ch + 20 - this.viewH);
  }

  clampScroll() {
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll());
  }

  // Builds the cells on screen (plus one row either side) and drops the rest.
  drawCells() {
    const items = this.list();
    const first = Math.max(0, Math.floor(this.scrollY / this.ch) - 1);
    const last = Math.min(Math.ceil(items.length / this.cols), Math.ceil((this.scrollY + this.viewH) / this.ch) + 1);
    const want = new Set();
    const toLoad = [];
    for (let r = first; r < last; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        if (i >= items.length) break;
        want.add(i);
        if (!this.cells.has(i)) this.cells.set(i, this.makeCell(items[i], c, r));
        const p = items[i];
        if (this.beaten.has(p.id) && !this.textures.exists(pokemonKey(p.id))) toLoad.push(p.id);
      }
    }
    for (const [i, cell] of this.cells) {
      if (!want.has(i)) { cell.destroy(); this.cells.delete(i); }
    }
    this.grid.y = this.top - this.scrollY;
    if (toLoad.length) {
      loadPokemon(this, toLoad);
      if (!this.load.isLoading()) this.load.start();
    }
  }

  makeCell(p, col, row) {
    const s = Math.max(0.8, this.scr.ui);
    const w = this.cw - 8;
    const h = this.ch - 8;
    const x = this.gridLeft + col * this.cw + this.cw / 2;
    const y = row * this.ch + this.ch / 2;
    const seen = this.beaten.has(p.id);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, 14);
    g.fillStyle(seen ? 0xfff8ec : 0x14275f, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    if (seen) g.fillStyle(TYPE_COLOURS[p.types[0]] ?? 0xdddddd, 0.35).fillCircle(0, -h * 0.08, w * 0.34);
    const num = makeText(this, -w / 2 + 8, -h / 2 + 6, `#${String(p.id).padStart(3, '0')}`, {
      fontStyle: '900', fontSize: px(Math.max(11, 13 * s)), color: seen ? '#8A7058' : '#7c8db8',
    });
    const parts = [g, num];
    if (seen) {
      const name = makeText(this, 0, h / 2 - 8, displayName(p.name), { fontStyle: '900', fontSize: px(Math.max(12, 14 * s)), color: INK }).setOrigin(0.5, 1);
      if (name.width > w - 10) name.setScale((w - 10) / name.width);
      parts.push(name);
    } else {
      // Dark silhouette blob with a "?".
      const sil = this.add.graphics();
      sil.fillStyle(0x0b1630, 1).fillEllipse(0, -h * 0.02, w * 0.5, h * 0.5).fillCircle(0, -h * 0.25, w * 0.17);
      const q = makeText(this, 0, -h * 0.04, '?', { fontFamily: FONT_TITLE, fontSize: px(w * 0.3), color: '#3b5296' }).setOrigin(0.5);
      parts.push(sil, q);
    }
    const cell = this.add.container(x, y, parts);
    Object.assign(cell, { pokemon: p, seen, w, h, art: null });
    this.grid.add(cell);
    this.addArt(cell);
    return cell;
  }

  addArt(cell) {
    if (!cell.seen || cell.art) return;
    const key = pokemonKey(cell.pokemon.id);
    if (!this.textures.exists(key)) return;
    const img = this.add.image(0, -cell.h * 0.08, key);
    img.setScale((cell.w * 0.72) / Math.max(img.width, img.height));
    cell.addAt(img, 2);
    cell.art = img;
  }

  refreshArt() {
    for (const cell of this.cells.values()) this.addArt(cell);
  }

  // ---------- input: drag with inertia, wheel, tap a cell ----------

  setupInput() {
    this.input.on('pointerdown', (p) => {
      if (this.info) return;
      if (p.y < this.top) return;
      this.drag = { y0: p.y, ly: p.y, t: this.time.now, moved: false };
      this.vel = 0;
    });
    this.input.on('pointermove', (p) => {
      const d = this.drag;
      if (!d || !p.isDown) return;
      if (Math.abs(p.y - d.y0) > 10) d.moved = true;
      if (d.moved) {
        const dy = p.y - d.ly;
        this.scrollY -= dy;
        const dt = Math.max(1, this.time.now - d.t);
        this.vel = this.vel * 0.5 + (-dy / dt) * 0.5;
        this.clampScroll();
        this.drawCells();
      }
      d.ly = p.y;
      d.t = this.time.now;
    });
    this.input.on('pointerup', (p) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (!d.moved) { this.vel = 0; this.tapAt(p); }
      else if (this.time.now - d.t > 80) this.vel = 0;
    });
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      if (this.info) return;
      this.scrollY += dy;
      this.clampScroll();
      this.drawCells();
    });
  }

  tapAt(p) {
    const y = p.y - this.top + this.scrollY;
    const col = Math.floor((p.x - this.gridLeft) / this.cw);
    const row = Math.floor(y / this.ch);
    if (col < 0 || col >= this.cols) return;
    const pk = this.list()[row * this.cols + col];
    if (!pk || !this.beaten.has(pk.id)) return;
    // Same info card as the map, with live stats from PokéAPI.
    this.showInfo({ id: pk.id, name: pk.name, types: pk.types, base: pk.power, level: null, alpha: 1, power: pk.power });
  }

  update(_t, delta) {
    if (this.drag || Math.abs(this.vel) < 0.01) return;
    this.scrollY += this.vel * delta;
    this.vel *= Math.pow(0.92, delta / 16.7);
    const before = this.scrollY;
    this.clampScroll();
    if (this.scrollY !== before) this.vel = 0;
    this.drawCells();
  }
}

// The info card (and its live stats block) is shared with the map's UIScene.
for (const m of ['showInfo', 'closeInfo', 'statsBlock', 'stopSpinner']) DexScene.prototype[m] = UIScene.prototype[m];
