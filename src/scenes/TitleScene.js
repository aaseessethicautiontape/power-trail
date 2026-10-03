import Phaser from 'phaser';
import dex from '../../shared/dex.json';
import { STARTERS, STARTER_KEYS, LEVEL_TUNING } from '../../shared/config.js';
import { formFor } from '../../shared/level.js';
import { load, save, newRunSeed, dailyRunSeed } from '../save.js';
import { setSoundMuted, setSoundEffectsEnabled } from '../audio.js';
import { firebaseAuth, observeFirebaseAuth, signInWithGoogle, signOutGoogle, firstName } from '../firebase.js';
import { syncProgress } from '../cloud.js';
import { pokemonKey } from '../assets.js';
import { getScreen, safeRect, watchResize } from '../layout/screen.js';
import {
  makeText, makeButton, makePanel, makeBadge, makeHearts, makeCog, makeDialog, makeTappable, shade, px,
  makeLevelChips, showChipInfo, levelChipLines,
  FONT_TITLE, INK, TYPE_COLOURS,
} from '../art/ui.js';

const byId = new Map(dex.map((p) => [p.id, p]));

// Card design size; real cards are sized to fit the screen in layout().
const CARD_W = 236;
const CARD_H = 320;

// "Evolves at 8 and 20" from the starter's forms in shared/config.js.
function evolvesLine(key) {
  const levels = STARTERS[key].forms.slice(1).map((f) => f.from);
  if (levels.length === 0) return 'Never evolves';
  if (levels.length === 1) return `Evolves at ${levels[0]}`;
  return `Evolves at ${levels.slice(0, -1).join(', ')} and ${levels.at(-1)}`;
}

