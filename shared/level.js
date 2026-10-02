// Endless level generator. Pure JS: no Phaser, no DOM, no fetch.
// The browser and the server both call generateLevel with the same inputs
// and get the exact same level, which is how the server can check a run.
//
// Every Pokémon's power on a level = its PokéAPI power (sum of 6 base stats) x level x alpha.
// alpha is 1 for normal Pokémon and 2+ for Alpha Pokémon (gates, bosses, late-zone wilds).

import { STARTERS, BIOMES, ITEMS, LUCKY_EGG, LEVEL_TUNING as T } from './config.js';
import { hashSeed, makeRng } from './rng.js';
import { bestRun } from './rules.js';
import { applyDifficulty } from './difficulty.js';

export function formFor(starterKey, level) {
  const forms = STARTERS[starterKey].forms;
  let id = forms[0].id;
  for (const f of forms) if (level >= f.from) id = f.id;
  return id;
}

export function biomeFor(level) {
  return BIOMES[Math.floor((level - 1) / 5) % BIOMES.length];
}

function wildWeight(p, level, biome) {
  const typeBonus = p.types.some((t) => biome.types.includes(t)) ? 3 : 1;
  const d = (p.power - T.tierCenter(level)) / 90;
  return typeBonus * (Math.exp(-d * d) + 0.02);
}

function makePools(dex, level, biome) {
  const maxGen = T.maxGen(level);
  const inGen = dex.filter((p) => p.gen <= maxGen);
  const wild = inGen
    .filter((p) => !p.legendary && !p.mythical)
    .map((p) => ({ p, w: wildWeight(p, level, biome) }));
  const legendLevel = level % T.legendEvery === 0;
  let boss = legendLevel
    ? inGen.filter((p) => p.legendary || p.mythical)
    : inGen.filter((p) => p.fullyEvolved && !p.legendary && !p.mythical && p.power >= 480);
  if (!boss.length) boss = inGen.filter((p) => p.fullyEvolved);
  return {
    wild,
    boss: boss.map((p) => ({ p, w: p.types.some((t) => biome.types.includes(t)) ? 3 : 1 })),
  };
}

// Pick a Pokémon and an alpha multiplier so power lands near `target`, inside [lo, hi).
function fitPokemon(rng, pool, level, target, lo, hi, avoid) {
  let best = null;
  const consider = (p) => {
    const unit = p.power * level;
    const k0 = Math.max(1, Math.round(target / unit));
    for (const k of [k0 - 1, k0, k0 + 1]) {
      if (k < 1) continue;
      const power = unit * k;
      if (power < lo || power >= hi) continue;
      const err = Math.abs(power - target) / target + (avoid.has(p.id) ? 0.5 : 0) + rng.next() * 0.02;
      if (!best || err < best.err) best = { p, k, power, err };
    }
  };
  for (let round = 0; round < 3 && !best; round++) {
    for (let i = 0; i < 18; i++) consider(rng.weighted(pool, (x) => x.w).p);
  }
  if (!best) for (const { p } of pool) consider(p); // exhaustive fallback
  return best;
}

function pokemonStop(id, kind, zone, fit) {
  const { p, k, power } = fit;
  return {
    id,
    kind,
    zone,
    pokemon: { id: p.id, name: p.name, base: p.power, types: p.types },
    alpha: k,
    power,
  };
}

export function levelSeed(runSeed, starter, level) {
  return hashSeed(runSeed, starter, level);
}

// difficulty: -2 (easier) to +2 (tougher), from difficultyFor(run.results). 0 = the normal level.
export function generateLevel({ dex, level, starter, runSeed, difficulty = 0 }) {
  const base = buildLevel({ dex, level, starter, runSeed });
  return difficulty ? applyDifficulty(base, difficulty) : base;
}

