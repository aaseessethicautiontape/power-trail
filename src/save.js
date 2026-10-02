// localStorage save (PRD section 9). Every storage call is wrapped so the game
// still runs when storage is blocked (private mode, school Chromebook policies).

const KEY = 'powerTrail.v1';

function defaults() {
  return {
    bestLevel: 0,
    bestStars: 0,
    run: null,
    dex: [],
    settings: { hint: false, reduceMotion: false },
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
