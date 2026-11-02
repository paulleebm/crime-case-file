// Web Audio로 직접 합성하는 악기들. 외부 음원 파일 없이 모든 소리를 만든다.

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let noiseCache: AudioBuffer | null = null;
export function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) return noiseCache;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache = buf;
  return buf;
}

/** 감쇠하는 잡음으로 만든 잔향 */
export function makeReverb(ctx: AudioContext, seconds = 2.8, decay = 2.6): ConvolverNode {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

function env(g: GainNode, t: number, peak: number, attack: number, dur: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/** FM 전자 피아노(로즈 느낌) */
export function rhodes(ctx: AudioContext, out: AudioNode, t: number, midi: number, dur: number, vel = 0.5) {
  const f = mtof(midi);
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const amp = ctx.createGain();
  car.frequency.value = f;
  mod.frequency.value = f;
  modGain.gain.setValueAtTime(f * 2.2, t);
  modGain.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.9);
  mod.connect(modGain).connect(car.frequency);
  env(amp, t, 0.16 * vel, 0.006, dur + 0.6);
  car.connect(amp).connect(out);
  car.start(t); mod.start(t);
  car.stop(t + dur + 0.7); mod.stop(t + dur + 0.7);
}

/** 어쿠스틱 피아노 느낌의 배음 합성 */
export function piano(ctx: AudioContext, out: AudioNode, t: number, midi: number, dur = 2.4, vel = 0.5) {
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(9000, f * 9), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2), t + dur);
  lp.connect(out);
  [[1, 1], [2, 0.42], [3, 0.16], [4.01, 0.07]].forEach(([h, a]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = h === 1 ? 'triangle' : 'sine';
    o.frequency.value = f * h;
    o.detune.value = (Math.random() - 0.5) * 6;
    env(g, t, 0.13 * vel * a, 0.004, dur / h + 0.3);
    o.connect(g).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.4);
  });
}

/** 콘트라베이스 피치카토 */
export function bass(ctx: AudioContext, out: AudioNode, t: number, midi: number, dur = 0.6, vel = 0.6) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  o.type = 'triangle';
  o.frequency.value = mtof(midi);
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(220, t + dur);
  env(g, t, 0.32 * vel, 0.01, dur);
  o.connect(lp).connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noiseHit(ctx: AudioContext, out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, dur: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, peak, attack, dur);
  src.connect(f).connect(g).connect(out);
  const off = Math.random() * 1.5;
  src.start(t, off);
  src.stop(t + dur + 0.05);
}

export const brush = (ctx: AudioContext, out: AudioNode, t: number, vel = 0.5) => noiseHit(ctx, out, t, 'bandpass', 2600, 0.8, 0.09 * vel, 0.04, 0.32);
export const ride = (ctx: AudioContext, out: AudioNode, t: number, vel = 0.5) => noiseHit(ctx, out, t, 'highpass', 7000, 0.7, 0.05 * vel, 0.002, 0.45);
export const hat = (ctx: AudioContext, out: AudioNode, t: number, vel = 0.5) => noiseHit(ctx, out, t, 'highpass', 8000, 0.7, 0.04 * vel, 0.002, 0.06);
export const snare = (ctx: AudioContext, out: AudioNode, t: number, vel = 0.5) => noiseHit(ctx, out, t, 'bandpass', 1800, 0.6, 0.16 * vel, 0.003, 0.18);

export function kick(ctx: AudioContext, out: AudioNode, t: number, vel = 0.6) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  env(g, t, 0.45 * vel, 0.003, 0.28);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.32);
}

/** 레코드판 잡음 */
export function crackle(ctx: AudioContext, out: AudioNode, t: number) {
  noiseHit(ctx, out, t, 'highpass', 3000 + Math.random() * 3000, 1, 0.015 + Math.random() * 0.03, 0.001, 0.015);
}

/** 길게 깔리는 패드 화음 */
export function pad(ctx: AudioContext, out: AudioNode, t: number, notes: number[], dur: number, vel = 0.4) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05 * vel, t + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  lp.connect(g).connect(out);
  notes.forEach((m) => {
    [-6, 6].forEach((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  });
}

/** 연속 잡음(빗소리, 라디오 잡음 바탕) */
export function noiseBed(ctx: AudioContext, out: AudioNode, type: BiquadFilterType, freq: number, gain: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(out);
  src.start();
  return { stop: () => { try { src.stop(); } catch { /* 이미 멈춤 */ } }, gain: g };
}

/** 미리 일정을 잡아 두는 반복 스케줄러 */
export function scheduler(ctx: AudioContext, stepLen: (step: number) => number, onStep: (step: number, t: number) => void) {
  let next = ctx.currentTime + 0.15;
  let step = 0;
  const id = window.setInterval(() => {
    while (next < ctx.currentTime + 0.35) {
      onStep(step, next);
      next += stepLen(step);
      step++;
    }
  }, 60);
  return () => window.clearInterval(id);
}
