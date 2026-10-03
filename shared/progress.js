// Pure helpers for saved progress (PRD 4.8, 9). Used by the browser (src/cloud.js) and by the
// server (api/progress.js), so both sides merge scores with exactly the same rules.
//
// bestByLevel[level] = { stars, power, best, starter, date }

// Does score `a` beat score `b`? More stars wins; with equal stars, more power wins.
export function betterScore(a, b) {
  if (!b) return !!a;
  if (!a) return false;
  return a.stars > b.stars || (a.stars === b.stars && (a.power ?? 0) > (b.power ?? 0));
}

// Merges two bestByLevel maps. For each level the better score wins (its starter and date are
// kept) and the record also keeps the highest stars and power seen. Never loses a score.
export function mergeBestByLevel(a = {}, b = {}) {
  const out = {};
  for (const level of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const x = a?.[level];
    const y = b?.[level];
    if (!x || !y) { out[level] = { ...(x ?? y) }; continue; }
    const win = betterScore(x, y) || (!betterScore(y, x) && (x.date ?? '') >= (y.date ?? '')) ? x : y;
    out[level] = { ...win, stars: Math.max(x.stars, y.stars), power: Math.max(x.power ?? 0, y.power ?? 0) };
  }
  return out;
}

// The scores a (server-verified) run's cleared levels earned.
// results: [{ level, stars, power, best }]. Entries without numbers are skipped.
export function bestFromResults(results = [], { starter, date } = {}) {
  const out = {};
  for (const r of results) {
    if (!r || !Number.isInteger(r.level) || !Number.isFinite(r.stars) || !Number.isFinite(r.power)) continue;
    out[r.level] = { stars: r.stars, power: r.power, best: r.best, starter, date };
  }
  return out;
}

// Highest level cleared and the stars that run had at that point, from bestByLevel.
export function bestLevelOf(bestByLevel = {}) {
  return Object.keys(bestByLevel).reduce((m, k) => Math.max(m, Number(k) || 0), 0);
}

// Which run should a device keep when it has `local` and the cloud has `remote`?
// Each is { levelsCleared } or null. The run that got further wins; ties keep the local one.
// Returns 'local' | 'remote' | 'none'.
export function pickRun(local, remote) {
  if (!local && !remote) return 'none';
  if (!remote) return 'local';
  if (!local) return 'remote';
  return remote.levelsCleared > local.levelsCleared ? 'remote' : 'local';
}
