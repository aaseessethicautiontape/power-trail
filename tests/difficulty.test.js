// Run: npm test   (difficulty follows scores)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateLevel } from '../shared/level.js';
import { playLevel } from '../shared/rules.js';
import { STARTER_KEYS } from '../shared/config.js';
import { difficultyFor, DIFFICULTY_MIN, DIFFICULTY_MAX } from '../shared/difficulty.js';

const dex = JSON.parse(readFileSync(new URL('../shared/dex.json', import.meta.url)));
const r = (level, stars, faints = 0) => ({ level, stars, faints });
const run = (...rows) => rows.map(([stars, faints], i) => r(i + 1, stars, faints));

test('difficultyFor: 0 with fewer than 3 levels', () => {
  assert.equal(difficultyFor([]), 0);
  assert.equal(difficultyFor(undefined), 0);
  assert.equal(difficultyFor(run([3, 0], [3, 0])), 0);
  assert.equal(difficultyFor(run([1, 3], [1, 2])), 0);
});

test('difficultyFor: +1 and +2 for strong streaks', () => {
  assert.equal(difficultyFor(run([3, 0], [3, 0], [3, 0])), 1);
  assert.equal(difficultyFor(run([3, 0], [3, 0], [3, 0], [3, 0])), 1);
  assert.equal(difficultyFor(run([3, 0], [3, 0], [3, 0], [3, 0], [3, 0])), 2);
  assert.equal(difficultyFor(run([1, 0], [3, 0], [3, 0], [3, 0], [3, 0], [3, 0])), 2);
  // A faint or a 2-star level breaks the streak.
  assert.equal(difficultyFor(run([3, 0], [3, 1], [3, 0])), 0);
  assert.equal(difficultyFor(run([3, 0], [2, 0], [3, 0])), 0);
});

test('difficultyFor: -1 for weak averages or 2+ faints', () => {
  assert.equal(difficultyFor(run([1, 0], [2, 0], [1, 0])), -1); // average 1.33 stars
  assert.equal(difficultyFor(run([3, 0], [3, 0], [3, 2])), -1); // fainted twice on the last level
  assert.equal(difficultyFor(run([3, 0], [3, 0], [3, 0], [3, 0], [3, 0], [3, 2])), -1);
  assert.equal(difficultyFor(run([1, 0], [1, 0], [1, 2])), -2); // both at once
});

test('difficultyFor: never outside -2 to +2', () => {
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
  for (let i = 0; i < 2000; i++) {
    const rows = Array.from({ length: rnd(12) }, (_, k) => r(k + 1, 1 + rnd(3), rnd(5)));
    const d = difficultyFor(rows);
    assert.ok(Number.isInteger(d) && d >= DIFFICULTY_MIN && d <= DIFFICULTY_MAX, `got ${d}`);
  }
});

test('difficulty 0 builds exactly the same levels as before', () => {
  // Hashes of generateLevel's output taken before difficulty existed.
  const snapshots = [
    ['pikachu', 'demo', 1, 'd5da0b6fc986214f'],
    ['charmander', 'trail10', 8, 'f5dcca2f54171e22'],
    ['bulbasaur', 'abc12345', 20, '6060739291201d17'],
    ['squirtle', 'zz99', 37, '15747e041e741136'],
  ];
  for (const [starter, runSeed, level, hash] of snapshots) {
    const plain = generateLevel({ dex, level, starter, runSeed });
    const zero = generateLevel({ dex, level, starter, runSeed, difficulty: 0 });
    assert.deepEqual(zero, plain);
    assert.equal(createHash('sha256').update(JSON.stringify(zero)).digest('hex').slice(0, 16), hash, `${starter} ${runSeed} L${level}`);
  }
});

test('every difficulty from -2 to +2 is clearable, levels 1 to 40, all starters', () => {
  for (const starter of STARTER_KEYS) {
    for (let level = 1; level <= 40; level++) {
      for (let d = DIFFICULTY_MIN; d <= DIFFICULTY_MAX; d++) {
        const lv = generateLevel({ dex, level, starter, runSeed: 'difficulty', difficulty: d });
        assert.ok(lv.solution.canClear, `${starter} L${level} d${d} has no winning path`);
        assert.equal(playLevel(lv, lv.solution.clicks).outcome, 'cleared');
        assert.ok(lv.boss.power < lv.best, 'boss must lose to perfect play');
        if (lv.eggTrap) assert.ok(lv.boss.power > lv.eggNaive, 'egg-first play must still lose');
      }
    }
  }
});

test('harder difficulty never makes the boss weaker', () => {
  for (const starter of STARTER_KEYS) {
    for (const runSeed of ['h1', 'h2']) {
      for (let level = 1; level <= 40; level++) {
        let prev = null;
        for (let d = DIFFICULTY_MIN; d <= DIFFICULTY_MAX; d++) {
          const lv = generateLevel({ dex, level, starter, runSeed, difficulty: d });
          if (prev) assert.ok(lv.boss.power >= prev.boss.power, `${starter} ${runSeed} L${level}: d${d} boss ${lv.boss.power} < d${d - 1} boss ${prev.boss.power}`);
          prev = lv;
        }
      }
    }
  }
});
