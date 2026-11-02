import { bass, brush, crackle, hat, kick, noiseBed, pad, piano, rhodes, ride, scheduler, snare } from './synth';

// 라디오 채널. 모두 실시간으로 합성하며 매번 조금씩 다르게 연주한다.

export interface Station {
  id: string;
  freq: string;
  name: string;
  /** 잔향 비율 0~1 */
  reverb: number;
  /** 채널 간 음량을 맞추는 배율 (실측 RMS 기준) */
  level: number;
  start(ctx: AudioContext, out: AudioNode): () => void;
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const chance = (p: number) => Math.random() < p;

/** 심야 재즈: 스윙 브러시 드럼, 워킹 베이스, 전자 피아노 컴핑 */
const lateJazz: Station = {
  id: 'jazz', freq: '89.1', name: '심야 재즈', reverb: 0.25, level: 0.9,
  start(ctx, out) {
    const beat = 60 / 74;
    const chords = [
      { root: 36, tones: [36, 39, 43, 46], voicing: [51, 55, 58, 62] }, // Cm9
      { root: 36, tones: [36, 39, 43, 46], voicing: [51, 55, 58, 62] },
      { root: 41, tones: [41, 44, 48, 51], voicing: [56, 60, 63, 67] }, // Fm9
      { root: 41, tones: [41, 44, 48, 51], voicing: [56, 60, 63, 67] },
      { root: 38, tones: [38, 41, 44, 48], voicing: [53, 56, 60, 62] }, // Dm7b5
      { root: 43, tones: [43, 47, 50, 53], voicing: [53, 56, 59, 62] }, // G7b9
      { root: 36, tones: [36, 39, 43, 46], voicing: [51, 55, 58, 62] },
      { root: 43, tones: [43, 47, 50, 53], voicing: [53, 56, 59, 62] },
    ];
    const melody = [60, 63, 65, 67, 70, 72, 75];
    return scheduler(ctx, (s) => (s % 2 === 0 ? beat * 0.64 : beat * 0.36), (s, t) => {
      const bar = Math.floor(s / 8) % chords.length;
      const pos = s % 8;
      const ch = chords[bar];
      const next = chords[(bar + 1) % chords.length];
      if (pos % 2 === 0) {
        const b = pos / 2;
        const note = b === 0 ? ch.root : b === 3 ? next.root + pick([-1, 1, 2]) : pick(ch.tones.slice(1));
        bass(ctx, out, t, note, beat * 0.9, 0.55 + Math.random() * 0.15);
        ride(ctx, out, t, b % 2 ? 0.7 : 0.5);
        if (b === 0) kick(ctx, out, t, 0.25);
        if (b === 1 || b === 3) brush(ctx, out, t, 0.6);
      } else if (pos === 3 || pos === 7) ride(ctx, out, t, 0.35);
      if ((pos === 3 && chance(0.75)) || (pos === 6 && chance(0.5))) ch.voicing.forEach((m) => rhodes(ctx, out, t + Math.random() * 0.02, m, beat * 0.8, 0.45));
      if (pos % 2 === 1 && chance(0.13)) rhodes(ctx, out, t, pick(melody) + 12, beat * 0.7, 0.35);
      if (chance(0.35)) crackle(ctx, out, t + Math.random() * 0.2);
    });
  },
};

/** 빗속의 사무실: 빗소리와 느린 패드, 이따금 피아노 */
const rainyOffice: Station = {
  id: 'rain', freq: '93.5', name: '빗속의 사무실', reverb: 0.45, level: 1.7,
  start(ctx, out) {
    const rain = noiseBed(ctx, out, 'lowpass', 1600, 0.11);
    const hiss = noiseBed(ctx, out, 'highpass', 6500, 0.018);
    const chords = [[57, 60, 64, 71], [53, 57, 60, 64], [52, 55, 59, 60], [50, 55, 59, 64]];
    const notes = [69, 72, 74, 76, 79, 81];
    const stop = scheduler(ctx, () => 0.5, (s, t) => {
      if (s % 16 === 0) pad(ctx, out, t, chords[(s / 16) % chords.length], 8.4, 0.55);
      if (chance(0.09)) piano(ctx, out, t, pick(notes), 3.2, 0.3);
      if (chance(0.5)) crackle(ctx, out, t + Math.random() * 0.4);
      rain.gain.gain.setTargetAtTime(0.09 + Math.random() * 0.04, t, 1.5);
    });
    return () => { stop(); rain.stop(); hiss.stop(); };
  },
};

/** 느와르 피아노: 느린 단조 아르페지오 */
const noirPiano: Station = {
  id: 'noir', freq: '97.3', name: '느와르 피아노', reverb: 0.55, level: 3.2,
  start(ctx, out) {
    const eighth = 60 / 58 / 2;
    const bars = [
      { low: 45, arp: [57, 64, 69, 71, 72, 71, 69, 64] }, // Am(add9)
      { low: 41, arp: [57, 60, 64, 69, 72, 69, 64, 60] }, // Fmaj7
      { low: 38, arp: [57, 62, 65, 69, 72, 69, 65, 62] }, // Dm9
      { low: 40, arp: [56, 62, 65, 68, 71, 68, 65, 62] }, // E7b9
    ];
    const melody = [76, 77, 79, 80, 81, 83, 84];
    return scheduler(ctx, () => eighth, (s, t) => {
      const b = bars[Math.floor(s / 8) % bars.length];
      const pos = s % 8;
      if (pos === 0) { piano(ctx, out, t, b.low, 4, 0.55); piano(ctx, out, t, b.low + 12, 3.5, 0.3); }
      piano(ctx, out, t, b.arp[pos], 1.6, pos % 4 === 0 ? 0.42 : 0.3);
      if (pos % 4 === 0 && chance(0.22)) piano(ctx, out, t, pick(melody), 2.8, 0.38);
    });
  },
};

/** 새벽 세 시: 먼지 낀 로파이 비트 */
const threeAM: Station = {
  id: 'lofi', freq: '101.7', name: '새벽 세 시', reverb: 0.2, level: 0.55,
  start(ctx, out) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(out);
    const sixteenth = 60 / 80 / 4;
    const chords = [
      { root: 41, v: [53, 57, 60, 64, 67] }, // Fmaj9
      { root: 40, v: [52, 55, 59, 62] }, // Em7
      { root: 38, v: [50, 53, 57, 60, 64] }, // Dm9
      { root: 36, v: [48, 52, 55, 59] }, // Cmaj7
    ];
    const stop = scheduler(ctx, (s) => sixteenth * (s % 2 === 0 ? 1.12 : 0.88), (s, t) => {
      const ch = chords[Math.floor(s / 16) % chords.length];
      const pos = s % 16;
      if (pos === 0 || pos === 7 || pos === 10) kick(ctx, lp, t, pos === 0 ? 0.7 : 0.5);
      if (pos === 4 || pos === 12) snare(ctx, lp, t, 0.55);
      if (pos % 2 === 0) hat(ctx, lp, t, pos % 4 === 0 ? 0.5 : 0.3);
      if (pos === 0) ch.v.forEach((m, i) => rhodes(ctx, lp, t + i * 0.012, m, 1.9, 0.42));
      if (pos === 8 && chance(0.5)) ch.v.slice(1).forEach((m) => rhodes(ctx, lp, t, m + 12, 0.6, 0.22));
      if (pos === 0 || pos === 10) bass(ctx, lp, t, ch.root - 12, 0.5, 0.7);
      if (chance(0.25)) crackle(ctx, out, t);
    });
    return () => { stop(); lp.disconnect(); };
  },
};

/** 취조실: 낮게 깔린 소음과 심장 박동 */
const interrogation: Station = {
  id: 'tense', freq: '104.9', name: '취조실', reverb: 0.6, level: 0.85,
  start(ctx, out) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    lp.connect(g).connect(out);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    const drones = [33, 40, 45].map((m, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      o.detune.value = i * 4;
      o.connect(lp);
      o.start();
      return o;
    });
    const glass = [81, 84, 86, 87, 91, 93];
    const stop = scheduler(ctx, () => 0.6, (s, t) => {
      if (s % 2 === 0) { kick(ctx, out, t, 0.35); kick(ctx, out, t + 0.22, 0.22); }
      if (chance(0.12)) piano(ctx, out, t, pick(glass), 4.5, 0.18);
    });
    return () => { stop(); lfo.stop(); drones.forEach((o) => o.stop()); g.disconnect(); };
  },
};

export const STATIONS: Station[] = [lateJazz, rainyOffice, noirPiano, threeAM, interrogation];
