import { STATIONS } from './stations';
import { makeReverb, noiseBed } from './synth';

// 오디오 엔진: 배경음악(라디오)과 효과음이 같은 AudioContext를 쓰고 음량은 따로 조절한다.
// 브라우저 정책상 사용자가 처음 클릭하거나 키를 누른 뒤에야 소리를 낼 수 있다.

interface Settings { station: number; music: number; sfx: number; playing: boolean }
const KEY = 'hangyeol-audio';

function loadSettings(): Settings {
  const d: Settings = { station: Math.max(0, STATIONS.findIndex((s) => s.id === 'noir')), music: 0.45, sfx: 0.6, playing: true };
  try {
    const raw = localStorage.getItem(KEY);
    const s: Settings = raw ? { ...d, ...JSON.parse(raw) } : d;
    // 끄기 버튼이 없어졌다. 음악 음량이 0이 아니면 라디오는 켜져 있다
    return { ...s, playing: s.music > 0 };
  } catch {
    return d;
  }
}

type Listener = () => void;

class AudioEngine {
  settings = loadSettings();
  ctx: AudioContext | null = null;
  musicGain!: GainNode;
  sfxGain!: GainNode;
  sfxReverb!: GainNode;
  private stationMix: GainNode | null = null;
  private stopStation: (() => void) | null = null;
  private listeners = new Set<Listener>();
  tuning = false;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit() {
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* noop */ }
    this.listeners.forEach((fn) => fn());
  }

  /** 사용자 입력 이후에만 호출된다 */
  ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.curve(this.settings.music);
    this.musicGain.connect(comp);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.curve(this.settings.sfx);
    this.sfxGain.connect(comp);
    const rev = makeReverb(ctx, 1.6, 3);
    this.sfxReverb = ctx.createGain();
    this.sfxReverb.gain.value = 0.25;
    this.sfxReverb.connect(rev).connect(this.sfxGain);
    if (this.settings.playing) this.startStation();
    return ctx;
  }

  private curve(v: number) { return v * v * 0.9; }

  private startStation() {
    const ctx = this.ctx;
    if (!ctx) return;
    const st = STATIONS[this.settings.station];
    const mix = ctx.createGain();
    mix.gain.setValueAtTime(0.0001, ctx.currentTime);
    mix.gain.exponentialRampToValueAtTime(st.level, ctx.currentTime + 1.2);
    mix.connect(this.musicGain);
    const rev = makeReverb(ctx);
    const send = ctx.createGain();
    send.gain.value = st.reverb;
    mix.connect(send).connect(rev).connect(this.musicGain);
    this.stationMix = mix;
    this.stopStation = st.start(ctx, mix);
  }

  private endStation() {
    const ctx = this.ctx;
    if (!ctx || !this.stationMix) return;
    const mix = this.stationMix;
    const stop = this.stopStation;
    mix.gain.cancelScheduledValues(ctx.currentTime);
    mix.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12);
    stop?.();
    window.setTimeout(() => mix.disconnect(), 900);
    this.stationMix = null;
    this.stopStation = null;
  }

  /** 라디오 채널 돌리기. 사이에 잠깐 잡음이 낀다 */
  tune(delta: number) {
    this.settings.station = (this.settings.station + delta + STATIONS.length) % STATIONS.length;
    const ctx = this.ensure();
    if (ctx && this.settings.playing) {
      this.endStation();
      this.tuning = true;
      const st = noiseBed(ctx, this.musicGain, 'bandpass', 1400, 0.0001);
      const t = ctx.currentTime;
      st.gain.gain.setValueAtTime(0.0001, t);
      st.gain.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
      st.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      const whistle = ctx.createOscillator();
      const wg = ctx.createGain();
      whistle.frequency.setValueAtTime(2400, t);
      whistle.frequency.exponentialRampToValueAtTime(700, t + 0.45);
      wg.gain.setValueAtTime(0.012, t);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      whistle.connect(wg).connect(this.musicGain);
      whistle.start(t);
      whistle.stop(t + 0.5);
      window.setTimeout(() => { st.stop(); this.tuning = false; this.startStation(); this.emit(); }, 450);
    }
    this.emit();
  }

  /** 음악 음량. 0까지 내리면 라디오를 끄고, 다시 올리면 켠다 */
  setMusic(v: number) {
    this.settings.music = v;
    if (this.ctx) this.musicGain.gain.setTargetAtTime(this.curve(v), this.ctx.currentTime, 0.05);
    const on = v > 0;
    if (on !== this.settings.playing) {
      this.settings.playing = on;
      if (this.ensure()) {
        if (on) this.startStation();
        else this.endStation();
      }
    }
    this.emit();
  }

  setSfx(v: number) {
    this.settings.sfx = v;
    if (this.ctx) this.sfxGain.gain.setTargetAtTime(this.curve(v), this.ctx.currentTime, 0.05);
    this.emit();
  }
}

export const audio = new AudioEngine();

/** 첫 사용자 입력에서 오디오를 깨운다 */
export function installAudioUnlock() {
  const wake = () => {
    audio.ensure();
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
}
