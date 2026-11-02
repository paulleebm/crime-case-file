import { audio } from './engine';
import { noiseBuffer } from './synth';

// 서류철·연필·도장 느낌의 효과음. 모두 합성으로 만든다.

function out(): { ctx: AudioContext; dry: AudioNode; wet: AudioNode } | null {
  const ctx = audio.ensure();
  if (!ctx || audio.settings.sfx <= 0) return null;
  return { ctx, dry: audio.sfxGain, wet: audio.sfxReverb };
}

function noise(ctx: AudioContext, dest: AudioNode, t: number, o: { type: BiquadFilterType; freq: number; q?: number; peak: number; attack: number; dur: number; sweepTo?: number; rate?: number }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.playbackRate.value = o.rate ?? 1;
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
  f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.peak, t + o.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + o.dur + 0.05);
}

function tone(ctx: AudioContext, dest: AudioNode, t: number, f0: number, f1: number, peak: number, dur: number, type: OscillatorType = 'sine') {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/**
 * 자판 소리: [딱 소리 중심 주파수, 바닥 소리 중심 주파수, 몸통 음높이, 두 소리 사이 간격, 크기].
 * 크기는 보내기 소리(type)와 비슷하게 맞췄다. 소리가 아주 짧아 크기를 낮추면 거의 들리지 않는다 (2026-10-13 측정: 크기 0.5 → 최대 0.19, RMS 0.016).
 * 일곱 가지 모두 RMS 0.016~0.019 안에 들도록 맞췄다.
 */
const KEY_SOUNDS: readonly (readonly [number, number, number, number, number])[] = [
  [2600, 1500, 260, 0.016, 0.5],
  [2300, 1350, 235, 0.019, 0.52],
  [2850, 1650, 285, 0.014, 0.46],
  [2100, 1250, 215, 0.021, 0.55],
  [1750, 1000, 185, 0.022, 0.5],
  [1550, 900, 165, 0.025, 0.5],
  [1900, 1100, 200, 0.02, 0.54],
];
/** 이 시각 전에는 자판 소리를 내지 않는다 (너무 촘촘하게 나지 않게) */
let keyQuietUntil = 0;

export const sfx = {
  /** 연필로 밑줄 긋기: 근거 수집 */
  pencil() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    for (let i = 0; i < 3; i++) noise(a.ctx, a.dry, t + i * 0.055, { type: 'bandpass', freq: 3800 + i * 500, q: 2.5, peak: 0.42, attack: 0.008, dur: 0.05 });
    tone(a.ctx, a.dry, t + 0.17, 2200, 1800, 0.05, 0.03);
  },
  /** 지우개 문지르기: 근거 빼기, 지우개 도구 */
  eraser() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    for (let i = 0; i < 4; i++) noise(a.ctx, a.dry, t + i * 0.07, { type: 'bandpass', freq: 900 + (i % 2) * 300, q: 1.2, peak: 0.36, attack: 0.02, dur: 0.07 });
  },
  /** 종이 넘기기: 탭·자료 열기 */
  paper() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    noise(a.ctx, a.dry, t, { type: 'bandpass', freq: 2500, sweepTo: 5200, q: 0.7, peak: 0.2, attack: 0.03, dur: 0.22 });
    noise(a.ctx, a.dry, t + 0.12, { type: 'highpass', freq: 4000, peak: 0.08, attack: 0.01, dur: 0.1 });
  },
  /** 타자 치는 소리: 질문 보내기 */
  type() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.055 + Math.random() * 0.03);
      noise(a.ctx, a.dry, tt, { type: 'bandpass', freq: 2200 + Math.random() * 900, q: 3, peak: 0.3, attack: 0.002, dur: 0.035 });
      tone(a.ctx, a.dry, tt, 180, 120, 0.12, 0.04, 'triangle');
    }
    tone(a.ctx, a.wet, t + n * 0.07 + 0.05, 2600, 2600, 0.025, 0.25);
  },
  /**
   * 입력창 자판 한 번 누름: 기계식·무접점 자판의 "또각". 누르는 순간의 짧은 딱(또) + 바닥에 닿는 각(각).
   * 소리 일곱 가지(조금 높고 단단한 넷 + 낮고 묵직한 셋) 가운데 하나를 고르고, 음높이를 조금씩 흔든다.
   * 빠르게 칠 때 매번 나면 시끄럽고 기계적이라, 앞 소리에서 일정 간격(약 90~130ms)이 지나야 다음 소리를 낸다.
   */
  key(variant = Math.floor(Math.random() * KEY_SOUNDS.length)) {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    if (t < keyQuietUntil) return;
    keyQuietUntil = t + 0.09 + Math.random() * 0.04;
    const j = 0.95 + Math.random() * 0.1;
    const [click, bottom, body, gap, peak] = KEY_SOUNDS[variant % KEY_SOUNDS.length];
    // 또: 눌리는 순간의 짧은 딱
    noise(a.ctx, a.dry, t, { type: 'bandpass', freq: click * j, q: 3.5, peak, attack: 0.0008, dur: 0.016 });
    tone(a.ctx, a.dry, t, body * 2 * j, body * 1.4 * j, peak * 0.3, 0.016, 'triangle');
    // 각: 바닥에 닿는 소리 (울림을 짧게 끊는다)
    noise(a.ctx, a.dry, t + gap, { type: 'bandpass', freq: bottom * j, q: 2.5, peak: peak * 0.85, attack: 0.0008, dur: 0.026 });
    tone(a.ctx, a.dry, t + gap, body * j, body * 0.8 * j, peak * 0.4, 0.03, 'triangle');
  },
  /** 답변 도착: 펜 끝으로 종이 두드림 */
  reply() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    noise(a.ctx, a.dry, t, { type: 'bandpass', freq: 1600, q: 4, peak: 0.2, attack: 0.002, dur: 0.04 });
  },
  /** 정정 도장: 진술서 정정, 새 자료 */
  stamp() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    tone(a.ctx, a.dry, t, 160, 55, 0.26, 0.22);
    noise(a.ctx, a.dry, t, { type: 'lowpass', freq: 900, peak: 0.13, attack: 0.002, dur: 0.12 });
    noise(a.ctx, a.wet, t + 0.01, { type: 'bandpass', freq: 3000, peak: 0.05, attack: 0.002, dur: 0.08 });
  },
  /** 보고서 제출: 큰 도장 두 번 */
  submit() {
    const a = out(); if (!a) return;
    this.stamp();
    window.setTimeout(() => this.stamp(), 260);
  },
  /** 빨간 연필 채점 */
  grade(n: number) {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    for (let k = 0; k < Math.min(n, 9); k++) {
      for (let i = 0; i < 2; i++) noise(a.ctx, a.dry, t + k * 0.22 + i * 0.07, { type: 'bandpass', freq: 3200 + i * 600, q: 2, peak: 0.3, attack: 0.01, dur: 0.08 });
    }
  },
  /** 연결선 긋기 */
  line() {
    const a = out(); if (!a) return;
    noise(a.ctx, a.dry, a.ctx.currentTime, { type: 'bandpass', freq: 3000, sweepTo: 4500, q: 2.5, peak: 0.28, attack: 0.02, dur: 0.28 });
  },
  /** 수사팀이 요청을 받음: 무전기 송신 끝 소리 (짧은 잡음 + 삑) */
  dispatch() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    noise(a.ctx, a.dry, t, { type: 'bandpass', freq: 1800, q: 0.9, peak: 0.12, attack: 0.005, dur: 0.12 });
    tone(a.ctx, a.dry, t + 0.13, 1250, 1250, 0.09, 0.09, 'square');
    noise(a.ctx, a.dry, t + 0.22, { type: 'bandpass', freq: 2200, q: 0.9, peak: 0.08, attack: 0.004, dur: 0.08 });
  },
  /**
   * 조사 결과 도착: 서류가 미끄러져 들어오는 소리 뒤에 맑은 알림 종 세 번 (도·미·솔), 마지막에 도장.
   * 다른 효과음보다 크고 길게 해서 다른 화면을 보고 있어도 알아듣게 한다.
   */
  arrive() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    noise(a.ctx, a.dry, t, { type: 'bandpass', freq: 1800, sweepTo: 4200, q: 0.7, peak: 0.22, attack: 0.04, dur: 0.32 });
    [1046.5, 1318.5, 1568].forEach((f, i) => {
      const s = t + 0.3 + i * 0.16;
      tone(a.ctx, a.dry, s, f, f, 0.2, 0.9);
      tone(a.ctx, a.wet, s, f * 2, f * 2, 0.05, 0.6);
    });
    window.setTimeout(() => this.stamp(), 900);
  },
  /** 용의자 답변 도착 (다른 화면에 있을 때): 맑은 종 한 번, 띵~ */
  ding() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    tone(a.ctx, a.dry, t, 1318.5, 1318.5, 0.18, 1.1);
    tone(a.ctx, a.wet, t, 2637, 2637, 0.04, 0.7);
  },
  /** 메모지 붙이기 */
  note() {
    const a = out(); if (!a) return;
    const t = a.ctx.currentTime;
    noise(a.ctx, a.dry, t, { type: 'bandpass', freq: 1800, q: 1, peak: 0.22, attack: 0.01, dur: 0.1 });
    tone(a.ctx, a.dry, t + 0.05, 300, 200, 0.12, 0.06, 'triangle');
  },
};
