// Stress test: build lots of levels and prove every one can be cleared.
// Run: node scripts/check-levels.mjs [levels] [seeds]
import { readFileSync } from 'node:fs';
import { generateLevel } from '../shared/level.js';
import { playLevel, allStops, isAvailable, canBeat } from '../shared/rules.js';
import { STARTER_KEYS } from '../shared/config.js';

const dex = JSON.parse(readFileSync(new URL('../shared/dex.json', import.meta.url)));
const LEVELS = Number(process.argv[2] || 60);
const SEEDS = Number(process.argv[3] || 40);

// Greedy play that grabs the Lucky Egg the moment it can.
function eggFirst(level) {
  const taken = new Set();
  const clicks = [];
  let power = level.startPower, open = 1;
  const stops = allStops(level).filter((s) => s.kind !== 'boss');
  for (;;) {
    const avail = stops.filter((s) => isAvailable(level, s, open, taken));
    const next = avail.find((s) => s.kind === 'egg') || avail.find((s) => s.kind === 'item') ||
      avail.filter((s) => s.power && canBeat(power, s.power)).sort((a, b) => a.power - b.power)[0];
    if (!next) break;
    taken.add(next.id); clicks.push(next.id);
    if (next.kind === 'egg') power *= next.mult; else if (next.kind === 'item') power += next.value;
    else { power += next.power; if (next.kind === 'gate') open++; }
  }
  clicks.push(level.boss.id);
  return playLevel(level, clicks).outcome;
}

let total = 0, fails = 0, trapOk = 0, trapLevels = 0, alphaWild = 0, wildCount = 0, eggLevels = 0;
const stopsHist = {};
const growth = [], bossAlpha = [], maxAlpha = [];
const t0 = Date.now();
for (const starter of STARTER_KEYS) for (let seed = 1; seed <= SEEDS; seed++) for (let L = 1; L <= LEVELS; L++) {
  total++;
  let lv;
  try { lv = generateLevel({ dex, level: L, starter, runSeed: `seed${seed}` }); }
  catch (e) { fails++; if (fails < 10) console.log('GEN FAIL', starter, seed, L, e.message); continue; }
  const replay = playLevel(lv, lv.solution.clicks);
  const ok = lv.solution.canClear && replay.outcome === 'cleared' && lv.solution.beforeBoss === lv.best;
  if (!ok) { fails++; if (fails < 10) console.log('FAIL', starter, seed, L, lv.solution.beforeBoss, lv.best, lv.boss.power, replay.outcome); }
  const stops = allStops(lv).length; stopsHist[stops] = (stopsHist[stops] || 0) + 1;
  for (const z of lv.zones) for (const s of z.stops) if (s.kind === 'wild') { wildCount++; if (s.alpha > 1) alphaWild++; }
  if (lv.eggNaive) eggLevels++;
  growth.push(lv.best / lv.startPower); bossAlpha.push(lv.boss.alpha);
  maxAlpha.push(Math.max(...allStops(lv).filter((s) => s.alpha).map((s) => s.alpha)));
  if (lv.eggTrap) { trapLevels++; if (eggFirst(lv) === 'fainted') trapOk++; }
}
console.log(`${total} levels in ${Date.now() - t0}ms, failures: ${fails}`);
console.log(`Lucky Egg levels: ${eggLevels}, egg traps: ${trapLevels}, traps that really punish egg-first: ${trapOk}`);
console.log(`Alpha wilds: ${(100 * alphaWild / wildCount).toFixed(1)}%`);
console.log('Stops per level:', JSON.stringify(stopsHist));
const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(q * (b.length - 1))]; };
console.log(`Best power / start power: median ${pct(growth, 0.5).toFixed(1)}x, 90th ${pct(growth, 0.9).toFixed(1)}x, max ${pct(growth, 1).toFixed(1)}x`);
console.log(`Boss alpha: median x${pct(bossAlpha, 0.5)}, 90th x${pct(bossAlpha, 0.9)}, max x${pct(bossAlpha, 1)}`);
console.log(`Biggest alpha on a level: median x${pct(maxAlpha, 0.5)}, max x${pct(maxAlpha, 1)}`);

// Show a few sample levels
for (const [starter, L] of [['pikachu', 1], ['charmander', 7], ['squirtle', 10], ['bulbasaur', 25]]) {
  const lv = generateLevel({ dex, level: L, starter, runSeed: 'demo' });
  console.log(`\n${starter} level ${L} (${lv.biomeLabel}) start ${lv.startPower} as ${lv.form.name}, best ${lv.best}, boss ${lv.boss.pokemon.name} ${lv.boss.pokemon.base} x${L} x${lv.boss.alpha} = ${lv.boss.power}${lv.eggTrap ? ' [egg trap]' : ''}`);
  for (const z of lv.zones) {
    const g = z.gate ? `GATE ${z.gate.pokemon.name} ${z.gate.power}${z.gate.alpha > 1 ? ' (alpha x' + z.gate.alpha + ')' : ''} | ` : '';
    console.log(`  zone ${z.index + 1}: ${g}` + z.stops.map((s) => s.kind === 'wild' ? `${s.pokemon.name} ${s.power}${s.alpha > 1 ? '*' + s.alpha : ''}` : s.kind === 'item' ? `${s.label} +${s.value}` : 'Lucky Egg x2').join(', '));
  }
}
