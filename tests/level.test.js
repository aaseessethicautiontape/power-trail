// Run: npm test   (package.json: "test": "node --test tests/*.test.js")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateLevel, formFor, biomeFor } from '../shared/level.js';
import { playLevel, bestRun, canBeat, allStops, starsFor, formatPower } from '../shared/rules.js';
import { STARTER_KEYS } from '../shared/config.js';

const dex = JSON.parse(readFileSync(new URL('../shared/dex.json', import.meta.url)));
const power = (name) => dex.find((p) => p.name === name).power;

test('starter powers match PokéAPI', () => {
  assert.equal(power('pikachu'), 320);
  assert.equal(power('charmander'), 309);
  assert.equal(power('bulbasaur'), 318);
  assert.equal(power('squirtle'), 314);
  assert.equal(dex.length, 1025);
});

test('ties lose', () => {
  assert.equal(canBeat(320, 320), false);
  assert.equal(canBeat(320, 319), true);
});

test('evolutions kick in at the right level', () => {
  assert.equal(formFor('charmander', 7), 4);
  assert.equal(formFor('charmander', 8), 5);
  assert.equal(formFor('charmander', 20), 6);
  assert.equal(formFor('pikachu', 12), 26);
});

test('biomes rotate every 5 levels', () => {
  assert.equal(biomeFor(1).key, 'meadow');
  assert.equal(biomeFor(6).key, 'beach');
  assert.equal(biomeFor(41).key, 'meadow');
});

test('same seed builds the same level', () => {
  const a = generateLevel({ dex, level: 9, starter: 'squirtle', runSeed: 'abc' });
  const b = generateLevel({ dex, level: 9, starter: 'squirtle', runSeed: 'abc' });
  assert.deepEqual(a, b);
});

test('level 1 starts at the starter power', () => {
  const lv = generateLevel({ dex, level: 1, starter: 'pikachu', runSeed: 'x' });
  assert.equal(lv.startPower, 320);
});

test('every level 1 to 40 can be cleared, for every starter', () => {
  for (const starter of STARTER_KEYS) {
    for (let level = 1; level <= 40; level++) {
      const lv = generateLevel({ dex, level, starter, runSeed: 'test-run' });
      const best = bestRun(lv);
      assert.ok(best.canClear, `${starter} level ${level} has no winning path`);
      assert.equal(playLevel(lv, best.clicks).outcome, 'cleared');
      assert.equal(best.beforeBoss, lv.best);
      assert.equal(starsFor(lv, best.beforeBoss), 3);
    }
  }
});

test('locked stops and repeat clicks are rejected', () => {
  const lv = generateLevel({ dex, level: 4, starter: 'bulbasaur', runSeed: 'lock' });
  const zone2Stop = lv.zones[1].stops[0];
  assert.equal(playLevel(lv, [zone2Stop.id]).outcome, 'invalid');
  assert.equal(playLevel(lv, [lv.boss.id]).outcome, 'invalid');
  const first = bestRun(lv).clicks[0];
  assert.equal(playLevel(lv, [first, first]).outcome, 'invalid');
});

test('clicking something too strong faints', () => {
  const lv = generateLevel({ dex, level: 3, starter: 'charmander', runSeed: 'faint' });
  const tooStrong = lv.zones[0].stops.find((s) => s.power && s.power >= lv.startPower) || lv.zones[1].gate;
  if (tooStrong.zone === 0) assert.equal(playLevel(lv, [tooStrong.id]).outcome, 'fainted');
  else assert.ok(tooStrong.power >= lv.startPower);
});

test('Lucky Egg trap: grabbing the egg first loses to the boss', () => {
  let checked = 0;
  for (let seed = 0; seed < 60 && checked < 5; seed++) {
    const lv = generateLevel({ dex, level: 12, starter: 'pikachu', runSeed: `egg${seed}` });
    if (!lv.eggTrap) continue;
    checked++;
    assert.ok(lv.boss.power > lv.eggNaive, 'boss must beat the egg-first score');
    assert.ok(lv.boss.power < lv.best, 'boss must lose to perfect play');
  }
  assert.ok(checked > 0, 'no egg trap levels found');
});

test('power formula is base x level x alpha', () => {
  const lv = generateLevel({ dex, level: 15, starter: 'squirtle', runSeed: 'formula' });
  for (const s of allStops(lv)) {
    if (s.pokemon) assert.equal(s.power, s.pokemon.base * 15 * s.alpha);
  }
});

test('formatPower', () => {
  assert.equal(formatPower(9940), '9,940');
  assert.equal(formatPower(12400), '12.4K');
  assert.equal(formatPower(975000), '975K');
  assert.equal(formatPower(3100000), '3.1M');
});
