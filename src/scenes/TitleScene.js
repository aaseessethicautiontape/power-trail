import Phaser from 'phaser';
import dex from '../../shared/dex.json';
import { STARTERS, STARTER_KEYS, LEVEL_TUNING } from '../../shared/config.js';
import { formFor } from '../../shared/level.js';
import { load, save, newRunSeed } from '../save.js';
import { pokemonKey } from '../assets.js';
import {
  makeText, makeButton, makePanel, makeBadge, makeHearts, makeCog, shade,
  FONT_TITLE, INK, TYPE_COLOURS,
} from '../art/ui.js';

const byId = new Map(dex.map((p) => [p.id, p]));

const CARD_W = 236;
const CARD_H = 320;
const CARD_GAP = 28;
const CARD_Y = 392;
const BUTTON_Y = 632;

// "Evolves at 8 and 20" from the starter's forms in shared/config.js.
function evolvesLine(key) {
  const levels = STARTERS[key].forms.slice(1).map((f) => f.from);
  if (levels.length === 0) return 'Never evolves';
  if (levels.length === 1) return `Evolves at ${levels[0]}`;
  return `Evolves at ${levels.slice(0, -1).join(', ')} and ${levels.at(-1)}`;
}

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    this.data_ = load();
    this.selected = this.data_.run?.starter ?? STARTER_KEYS[0];
    this.modal = null;

    this.drawBackground();
    this.drawLogo();
    this.cards = STARTER_KEYS.map((key, i) => this.makeCard(key, i));
    this.refreshCards(true);
    this.drawButtons();
  }

  // ---------- background: sky gradient, sun, drifting clouds, meadow hills ----------

  drawBackground() {
    const { width, height } = this.scale;
    if (!this.textures.exists('title-sky')) {
      const tex = this.textures.createCanvas('title-sky', width, height);
      const ctx = tex.getContext();
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#5FAEF2');
      sky.addColorStop(0.55, '#8EC9FF');
      sky.addColorStop(1, '#D8F0FF');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
      const sun = ctx.createRadialGradient(170, 90, 10, 170, 90, 360);
      sun.addColorStop(0, 'rgba(255,250,215,0.95)');
      sun.addColorStop(0.18, 'rgba(255,244,190,0.55)');
      sun.addColorStop(1, 'rgba(255,244,190,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, width, height);
      tex.refresh();
    }
    this.add.image(0, 0, 'title-sky').setOrigin(0);

    this.makeCloudTextures();
    this.clouds = [];
    const rng = new Phaser.Math.RandomDataGenerator(['title']);
    for (let i = 0; i < 7; i++) {
      const cloud = this.add.image(rng.between(0, width), rng.between(30, 330), `cloud${i % 3}`);
      const s = rng.realInRange(0.55, 1.1);
      cloud.setScale(s).setAlpha(rng.realInRange(0.75, 0.95));
      cloud.speed = 6 + 14 * s; // bigger clouds feel closer, so they move faster
      this.clouds.push(cloud);
    }

    // Two layers of rolling meadow hills behind the buttons.
    const hills = this.add.graphics();
    const hill = (baseY, amp, colour, phase) => {
      const pts = [new Phaser.Math.Vector2(0, height)];
      for (let x = 0; x <= width; x += 20) {
        const y = baseY - Math.sin(x / 210 + phase) * amp - Math.sin(x / 95 + phase * 2) * amp * 0.25;
        pts.push(new Phaser.Math.Vector2(x, y));
      }
      pts.push(new Phaser.Math.Vector2(width, height));
      hills.fillStyle(colour, 1).fillPoints(pts, true);
    };
    hill(560, 26, 0x7bc44f, 0.6);
    hill(600, 18, 0x8fd460, 2.2);
    // A few flower dots on the front hill.
    for (let i = 0; i < 40; i++) {
      const x = rng.between(10, width - 10);
      const y = rng.between(625, height - 8);
      hills.fillStyle(rng.pick([0xffffff, 0xfff176, 0xff9ecb]), 0.9).fillCircle(x, y, rng.between(2, 4));
    }
  }

  makeCloudTextures() {
    if (this.textures.exists('cloud0')) return;
    const shapes = [
      [[60, 60, 40], [105, 45, 52], [155, 62, 38], [190, 72, 26]],
      [[50, 55, 32], [90, 40, 44], [135, 55, 34]],
      [[55, 62, 36], [100, 48, 48], [150, 50, 42], [196, 64, 30], [240, 72, 22]],
    ];
    shapes.forEach((puffs, i) => {
      const g = this.make.graphics({ add: false });
      const w = Math.max(...puffs.map(([x, , r]) => x + r)) + 10;
      for (const [x, y, r] of puffs) g.fillStyle(0xcfe6fb, 1).fillCircle(x, y + 8, r);
      g.fillStyle(0xcfe6fb, 1).fillRoundedRect(30, 66, w - 50, 30, 15);
      for (const [x, y, r] of puffs) g.fillStyle(0xffffff, 1).fillCircle(x, y, r);
      g.fillStyle(0xffffff, 1).fillRoundedRect(30, 58, w - 50, 30, 15);
      g.generateTexture(`cloud${i}`, w, 110);
      g.destroy();
    });
  }

  update(_time, delta) {
    const { width } = this.scale;
    for (const c of this.clouds) {
      c.x += (c.speed * delta) / 1000;
      if (c.x - c.displayWidth / 2 > width) c.x = -c.displayWidth / 2;
    }
  }

  // ---------- logo ----------

  drawLogo() {
    const { width } = this.scale;
    const logo = makeText(this, width / 2, 92, 'POWER TRAIL', {
      fontFamily: FONT_TITLE, fontSize: '108px', color: '#ffffff',
      stroke: '#4A1D05', strokeThickness: 18, padding: { x: 12, y: 12 },
    }).setOrigin(0.5);
    const grad = logo.context.createLinearGradient(0, 0, 0, logo.height);
    grad.addColorStop(0.2, '#FFE14D');
    grad.addColorStop(0.55, '#FFB52E');
    grad.addColorStop(0.85, '#FB7A1E');
    logo.setFill(grad);
    logo.setShadow(0, 10, 'rgba(40,20,0,0.35)', 0, true, true);

    logo.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: logo, scale: 1, alpha: 1, duration: 600, ease: 'Back.Out' });
    this.tweens.add({
      targets: logo, y: 86, scaleX: 1.03, scaleY: 1.03,
      duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: 600,
    });

    if (this.data_.bestLevel > 0) {
      const best = makeText(this, width / 2, 170, `Best: Level ${this.data_.bestLevel}`, {
        fontFamily: FONT_TITLE, fontSize: '26px', color: '#ffffff', stroke: '#1E3A8A', strokeThickness: 6,
      }).setOrigin(0.5);
      const pill = this.add.graphics();
      const w = best.width + 40;
      pill.fillStyle(0x1e3a8a, 0.28).fillRoundedRect(width / 2 - w / 2, 170 - 20, w, 40, 20);
      best.setDepth(1);
    }
  }

  // ---------- starter cards ----------

  makeCard(key, i) {
    const formId = formFor(key, 1);
    const mon = byId.get(formId);
    const typeColour = TYPE_COLOURS[mon.types[0]] ?? 0xa8a77a;
    const startPower = mon.power * 1; // form power x level 1 (PRD rule 3)

    const totalW = STARTER_KEYS.length * CARD_W + (STARTER_KEYS.length - 1) * CARD_GAP;
    const x = this.scale.width / 2 - totalW / 2 + CARD_W / 2 + i * (CARD_W + CARD_GAP);
    const top = -CARD_H / 2;

    // Gold glow ring, shown when selected.
    const glow = this.add.graphics();
    for (let k = 6; k >= 1; k--) {
      glow.lineStyle(4, 0xffd54a, 0.08 + 0.06 * (6 - k));
      glow.strokeRoundedRect(-CARD_W / 2 - 4 - k * 3, top - 4 - k * 3, CARD_W + 8 + k * 6, CARD_H + 8 + k * 6, 28 + k * 3);
    }
    glow.lineStyle(6, 0xffc61a, 1).strokeRoundedRect(-CARD_W / 2 - 3, top - 3, CARD_W + 6, CARD_H + 6, 27);
    glow.setAlpha(0);

    const panel = makePanel(this, 0, 0, CARD_W, CARD_H);

    // Art backdrop in the type colour, with a soft spotlight behind the Pokémon.
    const backH = 168;
    const back = this.add.graphics();
    back.fillStyle(shade(typeColour, 22), 1)
      .fillRoundedRect(-CARD_W / 2 + 4, top + 4, CARD_W - 8, backH, { tl: 20, tr: 20, bl: 0, br: 0 });
    back.fillStyle(0xffffff, 0.35).fillCircle(0, top + 92, 70);
    back.fillStyle(0xffffff, 0.25).fillCircle(0, top + 92, 52);
    back.fillStyle(typeColour, 1).fillRect(-CARD_W / 2 + 4, top + 4 + backH, CARD_W - 8, 10);
    back.fillStyle(0x000000, 0.14).fillEllipse(0, top + 158, 104, 18);

    const typePill = makeText(this, -CARD_W / 2 + 18, top + 18, mon.types[0].toUpperCase(), {
      fontStyle: '900', fontSize: '13px', color: '#ffffff', stroke: '#00000033', strokeThickness: 0,
    });
    const pillBg = this.add.graphics();
    pillBg.fillStyle(shade(typeColour, -22), 1)
      .fillRoundedRect(typePill.x - 9, typePill.y - 3, typePill.width + 18, typePill.height + 6, 11);

    let art;
    if (this.textures.exists(pokemonKey(formId))) {
      art = this.add.image(0, top + 98, pokemonKey(formId));
      art.setScale(148 / art.height);
    } else {
      art = makeText(this, 0, top + 90, '?', { fontFamily: FONT_TITLE, fontSize: '80px', color: '#ffffff' }).setOrigin(0.5);
    }
    this.tweens.add({
      targets: art, y: art.y - 4, duration: 1100 + i * 130, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 170,
    });

    const name = makeText(this, 0, top + backH + 42, STARTERS[key].label, {
      fontFamily: FONT_TITLE, fontSize: '32px', color: INK,
    }).setOrigin(0.5);
    const powerLabel = makeText(this, 0, top + backH + 74, 'START POWER', {
      fontStyle: '900', fontSize: '13px', color: '#8A7360',
    }).setOrigin(0.5);
    const badge = makeBadge(this, startPower, 'player', { y: top + backH + 102, fontSize: 34 });
    const evolves = makeText(this, 0, top + backH + 138, evolvesLine(key), {
      fontStyle: '700', fontSize: '16px', color: '#6B5745',
    }).setOrigin(0.5);

    // Tick in the corner when selected.
    const tick = this.add.graphics();
    tick.fillStyle(0x16a34a, 1).fillCircle(CARD_W / 2 - 22, top + 22, 16);
    tick.lineStyle(5, 0xffffff, 1).beginPath();
    tick.moveTo(CARD_W / 2 - 30, top + 22).lineTo(CARD_W / 2 - 24, top + 28).lineTo(CARD_W / 2 - 13, top + 15).strokePath();
    tick.setAlpha(0);

    const card = this.add.container(x, CARD_Y, [glow, panel, back, art, pillBg, typePill, name, powerLabel, badge, evolves, tick]);
    card.setSize(CARD_W, CARD_H).setInteractive({ useHandCursor: true });
    Object.assign(card, { key, glow, tick, hovered: false });

    card.on('pointerover', () => { card.hovered = true; this.refreshCards(); });
    card.on('pointerout', () => { card.hovered = false; this.refreshCards(); });
    card.on('pointerup', () => {
      if (this.selected === key) return;
      this.selected = key;
      this.refreshCards();
      this.tweens.add({ targets: art, scale: art.scale * 1.12, duration: 120, yoyo: true, ease: 'Quad.Out' });
    });

    // Cards drop in one after another.
    card.y = CARD_Y + 40;
    card.setAlpha(0);
    this.tweens.add({ targets: card, y: CARD_Y, alpha: 1, duration: 450, delay: 150 + i * 90, ease: 'Back.Out' });
    return card;
  }

  refreshCards(instant = false) {
    for (const card of this.cards) {
      const selected = card.key === this.selected;
      const lift = selected ? -14 : card.hovered ? -10 : 0;
      const scale = selected ? 1.04 : 1;
      card.setDepth(selected ? 2 : card.hovered ? 1 : 0);
      if (instant) {
        card.glow.setAlpha(selected ? 1 : 0);
        card.tick.setAlpha(selected ? 1 : 0);
        continue;
      }
      this.tweens.add({ targets: card, y: CARD_Y + lift, scale, duration: 180, ease: 'Quad.Out' });
      this.tweens.add({ targets: [card.glow, card.tick], alpha: selected ? 1 : 0, duration: 180 });
    }
    // The drop-in tween targets CARD_Y, so apply the lift once it settles.
    if (instant) this.time.delayedCall(700, () => this.refreshCards());
  }

  // ---------- buttons ----------

  drawButtons() {
    const { width } = this.scale;
    const run = this.data_.run;

    makeButton(this, 116, 54, 'Trail Dex', 'secondary', () => this.scene.start('DexScene'), {
      height: 56, fontSize: 24, width: 180,
    });
    makeCog(this, width - 60, 50, () => this.openSettings());

    if (run) {
      const cont = makeButton(this, width / 2 - 170, BUTTON_Y, 'CONTINUE', 'secondary', () => this.continueRun(), {
        width: 300, height: 84, fontSize: 32, subtitle: `Level ${run.level}`,
      });
      // Small hearts next to "Level 14" inside the button.
      cont.subtitle.x = -34;
      cont.face.add(makeHearts(this, 48, 18, run.hearts, LEVEL_TUNING.lives, 15));
      makeButton(this, width / 2 + 170, BUTTON_Y, 'START', 'main', () => this.confirmNewRun(), {
        width: 300, height: 84, fontSize: 40,
      });
    } else {
      makeButton(this, width / 2, BUTTON_Y, 'START', 'main', () => this.startRun(), {
        width: 320, height: 84, fontSize: 42,
      });
    }
  }

  startRun() {
    const run = {
      starter: this.selected,
      runSeed: newRunSeed(),
      level: 1,
      hearts: LEVEL_TUNING.lives,
      stars: 0,
      history: [],
    };
    this.data_.run = run;
    save(this.data_);
    this.scene.start('LevelScene', { run });
  }

  continueRun() {
    this.scene.start('LevelScene', { run: this.data_.run });
  }

  // ---------- modals ----------

  openModal(w, h, build) {
    if (this.modal) return;
    const { width, height } = this.scale;
    const shade_ = this.add.rectangle(0, 0, width, height, 0x0b1630, 0.5).setOrigin(0).setInteractive();
    const panel = makePanel(this, width / 2, height / 2, w, h);
    const close = () => {
      shade_.destroy();
      panel.destroy();
      this.modal = null;
    };
    this.modal = { shade: shade_, panel };
    shade_.setDepth(10);
    panel.setDepth(11);
    build(panel, close);
    panel.setScale(0.85).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 220, ease: 'Back.Out' });
  }

  confirmNewRun() {
    const run = this.data_.run;
    this.openModal(560, 270, (panel, close) => {
      panel.add(makeText(this, 0, -80, 'Start a new run?', {
        fontFamily: FONT_TITLE, fontSize: '40px', color: INK,
      }).setOrigin(0.5));
      panel.add(makeText(this, 0, -24, `Your Level ${run.level} run will be lost.`, {
        fontStyle: '700', fontSize: '22px', color: '#6B5745',
      }).setOrigin(0.5));
      panel.add(makeButton(this, -120, 54, 'Cancel', 'secondary', close, { width: 200, height: 64, fontSize: 28 }));
      panel.add(makeButton(this, 120, 54, 'New run', 'danger', () => this.startRun(), { width: 200, height: 64, fontSize: 28 }));
    });
  }

  openSettings() {
    const settings = this.data_.settings;
    this.openModal(500, 340, (panel, close) => {
      panel.add(makeText(this, 0, -120, 'Settings', {
        fontFamily: FONT_TITLE, fontSize: '42px', color: INK,
      }).setOrigin(0.5));
      const row = (y, label, field) => {
        panel.add(makeText(this, -190, y, label, { fontStyle: '900', fontSize: '24px' }).setOrigin(0, 0.5));
        panel.add(this.makeToggle(160, y, settings[field], (on) => {
          settings[field] = on;
          save(this.data_);
        }));
      };
      row(-40, 'Hint mode', 'hint');
      row(30, 'Reduce motion', 'reduceMotion');
      panel.add(makeButton(this, 0, 112, 'Done', 'main', close, { width: 180, height: 60, fontSize: 28 }));
    });
  }

  makeToggle(x, y, on, onChange) {
    const w = 88;
    const h = 44;
    const g = this.add.graphics();
    const knob = this.add.circle(0, 0, h / 2 - 5, 0xffffff);
    const c = this.add.container(x, y, [g, knob]);
    const draw = () => {
      g.clear();
      g.fillStyle(on ? 0x15803d : 0x94a3b8, 1).fillRoundedRect(-w / 2, -h / 2 + 3, w, h, h / 2);
      g.fillStyle(on ? 0x22c55e : 0xcbd5e1, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      knob.x = on ? w / 2 - h / 2 : -w / 2 + h / 2;
    };
    draw();
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerup', () => {
      on = !on;
      draw();
      onChange(on);
    });
    return c;
  }
}
