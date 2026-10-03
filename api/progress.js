import { verifyRun } from '../shared/verifyRun.js';
import { bestFromResults, mergeBestByLevel } from '../shared/progress.js';
import { auth, firestore } from './_firebase.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Signed-in players' saved progress. The browser never touches Firestore (its rules deny everything):
// it sends a Google ID token plus its run history, this function verifies both, and only the
// server writes. Document: playerProgress/{uid}
//   bestByLevel  best score on every level, merged across runs
//   bestLevel, bestStars
//   run          the player's latest run (or null after game over). `history` is stored as a JSON
//                string because Firestore doesn't allow arrays inside arrays (attempts are arrays).
const MAX_HISTORY = 500;
const MAX_JSON = 800_000; // stay well under Firestore's 1 MiB document limit

let cachedDex;
function getDex() {
  if (!cachedDex) cachedDex = JSON.parse(readFileSync(fileURLToPath(new URL('../shared/dex.json', import.meta.url)), 'utf8'));
  return cachedDex;
}

async function userFor(req) {
  const header = req.headers?.authorization ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return null;
  try { return await auth().verifyIdToken(match[1]); } catch { return null; }
}

// What the browser gets back: the stored run with its history parsed again.
function publicView(doc) {
  let run = null;
  if (doc.run) {
    try {
      run = { ...doc.run, history: JSON.parse(doc.run.historyJson) };
      delete run.historyJson;
    } catch { run = null; }
  }
  return {
    bestByLevel: doc.bestByLevel ?? {},
    bestLevel: doc.bestLevel ?? 0,
    bestStars: doc.bestStars ?? 0,
    run,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ reason: 'Method not allowed' });
  }

  const user = await userFor(req);
  if (!user) return res.status(401).json({ reason: 'Sign in required' });

  const ref = firestore().collection('playerProgress').doc(user.uid);
  if (req.method === 'GET') {
    try {
      const snapshot = await ref.get();
      return res.status(200).json(snapshot.exists ? { progress: true, ...publicView(snapshot.data()) } : { progress: null });
    } catch (error) {
      console.error('Progress read failed:', error?.code ?? 'unknown error');
      return res.status(500).json({ reason: 'Could not load progress' });
    }
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const run = { starter: body.starter, runSeed: body.runSeed, history: body.history };
  if (!Array.isArray(run.history) || run.history.length > MAX_HISTORY) {
    return res.status(400).json({ reason: 'Invalid run data' });
  }
  const historyJson = JSON.stringify(run.history);
  if (historyJson.length > MAX_JSON) return res.status(400).json({ reason: 'Run is too large to save' });

  const verified = verifyRun(run, getDex(), { includeResults: true });
  if (!verified.verified) return res.status(400).json({ reason: verified.reason });
  // Saved after a cleared level (every level in the history cleared) or at game over (hearts gone).
  const gameOver = verified.hearts === 0;
  if (!gameOver && verified.levelsCleared !== run.history.length) {
    return res.status(400).json({ reason: 'Only cleared levels can be saved' });
  }

  const today = new Date().toISOString().slice(0, 10);
  try {
    const doc = await firestore().runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      const old = existing.exists ? existing.data() : {};
      const earned = bestFromResults(verified.levelResults, { starter: run.starter, date: today });
      const bestByLevel = mergeBestByLevel(old.bestByLevel, earned);

      let bestLevel = old.bestLevel ?? 0;
      let bestStars = old.bestStars ?? 0;
      if (verified.levelsCleared > bestLevel || (verified.levelsCleared === bestLevel && verified.stars > bestStars)) {
        bestLevel = verified.levelsCleared;
        bestStars = verified.stars;
      }

      // The latest run: a different run replaces the stored one; the same run only moves forward,
      // so an out-of-date device can't push the player back.
      const oldRun = old.run ?? null;
      const sameRun = oldRun?.runSeed === run.runSeed;
      let storedRun = oldRun;
      if (gameOver) {
        if (!oldRun || sameRun) storedRun = null;
      } else if (!oldRun || !sameRun || verified.levelsCleared >= (oldRun.levelsCleared ?? 0)) {
        storedRun = {
          starter: run.starter,
          runSeed: run.runSeed,
          historyJson,
          level: verified.levelsCleared + 1,
          levelsCleared: verified.levelsCleared,
          stars: verified.stars,
          hearts: verified.hearts,
          results: verified.levelResults,
        };
      }
      const next = { bestByLevel, bestLevel, bestStars, run: storedRun, updatedAt: new Date().toISOString() };
      transaction.set(ref, next);
      return next;
    });
    return res.status(200).json({ saved: true, ...publicView(doc) });
  } catch (error) {
    console.error('Progress save failed:', error?.code ?? error?.message ?? 'unknown error');
    return res.status(500).json({ reason: 'Could not save progress' });
  }
}
