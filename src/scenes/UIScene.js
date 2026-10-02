import Phaser from 'phaser';
import { LEVEL_TUNING } from '../../shared/config.js';
import { formatPower } from '../../shared/rules.js';
import { pokemonKey, itemKey } from '../assets.js';
import { paletteFor } from '../art/palettes.js';
import { getScreen, safeRect, watchResize } from '../layout/screen.js';
import { confetti } from '../art/effects.js';
import { load, save } from '../save.js';
import { STARTERS } from '../../shared/config.js';
import {
  makeText, makeBadge, makeHearts, makeStars, makeRoundButton, makeDialog, makePanel, makeButton, drawHeart, drawStar, px, shade,
  makeLevelChips, showChipInfo, levelChipLines,
  FONT_TITLE, INK, BADGE, TYPE_COLOURS, COLOURS,
} from '../art/ui.js';

// Live base stats from PokéAPI for the info card, cached for the session (PRD 6.4).
// Each entry: { state: 'loading' | 'ok' | 'error', stats? }. Failures aren't cached, so a later hold retries.
const statsCache = new Map();
const STAT_LABELS = { hp: 'HP', attack: 'Attack', defense: 'Defense', 'special-attack': 'Sp. Atk', 'special-defense': 'Sp. Def', speed: 'Speed' };
const STAT_COLOURS = { hp: 0x22c55e, attack: 0xef4444, defense: 0xf59e0b, 'special-attack': 0x3b82f6, 'special-defense': 0x8b5cf6, speed: 0xec4899 };

function fetchStats(id, onDone) {
  const hit = statsCache.get(id);
  if (hit) {
    if (hit.state === 'loading') hit.waiters.push(onDone);
    return hit;
  }
  const entry = { state: 'loading', waiters: [onDone] };
  statsCache.set(id, entry);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, { signal: ctrl.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`PokéAPI ${r.status}`);
      return r.json();
    })
    .then((json) => {
      entry.state = 'ok';
      entry.stats = json.stats.map((s) => ({ key: s.stat.name, value: s.base_stat }));
    })
    .catch((err) => {
      console.warn(`Stats for #${id} could not be loaded`, err.message);
      entry.state = 'error';
      statsCache.delete(id);
    })
    .finally(() => {
      clearTimeout(timer);
      for (const fn of entry.waiters) fn(entry);
      entry.waiters = [];
    });
  return entry;
}

// "mr-mime" -> "Mr Mime"
export const displayName = (name) => name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// Runs on top of LevelScene and holds the HUD, loading overlay, intro banner, info card and
// panels (PRD 7.7). It has its own camera, so zooming the map never shrinks any of it.
export default class UIScene extends Phaser.Scene {
  constructor() {
    super('UIScene');
  }

  create(data) {
    this.level = data.level;
    this.run = data.run;
    this.power = data.level.startPower;
    this.root = null;
    this.dialog = null;
    this.dialogSpec = null; // rebuilt at the new size on resize
    this.info = null; // { data, root }
    this.loading = null; // { p, root }
    this.nextShown = false; // "Next level" button after choosing Map on the clear panel
    this.clearInfo = null;
    this.vignette = this.add.image(0, 0, this.vignetteTexture()).setOrigin(0).setDepth(-1);

    // LevelScene tells us when it's loading, how far along, and when the stops are ready.
    const lv = this.scene.get('LevelScene');
    const handlers = {
      'level-loading': (level) => { this.setLevel(level, this.run); this.showLoading(0); },
      'load-progress': (p) => this.showLoading(p),
      'level-ready': () => { this.hideLoading(); this.layout(); this.showIntro(); },
    };
    for (const [ev, fn] of Object.entries(handlers)) lv.events.on(ev, fn);
    this.events.once('shutdown', () => { for (const [ev, fn] of Object.entries(handlers)) lv.events.off(ev, fn); });

    this.layout();
    watchResize(this, () => this.layout(), { immediate: () => this.vignette.setDisplaySize(this.scale.width, this.scale.height) });
    if (lv.ready) handlers['level-ready']();
    else this.showLoading(0);
  }

  setLevel(level, run) {
    this.level = level;
    this.run = run;
    this.power = level.startPower;
    this.closeInfo();
    this.layout();
  }

  // While a panel or the info card is open (or images are loading) the map ignores input.
  blocksInput() {
    return !!(this.dialog || this.info || this.loading);
  }

