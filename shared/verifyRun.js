// Server-side run verification. The client supplies only the starter, seed, and ordered stop ids;
// all difficulty, stars, and heart totals are derived from deterministic level replays.
import { generateLevel } from './level.js';
import { playLevel, starsFor } from './rules.js';
import { difficultyFor } from './difficulty.js';
import { LEVEL_TUNING, STARTERS } from './config.js';

const invalid = (reason) => ({ verified: false, reason });

export function verifyRun({ starter, runSeed, history } = {}, dex) {
  if (!dex) return invalid('Server data unavailable');
  if (typeof starter !== 'string' || typeof runSeed !== 'string' || !runSeed || !Array.isArray(history)) {
    return invalid('Invalid run data');
  }
  if (!Object.hasOwn(STARTERS, starter)) return invalid('Unknown starter');
  if (history.length === 0) return invalid('Run has no attempts');

  let hearts = LEVEL_TUNING.lives;
  let levelsCleared = 0;
  let stars = 0;
  const results = [];

  try {
    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      const expectedLevel = i + 1;
      if (!entry || entry.level !== expectedLevel) return invalid(`Expected level ${expectedLevel}`);
      if (!Array.isArray(entry.attempts) || entry.attempts.length === 0) {
        return invalid(`Level ${expectedLevel} has no attempts`);
      }
      if (hearts <= 0) return invalid('Attempts continue after game over');

      const difficulty = difficultyFor(results);
      const level = generateLevel({ dex, level: expectedLevel, starter, runSeed, difficulty });
      let levelFaints = 0;
      let levelCleared = false;

      for (let a = 0; a < entry.attempts.length; a++) {
        const clicks = entry.attempts[a];
        if (!Array.isArray(clicks) || clicks.some((id) => typeof id !== 'string')) {
          return invalid(`Level ${expectedLevel} has invalid stop ids`);
        }
        const replay = playLevel(level, clicks);
        const isLast = a === entry.attempts.length - 1;

        if (replay.outcome === 'invalid') return invalid(`Level ${expectedLevel}: ${replay.reason}`);
        if (replay.steps.length !== clicks.length) return invalid(`Level ${expectedLevel} has clicks after an attempt ended`);
        if (replay.outcome === 'cleared') {
          if (!isLast) return invalid(`Level ${expectedLevel} has attempts after a clear`);
          levelCleared = true;
          const powerBeforeBoss = replay.power - level.boss.power;
          const earned = starsFor(level, powerBeforeBoss);
          levelsCleared++;
          stars += earned;
          results.push({ level: expectedLevel, stars: earned, faints: levelFaints });
          if (expectedLevel % LEVEL_TUNING.heartEvery === 0 && hearts < LEVEL_TUNING.lives) hearts++;
          continue;
        }

        if (replay.outcome !== 'fainted' && replay.outcome !== 'incomplete') {
          return invalid(`Level ${expectedLevel} did not finish`);
        }
        if (isLast && levelCleared) return invalid(`Level ${expectedLevel} did not end with a clear`);
        if (replay.outcome === 'fainted') {
          hearts--;
          levelFaints++;
          if (hearts < 0) return invalid('Hearts fell below zero');
          if (hearts === 0 && !isLast) return invalid('Attempts continue after game over');
        }
      }
      if (!levelCleared && i !== history.length - 1) return invalid(`Level ${expectedLevel} was not cleared`);
    }
  } catch (error) {
    return invalid(error instanceof Error && /^Level \d+:/.test(error.message) ? error.message : 'Could not rebuild run');
  }

  return { verified: true, levelsCleared, stars, hearts };
}