function buildLevel({ dex, level, starter, runSeed }) {
  const seed = levelSeed(runSeed, starter, level);
  const rng = makeRng(seed);
  const biome = biomeFor(level);
  const pools = makePools(dex, level, biome);
  const minUnit = Math.min(...pools.wild.map((x) => x.p.power)) * level;
  const formId = formFor(starter, level);
  const form = dex.find((p) => p.id === formId);
  const startPower = form.power * level;
  const zoneCount = T.zones(level);
  const used = new Set();
  let n = 0;
  const nextId = () => `s${++n}`;

  const eggZone =
    level >= LUCKY_EGG.fromLevel && rng.chance(LUCKY_EGG.chance) ? rng.int(0, zoneCount - 1) : -1;

  let B = startPower; // best possible power so far, Lucky Egg not counted
  let eggEntry = null;
  const zones = [];

  for (let z = 0; z < zoneCount; z++) {
    const zone = { index: z, gate: null, stops: [] };

    if (z > 0) {
      const target = T.gateShare(level) * B;
      const fit =
        fitPokemon(rng, pools.wild, level, target, target * 0.85, B, used) ||
        fitPokemon(rng, pools.wild, level, target, 1, B, used);
      zone.gate = pokemonStop(nextId(), 'gate', z, fit);
      used.add(fit.p.id);
      B += fit.power;
    }

    const entry = B;
    if (z === eggZone) eggEntry = entry;
    const [minStops, maxStops] = T.stopsPerZone(level);
    const count = rng.int(minStops, maxStops);

    // Items first: they're always grabbable.
    let itemSum = 0;
    const wildsWanted = Math.max(2, count - (rng.chance(0.6) ? 1 : 0) - (rng.chance(0.25) ? 1 : 0));
    for (let i = wildsWanted; i < count; i++) {
      const item = rng.weighted(ITEMS, (it) => it.weight);
      const value = Math.max(1, Math.round(startPower * rng.range(item.share[0], item.share[1])));
      zone.stops.push({ id: nextId(), kind: 'item', zone: z, item: item.key, label: item.label, sprite: item.sprite, stars: item.stars, value });
      itemSum += value;
    }

    // Wild Pokémon: the first is always beatable on entry. Some zones get one "trap":
    // a Pokémon bigger than you that you can only beat after grabbing the rest of the zone.
    const W = T.wildShare;
    const wilds = [];
    const hasTrap = wildsWanted >= 3 && rng.chance(W.trapChance);
    for (let i = 0; i < wildsWanted; i++) {
      const share = i === 0 ? W.first : hasTrap && i === wildsWanted - 1 ? W.trap : W.normal;
      const target = entry * rng.range(share[0], share[1]);
      // The weakest Pokémon still has 175 power, so tiny targets fall back to "anything smaller".
      const cap = i === 0 ? entry : Math.max(target * 1.3, minUnit * 1.4);
      const fit =
        fitPokemon(rng, pools.wild, level, target, target * 0.85, target * 1.15, used) ||
        fitPokemon(rng, pools.wild, level, target, 1, cap, used);
      if (!fit) throw new Error(`Level ${level}: no wild Pokémon fits under ${cap}`);
      wilds.push(fit);
      used.add(fit.p.id);
    }

    // Make sure every wild in the zone can be beaten in some order.
    wilds.sort((a, b) => a.power - b.power);
    let cur = entry + itemSum;
    for (let i = 0; i < wilds.length; i++) {
      if (wilds[i].power >= cur) {
        const t = cur * rng.range(0.5, 0.95);
        wilds[i] = fitPokemon(rng, pools.wild, level, t, 1, cur, used);
        if (!wilds[i]) throw new Error(`Level ${level}: no Pokémon fits under ${cur}`);
        used.add(wilds[i].p.id);
      }
      cur += wilds[i].power;
    }
    for (const fit of wilds) zone.stops.push(pokemonStop(nextId(), 'wild', z, fit));
    B = cur;

    if (z === eggZone) {
      zone.stops.push({ id: nextId(), kind: 'egg', zone: z, label: LUCKY_EGG.label, sprite: LUCKY_EGG.sprite, mult: LUCKY_EGG.mult });
    }

    // Shuffle so the map doesn't list stops smallest-first.
    for (let i = zone.stops.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [zone.stops[i], zone.stops[j]] = [zone.stops[j], zone.stops[i]];
    }
    zones.push(zone);
  }

  const hasEgg = eggZone >= 0;
  const best = hasEgg ? B * LUCKY_EGG.mult : B;
  // The "grab the egg the second you see it" score.
  const eggNaive = hasEgg ? eggEntry * LUCKY_EGG.mult + (B - eggEntry) : null;

  let bossTarget = T.bossShare(level) * best;
  const eggTrap = hasEgg && level >= LUCKY_EGG.trapFromLevel && eggNaive + 1 < best;
  if (eggTrap) bossTarget = Math.max(bossTarget, eggNaive + 1);
  let bossFit = fitPokemon(rng, pools.boss, level, bossTarget, bossTarget, best, used);
  if (!bossFit) bossFit = fitPokemon(rng, pools.wild, level, bossTarget, bossTarget, best, used);
  if (!bossFit) throw new Error(`Level ${level}: no boss fits between ${bossTarget} and ${best}`);
  const boss = pokemonStop(nextId(), 'boss', zoneCount - 1, bossFit);

  const data = {
    version: 1,
    level,
    starter,
    seed,
    biome: biome.key,
    biomeLabel: biome.label,
    form: { id: form.id, name: form.name, base: form.power },
    startPower,
    zones,
    boss,
    best,
    eggNaive,
    eggTrap,
  };
  data.solution = bestRun(data);
  return data;
}