  layout() {
    const scr = getScreen(this);
    const s = scr.ui;
    this.drawVignette(scr);
    if (this.root) {
      this.tweens.killTweensOf(this.root.getAll());
      this.root.destroy();
    }
    this.root = this.add.container(0, 0);
    const area = safeRect(scr, Math.max(10, 14 * s));
    const gap = Math.max(8, 12 * s);

    // Top left: power pill with the player's Pokémon icon.
    const pill = this.powerPill(s);
    pill.setPosition(area.left + pill.pw / 2, area.top + pill.ph / 2);

    // Top right: hearts.
    const hs = Math.max(24, 32 * s);
    const hearts = makeHearts(this, 0, 0, this.run.hearts, LEVEL_TUNING.lives, hs);
    hearts.setPosition(area.right - hearts.width / 2 - 4, area.top + pill.ph / 2);

    // Top centre: level name. On narrow screens it moves under the power pill.
    const name = this.levelName(s);
    const fitsCentre = name.nw / 2 + gap <= scr.w / 2 - (area.left + pill.pw)
      && name.nw / 2 + gap <= (area.right - hearts.width) - scr.w / 2;
    if (fitsCentre) name.setPosition(scr.w / 2, area.top + pill.ph / 2);
    else name.setPosition(area.left + name.nw / 2, area.top + pill.ph + gap + name.nh / 2);

    // Bottom right: pause.
    const size = Math.max(52, 64 * s);
    const pause = makeRoundButton(this, area.right - size / 2, area.bottom - size / 2, () => this.openPause(), size, (g, R) => {
      g.fillStyle(0xffffff, 1).fillRoundedRect(-R * 0.32, -R * 0.36, R * 0.22, R * 0.72, R * 0.08)
        .fillRoundedRect(R * 0.1, -R * 0.36, R * 0.22, R * 0.72, R * 0.08);
    });

    this.root.add([pill, name, hearts, pause]);
    // How much of the screen the HUD covers, so the camera can scroll the map clear of it.
    this.hudInsets = {
      top: Math.max(pill.y + pill.ph / 2, name.y + name.nh / 2) + gap,
      bottom: scr.h - (pause.y - size / 2) + gap,
    };
    this.scene.get('LevelScene')?.updateBounds?.();
    if (this.nextShown) {
      const bs = Math.max(0.8, s);
      const next = makeButton(this, 0, 0, 'Next level', 'main', () => this.clearInfo.next(), { scale: bs, width: 240, height: 64, fontSize: 28 });
      next.setPosition(scr.w / 2, area.bottom - next.btnH / 2);
      // On narrow screens keep it clear of the pause button.
      if (next.x + next.btnW / 2 > area.right - size - gap) next.x = area.right - size - gap - next.btnW / 2;
      this.tweens.add({ targets: next, scale: 1.05, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.root.add(next);
    }
    Object.assign(this, { pill, hearts, heartSize: hs });

    // Overlays are rebuilt at the new size.
    if (this.loading) this.showLoading(this.loading.p);
    if (this.info) this.showInfo(this.info.data, false);
    if (this.dialog) {
      this.dialog.root.destroy();
      this.openDialog(this.dialogSpec, false);
    }
  }

  powerPill(s) {
    const ph = Math.max(48, 64 * s);
    const icon = ph * 0.86;
    const badge = makeBadge(this, this.power, 'player', { fontSize: 34, scale: Math.max(0.8, s) });
    const pw = icon + badge.width + ph * 0.45;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18).fillRoundedRect(-pw / 2 + 2, -ph / 2 + 4, pw, ph, ph / 2);
    g.fillStyle(0x1e3a8a, 1).fillRoundedRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    g.fillStyle(0xffffff, 0.95).fillRoundedRect(-pw / 2 + 3, -ph / 2 + 3, pw - 6, ph - 6, (ph - 6) / 2);
    g.fillStyle(0xdbeafe, 1).fillCircle(-pw / 2 + ph / 2, 0, icon / 2);
    g.lineStyle(3, BADGE.player, 1).strokeCircle(-pw / 2 + ph / 2, 0, icon / 2);
    const parts = [g];
    // The art is loaded by LevelScene with the rest of the level's images.
    const key = pokemonKey(this.level.form.id);
    if (this.textures.exists(key)) {
      const img = this.add.image(-pw / 2 + ph / 2, 0, key);
      img.setScale((icon * 0.95) / img.height);
      parts.push(img);
    }
    badge.setPosition(-pw / 2 + icon + ph * 0.1 + badge.width / 2, 0);
    parts.push(badge);
    const c = this.add.container(0, 0, parts);
    Object.assign(c, { pw, ph, badge });
    return c;
  }

  levelName(s) {
    const font = Math.max(16, 24 * s);
    const t = makeText(this, 0, 0, `Level ${this.level.level} · ${this.level.biomeLabel}`, {
      fontFamily: FONT_TITLE, fontSize: px(font), color: '#ffffff', stroke: '#1E3A8A', strokeThickness: Math.max(4, 6 * s),
    }).setOrigin(0.5);
    const nw = t.width + font * 1.4;
    const nh = font * 1.7;
    const g = this.add.graphics();
    g.fillStyle(0x1e3a8a, 0.35).fillRoundedRect(-nw / 2, -nh / 2, nw, nh, nh / 2);
    const c = this.add.container(0, 0, [g, t]);
    Object.assign(c, { nw, nh });
    return c;
  }

  // Pause and settings (PRD 6.10). Restart level costs no heart; the attempt is saved as incomplete.
  openPause() {
    const lv = this.scene.get('LevelScene');
    if (this.dialog || this.loading || lv.ended === 'fainted') return;
    this.closeInfo();
    const buttons = [{ label: 'Resume', colour: 'main', onClick: (close) => close() }];
    if (lv.canRestart?.()) buttons.push({ label: 'Restart level', colour: 'secondary', onClick: () => lv.restartLevel() });
    buttons.push({ label: 'Quit to title', colour: 'danger', onClick: () => lv.scene.start('TitleScene') });
    this.openDialog({
      title: 'Paused',
      width: 460,
      stackButtons: true,
      toggles: [
        { label: 'Hint mode', get: () => !!lv.settings?.hint, set: (on) => lv.setSetting('hint', on) },
        { label: 'Reduce motion', get: () => !!lv.settings?.reduceMotion, set: (on) => lv.setSetting('reduceMotion', on) },
        { label: 'Mute all sound', get: () => lv.settings?.muted ?? true, set: (on) => lv.setSetting('muted', on) },
        { label: 'Sound effects', get: () => lv.settings?.soundEffects ?? true, set: (on) => lv.setSetting('soundEffects', on) },
      ],
      buttons,
    });
  }

  openDialog(spec, animate = true) {
    this.dialogSpec = spec;
    this.dialog = makeDialog(this, spec, { animate, onClose: () => { this.dialog = null; this.dialogSpec = null; } });
  }

  // ---------- power ----------

  // During a count-up only the number changes; at the end the pill is rebuilt (it may be wider) and bounces.
  setPowerDisplay(v, bounce) {
    this.power = v;
    if (!bounce) {
      this.pill?.badge.setValue(v);
      return;
    }
    this.layout();
    this.tweens.add({ targets: this.pill.badge, scale: bounce, duration: 120, yoyo: true, ease: 'Quad.Out' });
  }

  // Item card flies up (art, name, stars, +value), then shrinks into the power pill.
  showItemCard(stop) {
    const scr = getScreen(this);
    const s = Math.max(0.8, scr.ui);
    const w = 230 * s;
    const h = 210 * s;
    const card = makePanel(this, scr.w / 2, scr.h * 0.55, w, h, { scale: s });
    const key = itemKey(stop.sprite);
    if (this.textures.exists(key)) card.add(this.add.image(0, -h * 0.25, key).setScale(2.4 * s));
    card.add(makeText(this, 0, h * 0.02, stop.label, { fontFamily: FONT_TITLE, fontSize: px(24 * s), color: INK }).setOrigin(0.5));
    card.add(makeStars(this, 0, h * 0.18, stop.stars, 3, 20 * s));
    card.add(makeBadge(this, stop.value, 'item', { prefix: '+', fontSize: 32, scale: s, y: h * 0.36 }));
    card.setDepth(85).setAlpha(0).setScale(0.7);
    const target = this.pill ? { x: this.pill.x, y: this.pill.y } : { x: 40, y: 40 };
    this.tweens.chain({
      targets: card,
      tweens: [
        { y: scr.h * 0.42, alpha: 1, scale: 1, duration: 220, ease: 'Back.Out' },
        { y: scr.h * 0.42, duration: 380 },
        { x: target.x, y: target.y, scale: 0.15, alpha: 0.2, duration: 300, ease: 'Quad.In', onComplete: () => card.destroy() },
      ],
    });
  }

  // ---------- fainting: red flash, banner, a heart cracks off, then Try again / Quit ----------

  faintSequence(heartsLeft, { retry, quit, newRun, dex, summary }) {
    const scr = getScreen(this);
    const flash = this.add.rectangle(0, 0, scr.w, scr.h, 0xef4444, 0).setOrigin(0).setDepth(85);
    this.tweens.add({ targets: flash, alpha: 0.45, duration: 120, yoyo: true, hold: 60, onComplete: () => flash.destroy() });
    this.crackHeart(heartsLeft);
    this.showBanner('You fainted!', 0xdc2626, { hold: 800 });
    this.time.delayedCall(1350, () => {
      if (heartsLeft > 0) {
        this.openDialog({
          title: 'You fainted!',
          message: `${heartsLeft} ${heartsLeft === 1 ? 'heart' : 'hearts'} left. Try the level again from the start?`,
          width: 520,
          buttons: [
            { label: 'Try again', colour: 'main', onClick: retry },
            { label: 'Quit to title', colour: 'secondary', onClick: quit },
          ],
        });
      } else {
        this.gameOver(summary, { newRun, dex });
      }
    });
  }

  // The heart that was just lost cracks and falls off the HUD.
  crackHeart(heartsLeft) {
    const hearts = this.hearts;
    if (!hearts) return;
    const max = LEVEL_TUNING.lives;
    const size = this.heartSize;
    const gap = size * 1.25;
    hearts.setCount(heartsLeft + 1);
    const x = hearts.x + (heartsLeft - (max - 1) / 2) * gap;
    const y = hearts.y;
    const g = this.add.graphics().setDepth(86).setPosition(x, y);
    drawHeart(g, 0, 0, size, true);
    g.lineStyle(Math.max(2, size * 0.08), 0x7f1d1d, 1).beginPath()
      .moveTo(-size * 0.05, -size * 0.3).lineTo(size * 0.08, -size * 0.12).lineTo(-size * 0.06, size * 0.04).lineTo(size * 0.06, size * 0.22).strokePath();
    this.time.delayedCall(140, () => hearts.setCount(heartsLeft));
    this.tweens.chain({
      targets: g,
      tweens: [
        { x: x + 3, duration: 40, yoyo: true, repeat: 3 },
        { y: y + 120, angle: 50, alpha: 0, duration: 650, ease: 'Quad.In', onComplete: () => g.destroy() },
      ],
    });
  }

  showBanner(text, colour, { hold = 700 } = {}) {
    const scr = getScreen(this);
    const s = Math.max(0.8, scr.ui);
    const t = makeText(this, 0, 0, text, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(30, 48 * s)), color: '#ffffff', stroke: '#450a0a', strokeThickness: 10 * s,
    }).setOrigin(0.5);
    const bw = Math.min(scr.w * 0.92, t.width + 80 * s);
    if (t.width > bw - 40) t.setScale((bw - 40) / t.width);
    const bh = 96 * s;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-bw / 2 + 4, -bh / 2 + 8, bw, bh, bh / 2);
    g.fillStyle(shade(colour, -25), 1).fillRoundedRect(-bw / 2, -bh / 2 + 5, bw, bh, bh / 2);
    g.fillStyle(colour, 1).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    const banner = this.add.container(scr.w / 2, scr.h * 0.4, [g, t]).setDepth(87).setScale(0.4).setAlpha(0);
    this.tweens.chain({
      targets: banner,
      tweens: [
        { scale: 1, alpha: 1, duration: 220, ease: 'Back.Out' },
        { scale: 1, duration: hold },
        { alpha: 0, y: banner.y - 30, duration: 220, onComplete: () => banner.destroy() },
      ],
    });
  }

  // Game over (PRD 6.7): level reached, total stars, Pokémon beaten, new Trail Dex entries.
  gameOver(sum, { newRun, dex }) {
    const verification = sum.verification;
    const spec = {
      title: 'Out of hearts!',
      width: 560,
      rows: [
        { build: (scene, inner, s) => statGrid(scene, inner, s, [
          ['Level reached', `${sum.level}`],
          ['Total stars', `${sum.stars}`, 'star'],
          ['Pokémon beaten', `${sum.beaten}`],
          ['New in Trail Dex', `+${sum.newDex}`],
        ]) },
        // Every level cleared this run; tap one for its power and best.
        { build: (scene, inner, s) => (sum.results?.length ? makeLevelChips(scene, sum.results, inner, Math.max(0.8, s), (e, chip) => {
          const m = chip.getWorldTransformMatrix();
          showChipInfo(scene, m.tx, m.ty, levelChipLines(e, sum.bestByLevel?.[e.level], (k) => STARTERS[k]?.label ?? k), Math.max(0.8, s));
        }) : null) },
      ],
      message: '',
      buttons: [],
    };
    const render = () => {
      spec.message = [
        `Your Trail Dex has ${sum.dexTotal} Pokémon. Pick a starter and climb again!`,
        sum.verificationResult?.label ?? (verification ? 'Verifying run…' : 'Not verified'),
      ].join('\n');
      spec.buttons = [
        ...(sum.verificationResult?.verified ? [{
          label: 'Submit score', colour: 'main', onClick: (close) => { close(); this.openInitialsPicker(sum); },
        }] : []),
        { label: 'New run', colour: sum.verificationResult?.verified ? 'secondary' : 'main', onClick: newRun },
        { label: 'Trail Dex', colour: 'secondary', onClick: dex },
      ];
      this.openDialog(spec, false);
    };
    render();
    if (verification) {
      this.gameOverVerification = verification;
      verification.then((result) => {
        if (this.gameOverVerification !== verification) return;
        sum.verificationResult = result;
        if (this.dialogSpec === spec && this.dialog) {
          this.dialog.root.destroy();
          this.dialog = null;
          render();
        }
      });
    }
  }

  openInitialsPicker(sum) {
    const letters = ['A', 'A', 'A'];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const spec = {
      title: 'Enter your initials',
      message: 'Choose 3 letters for the leaderboard.',
      width: 520,
      rows: [{
        build: (scene, inner, s) => {
          const row = scene.add.container(0, 0);
          const cellW = Math.min(128 * s, (inner - 24 * s) / 3);
          const gap = Math.max(8, 12 * s);
          for (let i = 0; i < 3; i++) {
            const x = (i - 1) * (cellW + gap);
            const up = makeButton(scene, x, -63 * s, '▲', 'secondary', () => {
              letters[i] = alphabet[(alphabet.indexOf(letters[i]) + 1) % alphabet.length];
              faces[i].setText(letters[i]);
            }, { scale: Math.max(0.8, s), width: 62, height: 48, fontSize: 18 });
            const down = makeButton(scene, x, 63 * s, '▼', 'secondary', () => {
              letters[i] = alphabet[(alphabet.indexOf(letters[i]) + alphabet.length - 1) % alphabet.length];
              faces[i].setText(letters[i]);
            }, { scale: Math.max(0.8, s), width: 62, height: 48, fontSize: 18 });
            const tile = scene.add.graphics();
            tile.fillStyle(0xfff8e8, 1).fillRoundedRect(x - cellW / 2, -38 * s, cellW, 76 * s, 14 * s);
            tile.lineStyle(3, 0xd6a83e, 1).strokeRoundedRect(x - cellW / 2, -38 * s, cellW, 76 * s, 14 * s);
            const face = makeText(scene, x, 0, letters[i], {
              fontFamily: FONT_TITLE, fontSize: px(54 * s), color: INK, align: 'center',
            }).setOrigin(0.5);
            faces.push(face);
            row.add([tile, face, up, down]);
          }
          row.rowH = 170 * s;
          return row;
        },
      }],
      buttons: [
        { label: 'Back', colour: 'secondary', onClick: (close) => { close(); this.gameOver(sum, { newRun: () => this.scene.start('TitleScene'), dex: () => this.scene.start('DexScene') }); } },
        { label: 'Submit', colour: 'main', onClick: (close) => { close(); this.submitLeaderboard(sum, letters.join('')); } },
      ],
    };
    const faces = [];
    this.openDialog(spec);
  }

  async submitLeaderboard(sum, initials) {
    try {
      const response = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sum.run, initials }),
      });
      const result = await response.json();
      if (!response.ok || result.saved !== true || !Array.isArray(result.entries)) {
        this.openDialog({ title: 'Score not saved', message: result.reason || 'Not verified', width: 500,
          buttons: [{ label: 'Back', colour: 'main', onClick: (close) => { close(); this.gameOver(sum, {
            newRun: () => this.scene.start('TitleScene'), dex: () => this.scene.start('DexScene'),
          }); } }],
        });
        return;
      }
      this.showLeaderboard(result.entries, result.highlightedIndex, /^\d{4}-\d{2}-\d{2}$/.test(sum.run.runSeed));
    } catch {
      this.openDialog({ title: 'Score not saved', message: 'Leaderboard unavailable', width: 500,
        buttons: [{ label: 'Back', colour: 'main', onClick: (close) => { close(); this.gameOver(sum, {
          newRun: () => this.scene.start('TitleScene'), dex: () => this.scene.start('DexScene'),
        }); } }],
      });
    }
  }

  showLeaderboard(entries, highlightedIndex, daily) {
    this.openDialog({
      title: daily ? 'Daily Top 10' : 'All-Time Top 10',
      width: 580,
      rows: [{
        build: (scene, inner, s) => {
          const row = scene.add.container(0, 0);
          const shown = entries.slice(0, 10);
          const rowH = 38 * s;
          shown.forEach((entry, index) => {
            const y = (index - (shown.length - 1) / 2) * rowH;
            if (index === highlightedIndex) {
              const bg = scene.add.graphics();
              bg.fillStyle(0xfde68a, 0.95).fillRoundedRect(-inner / 2, y - rowH * 0.43, inner, rowH * 0.86, 8 * s);
              row.add(bg);
            }
            const place = String(index + 1).padStart(2, '0');
            const starter = STARTERS[entry.starter]?.label ?? entry.starter;
            const text = `${place}   ${entry.initials}   ${starter}   L${entry.levelsCleared}   ${'★'.repeat(entry.stars)}`;
            const line = makeText(scene, 0, y, text, {
              fontFamily: FONT_TITLE, fontSize: px(Math.max(13, 20 * s)), color: INK,
            }).setOrigin(0.5);
            if (line.width > inner - 8 * s) line.setScale((inner - 8 * s) / line.width);
            row.add(line);
          });
          row.rowH = Math.max(44, shown.length * rowH);
          return row;
        },
      }],
      buttons: [{ label: 'Done', colour: 'main', onClick: (close) => close() }],
    });
  }

  // Level clear (PRD 6.6): confetti, stars pop in one by one, power vs best possible,
  // "+1 heart" when earned, then Next level or Map (look around first).
  clearedPanel({ level, stars, power, best, heart, hearts, verified, next, prev, newBest }) {
    const lv = this.scene.get('LevelScene');
    const reduce = !!lv.settings?.reduceMotion;
    this.clearInfo = { level, stars, power, best, heart, verified, next, prev, newBest };
    if (heart) this.time.delayedCall(700, () => this.gainHeart(hearts));
    this.showBanner(`Level ${level} cleared!`, 0x16a34a, { hold: 500 });
    this.time.delayedCall(900, () => {
      const scr = getScreen(this);
      confetti(this, scr.w / 2, scr.h * 0.18, reduce, { count: 90, spread: scr.w * 0.45, rise: scr.h * 0.25, fall: scr.h * 0.7, depth: 99, scale: Math.max(0.8, scr.ui) });
      this.openClearPanel(true);
    });
  }

  openClearPanel(animate) {
    const c = this.clearInfo;
    const rows = [
      { build: (scene, inner, s, anim) => starRow(scene, c.stars, Math.max(46, 64 * s), anim) },
      { build: (scene, inner, s) => statGrid(scene, inner, s, [
        ['Power', c.power.toLocaleString('en-US')],
        ['Best possible', c.best.toLocaleString('en-US')],
      ]) },
    ];
    if (c.newBest) rows.unshift({ build: (scene, inner, s, anim) => newBestRow(scene, s, anim, c.prev) });
    if (c.heart) rows.push({ build: (scene, inner, s, anim) => heartRow(scene, s, anim) });
    this.openDialog({
      title: `Level ${c.level} cleared!`,
      width: 560,
      rows,
      message: [
        !c.newBest && c.prev ? `Best ever: ${'★'.repeat(c.prev.stars)} ${c.prev.power.toLocaleString('en-US')} (${starterLabel(c.prev.starter)})` : null,
        c.verified ? null : '(this run would not pass the check)',
      ].filter(Boolean).join('\n') || null,
      buttons: [
        { label: 'Next level', colour: 'main', onClick: () => c.next() },
        { label: 'Map', colour: 'secondary', onClick: (close) => { close(); this.showNextButton(); } },
      ],
    }, animate);
  }

  // After "Map": a Next level button stays on screen while you look around.
  showNextButton() {
    this.nextShown = true;
    this.layout();
  }

  // A heart flies in and fills the next empty slot.
  gainHeart(hearts) {
    const h = this.hearts;
    if (!h) return;
    h.setCount(hearts);
    this.tweens.add({ targets: h, scale: 1.3, duration: 160, yoyo: true, repeat: 1, ease: 'Quad.Out' });
  }

  // ---------- first-time tutorial (PRD 6.4): a bouncing hand over the weakest reachable Pokémon ----------

  showTutorial(target) {
    this.hideTutorial();
    const scr = getScreen(this);
    const s = Math.max(0.8, scr.ui);
    const hand = this.add.graphics();
    drawHand(hand, 34 * s);
    const handBox = this.add.container(0, 0, [hand]).setDepth(70);
    const text = makeText(this, 0, 0, 'Tap any Pokémon with a smaller number than yours!', {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(18, 26 * s)), color: '#ffffff', stroke: '#1E3A8A', strokeThickness: 7 * s,
      align: 'center', wordWrap: { width: Math.min(scr.w * 0.86, 560 * s), useAdvancedWrap: true },
    }).setOrigin(0.5);
    const bw = text.width + 40 * s;
    const bh = text.height + 26 * s;
    const bg = this.add.graphics().fillStyle(0x1e3a8a, 0.55).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 18 * s);
    const area = safeRect(scr, 12);
    const bubble = this.add.container(scr.w / 2, area.bottom - bh / 2 - Math.max(64, 76 * s), [bg, text]).setDepth(70);
    this.tweens.add({ targets: hand, y: -16 * s, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.tutorial = { target, handBox, hand, bubble };
  }

  hideTutorial() {
    if (!this.tutorial) return;
    const { handBox, hand, bubble } = this.tutorial;
    this.tutorial = null;
    this.tweens.killTweensOf(hand);
    handBox.destroy();
    bubble.destroy();
    const data = load();
    if (!data.tutorialDone) {
      data.tutorialDone = true;
      save(data);
    }
  }

  // The hand follows its target on screen while the camera moves.
  update() {
    const t = this.tutorial;
    if (!t) return;
    const lv = this.scene.get('LevelScene');
    const c = t.target;
    if (!c.active) { this.hideTutorial(); return; }
    const cam = lv.cameras.main;
    const x = (c.x - cam.worldView.x) * cam.zoom;
    const y = (c.y + c.hit.dy - cam.worldView.y) * cam.zoom;
    // Tilted, fingertip on the Pokémon's right side, clear of its power badge.
    t.handBox.setPosition(x + c.hit.r * 0.55 * cam.zoom, y).setAngle(35);
  }

  // ---------- loading overlay ----------

  showLoading(p) {
    this.loading?.root.destroy();
    const scr = getScreen(this);
    const s = scr.ui;
    const root = this.add.container(0, 0).setDepth(90);
    const dim = this.add.rectangle(0, 0, scr.w, scr.h, 0x0b1630, 0.35).setOrigin(0);
    const pw = Math.min(360 * s, scr.w * 0.8);
    const ph = 110 * Math.max(0.8, s);
    const panel = makePanel(this, scr.w / 2, scr.h / 2, pw, ph, { scale: s });
    const label = makeText(this, 0, -ph * 0.18, 'Loading Pokémon…', {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(18, 26 * s)), color: INK,
    }).setOrigin(0.5);
    const bw = pw * 0.75;
    const bh = Math.max(12, 16 * s);
    const bar = this.add.graphics();
    bar.fillStyle(0xe6cfa6, 1).fillRoundedRect(-bw / 2, ph * 0.18 - bh / 2, bw, bh, bh / 2);
    bar.fillStyle(COLOURS.main, 1).fillRoundedRect(-bw / 2, ph * 0.18 - bh / 2, Math.max(bh, bw * p), bh, bh / 2);
    panel.add([label, bar]);
    root.add([dim, panel]);
    this.loading = { p, root };
  }

  hideLoading() {
    if (!this.loading) return;
    const { root } = this.loading;
    this.loading = null;
    this.tweens.add({ targets: root, alpha: 0, duration: 150, onComplete: () => root.destroy() });
  }

  // ---------- intro banner (PRD 6.3): slides in, 1.2s total, then the map is playable ----------

  showIntro() {
    const scr = getScreen(this);
    const s = Math.max(0.8, scr.ui);
    const pal = paletteFor(this.level.biome);
    const bh = 88 * s;
    const icon = bh * 0.8;
    const text = makeText(this, 0, 0, `Level ${this.level.level} · ${this.level.biomeLabel}`, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(22, 36 * s)), color: '#ffffff', stroke: '#1E293B', strokeThickness: 8 * s,
    }).setOrigin(0, 0.5);
    const maxW = scr.w * 0.94;
    const bw = Math.min(maxW, icon + text.width + bh * 0.7);
    if (icon + text.width + bh * 0.7 > maxW) text.setScale((maxW - icon - bh * 0.7) / text.width);
    const colour = shade(pal.cliff, -10);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-bw / 2 + 4, -bh / 2 + 8, bw, bh, bh / 2);
    g.fillStyle(shade(colour, -25), 1).fillRoundedRect(-bw / 2, -bh / 2 + 5, bw, bh, bh / 2);
    g.fillStyle(colour, 1).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    g.fillStyle(0xffffff, 0.18).fillRoundedRect(-bw / 2 + 10, -bh / 2 + 6, bw - 20, bh * 0.35, bh * 0.2);
    const iconG = this.add.graphics();
    drawBiomeIcon(iconG, pal.key, icon / 2);
    iconG.setPosition(-bw / 2 + bh * 0.15 + icon / 2, 0);
    text.setPosition(-bw / 2 + bh * 0.3 + icon, 0);
    const banner = this.add.container(-bw, scr.h * 0.42, [g, iconG, text]).setDepth(80);
    // Difficulty follows scores (PRD 4.7): say so when this level is tougher or easier.
    const d = this.level.difficulty ?? 0;
    const note = d > 0 ? "🔥 Tougher trail: you've been crushing it!" : d < 0 ? '🌱 Easier trail this time' : null;
    this.introNote = note;
    if (note) {
      const nt = makeText(this, 0, 0, note, {
        fontStyle: '900', fontSize: px(Math.max(16, 22 * s)), color: '#ffffff', stroke: d > 0 ? '#9A3412' : '#166534', strokeThickness: 5 * s,
      }).setOrigin(0.5);
      if (nt.width > maxW - 30 * s) nt.setScale((maxW - 30 * s) / nt.width);
      const nw = nt.displayWidth + 36 * s;
      const nh = nt.displayHeight + 16 * s;
      const ny = bh / 2 + 14 * s + nh / 2;
      const ng = this.add.graphics();
      ng.fillStyle(d > 0 ? 0xea580c : 0x16a34a, 1).fillRoundedRect(-nw / 2, ny - nh / 2, nw, nh, nh / 2);
      nt.setY(ny);
      banner.add([ng, nt]);
    }
    const done = () => {
      banner.destroy();
      this.scene.get('LevelScene').onIntroDone?.();
    };
    this.tweens.chain({
      targets: banner,
      tweens: [
        { x: scr.w / 2, duration: 300, ease: 'Back.Out' },
        { x: scr.w / 2, duration: note ? 1100 : 600 }, // a little longer to read the note
        { x: scr.w + bw, duration: 300, ease: 'Quad.In', onComplete: done },
      ],
    });
  }

  // ---------- info card (hold 0.5s on a Pokémon) ----------

  showInfo(info, animate = true) {
    this.stopSpinner();
    this.info?.root.destroy();
    const scr = getScreen(this);
    const s = scr.ui;
    const area = safeRect(scr, 12);
    const cw = Math.min(480 * s, scr.w * 0.92);
    const stacked = cw < 420;
    const pad = Math.max(16, 22 * s);
    const artSize = stacked ? Math.min(140 * s, cw * 0.45) : 150 * s;
    const textW = stacked ? cw - pad * 2 : cw - artSize - pad * 3;

    const root = this.add.container(0, 0).setDepth(95);
    const dim = this.add.rectangle(0, 0, scr.w, scr.h, 0x0b1630, 0.3).setOrigin(0)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, 10000, 10000), Phaser.Geom.Rectangle.Contains);
    // Close on the next press: the release of the hold that opened the card must not close it.
    dim.on('pointerdown', () => this.closeInfo());
    root.add(dim);

    const items = [];
    const name = makeText(this, 0, 0, displayName(info.name), { fontFamily: FONT_TITLE, fontSize: px(Math.max(24, 36 * s)), color: INK });
    if (name.width > textW) name.setScale(textW / name.width);
    items.push(name);

    // Type pills (and an Alpha / You tag).
    const pills = this.add.container(0, 0);
    let px_ = 0;
    const pillFont = Math.max(12, 15 * s);
    const tags = [...info.types.map((t) => [t.toUpperCase(), TYPE_COLOURS[t] ?? 0x888888])];
    if (info.alpha > 1) tags.push([`ALPHA ×${info.alpha}`, 0xdc2626]);
    if (info.you) tags.push(['YOU', BADGE.player]);
    for (const [label, colour] of tags) {
      const t = makeText(this, 0, 0, label, { fontStyle: '900', fontSize: px(pillFont), color: '#ffffff' }).setOrigin(0, 0.5);
      const w = t.width + pillFont * 1.3;
      const h = pillFont * 1.8;
      const bg = this.add.graphics().fillStyle(colour, 1).fillRoundedRect(px_, -h / 2, w, h, h / 2);
      t.setPosition(px_ + pillFont * 0.65, 0);
      pills.add([bg, t]);
      px_ += w + 6;
    }
    pills.height_ = pillFont * 1.8;
    items.push(pills);

    // The power maths: "Bulbasaur 318 × Level 1 × Alpha 14 = 4,452"
    // On the map: "Bulbasaur 318 × Level 1 × Alpha 14 = 4,452". In the Trail Dex (no level): its base power.
    const maths = info.level == null
      ? `Power ${formatPower(info.base)} (its 6 base stats added up)`
      : `${displayName(info.name)} ${formatPower(info.base)} × Level ${info.level}`
        + `${info.alpha > 1 ? ` × Alpha ${info.alpha}` : ''} = ${formatPower(info.power)}`;
    const m = makeText(this, 0, 0, maths, {
      fontStyle: '800', fontSize: px(Math.max(15, 19 * s)), color: '#6B5745', wordWrap: { width: textW, useAdvancedWrap: true },
    });
    items.push(m);
    const hint = makeText(this, 0, 0, 'Tap anywhere to close', { fontStyle: '700', fontSize: px(Math.max(12, 13 * s)), color: '#A08A74' });
    items.push(hint);

    const gap = Math.max(8, 10 * s);
    const heightOf = (o) => o.height_ ?? o.displayHeight;
    const textH = items.reduce((sum, o) => sum + heightOf(o), 0) + gap * (items.length - 1);
    const topH = stacked ? artSize + gap + textH : Math.max(artSize, textH);

    // The 6 base stats, fetched live from PokéAPI. The block keeps its height while loading.
    const entry = fetchStats(info.id, () => {
      if (this.sys.isActive() && this.info?.data === info) this.showInfo(info, false);
    });
    const stats = this.statsBlock(entry, cw - pad * 2, s);
    const ch = pad * 2 + topH + gap * 1.5 + stats.rowH;
    const panel = makePanel(this, area.cx, area.cy, cw, Math.min(ch, area.height), { scale: s });
    if (ch > area.height) panel.setScale(area.height / ch);
    stats.setPosition(-cw / 2 + pad, -ch / 2 + pad + topH + gap * 1.5);
    panel.add(stats);

    // Art on a soft circle.
    const ax = stacked ? 0 : -cw / 2 + pad + artSize / 2;
    const ay = -ch / 2 + pad + artSize / 2;
    const disc = this.add.graphics().fillStyle(TYPE_COLOURS[info.types[0]] ?? 0xdddddd, 0.3).fillCircle(ax, ay, artSize / 2);
    panel.add(disc);
    const key = pokemonKey(info.id);
    if (this.textures.exists(key)) {
      const img = this.add.image(ax, ay, key);
      img.setScale((artSize * 0.95) / img.height);
      panel.add(img);
    }
    let y = stacked ? ay + artSize / 2 + gap : -ch / 2 + pad + Math.max(0, (artSize - textH) / 2);
    const x = stacked ? -textW / 2 : -cw / 2 + pad * 2 + artSize;
    for (const o of items) {
      if (o === pills) o.setPosition(x, y + o.height_ / 2);
      else o.setPosition(x, y);
      panel.add(o);
      y += heightOf(o) + gap;
    }
    root.add(panel);
    if (animate) {
      panel.setScale(0.85).setAlpha(0);
      this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
    }
    this.info = { data: info, root };
  }

  // Stat bars (or a loading / friendly error message in the same space). Top-left origin.
  statsBlock(entry, w, s) {
    const c = this.add.container(0, 0);
    const rowH = Math.max(20, 24 * s);
    const font = Math.max(12, 14 * s);
    const h = rowH * 6 + font * 1.8;
    c.rowH = h;
    const head = makeText(this, 0, 0, 'BASE STATS', { fontStyle: '900', fontSize: px(font), color: '#8A7058' });
    c.add(head);
    const top = font * 1.8;
    if (entry.state === 'ok') {
      const total = entry.stats.reduce((sum, x) => sum + x.value, 0);
      c.add(makeText(this, w, 0, `Total ${total}`, { fontStyle: '900', fontSize: px(font), color: '#8A7058' }).setOrigin(1, 0));
      const labelW = 72 * Math.max(0.85, s);
      const valW = 40 * Math.max(0.85, s);
      const barW = w - labelW - valW - 8;
      const g = this.add.graphics();
      c.add(g);
      entry.stats.forEach((st, i) => {
        const y = top + i * rowH + rowH / 2;
        c.add(makeText(this, 0, y, STAT_LABELS[st.key] ?? st.key, { fontStyle: '800', fontSize: px(font), color: INK }).setOrigin(0, 0.5));
        c.add(makeText(this, labelW + valW - 6, y, `${st.value}`, { fontStyle: '900', fontSize: px(font), color: INK }).setOrigin(1, 0.5));
        const bh = rowH * 0.45;
        const x0 = labelW + valW;
        g.fillStyle(0xe8d6b5, 1).fillRoundedRect(x0, y - bh / 2, barW, bh, bh / 2);
        g.fillStyle(STAT_COLOURS[st.key] ?? 0x64748b, 1).fillRoundedRect(x0, y - bh / 2, Math.max(bh, (barW * Math.min(st.value, 200)) / 200), bh, bh / 2);
      });
      return c;
    }
    const msg = entry.state === 'loading'
      ? 'Loading stats from PokéAPI…'
      : "Couldn't reach PokéAPI just now. Hold again in a moment to retry.";
    const t = makeText(this, w / 2, top + (h - top) / 2, msg, {
      fontStyle: '800', fontSize: px(Math.max(14, 16 * s)), color: '#8A7058', align: 'center', wordWrap: { width: w * 0.9, useAdvancedWrap: true },
    }).setOrigin(0.5);
    c.add(t);
    if (entry.state === 'loading') {
      const spin = this.add.graphics().setPosition(w / 2, t.y - t.height / 2 - 22 * s);
      spin.lineStyle(4 * Math.max(0.8, s), COLOURS.main, 1).beginPath().arc(0, 0, 12 * s, 0, Math.PI * 1.4).strokePath();
      this.tweens.add({ targets: spin, angle: 360, duration: 800, repeat: -1 });
      this.infoSpin = spin;
      c.add(spin);
    }
    return c;
  }

  stopSpinner() {
    if (this.infoSpin) this.tweens.killTweensOf(this.infoSpin);
    this.infoSpin = null;
  }

  closeInfo() {
    this.stopSpinner();
    if (!this.info) return;
    const { root } = this.info;
    this.info = null;
    this.tweens.killTweensOf(root.list);
    root.destroy();
  }

  // ---------- soft vignette over the map, drawn in screen space ----------

  vignetteTexture() {
    if (!this.textures.exists('ui-vignette')) this.textures.createCanvas('ui-vignette', 4, 4);
    return 'ui-vignette';
  }

  drawVignette({ w, h }) {
    // Drawn at a quarter size and stretched: it's a soft gradient, so that's plenty.
    const tw = Math.max(4, Math.ceil(w / 4));
    const th = Math.max(4, Math.ceil(h / 4));
    const tex = this.textures.get('ui-vignette');
    tex.setSize(tw, th);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, tw, th);
    const r = Math.hypot(tw, th) / 2;
    const grad = ctx.createRadialGradient(tw / 2, th / 2, r * 0.55, tw / 2, th / 2, r);
    const [rgb, edge] = paletteFor(this.level.biome).vignette; // darker for Haunted Ruins and Volcano
    grad.addColorStop(0, `rgba(${rgb},0)`);
    grad.addColorStop(1, `rgba(${rgb},${edge})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tw, th);
    tex.refresh();
    this.vignette.setTexture('ui-vignette').setDisplaySize(w, h);
  }
}

// Small round icon for each biome, drawn in code, centred on (0,0) with radius R.
function drawBiomeIcon(g, key, R) {
  g.fillStyle(0xffffff, 1).fillCircle(0, 0, R);
  g.fillStyle(0x000000, 0.08).fillCircle(0, R * 0.08, R * 0.92);
  g.fillStyle(0xffffff, 1).fillCircle(0, 0, R * 0.9);
  const r = R * 0.55;
  const V = (x, y) => new Phaser.Math.Vector2(x, y);
  switch (key) {
    case 'meadow':
      g.fillStyle(0xfacc15, 1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillTriangle(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25, Math.cos(a + 0.25) * r * 0.75, Math.sin(a + 0.25) * r * 0.75, Math.cos(a - 0.25) * r * 0.75, Math.sin(a - 0.25) * r * 0.75);
      }
      g.fillStyle(0xfb923c, 1).fillCircle(0, 0, r * 0.7);
      break;
    case 'beach':
      g.fillStyle(0x2ec4e8, 1).fillRect(-r * 1.2, r * 0.1, r * 2.4, r * 0.8);
      g.lineStyle(R * 0.1, 0xffffff, 1).beginPath().arc(-r * 0.5, r * 0.4, r * 0.35, Math.PI, 0).arc(r * 0.2, r * 0.4, r * 0.35, Math.PI, 0).strokePath();
      g.fillStyle(0xfacc15, 1).fillCircle(r * 0.4, -r * 0.45, r * 0.45);
      break;
    case 'forest':
      g.fillStyle(0x2f6b33, 1).fillTriangle(-r, r * 0.6, r, r * 0.6, 0, -r * 0.3);
      g.fillTriangle(-r * 0.75, r * 0.05, r * 0.75, r * 0.05, 0, -r * 1.1);
      g.fillStyle(0x6b4423, 1).fillRect(-r * 0.12, r * 0.6, r * 0.24, r * 0.45);
      break;
    case 'desert':
      g.fillStyle(0x3f7d3a, 1).fillRoundedRect(-r * 0.2, -r, r * 0.4, r * 1.9, r * 0.2)
        .fillRoundedRect(-r * 0.8, -r * 0.4, r * 0.3, r * 0.8, r * 0.15).fillRoundedRect(-r * 0.8, r * 0.15, r * 0.7, r * 0.3, r * 0.15)
        .fillRoundedRect(r * 0.5, -r * 0.7, r * 0.3, r * 0.8, r * 0.15).fillRoundedRect(r * 0.1, -r * 0.1, r * 0.7, r * 0.3, r * 0.15);
      break;
    case 'snow':
      g.lineStyle(R * 0.12, 0x60a5fa, 1);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        g.lineBetween(Math.cos(a) * r, Math.sin(a) * r, -Math.cos(a) * r, -Math.sin(a) * r);
      }
      g.fillStyle(0x60a5fa, 1).fillCircle(0, 0, r * 0.18);
      break;
    case 'volcano':
      g.fillStyle(0x4a3b40, 1).fillPoints([V(-r * 1.1, r * 0.8), V(-r * 0.3, -r * 0.4), V(r * 0.3, -r * 0.4), V(r * 1.1, r * 0.8)], true);
      g.fillStyle(0xff7a2f, 1).fillTriangle(-r * 0.3, -r * 0.4, r * 0.3, -r * 0.4, 0, r * 0.3);
      g.fillStyle(0xffc15a, 1).fillCircle(-r * 0.2, -r * 0.8, r * 0.22).fillCircle(r * 0.25, -r * 1, r * 0.18);
      break;
    case 'haunted':
      g.fillStyle(0xa78bfa, 1).fillCircle(0, -r * 0.2, r * 0.75).fillRect(-r * 0.75, -r * 0.2, r * 1.5, r * 0.9);
      for (let i = 0; i < 3; i++) g.fillStyle(0xffffff, 1).fillCircle(-r * 0.5 + i * r * 0.5, r * 0.72, r * 0.25);
      g.fillStyle(0x2a2038, 1).fillCircle(-r * 0.28, -r * 0.25, r * 0.13).fillCircle(r * 0.28, -r * 0.25, r * 0.13);
      break;
    default: // sky
      g.fillStyle(0x8ec9ff, 1).fillCircle(-r * 0.5, r * 0.15, r * 0.45).fillCircle(0, -r * 0.2, r * 0.6).fillCircle(r * 0.55, r * 0.15, r * 0.45)
        .fillRect(-r * 0.5, r * 0.15, r * 1.05, r * 0.45);
      g.fillStyle(0xffd86b, 1).fillCircle(r * 0.75, -r * 0.65, r * 0.25);
  }
}

// ---------- panel rows ----------

// Gold stars that pop in one by one (empty grey ones underneath).
function starRow(scene, count, size, animate) {
  const gap = size * 1.25;
  const c = scene.add.container(0, 0);
  const base = scene.add.graphics();
  for (let i = 0; i < 3; i++) drawStar(base, (i - 1) * gap, 0, size, false);
  c.add(base);
  for (let i = 0; i < count; i++) {
    const g = scene.add.graphics();
    drawStar(g, 0, 0, size, true);
    g.setPosition((i - 1) * gap, 0);
    c.add(g);
    if (animate) {
      g.setScale(0);
      scene.tweens.add({ targets: g, scale: { from: 0, to: 1 }, duration: 320, delay: 380 + i * 360, ease: 'Back.Out',
        onStart: () => {
          const ring = scene.add.circle(0, 0, size * 0.6).setStrokeStyle(4, 0xfacc15, 1);
          ring.setPosition((i - 1) * gap, 0);
          c.add(ring);
          scene.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 380, onComplete: () => ring.destroy() });
        } });
    }
  }
  c.rowH = size * 1.15;
  return c;
}

// Boxes of "label / big value", two per row (one per row when narrow).
function statGrid(scene, inner, s, stats) {
  const c = scene.add.container(0, 0);
  const cols = inner < 250 ? 1 : 2;
  const gap = Math.max(8, 12 * s);
  const bw = (inner - gap * (cols - 1)) / cols;
  const bh = Math.max(64, 84 * s);
  const rows = Math.ceil(stats.length / cols);
  stats.forEach(([label, value, icon], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = -inner / 2 + bw / 2 + col * (bw + gap);
    const y = -((rows - 1) * (bh + gap)) / 2 + row * (bh + gap);
    const g = scene.add.graphics();
    g.fillStyle(0xf3e3c3, 1).fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 14 * s);
    const l = makeText(scene, x, y - bh * 0.22, label.toUpperCase(), { fontStyle: '900', fontSize: px(Math.max(11, 14 * s)), color: '#8A7058' }).setOrigin(0.5);
    if (l.width > bw - 12) l.setScale((bw - 12) / l.width);
    const v = makeText(scene, x, y + bh * 0.14, value, { fontFamily: FONT_TITLE, fontSize: px(Math.max(24, 34 * s)), color: INK }).setOrigin(0.5);
    if (v.width > bw - 16) v.setScale((bw - 16) / v.width);
    c.add([g, l, v]);
    if (icon === 'star') {
      const st = scene.add.graphics();
      drawStar(st, 0, 0, Math.max(18, 24 * s), true);
      st.setPosition(x + v.displayWidth / 2 + 18 * s, v.y);
      c.add(st);
    }
  });
  c.rowH = rows * bh + (rows - 1) * gap;
  return c;
}

// "+1 ❤" row, drawn (emoji fonts vary too much across devices).
function heartRow(scene, s, animate) {
  const size = Math.max(30, 40 * s);
  const t = makeText(scene, 0, 0, '+1', { fontFamily: FONT_TITLE, fontSize: px(Math.max(26, 36 * s)), color: '#DC2626', stroke: '#ffffff', strokeThickness: 6 * s }).setOrigin(0.5);
  const g = scene.add.graphics();
  drawHeart(g, 0, 0, size, true);
  const w = t.width + 10 + size;
  t.x = -w / 2 + t.width / 2;
  g.x = w / 2 - size / 2;
  const c = scene.add.container(0, 0, [t, g]);
  if (animate) {
    c.setScale(0);
    scene.tweens.add({ targets: c, scale: 1, duration: 360, delay: 1500, ease: 'Back.Out' });
  }
  c.rowH = size * 1.2;
  return c;
}

const starterLabel = (key) => STARTERS[key]?.label ?? key;

// A cartoon pointing hand (finger down), drawn in code, fingertip at (0, 0).
function drawHand(g, R) {
  const V = (x, y) => new Phaser.Math.Vector2(x * R, y * R);
  g.fillStyle(0x000000, 0.2).fillEllipse(0, R * 0.12, R * 0.5, R * 0.16);
  const outline = 0x1e293b;
  const skin = 0xffe0bd;
  const parts = (grow, colour) => {
    g.fillStyle(colour, 1);
    g.fillRoundedRect((-0.17 - grow) * R, (-1.15 - grow) * R, (0.34 + grow * 2) * R, (1.15 + grow * 2) * R, (0.17 + grow) * R); // finger
    g.fillRoundedRect((-0.5 - grow) * R, (-1.95 - grow) * R, (1.05 + grow * 2) * R, (1.0 + grow * 2) * R, (0.3 + grow) * R); // palm
    g.fillRoundedRect((0.45 - grow) * R, (-1.75 - grow) * R, (0.32 + grow * 2) * R, (0.55 + grow * 2) * R, (0.15 + grow) * R); // thumb
    g.fillRoundedRect((-0.35 - grow) * R, (-2.45 - grow) * R, (0.75 + grow * 2) * R, (0.6 + grow * 2) * R, (0.12 + grow) * R); // cuff
  };
  parts(0.07, outline);
  parts(0, skin);
  g.fillStyle(0x3b82f6, 1).fillRoundedRect(-0.35 * R, -2.45 * R, 0.75 * R, 0.6 * R, 0.12 * R);
  g.fillStyle(0xffffff, 0.6).fillRoundedRect(-0.1 * R, -1.05 * R, 0.08 * R, 0.6 * R, 0.04 * R);
  g.fillStyle(0xffffff, 0.9).fillPoints([V(0, -0.02), V(0.05, 0), V(0, 0.02)], true);
}

// "New best!" ribbon, with the old best underneath (PRD 4.8).
function newBestRow(scene, s, animate, prev) {
  const t = makeText(scene, 0, 0, 'New best!', {
    fontFamily: FONT_TITLE, fontSize: px(Math.max(22, 30 * s)), color: '#ffffff', stroke: '#B45309', strokeThickness: 6 * s,
  }).setOrigin(0.5);
  const w = t.width + 44 * s;
  const h = t.height + 12 * s;
  const g = scene.add.graphics();
  g.fillStyle(0xb45309, 1).fillRoundedRect(-w / 2, -h / 2 + 4 * s, w, h, h / 2);
  g.fillStyle(0xf59e0b, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  const old = makeText(scene, 0, h / 2 + 14 * s, `was ${'★'.repeat(prev.stars)} ${prev.power.toLocaleString('en-US')} (${starterLabel(prev.starter)})`, {
    fontStyle: '800', fontSize: px(Math.max(13, 15 * s)), color: '#8A7058',
  }).setOrigin(0.5);
  const c = scene.add.container(0, -10 * s, [g, t, old]);
  if (animate) {
    c.setScale(0);
    scene.tweens.add({ targets: c, scale: 1, duration: 380, delay: 1500, ease: 'Back.Out' });
  }
  c.rowH = h + 34 * s;
  return c;
}
