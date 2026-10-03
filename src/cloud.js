// Saves levels and scores to the player's Google account (Firebase), and brings them back on
// another device. Signed-out players just play and save on this device as before.
//
// The server (api/progress.js) is the source of truth for the cloud copy: it replays the run's
// taps with the same shared rules before it saves anything, so scores can't be made up.
import { load, save } from './save.js';
import { firebaseAuth, requestProgress } from './firebase.js';
import { mergeBestByLevel, pickRun } from '../shared/progress.js';
import { formFor } from '../shared/level.js';

// A run as the game keeps it, from the server's copy.
function runFromCloud(run) {
  return {
    starter: run.starter,
    runSeed: run.runSeed,
    level: run.level,
    hearts: run.hearts,
    stars: run.stars,
    history: run.history,
    results: run.results ?? [],
    faints: 0,
    beaten: 0,
    newDex: 0,
    // The form you'd already evolved into before this level, so evolution still plays when it's due.
    form: formFor(run.starter, Math.max(1, run.level - 1)),
  };
}

// Folds the server's scores into this device's save: every level keeps its best score from either side.
function mergeScores(local, cloud) {
  local.bestByLevel = mergeBestByLevel(local.bestByLevel, cloud.bestByLevel);
  if (cloud.bestLevel > local.bestLevel || (cloud.bestLevel === local.bestLevel && cloud.bestStars > local.bestStars)) {
    local.bestLevel = cloud.bestLevel;
    local.bestStars = cloud.bestStars;
  }
}

// After signing in: merge the cloud's scores in, keep whichever run got further, and send this
// device's run up if it won. Returns { signedIn, adoptedRun } (or null when signed out).
export async function syncProgress() {
  if (!firebaseAuth.currentUser) return null;
  const cloud = await requestProgress('GET');
  const local = load();
  let adoptedRun = false;
  if (cloud.progress) {
    mergeScores(local, cloud);
    const mine = local.run ? { levelsCleared: local.run.level - 1 } : null;
    const theirs = cloud.run ? { levelsCleared: cloud.run.levelsCleared } : null;
    if (pickRun(mine, theirs) === 'remote') {
      local.run = runFromCloud(cloud.run);
      adoptedRun = true;
    }
    save(local);
  }
  // This device's run is further along (or the cloud has none): save it to the account.
  const run = load().run;
  if (!adoptedRun && run && run.history?.length > 0 && run.history.length === run.level - 1) {
    await pushRun(run).catch((error) => console.warn('Cloud save failed:', error?.message || 'unknown error'));
  }
  return { signedIn: true, adoptedRun };
}

// Saves a run after a cleared level or at game over, and merges the scores the server sends back.
export async function pushRun(run) {
  if (!firebaseAuth.currentUser || !run?.history?.length) return null;
  const cloud = await requestProgress('POST', run);
  const local = load();
  mergeScores(local, cloud);
  save(local);
  return cloud;
}

// Fire and forget, for the moments the game saves: never blocks play, never throws.
export function pushRunQuietly(run) {
  if (!firebaseAuth.currentUser) return;
  pushRun(run).catch((error) => console.warn('Cloud save failed:', error?.message || 'unknown error'));
}
