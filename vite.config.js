import { defineConfig } from 'vite';

// Vercel: `npm run build` -> dist/. shared/dex.json is imported by the game code, so it's bundled
// into the JS (no separate fetch). Phaser alone is ~1.2 MB minified, hence the higher warning limit.
export default defineConfig({
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
});
