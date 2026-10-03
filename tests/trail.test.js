// Run: npm test   (level-select trail map geometry)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyCircles } from '../src/art/layout.js';
import {
  TRAIL, trailGeometry, bandRect, bandOf, roadBetween, bandDecor, visibleBands, trailCount, thin, heroSpot,
} from '../src/art/trail.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const WIDTHS = [520, 640, 760, 1024];

test('levels climb the map: level 1 at the bottom, every node inside the world', () => {
  for (const W of WIDTHS) {
    const geo = trailGeometry({ W, count: 40, seed: 'abc' });
    assert.equal(geo.nodes.length, 40);
    assert.equal(geo.nodes[0].level, 1);
    for (let i = 1; i < geo.nodes.length; i++) {
      assert.ok(geo.nodes[i].y < geo.nodes[i - 1].y, `level ${i + 1} is above level ${i}`);
      assert.ok(Math.abs(geo.nodes[i].y - geo.nodes[i - 1].y - -TRAIL.step) < 1e-6);
      assert.ok(dist(geo.nodes[i], geo.nodes[i - 1]) > 100, 'nodes are spaced out');
    }
    for (const n of geo.nodes) {
      assert.ok(n.x >= TRAIL.nodeR + 10 && n.x <= W - TRAIL.nodeR - 10, `node ${n.level} x ${n.x} inside ${W}`);
      assert.ok(n.y > 0 && n.y < geo.H);
    }
  }
});

test('the road passes through every node, in order, with no big gaps', () => {
  const geo = trailGeometry({ W: 760, count: 30, seed: 'road' });
  for (let i = 1; i < geo.nodes.length; i++) assert.ok(geo.nodes[i].i > geo.nodes[i - 1].i, 'node indexes increase');
  for (const n of geo.nodes) assert.ok(dist(geo.road[n.i], n) < 10, `road reaches node ${n.level}`);
  for (let i = 1; i < geo.road.length; i++) assert.ok(dist(geo.road[i], geo.road[i - 1]) < 16, 'road is densely sampled');
});

test('roadBetween walks from one level to another, either way', () => {
  const geo = trailGeometry({ W: 640, count: 20, seed: 'walk' });
  const up = roadBetween(geo, 3, 4);
  assert.ok(dist(up[0], geo.nodes[2]) < 10 && dist(up.at(-1), geo.nodes[3]) < 10);
  const down = roadBetween(geo, 4, 3);
  assert.ok(dist(down[0], geo.nodes[3]) < 10 && dist(down.at(-1), geo.nodes[2]) < 10);
  assert.equal(roadBetween(geo, 5, 5).length, 1);
  const t = thin(roadBetween(geo, 1, 6), 24);
  assert.ok(t.length < roadBetween(geo, 1, 6).length / 2);
});

test('biome bands tile the whole map with no gaps', () => {
  for (const count of [15, 20, 45]) {
    const geo = trailGeometry({ W: 760, count, seed: 'bands' });
    assert.equal(geo.bands, count / TRAIL.band);
    assert.equal(bandRect(geo, 0).bottom, geo.H);
    assert.equal(bandRect(geo, geo.bands - 1).top, 0);
    for (let b = 1; b < geo.bands; b++) {
      assert.ok(Math.abs(bandRect(geo, b).bottom - bandRect(geo, b - 1).top) < 1e-6, `band ${b} meets band ${b - 1}`);
    }
    // Levels 1-5 sit in band 0, levels 6-10 in band 1, ...
    for (const n of geo.nodes) {
      const r = bandRect(geo, bandOf(n.level));
      assert.ok(n.y >= r.top && n.y <= r.bottom, `level ${n.level} is inside its band`);
    }
  }
});

test('decor never covers the road or a level node, and is the same every time', () => {
  for (const W of [520, 760]) {
    const geo = trailGeometry({ W, count: 20, seed: 'decor' });
    for (let b = 0; b < geo.bands; b++) {
      const decor = bandDecor(geo, b, ['meadow', 'beach', 'forest', 'desert'][b]);
      assert.ok(decor.length > 10, 'a band has scenery');
      const r = bandRect(geo, b);
      for (const d of decor) {
        for (const c of bodyCircles(d.type, d.x, d.y, d.scale)) {
          assert.ok(c.y - c.r >= r.top, 'inside the band texture');
          for (const p of geo.road) assert.ok(dist(p, c) > c.r + TRAIL.roadHalf, `${d.type} at ${Math.round(d.x)},${Math.round(d.y)} is on the road`);
          for (const n of geo.nodes) assert.ok(dist(n, c) > c.r + TRAIL.nodeR, `${d.type} covers level ${n.level}`);
          for (const n of geo.nodes) assert.ok(dist(heroSpot(geo, n.level), c) > c.r + 40, `${d.type} crowds the Pokémon on level ${n.level}`);
        }
      }
      assert.deepEqual(bandDecor(geo, b, ['meadow', 'beach', 'forest', 'desert'][b]), decor);
    }
  }
});

test('only the bands near the screen are kept, and the count is whole biomes', () => {
  const geo = trailGeometry({ W: 760, count: 60, seed: 'vis' });
  const near = visibleBands(geo, geo.H - 900, geo.H);
  assert.ok(near.includes(0) && near.length < geo.bands / 2, `kept ${near.join(',')}`);
  assert.equal(visibleBands(geo, 0, geo.H).length, geo.bands);
  assert.equal(trailCount(1, 0), 15);
  assert.equal(trailCount(12, 0), 20);
  assert.equal(trailCount(3, 28) % TRAIL.band, 0);
  assert.ok(trailCount(40, 40) >= 46);
});
