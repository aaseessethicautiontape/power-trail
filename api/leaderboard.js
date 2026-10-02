import { verifyRun } from '../shared/verifyRun.js';
import { firestore } from './_firebase.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cachedDex;
function getDex() {
  if (!cachedDex) cachedDex = JSON.parse(readFileSync(fileURLToPath(new URL('../shared/dex.json', import.meta.url)), 'utf8'));
  return cachedDex;
}

function dateIsValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function boardForSeed(runSeed) {
  return dateIsValid(runSeed) ? `leaderboard_daily_${runSeed}` : 'leaderboard_alltime';
}

function entriesFrom(snapshot) {
  return snapshot.docs.map((doc) => {
    const { initials, starter, levelsCleared, stars } = doc.data();
    return { initials, starter, levelsCleared, stars };
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const day = req.query?.daily;
    if (day != null && !dateIsValid(day)) return res.status(400).json({ reason: 'Invalid daily date' });
    const collection = day ? `leaderboard_daily_${day}` : 'leaderboard_alltime';
    try {
      const snapshot = await firestore().collection(collection)
        .orderBy('levelsCleared', 'desc').orderBy('stars', 'desc').limit(10).get();
      return res.status(200).json(entriesFrom(snapshot));
    } catch (error) {
      console.error('Leaderboard query failed:', error?.code ?? 'unknown error', error?.message ?? '');
      return res.status(500).json({ reason: 'Leaderboard unavailable' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ reason: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof body.initials !== 'string' || !/^[A-Z]{3}$/.test(body.initials)) {
    return res.status(400).json({ reason: 'Initials must be exactly 3 letters A to Z' });
  }

  const run = { starter: body.starter, runSeed: body.runSeed, history: body.history };
  const verified = verifyRun(run, getDex());
  if (!verified.verified) return res.status(400).json({ reason: verified.reason });

  try {
    const db = firestore();
    const collection = db.collection(boardForSeed(run.runSeed));
    const before = await collection.orderBy('levelsCleared', 'desc').orderBy('stars', 'desc').limit(10).get();
    const entry = {
      initials: body.initials,
      starter: run.starter,
      levelsCleared: verified.levelsCleared,
      stars: verified.stars,
      createdAt: new Date(),
    };
    const ref = await collection.add(entry);
    const ranked = [
      ...before.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      { id: ref.id, data: entry },
    ].sort((a, b) => b.data.levelsCleared - a.data.levelsCleared || b.data.stars - a.data.stars).slice(0, 10);
    const entries = ranked.map(({ data }) => ({
      initials: data.initials, starter: data.starter,
      levelsCleared: data.levelsCleared, stars: data.stars,
    }));
    const highlightedIndex = ranked.findIndex(({ id }) => id === ref.id);
    return res.status(200).json({ saved: true, entries, highlightedIndex });
  } catch (error) {
    console.error('Leaderboard save failed:', error?.code ?? error?.message ?? 'unknown error');
    return res.status(500).json({ reason: 'Could not save leaderboard entry' });
  }
}
