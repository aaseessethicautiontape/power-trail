// Game tuning: starters, evolutions, biomes, items. Change numbers here, not in game code.

// Starter evolution lines. Each form is used from its `from` level onward.
// Power of the player at the start of a level = current form's power (from PokéAPI) x level.
// Every wild Pokémon on that level is also x level, so the numbers grow together.
export const STARTERS = {
  pikachu: { label: 'Pikachu', forms: [{ id: 25, from: 1 }, { id: 26, from: 12 }] },
  charmander: { label: 'Charmander', forms: [{ id: 4, from: 1 }, { id: 5, from: 8 }, { id: 6, from: 20 }] },
  bulbasaur: { label: 'Bulbasaur', forms: [{ id: 1, from: 1 }, { id: 2, from: 8 }, { id: 3, from: 20 }] },
  squirtle: { label: 'Squirtle', forms: [{ id: 7, from: 1 }, { id: 8, from: 8 }, { id: 9, from: 20 }] },
};

export const STARTER_KEYS = Object.keys(STARTERS);

// Biomes rotate every 5 levels. Pokémon with a matching type are 3x more likely to appear.
export const BIOMES = [
  { key: 'meadow', label: 'Sunny Meadow', types: ['normal', 'bug', 'grass', 'flying'] },
  { key: 'beach', label: 'Coral Beach', types: ['water', 'ground', 'flying'] },
  { key: 'forest', label: 'Deep Forest', types: ['grass', 'bug', 'poison', 'fairy'] },
  { key: 'desert', label: 'Desert Ruins', types: ['ground', 'rock', 'fire'] },
  { key: 'snow', label: 'Snow Peaks', types: ['ice', 'water', 'steel'] },
  { key: 'volcano', label: 'Volcano', types: ['fire', 'rock', 'dragon'] },
  { key: 'haunted', label: 'Haunted Ruins', types: ['ghost', 'dark', 'poison', 'psychic'] },
  { key: 'sky', label: 'Sky Temple', types: ['dragon', 'flying', 'psychic', 'fairy', 'electric'] },
];

// Mystery box item cards. Value = a share of your power at the start of the level, rounded.
// sprite = PokéAPI item name, image at
// https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/<sprite>.png
export const ITEMS = [
  { key: 'oran', label: 'Oran Berry', sprite: 'oran-berry', stars: 1, weight: 6, share: [0.08, 0.14] },
  { key: 'sitrus', label: 'Sitrus Berry', sprite: 'sitrus-berry', stars: 2, weight: 3, share: [0.15, 0.25] },
  { key: 'candy', label: 'Rare Candy', sprite: 'rare-candy', stars: 3, weight: 1, share: [0.28, 0.4] },
];

// Lucky Egg doubles your power. The puzzle: grab it LAST, right before the boss.
export const LUCKY_EGG = { label: 'Lucky Egg', sprite: 'lucky-egg', mult: 2, fromLevel: 3, chance: 0.5, trapFromLevel: 5 };

export const LEVEL_TUNING = {
  zones: (level) => Math.min(4, 3 + Math.floor((level - 1) / 10)), // 3 zones, 4 from level 11
  stopsPerZone: (level) => [3, Math.min(5, 4 + Math.floor(level / 12))], // min, max (gate not counted)
  // Wild Pokémon power as a share of your best power when the zone opens.
  wildShare: { first: [0.15, 0.3], normal: [0.1, 0.4], trap: [1.05, 1.3], trapChance: 0.7 },
  gateShare: (level) => Math.min(0.78, 0.6 + 0.008 * (level - 1)), // gate power vs best power before it
  bossShare: (level) => Math.min(0.95, 0.84 + 0.005 * (level - 1)), // boss power vs best possible
  maxGen: (level) => Math.min(9, 1 + Math.floor((level - 1) / 4)), // new generation every 4 levels
  tierCenter: (level) => Math.min(600, 290 + 12 * (level - 1)), // which Pokémon show up: weak early, strong later
  legendEvery: 10, // every 10th level the boss is a legendary or mythical
  lives: 3,
  heartEvery: 5, // +1 heart (max 3) every 5 levels cleared
};
