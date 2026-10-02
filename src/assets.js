// Sprite URLs from the PokéAPI sprites repo (PRD 7.3), with fallbacks.
import Phaser from 'phaser';


const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';

// Best first: HOME render, then official artwork, then the small sprite.
export function pokemonArt(id) {
  return [
    `${BASE}/pokemon/other/home/${id}.png`,
    `${BASE}/pokemon/other/official-artwork/${id}.png`,
    `${BASE}/pokemon/${id}.png`,
  ];
}

export function itemArt(sprite) {
  return `${BASE}/items/${sprite}.png`;
}

// Is this image already waiting in (or loading on) this loader? Then don't queue it twice:
// every sprite loads once (PRD 13).
function queued(loader, key) {
  // The loader's lists are Phaser CustomSets: their files live in .entries.
  return [loader.list, loader.inflight, loader.queue].some((set) => set?.entries?.some((f) => f.key === key));
}

export const pokemonKey = (id) => `pkmn-${id}`;
export const itemKey = (sprite) => `item-${sprite}`;

// Queues Pokémon images on a scene's loader. If a URL fails, the same texture key
// is retried with the next fallback URL, so scenes can always use pokemonKey(id).
// Call from preload(), or call scene.load.start() yourself afterwards.
export function loadPokemon(scene, ids) {
  const loader = scene.load;
  const pending = new Map(); // texture key -> remaining fallback URLs

  for (const id of new Set(ids)) {
    const key = pokemonKey(id);
    if (scene.textures.exists(key) || pending.has(key) || queued(loader, key)) continue;
    const [first, ...rest] = pokemonArt(id);
    pending.set(key, rest);
    loader.image(key, first);
  }
  if (pending.size === 0) return;

  const onError = (file) => {
    const rest = pending.get(file.key);
    if (!rest) return;
    if (rest.length === 0) {
      console.warn(`No art could be loaded for ${file.key}`);
      pending.delete(file.key);
      return;
    }
    loader.image(file.key, rest.shift());
    // A file added during the load is only picked up if the loader is running.
    if (!loader.isLoading()) loader.start();
  };
  const onComplete = () => {
    loader.off('loaderror', onError);
    loader.off('complete', onComplete);
  };

  loader.on('loaderror', onError);
  loader.on('complete', onComplete);
}

// Item sprites are tiny pixel art: keep them crisp when scaled up.
export function loadItems(scene, sprites) {
  for (const sprite of new Set(sprites)) {
    const key = itemKey(sprite);
    if (scene.textures.exists(key) || queued(scene.load, key)) continue;
    scene.load.image(key, itemArt(sprite));
    scene.load.once(`filecomplete-image-${key}`, () => {
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    });
  }
}
