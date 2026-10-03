// Run: npm test   (saved progress: merging scores, picking a run)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { betterScore, mergeBestByLevel, bestFromResults, bestLevelOf, pickRun } from '../shared/progress.js';
import { generateLevel } from '../shared/level.js';
import { verifyRun } from '../shared/verifyRun.js';

const dex = JSON.parse(readFileSync(new URL('../shared/dex.json', import.meta.url), 'utf8'));
const rec = (stars, power, starter = 'pikachu', date = '2026-10-01') => ({ stars, power, best: 100, starter, date });

test('betterScore: more stars wins, then more power', () => {
  assert.equal(betterScore(rec(3, 10), rec(2, 99)), true);
  assert.equal(betterScore(rec(2, 99), rec(3, 10)), false);
  assert.equal(betterScore(rec(2, 50), rec(2, 40)), true);
  assert.equal(betterScore(rec(2, 40), rec(2, 40)), false);
  assert.equal(betterScore(rec(1, 1), null), true);
  assert.equal(betterScore(null, rec(1, 1)), false);
});

test('mergeBestByLevel never loses a score and keeps the best of each level', () => {
  const local = { 1: rec(3, 500, 'charmander'), 2: rec(1, 300), 4: rec(2, 900) };
  const cloud = { 1: rec(2, 800, 'pikachu'), 2: rec(2, 100), 3: rec(3, 700) };
  const merged = mergeBestByLevel(local, cloud);
  assert.deepEqual(Object.keys(merged).sort(), ['1', '2', '3', '4']);
  assert.equal(merged[1].stars, 3);
  assert.equal(merged[1].power, 800, 'keeps the highest power seen');
  assert.equal(merged[1].starter, 'charmander', 'starter of the better score');
  assert.equal(merged[2].stars, 2);
  assert.equal(merged[3].power, 700);
  assert.equal(merged[4].power, 900);
  // Order doesn't matter, and merging twice changes nothing.
  assert.deepEqual(mergeBestByLevel(cloud, local), merged);
  assert.deepEqual(mergeBestByLevel(merged, merged), merged);
  // Inputs aren't mutated.
  assert.equal(local[1].power, 500);
  assert.deepEqual(mergeBestByLevel(undefined, undefined), {});
});

test('bestFromResults and bestLevelOf', () => {
  const out = bestFromResults([
    { level: 1, stars: 3, power: 50, best: 50 }, { level: 2, stars: 2, power: 70, best: 80 }, { level: 3, stars: 1 }, null,
  ], { starter: 'squirtle', date: '2026-10-02' });
  assert.deepEqual(Object.keys(out), ['1', '2']);
  assert.deepEqual(out[2], { stars: 2, power: 70, best: 80, starter: 'squirtle', date: '2026-10-02' });
  assert.equal(bestLevelOf(out), 2);
  assert.equal(bestLevelOf({}), 0);
});

test('pickRun keeps the run that got further, ties keep this device', () => {
  assert.equal(pickRun(null, null), 'none');
  assert.equal(pickRun({ levelsCleared: 2 }, null), 'local');
  assert.equal(pickRun(null, { levelsCleared: 2 }), 'remote');
  assert.equal(pickRun({ levelsCleared: 2 }, { levelsCleared: 5 }), 'remote');
  assert.equal(pickRun({ levelsCleared: 5 }, { levelsCleared: 2 }), 'local');
  assert.equal(pickRun({ levelsCleared: 3 }, { levelsCleared: 3 }), 'local');
});

test('a verified run reports the power and best of every cleared level', () => {
  const runSeed = 'progress-test';
  const level = generateLevel({ dex, level: 1, starter: 'pikachu', runSeed });
  const out = verifyRun({ starter: 'pikachu', runSeed, history: [{ level: 1, attempts: [level.solution.clicks] }] }, dex, { includeResults: true });
  assert.equal(out.verified, true);
  assert.equal(out.levelResults.length, 1);
  const [r] = out.levelResults;
  assert.equal(r.level, 1);
  assert.equal(r.stars, 3);
  assert.equal(r.power, level.best, 'perfect play reaches the best possible power');
  assert.equal(r.best, level.best);
  const best = bestFromResults(out.levelResults, { starter: 'pikachu', date: '2026-10-02' });
  assert.equal(best[1].power, level.best);
});
