// Biome palettes (PRD 7.2) as data. Keys match BIOMES[].key in shared/config.js.
// Colours are 0xRRGGBB numbers for Phaser Graphics. Decor and particles per biome
// live in STYLE in biomeRenderer.js.

export const PALETTES = {
  meadow: {
    vignette: ['10,30,20', 0.32], // rgb, edge alpha
    label: 'Sunny Meadow',
    ground: [0x8fd460, 0x7bc44f],
    top: 0x9be070,
    cliff: 0x5e9f3e,
    path: 0xf2d48a,
    pathEdge: 0xd9b566,
    water: 0x4fc3f7,
    waterRim: 0xb3ecff,
    waterDeep: 0x2fa8e0,
    foam: 0xffffff,
  },
  beach: {
    vignette: ['20,60,90', 0.26], // rgb, edge alpha
    label: 'Coral Beach',
    ground: [0xf6e3a1, 0xeed58a],
    top: 0xf9eab8,
    cliff: 0xc9a35e,
    path: 0xc99a5b,
    pathEdge: 0xa77a42,
    water: 0x2ec4e8,
    waterRim: 0xb3f0ff,
    waterDeep: 0x1a9bd1,
    foam: 0xffffff,
  },
  forest: {
    vignette: ['0,18,8', 0.5], // rgb, edge alpha
    label: 'Deep Forest',
    ground: [0x4e9b47, 0x3f8a3d],
    top: 0x5dae52,
    cliff: 0x2f6b33,
    path: 0xb98a55,
    pathEdge: 0x94693b,
    water: 0x3ba7a0,
    waterRim: 0x9fe3d9,
    waterDeep: 0x2a8780,
    foam: 0xe8fffb,
  },
  desert: {
    vignette: ['90,45,0', 0.3], // rgb, edge alpha
    label: 'Desert Ruins',
    ground: [0xf2c66d, 0xe6b055],
    top: 0xe8b96b,
    cliff: 0xb9853f,
    path: 0xd4a35c,
    pathEdge: 0xb0823f,
    water: 0x39c5c9,
    waterRim: 0xb5f3f2,
    waterDeep: 0x23a3a8,
    foam: 0xffffff,
  },
  snow: {
    vignette: ['40,70,120', 0.22], // rgb, edge alpha
    label: 'Snow Peaks',
    ground: [0xeef6ff, 0xdcebf8],
    top: 0xf7fbff,
    cliff: 0xa9c4de,
    path: 0xc9d9ea,
    pathEdge: 0xa9bfd6,
    water: 0x9fdbf5,
    waterRim: 0xe4f7ff,
    waterDeep: 0x6fc3ea,
    foam: 0xffffff,
  },
  volcano: {
    vignette: ['45,0,0', 0.5], // rgb, edge alpha
    label: 'Volcano',
    ground: [0x5b4b4f, 0x4a3b40],
    top: 0x6e5a5e,
    cliff: 0x3a2c30,
    path: 0x8e6e5e,
    pathEdge: 0x6d5245,
    water: 0xff7a2f, // lava
    waterRim: 0xffc15a,
    waterDeep: 0xe0561a,
    foam: 0xffe08a,
  },
  haunted: {
    vignette: ['18,0,40', 0.66], // rgb, edge alpha
    label: 'Haunted Ruins',
    ground: [0x5c4b7a, 0x4b3d66],
    top: 0x6d5a8f,
    cliff: 0x3b2f52,
    path: 0x8d7bb0,
    pathEdge: 0x6f5e93,
    water: 0x4fd1a5, // swamp
    waterRim: 0xa8f0d6,
    waterDeep: 0x36b38a,
    foam: 0xd6fff0,
  },
  sky: {
    vignette: ['60,110,190', 0.22], // rgb, edge alpha
    label: 'Sky Temple',
    ground: [0xffffff, 0xeaf2ff],
    sky: 0x8ec9ff,
    top: 0xffffff,
    cliff: 0xc9dbf5,
    path: 0xffd86b,
    pathEdge: 0xe0b84a,
    water: 0x8ec9ff, // open sky between islands
    waterRim: 0xffffff,
    waterDeep: 0x6fb4f2,
    foam: 0xffffff,
  },
};

export function paletteFor(biomeKey) {
  const key = biomeKey in PALETTES ? biomeKey : 'meadow';
  return { key, ...PALETTES[key] };
}
