import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateLevel } from '../shared/level.js';
import { verifyRun } from '../shared/verifyRun.js';

const dex = JSON.parse(readFileSync(new URL('../shared/dex.json', import.meta.url), 'utf8'));
const starter = 'pikachu';
const runSeed = 'verify-test';
const winningHistory = () => {
  const level = generateLevel({ dex, level: 1, starter, runSeed });
  return [{ level: 1, attempts: [level.solution.clicks] }];
};

test('a real winning run passes and returns server-calculated totals', () => {
  assert.deepEqual(verifyRun({ starter, runSeed, history: winningHistory() }, dex), {
    verified: true, levelsCleared: 1, stars: 3, hearts: 3,
  });
});

test('a made-up stop id fails', () => {
  const history = winningHistory();
  history[0].attempts[0] = ['made-up-stop'];
  const result = verifyRun({ starter, runSeed, history }, dex);
  assert.equal(result.verified, false);
  assert.match(result.reason, /unknown stop/);
});

test('a run that skips a level fails', () => {
  const history = winningHistory();
  history.push({ level: 3, attempts: [[]] });
  const result = verifyRun({ starter, runSeed, history }, dex);
  assert.equal(result.verified, false);
  assert.match(result.reason, /Expected level 2/);
});

test('a run that claims a clear but faints fails', () => {
  const first = generateLevel({ dex, level: 1, starter, runSeed });
  const strong = first.zones.flatMap((z) => z.stops).find((s) => s.kind === 'wild' && s.power >= first.startPower);
  assert.ok(strong, 'fixture has a wild that causes a faint');
  const history = [{ level: 1, attempts: [[strong.id]] }, { level: 2, attempts: [[]] }];
  const result = verifyRun({ starter, runSeed, history }, dex);
  assert.equal(result.verified, false);
  assert.match(result.reason, /not cleared/);
});

test('client power and score fields are ignored', () => {
  const result = verifyRun({ starter, runSeed, history: winningHistory(), power: 999999999, score: 999999 }, dex);
  assert.deepEqual(result, { verified: true, levelsCleared: 1, stars: 3, hearts: 3 });
});
