// localStorage save (PRD section 9). Every storage call is wrapped so the game
// still runs when storage is blocked (private mode, school Chromebook policies).

const KEY = 'powerTrail.v1';

function defaults() {
  return {
    bestLevel: 0,
    bestStars: 0,
    run: null,
    dex: [],
    settings: { hint: false, reduceMotion: false, muted: true, soundEffects: true },
    // Best score on every level, kept across runs (PRD 4.8):
    // bestByLevel[level] = { stars, power, best, starter, date }
    bestByLevel: {},
    tutorialDone: false, // the level 1 "tap a smaller number" hand has been shown
  };
}

export function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    return {
      ...base,
      ...data,
      dex: Array.isArray(data.dex) ? data.dex : [],
      settings: { ...base.settings, ...data.settings },
      bestByLevel: data.bestByLevel && typeof data.bestByLevel === 'object' ? data.bestByLevel : {},
    };
  } catch (err) {
    console.warn('Save could not be read, starting fresh', err);
    return base;
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('Save could not be written', err);
    return false;
  }
}

// Ends the current run but keeps best scores, the Trail Dex and settings.
export function clearRun() {
  const data = load();
  data.run = null;
  save(data);
  return data;
}

// A new run's seed: 8 characters from crypto.getRandomValues.
export function newRunSeed() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function dailyRunSeed(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// Records a cleared level (PRD 4.8). It's a new best when the stars or the power beat the old
// best; the record keeps the best stars and best power seen, with the starter and date of the
// latest improvement. Mutates `data`; returns { prev, newBest }.
export function recordBest(data, level, { stars, power, best, starter }) {
  const prev = data.bestByLevel[level] ?? null;
  const newBest = !prev || stars > prev.stars || power > prev.power;
  if (newBest) {
    data.bestByLevel[level] = {
      stars: Math.max(stars, prev?.stars ?? 0),
      power: Math.max(power, prev?.power ?? 0),
      best,
      starter,
      date: new Date().toISOString().slice(0, 10),
    };
  }
  return { prev, newBest };
}
