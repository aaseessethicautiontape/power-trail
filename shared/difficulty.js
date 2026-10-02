// Difficulty follows scores. Pure JS, shared by the browser and the server.
//
// difficultyFor(results) looks at how the run is going and returns a step from -2 (easier) to +2
// (tougher). applyDifficulty(level, d) turns a normal level (difficulty 0) into that step: the
// same map, the same Pokémon and items, only the numbers move. Difficulty 0 is never touched, so
// every existing level, including the "demo" example, builds exactly as before.

import { LEVEL_TUNING as T, LUCKY_EGG } from './config.js';
import { hashSeed, makeRng } from './rng.js';
import { bestRun } from './rules.js';

export const DIFFICULTY_MIN = -2;
export const DIFFICULTY_MAX = 2;

// How much each step moves the tuning, and the limits it's clamped to.
export const DIFFICULTY_STEP = {
  bossShare: 0.04, bossRange: [0.4, 0.97],
  gateShare: 0.03, gateRange: [0.2, 0.85],
  trapChance: 0.1, trapRange: [0, 1],
};

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// results: [{ level, stars, faints }] for every level cleared this run, oldest first.
// - Fewer than 3 cleared levels: 0 (not enough to judge).
// - Struggling comes first: 2+ faints on the latest level, or under 2 stars on average over the
//   last 3, gives -1; both at once (or 4+ faints over the last 3) gives -2.
// - Crushing it: 3 stars and no faints on each of the last 3 levels gives +1; on each of the
//   last 5 gives +2.
// - Anything else: 0. Always between -2 and +2.
export function difficultyFor(results = []) {
  if (!Array.isArray(results) || results.length < 3) return 0;
  const last = (n) => results.slice(-n);
  const recent = last(3);
  const avgStars = recent.reduce((s, r) => s + (r.stars ?? 0), 0) / recent.length;
  const faints3 = recent.reduce((s, r) => s + (r.faints ?? 0), 0);
  const lastFaints = results[results.length - 1].faints ?? 0;

  const manyFaints = lastFaints >= 2;
  const weak = avgStars < 2;
  if (manyFaints || weak || faints3 >= 4) {
    const d = (manyFaints && weak) || faints3 >= 4 ? -2 : -1;
    return Math.max(DIFFICULTY_MIN, d);
  }
  const perfect = (r) => r.stars === 3 && !(r.faints > 0);
  if (results.length >= 5 && last(5).every(perfect)) return DIFFICULTY_MAX;
  if (recent.every(perfect)) return 1;
  return 0;
}

// The tuning numbers a difficulty step uses on a level.
export function tuningFor(level, difficulty) {
  const d = difficulty;
  return {
    bossShare: clamp(T.bossShare(level) + DIFFICULTY_STEP.bossShare * d, DIFFICULTY_STEP.bossRange),
    gateShare: clamp(T.gateShare(level) + DIFFICULTY_STEP.gateShare * d, DIFFICULTY_STEP.gateRange),
    trapChance: clamp(T.wildShare.trapChance + DIFFICULTY_STEP.trapChance * d, DIFFICULTY_STEP.trapRange),
  };
}

// Largest k >= 1 with unit * k < limit (0 if even k = 1 is too big).
const kBelow = (unit, limit) => Math.max(0, Math.ceil(limit / unit) - 1);

