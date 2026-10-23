// Chiptune sound effects, synthesized with Web Audio (no audio files). Call sfx(name).
// Sound starts after the first click or key press (browsers require a user gesture),
// and the mute setting is remembered per browser.

const KEY = 'hopi-farms-sound';
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === 'off'; } catch { /* storage unavailable */ }

function audio() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// One note: wave type, frequency (or [from, to] for a slide), start offset and length in s.
function tone(type, freq, at, len, vol = 1) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  const [f0, f1] = Array.isArray(freq) ? freq : [freq, freq];
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

function noise(at, len, vol = 0.5, hp = 800) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * len), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const N = { C4: 262, E4: 330, G4: 392, A4: 440, C5: 523, D5: 587, E5: 659, F5: 698, G5: 784, A5: 880, B5: 988, C6: 1047, E6: 1319, G6: 1568 };
const arp = (type, notes, step, len, vol = 0.8) => notes.forEach((n, i) => tone(type, N[n] || n, i * step, len, vol));

const SOUNDS = {
  click: () => tone('square', 880, 0, 0.03, 0.25),
  tick: () => tone('square', 1400, 0, 0.018, 0.18),
  plant: () => { tone('triangle', [220, 440], 0, 0.09, 0.7); noise(0, 0.05, 0.12, 2000); },
  harvest: () => arp('square', ['E5', 'B5'], 0.06, 0.09, 0.45),
  harvestAll: () => arp('square', ['C5', 'E5', 'G5', 'C6'], 0.055, 0.09, 0.45),
  coins: () => arp('square', ['B5', 'E6', 'B5', 'E6'], 0.05, 0.07, 0.35),
  error: () => tone('square', [180, 120], 0, 0.16, 0.4),
  // Gacha landings, more notes for rarer crops.
  common: () => tone('triangle', 660, 0, 0.12, 0.7),
  uncommon: () => arp('triangle', ['E5', 'A5'], 0.07, 0.12),
  rare: () => arp('square', ['C5', 'E5', 'A5'], 0.07, 0.13, 0.45),
  epic: () => arp('square', ['C5', 'E5', 'G5', 'C6'], 0.07, 0.15, 0.5),
  legendary: () => {
    arp('square', ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'], 0.08, 0.18, 0.5);
    for (let i = 0; i < 8; i++) tone('sine', 2000 + Math.random() * 1500, 0.5 + i * 0.05, 0.08, 0.15);
  },
  levelUp: () => { arp('square', ['C5', 'E5', 'G5', 'C6'], 0.09, 0.16, 0.5); tone('triangle', N.C6, 0.36, 0.4, 0.5); },
  chestRattle: () => { for (let i = 0; i < 5; i++) noise(i * 0.12, 0.05, 0.25, 1500); },
  chestOpen: () => {
    tone('sawtooth', [140, 90], 0, 0.25, 0.25);                 // creak
    arp('triangle', ['G5', 'C6', 'E6', 'G6'], 0.07, 0.2, 0.6);   // sparkle
    for (let i = 0; i < 10; i++) tone('sine', 1800 + Math.random() * 2200, 0.25 + i * 0.04, 0.07, 0.12);
  },
  brew: () => { for (let i = 0; i < 9; i++) tone('sine', [300 + Math.random() * 500, 700 + Math.random() * 400], i * 0.13, 0.07, 0.35); },
  success: () => arp('triangle', ['E5', 'G5', 'C6'], 0.08, 0.16),
  fizzle: () => { tone('sawtooth', [400, 60], 0, 0.5, 0.25); noise(0.05, 0.45, 0.2, 600); },
  potion: () => { tone('sine', [500, 1200], 0, 0.15, 0.5); tone('sine', [700, 1600], 0.06, 0.15, 0.3); },
};

export function sfx(name) {
  try { SOUNDS[name]?.(); } catch { /* audio unavailable */ }
}

export function isMuted() { return muted; }

export function setMuted(on) {
  muted = on;
  try { localStorage.setItem(KEY, on ? 'off' : 'on'); } catch { /* storage unavailable */ }
  if (on && ctx) ctx.suspend();
  if (!on) sfx('click');
}
