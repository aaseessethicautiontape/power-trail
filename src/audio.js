// All game audio is synthesized here; no recordings or third-party melodies are bundled.
let context = null;
let master = null;
let muted = true;
let effectsEnabled = true;
let musicTimer = null;
let musicStep = 0;
let nextMusicTime = 0;

const CHORDS = [
  [60, 64, 67, 71], // Cmaj7
  [57, 60, 64, 67], // Am7
  [53, 57, 60, 64], // Fmaj7
  [55, 59, 62, 65], // G6
];

function audioContext() {
  if (context) return context;
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return null;
  context = new Ctx();
  master = context.createGain();
  master.gain.value = muted ? 0 : 0.7;
  master.connect(context.destination);
  return context;
}

export function unlockAudio() {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (!muted) startMusic();
}

export function setSoundMuted(value) {
  muted = !!value;
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended' && !muted) ctx.resume().catch(() => {});
  master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.025);
  if (muted) stopMusic();
  else startMusic();
}

export function setSoundEffectsEnabled(value) {
  effectsEnabled = !!value;
}

function tone(from, to, duration, { type = 'sine', volume = 0.12, delay = 0 } = {}) {
  const ctx = audioContext();
  if (!ctx || muted || !effectsEnabled) return;
  const start = ctx.currentTime + delay;
  const end = start + duration;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, from), start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.012, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(end + 0.01);
}

function noise(duration, volume = 0.08, cutoff = 1800) {
  const ctx = audioContext();
  if (!ctx || muted || !effectsEnabled) return;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  source.connect(filter).connect(gain).connect(master);
  source.start();
}

const sounds = {
  tap: () => tone(920, 620, 0.045, { type: 'triangle', volume: 0.045 }),
  hop: () => tone(310, 570, 0.12, { type: 'sine', volume: 0.07 }),
  hit: () => { tone(190, 68, 0.14, { type: 'sawtooth', volume: 0.12 }); noise(0.09, 0.045, 1100); },
  pop: () => tone(420, 980, 0.105, { type: 'triangle', volume: 0.08 }),
  item: () => {
    tone(620, 930, 0.13, { type: 'sine', volume: 0.075 });
    tone(930, 1240, 0.16, { type: 'sine', volume: 0.055, delay: 0.09 });
  },
  egg: () => {
    tone(300, 600, 0.34, { type: 'sine', volume: 0.07 });
    tone(450, 900, 0.38, { type: 'sine', volume: 0.055, delay: 0.07 });
    tone(720, 1100, 0.42, { type: 'triangle', volume: 0.035, delay: 0.13 });
  },
  faint: () => { tone(260, 72, 0.38, { type: 'triangle', volume: 0.12 }); noise(0.16, 0.045, 600); },
  clear: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => tone(hz, hz * 1.01, 0.3, { type: 'sine', volume: 0.075, delay: i * 0.11 }));
  },
};

export function playSound(name) {
  if (muted) return;
  sounds[name]?.();
}

function midiHz(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function scheduleMusicNote(note, at, duration, volume, octave = 0) {
  const ctx = context;
  if (!ctx || muted) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = midiHz(note + octave);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.08);
  gain.gain.setTargetAtTime(0.0001, at + duration * 0.62, duration * 0.18);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + duration);
}

function scheduleMusic() {
  const ctx = context;
  if (!ctx || muted) return;
  const stepDuration = 0.38;
  const horizon = ctx.currentTime + 0.7;
  while (nextMusicTime < horizon) {
    const chord = CHORDS[Math.floor(musicStep / 4) % CHORDS.length];
    const note = chord[[0, 2, 1, 3][musicStep % 4]];
    scheduleMusicNote(note, nextMusicTime, stepDuration * 1.7, 0.025);
    if (musicStep % 4 === 0) scheduleMusicNote(chord[0] - 12, nextMusicTime, stepDuration * 2.3, 0.018);
    musicStep++;
    nextMusicTime += stepDuration;
  }
}

function startMusic() {
  const ctx = context;
  if (!ctx || muted || musicTimer) return;
  nextMusicTime = ctx.currentTime + 0.08;
  scheduleMusic();
  musicTimer = globalThis.setInterval(scheduleMusic, 180);
}

function stopMusic() {
  if (musicTimer) globalThis.clearInterval(musicTimer);
  musicTimer = null;
}