// Turns a difficulty-0 level into difficulty d. Walks the zones in order, keeping every rule the
// generator guarantees: gates are beatable when you reach them, every wild in a zone can be
// beaten in some order, the boss is beatable with perfect play, and egg traps still punish
// egg-first play. Returns a new level object (the input isn't changed).
export function applyDifficulty(base, difficulty) {
  const d = Math.max(DIFFICULTY_MIN, Math.min(DIFFICULTY_MAX, Math.round(difficulty || 0)));
  if (d === 0) return base;
  const L = structuredClone(base);
  const lv = L.level;
  const tune = tuningFor(lv, d);
  const baseTrap = T.wildShare.trapChance;
  // One roll per zone, the same for every difficulty, so a harder step only ever adds traps
  // (and an easier one only ever removes them).
  const rng = makeRng(hashSeed(L.seed, 'difficulty'));
  const setAlpha = (s, k) => { s.alpha = k; s.power = s.pokemon.base * lv * k; };

  let B = L.startPower; // best possible power so far, Lucky Egg not counted
  let eggEntry = null;
  for (const zone of L.zones) {
    const roll = rng.next();
    const roll2 = rng.next();
    if (zone.gate) {
      const g = zone.gate;
      const unit = g.pokemon.base * lv;
      const kMax = kBelow(unit, B);
      const k = Math.min(kMax, Math.max(1, Math.round((tune.gateShare * B) / unit)));
      if (k >= 1) setAlpha(g, k);
      B += g.power;
    }
    const entry = B;
    const items = zone.stops.filter((s) => s.kind === 'item').reduce((sum, s) => sum + s.value, 0);
    if (zone.stops.some((s) => s.kind === 'egg')) eggEntry = entry;
    const wilds = zone.stops.filter((s) => s.kind === 'wild');
    const trap = wilds.find((s) => s.power >= entry);

    if (d > 0 && !trap && wilds.length >= 3 && roll < (tune.trapChance - baseTrap) / (1 - baseTrap || 1)) {
      // Turn the biggest wild into a trap: too strong on entry, beatable once the rest is collected.
      const w = [...wilds].sort((a, b) => b.power - a.power)[0];
      const rest = items + wilds.filter((s) => s !== w).reduce((sum, s) => sum + s.power, 0);
      const unit = w.pokemon.base * lv;
      const want = entry * (T.wildShare.trap[0] + (T.wildShare.trap[1] - T.wildShare.trap[0]) * roll2);
      const k = Math.min(kBelow(unit, entry + rest), Math.max(1, Math.round(want / unit)));
      if (k >= 1 && unit * k >= entry && unit * k > w.power) setAlpha(w, k);
    } else if (d < 0 && trap && roll < (baseTrap - tune.trapChance) / (baseTrap || 1)) {
      // Defuse the trap: beatable as soon as the zone opens.
      const k = kBelow(trap.pokemon.base * lv, entry);
      if (k >= 1) setAlpha(trap, k);
    }

    // Every wild must still be beatable in some order (weaker gates mean less power on entry).
    let cur = entry + items;
    for (const w of [...wilds].sort((a, b) => a.power - b.power)) {
      if (w.power >= cur) {
        const k = kBelow(w.pokemon.base * lv, cur);
        if (k >= 1) setAlpha(w, k);
      }
      cur += w.power;
    }
    B = cur;
  }

  const hasEgg = eggEntry != null;
  const best = hasEgg ? B * LUCKY_EGG.mult : B;
  const eggNaive = hasEgg ? eggEntry * LUCKY_EGG.mult + (B - eggEntry) : null;
  const eggTrap = hasEgg && lv >= LUCKY_EGG.trapFromLevel && eggNaive + 1 < best;

  // Boss: the same Pokémon, its alpha set for the new share. Harder never makes it weaker.
  const boss = L.boss;
  const unit = boss.pokemon.base * lv;
  let target = tune.bossShare * best;
  if (eggTrap) target = Math.max(target, eggNaive + 1);
  const kMax = kBelow(unit, best);
  let k = Math.max(1, Math.ceil(target / unit));
  if (d > 0) k = Math.max(k, base.boss.alpha);
  setAlpha(boss, Math.max(1, Math.min(k, kMax)));

  Object.assign(L, { best, eggNaive, eggTrap, difficulty: d });
  L.solution = bestRun(L);
  // Safety net: if the numbers ever leave no winning path, play the normal level instead.
  if (!L.solution.canClear || L.solution.beforeBoss !== best) return base;
  return L;
}
