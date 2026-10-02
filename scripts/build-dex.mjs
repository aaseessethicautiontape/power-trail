// Builds shared/dex.json: every Pokémon species (1 to 1025) with its power,
// generation, types, evolution stage and legendary flags.
// Data comes from PokéAPI's own data files on GitHub, so the numbers match the API.
//
// Run: node scripts/build-dex.mjs
// Optional: DEX_CSV_DIR=path/to/csvs node scripts/build-dex.mjs  (use local copies)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const FILES = ['pokemon_species.csv', 'pokemon.csv', 'pokemon_stats.csv', 'pokemon_types.csv', 'types.csv'];
const MAX_ID = 1025;

async function loadCsv(name) {
  let text;
  if (process.env.DEX_CSV_DIR) {
    text = await readFile(path.join(process.env.DEX_CSV_DIR, name), 'utf8');
  } else {
    const res = await fetch(BASE + name);
    if (!res.ok) throw new Error(`Could not download ${name}: ${res.status}`);
    text = await res.text();
  }
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header.split(',');
  return lines.map((line) => {
    const values = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, values[i]]));
  });
}

const [species, pokemon, stats, ptypes, types] = await Promise.all(FILES.map(loadCsv));

const typeName = Object.fromEntries(types.map((t) => [t.id, t.identifier]));

const power = {};
for (const s of stats) power[s.pokemon_id] = (power[s.pokemon_id] || 0) + Number(s.base_stat);

const typesOf = {};
for (const t of ptypes) {
  (typesOf[t.pokemon_id] ||= []).push([Number(t.slot), typeName[t.type_id]]);
}

// Default form for each species (pokemon id equals species id for defaults 1 to 1025)
const defaultForm = {};
for (const p of pokemon) if (p.is_default === '1') defaultForm[p.species_id] = p.id;

const byId = Object.fromEntries(species.map((s) => [s.id, s]));
function stage(id) {
  let depth = 1;
  let cur = byId[id];
  while (cur && cur.evolves_from_species_id) {
    depth += 1;
    cur = byId[cur.evolves_from_species_id];
  }
  return depth;
}
const hasEvolution = new Set(species.filter((s) => s.evolves_from_species_id).map((s) => s.evolves_from_species_id));

const dex = species
  .filter((s) => Number(s.id) <= MAX_ID)
  .map((s) => {
    const pid = defaultForm[s.id];
    return {
      id: Number(pid),
      name: s.identifier,
      power: power[pid],
      gen: Number(s.generation_id),
      types: (typesOf[pid] || []).sort((a, b) => a[0] - b[0]).map((t) => t[1]),
      stage: stage(s.id),
      fullyEvolved: !hasEvolution.has(s.id),
      baby: s.is_baby === '1',
      legendary: s.is_legendary === '1',
      mythical: s.is_mythical === '1',
    };
  })
  .sort((a, b) => a.id - b.id);

const missing = dex.filter((d) => !d.power);
if (missing.length) throw new Error(`Missing power for: ${missing.map((m) => m.name).join(', ')}`);

await mkdir('shared', { recursive: true });
await writeFile('shared/dex.json', JSON.stringify(dex));
console.log(`Wrote shared/dex.json with ${dex.length} Pokémon`);
for (const name of ['pikachu', 'charmander', 'bulbasaur', 'squirtle', 'pidgey', 'mewtwo']) {
  const d = dex.find((x) => x.name === name);
  console.log(`  ${d.name} #${d.id}: power ${d.power}, gen ${d.gen}, stage ${d.stage}, ${d.types.join('/')}`);
}
