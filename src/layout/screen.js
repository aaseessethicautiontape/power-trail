// Screen info for responsive layout (PRD 7.7). Every scene's layout() starts here.

// Text and generated textures render at this resolution so they stay sharp on phones.
export const RES = Math.min(window.devicePixelRatio || 1, 2);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function readSafe() {
  try {
    const css = getComputedStyle(document.documentElement);
    const px = (name) => parseFloat(css.getPropertyValue(name)) || 0;
    return { top: px('--safe-top'), right: px('--safe-right'), bottom: px('--safe-bottom'), left: px('--safe-left') };
  } catch {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}

// { w, h, portrait, compact, ui, safe }
// ui compares against a 1280x720 design in landscape and a 720x1280 design in
// portrait, so a tablet held upright isn't treated like a tiny landscape screen.
export function getScreen(scene) {
  const w = scene.scale.width;
  const h = scene.scale.height;
  const portrait = h > w;
  const compact = Math.min(w, h) < 500;
  const fit = portrait ? Math.min(w / 720, h / 1280) : Math.min(w / 1280, h / 720);
  let ui = clamp(fit, 0.6, 1.4);
  if (compact) ui = Math.max(ui, 0.8);
  return { w, h, portrait, compact, ui, safe: readSafe() };
}

// The safe rectangle with a margin, handy for placing UI.
export function safeRect(scr, margin = 0) {
  const { w, h, safe } = scr;
  const left = safe.left + margin;
  const top = safe.top + margin;
  const right = w - safe.right - margin;
  const bottom = h - safe.bottom - margin;
  return { left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

// Calls layout() on every resize, debounced (~100ms), so dragging a window edge
// doesn't rebuild every frame. An orientation flip (phone rotation) re-lays out
// straight away so the old layout never shows in the new shape. `immediate`
// runs on every resize event for cheap fixes (e.g. stretching a background).
// Cleans itself up when the scene shuts down.
export function watchResize(scene, layout, { delay = 100, immediate } = {}) {
  let timer = null;
  let portrait = scene.scale.height > scene.scale.width;
  const run = () => {
    timer = null;
    if (scene.sys.isActive() || scene.sys.isPaused()) layout();
  };
  const onResize = () => {
    immediate?.();
    clearTimeout(timer);
    const nowPortrait = scene.scale.height > scene.scale.width;
    if (nowPortrait !== portrait) {
      portrait = nowPortrait;
      run();
    } else {
      timer = setTimeout(run, delay);
    }
  };
  scene.scale.on('resize', onResize);
  scene.events.once('shutdown', () => {
    scene.scale.off('resize', onResize);
    clearTimeout(timer);
  });
}
