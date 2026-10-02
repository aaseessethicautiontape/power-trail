// Battle and replay rules. Pure JS, shared by the browser and the server.

export function canBeat(power, enemyPower) {
  return enemyPower < power; // ties lose
}

export function allStops(level) {
  const list = [];
  for (const z of level.zones) {
    if (z.gate) list.push(z.gate);
    list.push(...z.stops);
  }
  list.push(level.boss);
  return list;
}

// Which stops can be clicked right now. `open` = how many zones are open.
export function isAvailable(level, stop, open, taken) {
  if (taken.has(stop.id)) return false;
  if (stop.kind === 'boss') return open === level.zones.length;
  if (stop.kind === 'gate') return stop.zone === open;
  return stop.zone < open;
}

// Replay a list of clicked stop ids on a level.
// outcome: 'cleared' | 'fainted' | 'incomplete' | 'invalid'
export function playLevel(level, clicks) {
  const byId = new Map(allStops(level).map((s) => [s.id, s]));
  const taken = new Set();
  let power = level.startPower;
  let open = 1;
  const steps = [];
  for (const id of clicks) {
    const stop = byId.get(id);
    if (!stop) return { outcome: 'invalid', reason: `unknown stop ${id}`, power, steps };
    if (!isAvailable(level, stop, open, taken)) return { outcome: 'invalid', reason: `stop ${id} not available`, power, steps };
    taken.add(id);
    if (stop.kind === 'item') power += stop.value;
    else if (stop.kind === 'egg') power *= stop.mult;
    else if (canBeat(power, stop.power)) {
      power += stop.power;
      if (stop.kind === 'gate') open += 1;
    } else {
      steps.push({ id, power, won: false });
      return { outcome: 'fainted', faintedAt: id, power, steps };
    }
    steps.push({ id, power, won: true });
    if (stop.kind === 'boss') return { outcome: 'cleared', power, steps };
  }
  return { outcome: 'incomplete', power, steps };
}

// Best possible play: grab items, beat the smallest beatable Pokémon, egg last, then boss.
export function bestRun(level) {
  const taken = new Set();
  const clicks = [];
  let power = level.startPower;
  let open = 1;
  const stops = allStops(level).filter((s) => s.kind !== 'boss' && s.kind !== 'egg');
  for (;;) {
    const avail = stops.filter((s) => isAvailable(level, s, open, taken));
    const item = avail.find((s) => s.kind === 'item');
    const next = item || avail.filter((s) => canBeat(power, s.power)).sort((a, b) => a.power - b.power)[0];
    if (!next) break;
    taken.add(next.id);
    clicks.push(next.id);
    if (next.kind === 'item') power += next.value;
    else {
      power += next.power;
      if (next.kind === 'gate') open += 1;
    }
  }
  const egg = allStops(level).find((s) => s.kind === 'egg');
  if (egg && egg.zone < open) {
    clicks.push(egg.id);
    power *= egg.mult;
  }
  const beforeBoss = power;
  const canClear = open === level.zones.length && canBeat(power, level.boss.power);
  if (canClear) clicks.push(level.boss.id);
  return { clicks, beforeBoss, canClear };
}

// 1 to 3 stars based on power before the boss vs the best possible.
export function starsFor(level, powerBeforeBoss) {
  const best = level.solution ? level.solution.beforeBoss : bestRun(level).beforeBoss;
  const r = powerBeforeBoss / best;
  return r >= 0.98 ? 3 : r >= 0.85 ? 2 : 1;
}

// Compact numbers for the HUD: 950, 12.4K, 3.1M
export function formatPower(n) {
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e5 ? 1 : 0)}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)}M`;
  return `${(n / 1e9).toFixed(1)}B`;
}