// Shrinks a text object to fit a width.
const fitWidth = (t, maxW) => t.setScale(Math.min(1, maxW / t.width));

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    this.save_ = load();
    this.selected = this.save_.run?.starter ?? STARTER_KEYS[0];
    this.dialogKind = null;
    this.dialog = null;
    this.root = null;
    this.firstLayout = true;
    this.accountBusy = false;
    this.accountError = '';
    const unsubscribe = observeFirebaseAuth((user) => {
      this.save_ = load();
      if (this.root && this.scene.isActive('TitleScene')) this.layout();
      if (user) this.syncSignedIn();
    });
    this.events.once('shutdown', unsubscribe);

    this.buildBackground();
    this.layout();
    watchResize(this, () => this.layout(), { immediate: () => this.stretchBackground() });
  }

  layout() {
    const scr = getScreen(this);
    this.drawBackground(scr);

    // Rebuild the UI layer at the new size. Selection and open dialogs survive.
    if (this.root) {
      this.tweens.killTweensOf(this.root.getAll());
      this.cards?.forEach((c) => this.tweens.killTweensOf(c.list));
      this.root.destroy();
    }
    this.root = this.add.container(0, 0).setDepth(1);
    if (scr.portrait) this.layoutPortrait(scr);
    else this.layoutLandscape(scr);
    this.refreshCards(true);

    if (this.dialogKind) {
      this.dialog?.root.destroy();
      this.openDialog(this.dialogKind, false);
    }
    this.firstLayout = false;
  }

  // ---------- layouts ----------

  layoutLandscape(scr) {
    const s = scr.ui;
    const gap = Math.max(8, 14 * s);
    const area = safeRect(scr, Math.max(12, 16 * s));
    const bar = this.drawTopBar(scr, area);

    const logoFont = Math.min(108 * s, (area.width - 2 * (bar.dexW + gap * 2)) / this.logoRatio(), scr.h * 0.15);
    const logoH = logoFont * 1.22;
    this.drawLogo(scr.w / 2, area.top + logoH / 2, logoFont, s);
    let y = area.top + Math.max(bar.h, logoH) + gap * 0.4;
    // Short landscape screens (phones on their side): the level chips share the Best row, so the
    // starter cards keep their height (and the Google button shrinks to an icon in the top bar).
    const inline = scr.h < 500 ? this.runChips(area.width * 0.5, Math.max(0.8, s)) : null;
    y = this.drawInfoRow(scr.w / 2, y, s, gap, area.width, [inline]);

    const bs = Phaser.Math.Clamp(Math.min(s, (scr.h * 0.16) / 84), 0.6, 1.4);
    let btnBlock = 92 * bs;
    const btnY = area.bottom - btnBlock / 2 - 4 * bs;
    const cont = this.drawButtonsRow(scr.w / 2, btnY, bs, area.width);
    // This run's level chips sit on top of the Continue button.
    if (cont && !inline) btnBlock += this.drawRunChips(cont.x, cont.y - cont.btnH / 2 - gap * 0.5, cont.btnW, bs) + gap * 0.5;

    const lift = 14 * s;
    this.placeCards(4, 1, {
      left: area.left, right: area.right, top: y + lift, bottom: area.bottom - btnBlock - gap,
    }, s);
  }

  layoutPortrait(scr) {
    const s = scr.ui;
    const gap = Math.max(10, 14 * s);
    const area = safeRect(scr, Math.max(14, 16 * s));
    const bar = this.drawTopBar(scr, area);
    let y = area.top + bar.h + gap;

    const logoFont = Math.min(area.width / this.logoRatio(), scr.h * 0.085, 130);
    const logoH = logoFont * 1.22;
    this.drawLogo(scr.w / 2, y + logoH / 2, logoFont, s);
    y += logoH + gap * 0.4;
    y = this.drawInfoRow(scr.w / 2, y, s, gap, area.width);

    const bs = Phaser.Math.Clamp(s, 0.8, 1.2);
    const blockBottom = this.drawButtonsStack(scr.w / 2, area.bottom, area.width, bs, gap);

    const lift = 14 * s;
    this.placeCards(2, 2, { left: area.left, right: area.right, top: y + lift, bottom: blockBottom - gap }, s);
  }

  // ---------- background: a real Sunny Meadow map (TitleBgScene) under a soft wash ----------

  buildBackground() {
    this.scene.launch('TitleBgScene');
    this.scene.sendToBack('TitleBgScene');
    this.events.once('shutdown', () => this.scene.stop('TitleBgScene'));
    if (!this.textures.exists('title-wash')) this.textures.createCanvas('title-wash', 4, 4);
    this.wash = this.add.image(0, 0, 'title-wash').setOrigin(0);
  }

  // Cheap fix on every resize event so the wash always covers the screen.
  stretchBackground() {
    const { width, height } = this.scale;
    this.wash.setDisplaySize(width, height);
    this.dialog?.root.list[0].setSize(width, height); // the dialog's dim layer
  }

  // Light at the top behind the logo, darker at the bottom behind the buttons, so the UI reads
  // clearly over the busy map.
  drawBackground(scr) {
    const { w, h } = scr;
    const tw = Math.max(4, Math.ceil(w / 4));
    const th = Math.max(4, Math.ceil(h / 4));
    const tex = this.textures.get('title-wash');
    tex.setSize(tw, th);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, tw, th);
    const grad = ctx.createLinearGradient(0, 0, 0, th);
    grad.addColorStop(0, 'rgba(255,255,255,0.45)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    grad.addColorStop(0.65, 'rgba(15,40,90,0.05)');
    grad.addColorStop(1, 'rgba(15,40,90,0.4)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tw, th);
    tex.refresh();
    this.wash.setTexture('title-wash').setDisplaySize(w, h);
  }

  // ---------- top bar, logo, best ----------

  drawTopBar(scr, area) {
    const s = scr.ui;
    const dex = makeButton(this, 0, 0, 'Trail Dex', 'secondary', () => this.scene.start('DexScene'), {
      scale: s, height: 56, fontSize: 24, width: 180,
    });
    const h = dex.btnH;
    dex.setPosition(area.left + dex.btnW / 2, area.top + (h - 8 * s) / 2);
    const cogSize = Math.max(44, 60 * s);
    const cog = makeCog(this, area.right - cogSize / 2, area.top + cogSize / 2, () => this.openDialog('settings'), cogSize);
    const items = [dex, cog];
    let side = Math.max(dex.btnW, cogSize);
    if (this.compactBar(scr)) {
      // No room for the full "Continue with Google" pill: a round Google button beside the cog.
      const icon = this.accountIcon(cogSize);
      icon.setPosition(area.right - cogSize - 10 * s - cogSize / 2, area.top + cogSize / 2);
      items.push(icon);
      side = Math.max(side, cogSize * 2 + 10 * s);
    }
    this.root.add(items);
    return { h: Math.max(h, cogSize), dexW: side };
  }

  // Short landscape screens keep the top bar for a round account button.
  compactBar(scr) {
    return !scr.portrait && scr.h < 500;
  }

  // ---------- Google account ----------

  // The Google "G", drawn in code (four coloured arcs and a bar), centred on (0,0).
  drawGoogleG(g, R) {
    const lw = R * 0.42;
    const arc = (colour, a0, a1) => {
      g.lineStyle(lw, colour, 1).beginPath().arc(0, 0, R * 0.72, Phaser.Math.DegToRad(a0), Phaser.Math.DegToRad(a1)).strokePath();
    };
    arc(0xea4335, 215, 325);
    arc(0xfbbc05, 125, 215);
    arc(0x34a853, 40, 125);
    arc(0x4285f4, 330, 400);
    g.fillStyle(0x4285f4, 1).fillRect(0, -lw / 2, R * 0.72 + lw / 2, lw);
  }

  // Signed in: a round avatar with the player's initial. Signed out: the Google "G".
  accountGlyph(R) {
    const g = this.add.graphics();
    const user = firebaseAuth.currentUser;
    if (!user) {
      this.drawGoogleG(g, R);
      return g;
    }
    g.fillStyle(0x16a34a, 1).fillCircle(0, 0, R);
    g.fillStyle(0xffffff, 0.25).fillEllipse(0, -R * 0.4, R * 1.5, R * 0.8);
    const initial = makeText(this, 0, 0, firstName(user)[0].toUpperCase(), {
      fontFamily: FONT_TITLE, fontSize: px(R * 1.4), color: '#ffffff',
    }).setOrigin(0.5);
    return this.add.container(0, 0, [g, initial]);
  }

  // Round white account button for the top bar.
  accountIcon(size) {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillCircle(2, size * 0.1 + 3, size / 2);
    g.fillStyle(0xffffff, 1).fillCircle(0, 0, size / 2);
    g.lineStyle(2, 0xdadce0, 1).strokeCircle(0, 0, size / 2);
    const c = this.add.container(0, 0, [g, this.accountGlyph(size * 0.3)]);
    makeTappable(c, size, size);
    c.on('pointerup', () => this.toggleGoogleAccount());
    return c;
  }

  // "Continue with Google" (or "Hi, Sam" when signed in): a white pill under the logo.
  accountPill(s, maxW) {
    const user = firebaseAuth.currentUser;
    const h = Math.max(46, 50 * s);
    const font = Math.max(15, 18 * s);
    const label = this.accountBusy ? 'Signing in…' : user ? `Hi, ${firstName(user)}` : 'Continue with Google';
    const t = makeText(this, 0, 0, label, { fontStyle: '900', fontSize: px(font), color: '#3C4043' }).setOrigin(0, 0.5);
    const R = h * 0.3;
    let w = h * 0.45 + R * 2 + 10 + t.width + h * 0.5;
    if (w > maxW) { t.setScale((maxW - h * 0.95 - R * 2 - 10) / t.width); w = maxW; }
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, h / 2);
    g.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.lineStyle(2, 0xdadce0, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const glyph = this.accountGlyph(R).setPosition(-w / 2 + h * 0.45 + R, 0);
    t.setPosition(-w / 2 + h * 0.45 + R * 2 + 10, 0);
    const pill = this.add.container(0, 0, [g, glyph, t]);
    makeTappable(pill, w, h);
    pill.on('pointerup', () => this.toggleGoogleAccount());
    Object.assign(pill, { rowW: w, rowH: h });
    return pill;
  }

  async toggleGoogleAccount() {
    if (this.accountBusy) return;
    if (firebaseAuth.currentUser) {
      this.openDialog('account');
      return;
    }
    this.accountBusy = true;
    this.layout();
    let error = '';
    try {
      await signInWithGoogle();
    } catch (err) {
      console.warn('Google sign-in failed:', err?.code || 'unknown error');
      error = ({
        'auth/unauthorized-domain': 'This website is not allowed to use Google sign-in yet.',
        'auth/network-request-failed': 'No internet connection. Try again.',
        'auth/too-many-requests': 'Too many tries. Wait a moment and try again.',
      })[err?.code] ?? 'Google sign-in did not work. Please try again.';
    } finally {
      this.accountBusy = false;
      this.save_ = load();
      if (this.scene.isActive('TitleScene')) this.layout();
    }
    if (error) this.showAccountMessage(error);
  }

  // After signing in: bring the account's levels and scores onto this device (and the other way).
  async syncSignedIn() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const result = await syncProgress();
      this.save_ = load();
      if (this.scene.isActive('TitleScene') && this.root) {
        this.selected = this.save_.run?.starter ?? this.selected;
        this.layout();
        if (result?.adoptedRun) this.showAccountMessage('Your saved level is loaded. Tap CONTINUE!');
      }
    } catch (error) {
      console.warn('Cloud progress sync failed:', error?.message || 'unknown error');
    } finally {
      this.syncing = false;
    }
  }

  // Width of the logo per 1px of font size, measured once.
  logoRatio() {
    if (!TitleScene.logoK) {
      const t = this.logoText(100);
      TitleScene.logoK = t.width / 100;
      t.destroy();
    }
    return TitleScene.logoK;
  }

  logoText(font) {
    return makeText(this, 0, 0, 'POWER TRAIL', {
      fontFamily: FONT_TITLE, fontSize: px(font), color: '#ffffff',
      stroke: '#4A1D05', strokeThickness: Math.max(6, font * 0.16), padding: { x: font * 0.1, y: font * 0.1 },
    }).setOrigin(0.5);
  }

  drawLogo(x, y, font, s) {
    const logo = this.logoText(font).setPosition(x, y);
    const grad = logo.context.createLinearGradient(0, 0, 0, logo.height);
    grad.addColorStop(0.2, '#FFE14D');
    grad.addColorStop(0.55, '#FFB52E');
    grad.addColorStop(0.85, '#FB7A1E');
    logo.setFill(grad);
    logo.setShadow(0, font * 0.09, 'rgba(40,20,0,0.35)', 0, true, true);
    this.root.add(logo);

    const bob = () => this.tweens.add({
      targets: logo, y: y - 4 * s, scaleX: 1.03, scaleY: 1.03,
      duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });
    if (this.firstLayout) {
      logo.setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: logo, scale: 1, alpha: 1, duration: 600, ease: 'Back.Out', onComplete: bob });
    } else {
      bob();
    }
  }

  // "Best: Level 23" pill (a container with rowW / rowH), or null before the first clear.
  bestPill(s) {
    if (!(this.save_.bestLevel > 0)) return null;
    const font = Math.max(16, 26 * s);
    const ph = font * 1.55;
    const best = makeText(this, 0, 0, `Best: Level ${this.save_.bestLevel}`, {
      fontFamily: FONT_TITLE, fontSize: px(font), color: '#ffffff', stroke: '#1E3A8A', strokeThickness: Math.max(4, 6 * s),
    }).setOrigin(0.5);
    const w = best.width + font * 1.5;
    const pill = this.add.graphics();
    pill.fillStyle(0x1e3a8a, 0.28).fillRoundedRect(-w / 2, -ph / 2, w, ph, ph / 2);
    const c = this.add.container(0, 0, [pill, best]);
    Object.assign(c, { rowW: w, rowH: ph });
    return c;
  }

  // The row under the logo: the Best pill, the Google account pill and (on short screens) the
  // level chips, centred and wrapped onto more rows when they don't fit. Returns the next free y.
  drawInfoRow(x, y, s, gap, maxW, extras = []) {
    const items = [this.bestPill(s), this.compactBar(getScreen(this)) ? null : this.accountPill(s, maxW), ...extras].filter(Boolean);
    const rows = [];
    let row = [];
    let used = 0;
    for (const it of items) {
      if (row.length && used + gap + it.rowW > maxW) { rows.push(row); row = []; used = 0; }
      used += (row.length ? gap : 0) + it.rowW;
      row.push(it);
    }
    if (row.length) rows.push(row);
    let yy = y;
    for (const r of rows) {
      const rowH = Math.max(...r.map((i) => i.rowH));
      const total = r.reduce((sum, i) => sum + i.rowW, 0) + gap * (r.length - 1);
      let cx = x - total / 2;
      for (const it of r) {
        it.setPosition(cx + it.rowW / 2, yy + rowH / 2);
        this.root.add(it);
        cx += it.rowW + gap;
      }
      yy += rowH + gap * 0.4;
    }
    return yy + gap * 0.1;
  }

  // ---------- starter cards ----------

  // Fits `cols` x `rows` cards inside rect, centred, keeping a card-like shape.
  placeCards(cols, rows, rect, s) {
    const cg = Math.max(10, 24 * s);
    // Leave room for the selected card's glow ring so it never touches the edge, logo or buttons.
    const gm = Math.max(8, 18 * s);
    rect = { left: rect.left + gm, right: rect.right - gm, top: rect.top + gm * 0.5, bottom: rect.bottom - gm * 0.5 };
    const availW = rect.right - rect.left;
    const availH = rect.bottom - rect.top;
    let cw = (availW - (cols - 1) * cg) / cols;
    let ch = (availH - (rows - 1) * cg) / rows;
    cw = Math.min(cw, CARD_W * 1.4, ch * 0.95);
    ch = Math.min(ch, cw * 1.36);
    const f = Math.min(cw / CARD_W, ch / 300, 1.4);
    const blockW = cols * cw + (cols - 1) * cg;
    const blockH = rows * ch + (rows - 1) * cg;
    const x0 = (rect.left + rect.right) / 2 - blockW / 2 + cw / 2;
    const y0 = rect.top + (availH - blockH) / 2 + ch / 2;
    this.cards = STARTER_KEYS.map((key, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return this.makeCard(key, i, x0 + col * (cw + cg), y0 + row * (ch + cg), cw, ch, f);
    });
  }

  makeCard(key, i, x, y, cw, ch, f) {
    const formId = formFor(key, 1);
    const mon = byId.get(formId);
    const typeColour = TYPE_COLOURS[mon.types[0]] ?? 0xa8a77a;
    const startPower = mon.power * 1; // form power x level 1 (PRD rule 3)
    const top = -ch / 2;
    const b = Math.max(3, 4 * f); // panel border

    // Text block sizes, never smaller than readable on a phone.
    const nameSize = Math.max(16, 32 * f);
    const labelSize = Math.max(11, 13 * f);
    const badgeSize = Math.max(18, 34 * f);
    const evoSize = Math.max(12, 16 * f);
    const strip = Math.max(6, 10 * f);
    const pad = Math.max(6, 10 * f);
    let showLabel = true;
    const textH = () => nameSize * 1.25 + (showLabel ? labelSize * 1.5 : 0) + badgeSize * 1.3 + evoSize * 1.5 + pad * 1.5;
    if (ch - textH() < ch * 0.45) showLabel = false; // tight cards drop the "START POWER" label
    const backH = ch - textH() - strip - b;

    // Gold glow ring, shown when selected.
    const glow = this.add.graphics();
    const gr = 24 * f;
    for (let k = 6; k >= 1; k--) {
      const o = 4 * f + k * 3 * f;
      glow.lineStyle(4 * f, 0xffd54a, 0.08 + 0.06 * (6 - k));
      glow.strokeRoundedRect(-cw / 2 - o, top - o, cw + 2 * o, ch + 2 * o, gr + o);
    }
    glow.lineStyle(Math.max(3, 6 * f), 0xffc61a, 1).strokeRoundedRect(-cw / 2 - 3 * f, top - 3 * f, cw + 6 * f, ch + 6 * f, gr + 3 * f);
    glow.setAlpha(0);

    const panel = makePanel(this, 0, 0, cw, ch, { scale: f });

    // Art backdrop in the type colour, with a soft spotlight behind the Pokémon.
    const artY = top + b + backH * 0.53;
    const artSize = Math.min(backH * 0.86, cw * 0.66);
    const back = this.add.graphics();
    back.fillStyle(shade(typeColour, 22), 1)
      .fillRoundedRect(-cw / 2 + b, top + b, cw - 2 * b, backH, { tl: gr - b, tr: gr - b, bl: 0, br: 0 });
    back.fillStyle(0xffffff, 0.35).fillCircle(0, artY, artSize * 0.47);
    back.fillStyle(0xffffff, 0.25).fillCircle(0, artY, artSize * 0.35);
    back.fillStyle(typeColour, 1).fillRect(-cw / 2 + b, top + b + backH, cw - 2 * b, strip);
    back.fillStyle(0x000000, 0.14).fillEllipse(0, artY + artSize * 0.42, artSize * 0.62, artSize * 0.11);

    let art;
    if (this.textures.exists(pokemonKey(formId))) {
      art = this.add.image(0, artY, pokemonKey(formId));
      art.setScale(artSize / art.height);
    } else {
      art = makeText(this, 0, artY, '?', { fontFamily: FONT_TITLE, fontSize: px(artSize * 0.5), color: '#ffffff' }).setOrigin(0.5);
    }
    this.tweens.add({
      targets: art, y: art.y - 4 * f, duration: 1100 + i * 130, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 170,
    });

    const pillFont = Math.max(10, 13 * f);
    const typePill = makeText(this, -cw / 2 + b + 12 * f, top + b + 10 * f, mon.types[0].toUpperCase(), {
      fontStyle: '900', fontSize: px(pillFont), color: '#ffffff',
    });
    const pillBg = this.add.graphics();
    pillBg.fillStyle(shade(typeColour, -22), 1)
      .fillRoundedRect(typePill.x - pillFont * 0.7, typePill.y - pillFont * 0.25, typePill.width + pillFont * 1.4, typePill.height + pillFont * 0.5, pillFont);

    let cy = top + b + backH + strip + pad * 0.6;
    const next = (hgt) => { const c = cy + hgt / 2; cy += hgt; return c; };
    const maxTextW = cw - 2 * pad;
    const name = fitWidth(makeText(this, 0, next(nameSize * 1.25), STARTERS[key].label, {
      fontFamily: FONT_TITLE, fontSize: px(nameSize), color: INK,
    }).setOrigin(0.5), maxTextW);
    const parts = [name];
    if (showLabel) {
      parts.push(makeText(this, 0, next(labelSize * 1.5), 'START POWER', {
        fontStyle: '900', fontSize: px(labelSize), color: '#8A7360',
      }).setOrigin(0.5));
    }
    parts.push(makeBadge(this, startPower, 'player', { y: next(badgeSize * 1.3), fontSize: badgeSize }));
    parts.push(fitWidth(makeText(this, 0, next(evoSize * 1.5), evolvesLine(key), {
      fontStyle: '700', fontSize: px(evoSize), color: '#6B5745',
    }).setOrigin(0.5), maxTextW));

    // Tick in the corner when selected.
    const tr = Math.max(11, 16 * f);
    const tx = cw / 2 - b - tr - 4 * f;
    const ty = top + b + tr + 4 * f;
    const tick = this.add.graphics();
    tick.fillStyle(0x16a34a, 1).fillCircle(tx, ty, tr);
    tick.lineStyle(Math.max(3, 5 * f), 0xffffff, 1).beginPath();
    tick.moveTo(tx - tr * 0.5, ty).lineTo(tx - tr * 0.12, ty + tr * 0.38).lineTo(tx + tr * 0.55, ty - tr * 0.42).strokePath();
    tick.setAlpha(0);

    const card = this.add.container(x, y, [glow, panel, back, art, pillBg, typePill, ...parts, tick]);
    makeTappable(card, cw, ch);
    Object.assign(card, { key, glow, tick, hovered: false, baseY: y, lift: 14 * f });
    this.root.add(card);

    card.on('pointerover', () => { card.hovered = true; this.refreshCards(); });
    card.on('pointerout', () => { card.hovered = false; this.refreshCards(); });
    card.on('pointerup', () => {
      if (this.selected === key) return;
      this.selected = key;
      this.refreshCards();
      this.tweens.add({ targets: art, scale: art.scale * 1.12, duration: 120, yoyo: true, ease: 'Quad.Out' });
    });

    // On first show the cards drop in one after another.
    if (this.firstLayout) {
      card.y = y + 40 * f;
      card.setAlpha(0);
      this.tweens.add({
        targets: card, y, alpha: 1, duration: 450, delay: 150 + i * 90, ease: 'Back.Out',
        onComplete: () => this.refreshCards(),
      });
    }
    return card;
  }

  refreshCards(instant = false) {
    for (const card of this.cards) {
      const selected = card.key === this.selected;
      const y = card.baseY - (selected ? card.lift : card.hovered ? card.lift * 0.7 : 0);
      const scale = selected ? 1.04 : 1;
      card.setDepth(selected ? 2 : card.hovered ? 1 : 0);
      this.root.sort('depth');
      if (instant) {
        card.glow.setAlpha(selected ? 1 : 0);
        card.tick.setAlpha(selected ? 1 : 0);
        if (!this.firstLayout) card.setY(y).setScale(scale);
        continue;
      }
      this.tweens.add({ targets: card, y, scale, duration: 180, ease: 'Quad.Out' });
      this.tweens.add({ targets: [card.glow, card.tick], alpha: selected ? 1 : 0, duration: 180 });
    }
  }

  // ---------- buttons ----------

  continueButton(x, y, bs, width, height = 84) {
    const run = this.save_.run;
    const cont = makeButton(this, x, y, 'CONTINUE', 'secondary', () => this.continueRun(), {
      scale: bs, width, height, fontSize: 32, subtitle: `Level ${run.level}`,
    });
    // "Level 14 ❤❤♡" centred inside the button.
    const hearts = makeHearts(this, 0, cont.subtitle.y, run.hearts, LEVEL_TUNING.lives, Math.max(12, 15 * bs));
    const sub = cont.subtitle.setOrigin(1, 0.5);
    const total = sub.width + 8 + hearts.width;
    sub.x = -total / 2 + sub.width;
    hearts.x = sub.x + 8 + hearts.width / 2;
    cont.face.add(hearts);
    return cont;
  }

  drawButtonsRow(cx, y, bs, maxW) {
    const gap = 14 * bs;
    if (this.save_.run) {
      const w = Math.min(300, (maxW / bs - 2 * 14) / 3);
      const off = w * bs + gap;
      const cont = this.continueButton(cx - off, y, bs, w, 72);
      this.root.add(cont);
      this.root.add(makeButton(this, cx, y, 'START', 'main', () => this.openDialog('confirm'), {
        scale: bs, width: w, height: 72, fontSize: 34,
      }));
      this.root.add(makeButton(this, cx + off, y, 'DAILY', 'secondary', () => this.startDailyRun(), {
        scale: bs, width: w, height: 72, fontSize: 30,
      }));
      return cont;
    }
    const w = Math.min(320, (maxW / bs - gap / bs) / 2);
    const off = (w * bs + gap) / 2;
    this.root.add(makeButton(this, cx - off, y, 'START', 'main', () => this.startRun(), {
      scale: bs, width: w, height: 84, fontSize: 40,
    }));
    this.root.add(makeButton(this, cx + off, y, 'DAILY TRAIL', 'secondary', () => this.startDailyRun(), {
      scale: bs, width: w, height: 84, fontSize: 28,
    }));
    return null;
  }

  // Full-width stacked buttons at the bottom (portrait). Returns the block's top y.
  drawButtonsStack(cx, bottom, width, bs, gap) {
    const h = 72;
    const w = width / bs;
    const unit = (h + 8) * bs;
    const startY = bottom - unit + (h * bs) / 2;
    if (this.save_.run) {
      const contY = startY - 2 * unit;
      const cont = this.continueButton(cx, contY, bs, w, h);
      this.root.add(cont);
      this.root.add(makeButton(this, cx, startY - unit, 'START', 'main', () => this.openDialog('confirm'), {
        scale: bs, width: w, height: h, fontSize: 38,
      }));
      this.root.add(makeButton(this, cx, startY, 'DAILY TRAIL', 'secondary', () => this.startDailyRun(), {
        scale: bs, width: w, height: h, fontSize: 30,
      }));
      const top = contY - (h * bs) / 2;
      return top - this.drawRunChips(cx, top - gap * 0.5, w * bs, bs) - gap * 0.5;
    }
    this.root.add(makeButton(this, cx, startY - unit, 'START', 'main', () => this.startRun(), {
      scale: bs, width: w, height: h, fontSize: 38,
    }));
    this.root.add(makeButton(this, cx, startY, 'DAILY TRAIL', 'secondary', () => this.startDailyRun(), {
      scale: bs, width: w, height: h, fontSize: 30,
    }));
    return startY - unit - (h * bs) / 2;
  }

  // Chips for every level cleared this run (PRD 4.8), bottom edge at `bottom`. Tap one for its
  // power and best. Returns the height used (0 if nothing cleared yet).
  drawRunChips(cx, bottom, width, bs) {
    const chips = this.runChips(width, Math.max(0.8, bs));
    if (!chips) return 0;
    chips.setPosition(cx, bottom - chips.rowH / 2);
    this.root.add(chips);
    return chips.rowH;
  }

  runChips(width, s) {
    const results = this.save_.run?.results ?? [];
    if (!results.length) return null;
    return makeLevelChips(this, results, width, s, (e, chip) => {
      const m = chip.getWorldTransformMatrix();
      showChipInfo(this, m.tx, m.ty, levelChipLines(e, this.save_.bestByLevel?.[e.level], (k) => STARTERS[k]?.label ?? k), s);
    });
  }

  startRun(runSeed = newRunSeed()) {
    const run = {
      starter: this.selected,
      runSeed,
      level: 1,
      hearts: LEVEL_TUNING.lives,
      stars: 0,
      history: [],
      results: [],
    };
    this.save_.run = run;
    save(this.save_);
    this.scene.start('TrailMapScene', { run });
  }

  startDailyRun() {
    const seed = dailyRunSeed();
    if (this.save_.run) {
      this.openDialog('daily-confirm', true, seed);
      return;
    }
    this.startRun(seed);
  }

  // Continue and Start both lead to the level map, where your Pokémon waits on the current level.
  continueRun() {
    this.scene.start('TrailMapScene', { run: this.save_.run });
  }

  showAccountMessage(message) {
    // Mid-screen, over the starter cards: the buttons stay tappable and uncovered.
    const note = makeText(this, this.scale.width / 2, this.scale.height * 0.46, message, {
      fontFamily: FONT_TITLE, fontSize: px(Math.max(16, Math.min(24, this.scale.width / 20))), color: '#ffffff', align: 'center',
      backgroundColor: '#16325F', padding: { x: 16, y: 10 }, wordWrap: { width: this.scale.width * 0.86 },
    }).setOrigin(0.5).setDepth(20);
    this.time.delayedCall(2800, () => note.destroy());
  }

  // ---------- dialogs (rebuilt on resize) ----------

  openDialog(kind, animate = true, seed = this.dialogSeed) {
    if (this.dialog && this.dialogKind === kind && animate) return;
    this.dialogKind = kind;
    this.dialogSeed = seed;
    const settings = this.save_.settings;
    const spec = kind === 'settings'
      ? {
        title: 'Settings',
        width: 500,
        toggles: [
          { label: 'Mute all sound', get: () => settings.muted ?? true, set: (on) => {
            settings.muted = on; setSoundMuted(on); save(this.save_);
          } },
          { label: 'Sound effects', get: () => settings.soundEffects ?? true, set: (on) => {
            settings.soundEffects = on; setSoundEffectsEnabled(on); save(this.save_);
          } },
          { label: 'Hint mode', get: () => settings.hint, set: (on) => { settings.hint = on; save(this.save_); } },
          { label: 'Reduce motion', get: () => settings.reduceMotion, set: (on) => { settings.reduceMotion = on; save(this.save_); } },
        ],
        buttons: [{ label: 'Done', colour: 'main', onClick: (close) => close() }],
      }
      : kind === 'account'
      ? {
        title: `Hi, ${firstName(firebaseAuth.currentUser)}!`,
        message: 'Your levels and scores are saved to your Google account, so you can pick up on any device.',
        width: 540,
        buttons: [
          { label: 'Done', colour: 'main', onClick: (close) => close() },
          { label: 'Sign out', colour: 'secondary', onClick: async (close) => {
            close();
            await signOutGoogle().catch(() => {});
            this.save_ = load();
            this.layout();
          } },
        ],
      }
      : kind === 'daily-confirm'
      ? {
        title: 'Play today’s Daily Trail?',
        message: `Your Level ${this.save_.run.level} run will be replaced. Today’s seed is ${seed}.`,
        width: 560,
        buttons: [
          { label: 'Cancel', colour: 'secondary', onClick: (close) => close() },
          { label: 'Daily Trail', colour: 'main', onClick: () => this.startRun(seed) },
        ],
      }
      : {
        title: 'Start a new run?',
        message: `Your Level ${this.save_.run.level} run will be lost.`,
        width: 560,
        buttons: [
          { label: 'Cancel', colour: 'secondary', onClick: (close) => close() },
          { label: 'New run', colour: 'danger', onClick: () => this.startRun() },
        ],
      };
    this.dialog = makeDialog(this, spec, {
      animate,
      onClose: () => { this.dialogKind = null; this.dialog = null; this.dialogSeed = null; },
    });
  }
}
