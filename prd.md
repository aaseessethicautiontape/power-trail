# Power Trail: Full PRD (v2, endless)

Owner: Aasees Sethi
Repo: power-trail
Stack: Vite (vanilla JS) + Phaser 3, Vercel for hosting and server functions, PokéAPI for all Pokémon data and sprites

This is Aasees's own full build of Power Trail. Phase 1 (the class version from Lab 3 Week 2, built from `PRD.md`) stays as it is. Everything after that follows this file.

The game logic is already written and tested in the **starter kit** (`shared/`, `scripts/`, `tests/`). Build the game on top of it. Don't rewrite it.

---

## 1. The game in one paragraph

Pick Pikachu, Charmander, Bulbasaur or Squirtle and climb an endless chain of colourful island maps. Every Pokémon on the map has a power number over its head. Tap one with a smaller number than yours: you win and its number is added to yours. Tap one with an equal or bigger number: you faint and lose a heart. Mystery boxes give berries and candy, and a Lucky Egg doubles your power (but only if you're smart about when you grab it). Beat the Alpha guarding the stairs to open the next part of the map, then beat the boss to clear the level. Levels never end: the biomes change, the Pokémon get stronger, new generations show up, and your starter evolves as you go.

## 2. Core rules (these never change)

1. **Pokémon power** = the sum of its 6 base stats from PokéAPI. Stored in `shared/dex.json`, which is built from PokéAPI's own data files.
2. **Power on a level** = Pokémon power × level number × alpha. Normal Pokémon have alpha 1. Alphas (gates, bosses, some late wilds) have alpha 2 or more.
3. **Your start power** each level = your current form's power × level number. Level 1 Pikachu starts at 320. Level 12 Raichu starts at 5,820.
4. **Battle**: you win only if their power is STRICTLY lower than yours. Ties lose.
5. **Win**: your power += their power.
6. **Lose**: you faint, lose a heart, and the level restarts from the start (same map, same numbers).
7. **Items**: berries and candy add a fixed number. The Lucky Egg multiplies by 2.
8. **Zones**: a level has 3 or 4 zones. Zone 1 is open at the start. Each later zone has a gate Alpha on the stairs. Beat it and the zone opens.
9. **Boss**: at the top of the last zone. Beat it to clear the level.
10. **Hearts**: start with 3. Clearing every 5th level gives +1 heart (max 3). 0 hearts = game over.
11. **Stars**: 1 to 3 based on your power right before the boss vs. the best possible (98% or more = 3 stars, 85% or more = 2).
12. **Score**: highest level cleared. Tiebreak: total stars.

All of this lives in `shared/rules.js` and `shared/level.js`. The browser and the server use the same files.

## 3. Starters and evolutions

| Starter | Level 1 power | Evolves | Into |
|---|---|---|---|
| Pikachu (25) | 320 | Level 12 | Raichu (26) 485 |
| Charmander (4) | 309 | Level 8, Level 20 | Charmeleon (5) 405, Charizard (6) 534 |
| Bulbasaur (1) | 318 | Level 8, Level 20 | Ivysaur (2) 405, Venusaur (3) 525 |
| Squirtle (7) | 314 | Level 8, Level 20 | Wartortle (8) 405, Blastoise (9) 530 |

Pikachu starts strongest but only evolves once, into the weakest final form. Good trade-off to point out to players.

Evolution levels live in `shared/config.js` (`STARTERS`).

## 4. Levels

### 4.1 How a level is built

`generateLevel({ dex, level, starter, runSeed })` in `shared/level.js` builds a whole level from a seed. Same inputs, same level, every time. It returns:

```
{
  level, starter, seed, biome, biomeLabel,
  form: { id, name, base },        // your Pokémon this level
  startPower,
  zones: [ { index, gate, stops: [...] } ],
  boss,
  best,                            // best possible power before the boss
  eggNaive, eggTrap,               // Lucky Egg info
  solution: { clicks, beforeBoss, canClear }
}
```

A Pokémon stop: `{ id, kind: 'wild' | 'gate' | 'boss', zone, pokemon: { id, name, base, types }, alpha, power }`
An item stop: `{ id, kind: 'item', zone, item, label, sprite, stars, value }`
The egg: `{ id, kind: 'egg', zone, label, sprite, mult }`

Inside each zone:
- The first wild Pokémon is always beatable when the zone opens.
- About half the zones have a **trap**: a Pokémon bigger than you that you can only beat after grabbing the rest of the zone.
- Items are 0 to 2 mystery boxes per zone.
- Every wild in the zone can always be beaten in some order (checked when the level is built).

Gates and bosses are tuned as a share of the best power you could have at that point, so you need to collect most of the map before the boss. The share rises with level (see `LEVEL_TUNING` in `shared/config.js`).

### 4.2 Lucky Egg trap

From level 3, about half the levels have a Lucky Egg (×2). From level 5, the boss is set so that grabbing the egg the moment you see it is NOT enough. You have to collect everything else first and take the egg last. Tested: in every egg-trap level, egg-first play loses to the boss.

### 4.3 Which Pokémon show up

- **Generations unlock as you climb**: Gen 1 only for levels 1 to 4, Gen 2 joins at level 5, and so on until all 9 generations by level 33.
- **Weak early, strong later**: the generator prefers Pokémon near a target power that rises 12 per level (290 at level 1, capped at 600).
- **Biome types**: Pokémon that match the biome's types are 3× more likely.
- **No repeats** inside one level when possible.
- **Legendary bosses**: every 10th level the boss is a legendary or mythical. Other bosses are strong fully evolved Pokémon.

### 4.4 Biomes (rotate every 5 levels)

| Levels | Biome | Pokémon types |
|---|---|---|
| 1 to 5 | Sunny Meadow | normal, bug, grass, flying |
| 6 to 10 | Coral Beach | water, ground, flying |
| 11 to 15 | Deep Forest | grass, bug, poison, fairy |
| 16 to 20 | Desert Ruins | ground, rock, fire |
| 21 to 25 | Snow Peaks | ice, water, steel |
| 26 to 30 | Volcano | fire, rock, dragon |
| 31 to 35 | Haunted Ruins | ghost, dark, poison, psychic |
| 36 to 40 | Sky Temple | dragon, flying, psychic, fairy, electric |
| 41+ | Loops back to Sunny Meadow | |

### 4.5 Example: Pikachu, level 1, run seed "demo"

| Zone | Gate | Stops |
|---|---|---|
| 1 | none | Caterpie 195, Zubat 245, Rattata 253, Sitrus Berry +61 |
| 2 | Alpha Jigglypuff 270 ×2 = 540 | Paras 285, Kakuna 205 ×2 = 410, Sitrus Berry +50 |
| 3 | Alpha Pidgeotto 349 ×3 = 1,047 | Pidgey 502, Koffing 680, Bellsprout 900, **Alpha Bulbasaur 318 ×14 = 4,452 (trap)** |
| Boss | | **Alpha Aerodactyl 515 ×13 = 6,695** |

Best play reaches 9,940 before the boss in 14 taps. Notice Rattata (253) is beatable here because Pikachu is 320, and Bulbasaur at 4,452 is a trap you can only take last.

### 4.6 Tested numbers

`node scripts/check-levels.mjs 60 25` builds 6,000 levels (4 starters × 25 runs × levels 1 to 60):
- 0 unbeatable levels
- 12 to 25 stops per level
- Power grows about 130× inside a typical level (Hero Wars style big numbers), a few hundred × on long late levels
- Every Lucky Egg trap punishes egg-first play

## 5. Starter kit (already done, don't rewrite)

| File | What it does |
|---|---|
| `shared/dex.json` | All 1025 Pokémon: id, name, power, generation, types, evolution stage, legendary and mythical flags |
| `scripts/build-dex.mjs` | Rebuilds `dex.json` from PokéAPI's data files on GitHub |
| `shared/config.js` | All tuning: starters, evolutions, biomes, items, Lucky Egg, level difficulty curves |
| `shared/rng.js` | Seeded random numbers so the same seed always builds the same level |
| `shared/level.js` | `generateLevel`, `formFor`, `biomeFor`, `levelSeed` |
| `shared/rules.js` | `canBeat`, `allStops`, `isAvailable`, `playLevel` (replay), `bestRun`, `starsFor`, `formatPower` |
| `tests/level.test.js` | 12 tests, all passing |
| `scripts/check-levels.mjs` | Stress test |

Rules for the build:
- Game code never decides a battle itself. It calls `canBeat` and `isAvailable`, and keeps a list of clicked stop ids.
- Never hardcode power numbers. They come from `generateLevel`.
- To change difficulty, edit `shared/config.js`, then run `npm test` and the stress test.

## 6. Screens

### 6.1 Boot
- Load fonts, then show a loading bar while the first level's sprites load.

### 6.2 Title
- Animated background: a slow pan across a Sunny Meadow map with a few idle Pokémon.
- "POWER TRAIL" logo: chunky font, orange to yellow gradient fill, thick dark outline, a gentle bounce.
- 4 starter cards in a row: big Pokémon art, name, type colour strip, start power, a line like "Evolves at 8 and 20". Selected card lifts and glows.
- Buttons: **Start**, **Continue** (only if a run is saved, shows "Level 14 · ❤️❤️"), **Trail Dex**, settings cog.
- "Best: Level 23" under the logo.

### 6.3 Level intro
- Biome banner slides in: "Level 7 · Coral Beach", with the biome icon. 1.2 seconds, then the map is playable.
- If the starter evolves this level, the evolution scene plays first (6.8).

### 6.4 Map (the main screen)
- Built like a 2.5D island diorama (see section 7). Each zone is a raised plateau. Stairs or a bridge connect zones, and the gate Alpha stands on them.
- Your Pokémon starts at the bottom of zone 1. The boss stands on a raised pedestal at the top of the last zone.
- Every stop: Pokémon art with a soft shadow and a gentle idle bob, the power badge above (section 7.4), and a small name label on tap-and-hold.
- Locked zones are visible but desaturated with a soft cloud of fog. When a gate falls, the fog blows away and the stairs light up.
- Mystery boxes have a bobbing "?" speech bubble. The Lucky Egg sits on a little glowing pedestal.
- Tap a stop you can reach: your Pokémon hops along the path to it, then the battle plays (6.5).
- Tap a locked stop: a small shake and a lock icon. Nothing happens.
- Camera: follows your Pokémon. Drag (mouse or one finger) to look around, with a little inertia. Scroll wheel or two-finger pinch to zoom. Zoom limits depend on the screen (section 7.7). A tap that moved less than 10px counts as a tap, more counts as a drag.
- HUD: top left power pill (big number, your Pokémon's icon), top centre "Level 7 · Coral Beach", top right hearts, bottom right pause button. HUD stays fixed while the camera moves and never zooms with the map (it lives in its own UI scene, section 7.7). On narrow portrait screens the level name moves under the power pill.
- Hold on any Pokémon for 0.5 seconds: an info card shows its art, name, types, and the maths: "Bulbasaur 318 × Level 1 × Alpha 14 = 4,452". This card can fetch the live PokéAPI entry to show the 6 stats.

### 6.5 Battle feel
- Win: your Pokémon lunges, an attack effect plays based on your starter's type (electric bolt, fire burst, leaf swirl, water splash), small camera shake, the enemy flashes white, squashes and pops into sparkles, a green "+4,452" floats up, and your power badge counts up with a bounce.
- Lose: your Pokémon lunges and bounces off, the screen flashes red, your Pokémon tips over, "You fainted!" banner, one heart cracks and falls off the HUD. Then a panel: "Try again" (same level, from the start) or "Quit to title".
- Items: the box pops open and an item card flies up (item art from PokéAPI, item name, 1 to 3 stars, "+61"), then the value flies into your power.
- Lucky Egg: egg cracks open, gold sparkle burst, "×2" in purple, power doubles with a bigger bounce.
- Every animation keeps the game responsive: the next tap is accepted as soon as the power number finishes counting (max 600ms).

### 6.6 Level clear
- Boss pops into confetti. Panel: "Level 7 cleared!", stars animate in one by one, "Power 64,400", "Best possible 64,400", and buttons **Next level** and **Map** (look around before moving on).
- Auto-saves before the panel shows.
- If this level gave a heart, show "+1 ❤️".

### 6.7 Game over
- "Out of hearts!", level reached, total stars, Pokémon beaten this run, new Pokémon added to the Trail Dex.
- Buttons: **New run** (back to starter select), **Trail Dex**.

### 6.8 Evolution
- Dark background, your Pokémon in the centre glows white and pulses faster and faster, swaps to the silhouette of the new form, then a flash reveals it. "Charmander evolved into Charmeleon!" Tap to continue.

### 6.9 Trail Dex
- Grid of all 1025 Pokémon. Ones you've beaten show their art, the rest are dark silhouettes with "?".
- Counter at the top: "87 / 1025".
- Filter tabs: All, by generation.
- Tap one you've beaten: info card with its stats from PokéAPI.

### 6.10 Pause and settings
- Resume, Restart level (costs no heart), Quit to title.
- Hint mode toggle (off by default): beatable Pokémon get a green badge outline instead of red.
- Reduce motion toggle: turns off camera shake and particles.

## 7. Art direction

The goal: it should look like a polished mobile game, bright and toy-like, the same genre as the Hero Wars ads but 100% original art. Don't use any art, logos, fonts, names or UI from Hero Wars or any other game.

### 7.1 Map construction (2.5D diorama)
Draw everything in code with Phaser Graphics, then bake each level's background into a RenderTexture once so it's fast.
- **Base ground**: two-tone noise patches in the biome's ground colours, soft and blotchy, never flat.
- **Plateaus**: each zone is a big rounded polygon with a light top face and a darker "cliff" band (24 to 40px) below it, like a block of earth. Add a soft drop shadow under each plateau.
- **Path**: a winding path across each plateau joining the stops, in the biome's path colour with a slightly darker edge line and a few pebbles.
- **Stairs or bridges** between plateaus: stairs drawn as stacked light and dark stripes on the cliff band. Bridges are wooden planks over water. The gate Alpha stands at the top of them.
- **Water**: rivers and pools between plateaus with a light rim, a foam edge and slow shimmering highlight lines.
- **Decor**: scatter trees, bushes, rocks and biome props around the edges of plateaus (never on top of stops). Everything gets an ellipse shadow. Big decor in front of the map edges for depth.
- **Ambient particles** per biome (section 7.2) plus a soft vignette.
- **Layout**: stops are placed inside their zone's plateau with seeded random placement and at least 140px between stops, so retrying a level shows the exact same map. Use a separate seed from the level: `hashSeed(level.seed, 'layout')`.
- **World size**: two layouts from the same level (section 7.7). **Wide** (landscape screens): 1280 wide, roughly 560px of height per zone. **Tall** (portrait screens): 760 wide, plateaus stacked more vertically, roughly 640px per zone. Both climb from bottom to top with plateaus offset left and right so the path zigzags. Same stops, same numbers, only positions change.

Optional upgrade later: if `public/biomes/<biome>.png` exists, use it as the ground layer and draw only paths, stops and particles on top. These can be painted or generated later.

### 7.2 Biome palettes

| Biome | Ground | Plateau top / cliff | Path | Water or special | Decor | Particles |
|---|---|---|---|---|---|---|
| Sunny Meadow | #8FD460, #7BC44F | #9BE070 / #5E9F3E | #F2D48A, edge #D9B566 | water #4FC3F7, rim #B3ECFF | round trees, flower clumps, mushrooms | pollen drifting |
| Coral Beach | #F6E3A1, #EED58A | #F9EAB8 / #C9A35E | boardwalk #C99A5B | sea #2EC4E8, deep #1A9BD1, foam #FFFFFF | palm trees, shells, starfish, beach umbrellas | sea sparkles |
| Deep Forest | #4E9B47, #3F8A3D | #5DAE52 / #2F6B33 | #B98A55 | pond #3BA7A0 | tall dark trees, glowing mushrooms, logs | fireflies |
| Desert Ruins | #F2C66D, #E6B055 | #E8B96B / #B9853F | stone #D4A35C | oasis #39C5C9 | cacti, broken pillars, ruins blocks | blowing sand |
| Snow Peaks | #EEF6FF, #DCEBF8 | #F7FBFF / #A9C4DE | #C9D9EA | ice #9FDBF5 | snowy pines (#3E7C6E with white caps), ice crystals #A8E6FF | snowfall |
| Volcano | #5B4B4F, #4A3B40 | #6E5A5E / #3A2C30 | #8E6E5E | lava #FF7A2F, glow #FFC15A | dark rocks, cracked ground glowing orange | embers rising |
| Haunted Ruins | #5C4B7A, #4B3D66 | #6D5A8F / #3B2F52 | #8D7BB0 | swamp #4FD1A5 | dead trees, purple lanterns, gravestones | floating wisps |
| Sky Temple | clouds #FFFFFF, #EAF2FF on sky #8EC9FF | #FFFFFF / #C9DBF5 | gold #FFD86B | rainbow arcs | floating islands, golden pillars | sparkles |

### 7.3 Pokémon art
- Use the PokéAPI HOME renders: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/{id}.png`
- If one fails to load, fall back to official artwork (`.../other/official-artwork/{id}.png`), then the small sprite (`.../pokemon/{id}.png`).
- Display around 110px tall for wilds, 150px for gates, 210px for bosses, 130px for the player.
- Every Pokémon gets an ellipse shadow and a slow idle bob (2 to 3px, random phase so they don't bob in sync).
- Wilds face the player. The player flips to face where it's hopping.
- Alphas get a small gold crown drawn above the badge and a faint red aura ring at their feet.
- Item art: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/{sprite}.png` (oran-berry, sitrus-berry, rare-candy, lucky-egg). These are tiny, so scale them up with pixel-art-safe filtering only for item images.
- Mystery box and pedestal are drawn in code (original design: rounded wooden box, gold bands, blue "?" bubble).

### 7.4 Power badges
- Font: **Lilita One** (Google Fonts) for all numbers and titles. **Nunito** for small UI text.
- Badge: big number, white fill, 8px outline, slight drop shadow, sitting just above the head.
- Colours: player blue outline #2563EB, enemies red #DC2626, items green #16A34A ("+61"), Lucky Egg purple #A855F7 ("×2"). Hint mode: beatable enemies switch to green.
- Numbers use `formatPower` (9,940, 12.4K, 975K, 3.1M).
- Floating "+X" numbers rise 60px and fade over 700ms.

### 7.5 UI kit
- Rounded panels (radius 24) in cream #FFF8EC with a 4px darker border and a soft shadow.
- Buttons: chunky rounded rectangles with a darker bottom edge so they look pressable. Press = moves down 4px. Main action orange #FB923C, secondary blue #3B82F6, danger red #EF4444.
- Type colours for starter cards: electric #F7D02C, fire #EE8130, grass #7AC74C, water #6390F0.
- Hearts: drawn red hearts with a white shine.
- Stars: gold #FACC15 with a darker outline, empty stars grey.

### 7.6 Performance
- Bake the map background once per level. Particles max ~80 on screen.
- Only load the sprites the current level needs, and start loading the next level's sprites while the clear panel is up.
- Should run at 60fps on a school Chromebook and a phone.

### 7.7 Responsive and mobile (applies to every screen)

The game fills the whole browser window and re-lays itself out live while the window is resized or the phone is rotated. No letterbox bars, no reload, no lost progress.

**Canvas**
- Phaser `Scale.RESIZE`: the canvas is always exactly the window size. Use `100dvh` so mobile browser bars don't cut it off.
- `index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`, `html, body { margin: 0; height: 100%; overflow: hidden; overscroll-behavior: none; }`, canvas `touch-action: none` so drags and pinches never scroll or zoom the page.
- Text and generated textures render at `min(devicePixelRatio, 2)` so they stay sharp on phones and retina screens.

**Screen sizes**
- `src/layout/screen.js` exports `getScreen(scene)` returning `{ w, h, portrait, compact, ui, safe }`:
  - `portrait` = h > w
  - `compact` = the short side is under 500px (phones)
  - `ui` = a UI scale factor, `clamp(min(w / 1280, h / 720), 0.6, 1.4)`, bumped up to at least 0.8 on compact screens so text stays readable
  - `safe` = safe-area insets (notch, home bar) read from CSS `env(safe-area-inset-*)`
- Every scene has a `layout()` method that places everything from `getScreen`. It runs on create and on every `this.scale.on('resize')`, debounced to about 100ms. Nothing in a scene uses fixed pixel positions from a 1280×720 design.

**Per screen**
- Title, landscape: 4 starter cards in a row. Portrait: logo on top, cards in a 2×2 grid, buttons stacked full-width at the bottom. Very small phones: cards shrink but art, name and power stay readable.
- Level map: picks the **wide** world on landscape screens and the **tall** world on portrait screens. Rotating the phone rebuilds the map layout and the baked background, keeps every taken stop and the current power, and keeps the camera centred on the player. Resizing without changing orientation only moves the camera bounds and zoom.
- Map zoom: the default zoom fits the world's width to the screen width (clamped). Pinch and wheel zoom between 0.8× and 2× of that default.
- HUD, panels, banners, item cards and the info card live in a separate `UIScene` that runs on top of the map scene, so camera zoom never shrinks them. They use `ui` scale and stay inside the safe area.
- Panels (level clear, game over, pause, info card): max 92% of screen width on phones, centred, buttons stacked vertically when the panel is narrower than 420px.
- Trail Dex grid: the number of columns comes from the width (about 3 on a phone, 8 or more on a desktop). Scroll by drag with inertia.

**Touch**
- Every tappable thing has at least a 44×44px hit area on screen, even if it looks smaller.
- Badges and labels on the map never get smaller than 18px on screen. When zoomed out, they counter-scale so they stay readable.
- Pinch zoom needs `this.input.addPointer(1)`. Long-press (0.5s) opens the info card on touch, the same as hold on desktop.
- No hover-only features. Hover effects are a bonus on desktop.

**Performance on phones**
- When `compact` is true: max 40 particles, smaller baked map texture, and skip the vignette blur if it drops frames.

**Test sizes** (every phase from now on): 390×844 phone portrait, 844×390 phone landscape, 768×1024 tablet portrait, 1280×720, 1920×1080, plus dragging the browser window edge live while the game is running.

## 8. Code structure

```
power-trail/
  index.html                 Google Fonts links, #app
  PRD.md                     class version, keep as is
  PRD-FULL.md                this file
  package.json               "type": "module", "test": "node --test tests/*.test.js"
  shared/                    starter kit (game logic)
  scripts/                   starter kit (build-dex, check-levels)
  tests/                     starter kit tests + new ones
  src/
    main.js                  Phaser config (Scale.RESIZE, full window), waits for fonts
    layout/
      screen.js              getScreen(): size, portrait, compact, ui scale, safe areas
    save.js                  localStorage save, wrapped in try/catch
    assets.js                sprite URL helpers and fallbacks
    art/
      palettes.js            section 7.2 as data
      biomeRenderer.js       draws and bakes the map for a level
      layout.js              places plateaus, paths, stairs and stops (seeded)
      effects.js             attack effects, sparkles, floating numbers, confetti
      ui.js                  buttons, panels, badges, hearts, stars
    scenes/
      BootScene.js
      TitleScene.js
      LevelScene.js          map + taps (camera, zoom)
      UIScene.js             HUD, panels, banners on top of LevelScene
      EvolutionScene.js
      DexScene.js
  api/                       Phase 8+
    run.js
    leaderboard.js
```

## 9. Save data

`localStorage` key `powerTrail.v1`, everything wrapped in try/catch so the game still works if storage is blocked:

```
{
  bestLevel, bestStars,
  run: { starter, runSeed, level, hearts, stars, history: [ { level, attempts: [[stopIds...]] } ] } | null,
  dex: [ids of Pokémon beaten],
  settings: { hint: false, reduceMotion: false }
}
```

- A new run gets a random `runSeed` (8 characters from `crypto.getRandomValues`).
- The history of taps is saved so the server can check the run later (section 10).

## 10. Server decides (Phase 8)

Same idea as before, now for a whole run.
- The browser sends `POST /api/run` with `{ starter, runSeed, history }`. No powers, no scores.
- The server rebuilds every level with `generateLevel` (reading `shared/dex.json` itself) and replays every attempt with `playLevel`.
- It checks: levels go 1, 2, 3 in order; every attempt except the last one on a level ended `fainted` (costs a heart) or `incomplete` (a free restart from the pause menu); the last attempt on each cleared level is `cleared`; hearts never go below 0 using the heart rules; stop ids are valid.
- It returns `{ verified: true, levelsCleared, stars, hearts }` and the browser shows "✅ Verified" on game over.
- Anything wrong returns 400 with a short reason.
- The `window.powerTrail.setPower(n)` cheat hook (kept for teaching) changes the screen, but the server's answer ignores it.

## 11. Leaderboard (Phase 9)

- `POST /api/leaderboard` takes the same run body plus `initials` (exactly 3 letters A to Z). The server verifies the run and saves ONLY its own result. No real names (players are kids).
- `GET /api/leaderboard` returns the top 10: initials, starter, levels cleared, stars.
- **Daily Trail**: a button on the title that uses today's date as the run seed, so everyone plays the same levels that day. Separate daily top 10.
- Storage: Upstash Redis through the Vercel Marketplace. Credentials only in Vercel environment variables.

## 12. Phases

| Phase | What ships | Done when |
|---|---|---|
| 1 | Class version | Built live in Week 2 |
| 2 | Kit installed, scenes skeleton, fonts, save system, asset loader | `npm test` passes, Title shows 4 starters with HOME art |
| 3 | Map art: biome renderer, plateaus, paths, stairs, water, decor, particles, stops and badges | Every biome looks right in a debug biome switcher |
| 4 | Gameplay: taps, battles, items, egg, gates, boss, hearts, level clear, next level, evolution | A full run from level 1 to 10 works with all 4 starters |
| 5 | Meta: Title polish, Continue, game over, Trail Dex, pause and settings | Refresh mid-run and Continue works |
| 6 | Polish and performance pass | 60fps on a phone, no console errors, every test size in 7.7 looks right |
| 7 | Deployed to Vercel | Public URL works on phone and laptop |
| 8 | Server decides | Cheated runs are rejected |
| 9 | Leaderboard and Daily Trail | Top 10 shows server-verified results only |
| 10 (optional) | Painted biome backgrounds, sound effects, music | |

## 13. Acceptance tests

Automated (already passing in the kit, keep them passing):
- Starter powers 320 / 309 / 318 / 314, dex has 1025 Pokémon
- Ties lose
- Evolution levels
- Biome rotation
- Same seed builds the same level
- Levels 1 to 40 clearable for every starter
- Locked stops and repeat taps are rejected
- Lucky Egg trap works
- Power = base × level × alpha for every Pokémon stop
- `formatPower` output

Manual:
- Pikachu level 1 with run seed "demo" matches section 4.5.
- Tapping a locked stop does nothing except the lock shake.
- Fainting costs exactly one heart and restarts the same map.
- Evolution plays at level 8 for Charmander, Bulbasaur and Squirtle, and level 12 for Pikachu.
- Biome changes at level 6.
- Level 10 boss is a legendary or mythical.
- Refreshing the page mid-run and pressing Continue resumes the same level with the same hearts.
- Trail Dex count goes up after beating a new Pokémon.
- No console errors. Each sprite loads once.
- Every screen looks right at all the test sizes in section 7.7, and dragging the window edge re-lays it out live without a reload.
- Rotating a phone mid-level keeps power, taken stops and hearts.
- Pinch zoom and drag work on a real phone and never scroll the page.

## 14. Out of scope

- Moves, types and type matchups in battle (types only pick which Pokémon appear)
- Multiplayer
- Accounts, logins, real names, emails
- Ads, in-app purchases, or publishing commercially (Pokémon art is used for a personal teaching project)
- Any art, logos, fonts, names or UI copied from Hero Wars or any other game