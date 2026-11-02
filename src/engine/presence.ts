// 수사관이 지금 게임 앞에 있는가. "헤매는 중"과 "자리를 비움(중단)"을 가른다.
//   - 헤매는 중: 화면이 보이고 최근에 손을 움직였는데(누르기·자판·스크롤·마우스) 새 자료나 진술이 없다.
//     이 시간만 쌓아 수사팀이 먼저 나설지 정한다.
//   - 자리를 비움: 창이 가려졌거나 한동안 아무 입력이 없다. 이 동안에는 막힌 시간을 쌓지 않는다.
//     (2026-10-15 플레이 리뷰: 3시간 넘게 자리를 비운 사이 수사팀이 먼저 맡은 조사가 계속 이어져, 돌아오니 자료가 20건 쌓여 있었다)

/** 마지막 입력 뒤 이만큼은 읽거나 생각하는 중으로 본다 */
export const IDLE_GRACE = 90_000;
/** 입력이 이만큼 없거나 창이 가려진 채 이만큼 지나면 자리를 비운 것으로 본다 */
export const AWAY_AFTER = 3 * 60_000;
/** 이만큼 넘게 비웠다가 돌아오면 그사이 들어온 결과를 짧게 정리해 준다 */
export const BACK_SUMMARY_AFTER = 5 * 60_000;

let lastInput = Date.now();
let hiddenAt: number | null = null;

if (typeof window !== 'undefined') {
  const touch = () => { lastInput = Date.now(); };
  // 마우스 움직임은 자주 오므로 1초에 한 번만 센다
  let moveAt = 0;
  const move = () => { const n = Date.now(); if (n - moveAt > 1000) { moveAt = n; lastInput = n; } };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, touch, { passive: true, capture: true });
  window.addEventListener('scroll', touch, { passive: true, capture: true });
  window.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else { hiddenAt = null; touch(); }
  });
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
}

export type Presence = 'active' | 'idle' | 'away';

/**
 * active: 화면이 보이고 최근(IDLE_GRACE 안)에 입력이 있었다 — 막힌 시간을 센다.
 * idle:   화면은 보이지만 잠시 손을 놓았다 (읽는 중일 수 있다) — 세지 않지만 비운 것도 아니다.
 * away:   창이 가려진 채 오래 지났거나 AWAY_AFTER 넘게 입력이 없다.
 */
export function presence(now = Date.now()): Presence {
  if (hiddenAt !== null) return now - hiddenAt >= AWAY_AFTER ? 'away' : 'idle';
  const quiet = now - lastInput;
  if (quiet < IDLE_GRACE) return 'active';
  return quiet >= AWAY_AFTER ? 'away' : 'idle';
}

/** 마지막 입력 시각 (기록용) */
export const lastInputAt = () => lastInput;

/**
 * 막힌 시간 계산기. 시계가 돌 때마다 지난 시간을 받아, 수사관이 앞에 있을 때만 더한다.
 * 진전이 생기거나 수사팀이 먼저 나서면 0으로 되돌린다.
 */
export interface StuckClock { stuck: number; mark: number; awaySince: number | null }

export const newStuckClock = (now = Date.now()): StuckClock => ({ stuck: 0, mark: now, awaySince: null });

export interface StuckTick {
  /** 앞에 있으면서 진전 없이 보낸 시간 */
  stuck: number;
  /** 이번에 자리 비움에서 돌아왔다면 비운 시간 */
  backAfter?: number;
  /** 이번에 자리를 비우기 시작했다 */
  left?: boolean;
}

export function tickStuck(c: StuckClock, state: Presence, now = Date.now()): StuckTick {
  // 시계가 오래 멈췄다면(절전·탭 멈춤) 그 사이는 세지 않는다
  const dt = Math.min(Math.max(0, now - c.mark), 5_000);
  c.mark = now;
  const out: StuckTick = { stuck: c.stuck };
  if (state === 'away') {
    if (c.awaySince === null) { c.awaySince = now - AWAY_AFTER; out.left = true; }
    return out;
  }
  if (c.awaySince !== null) { out.backAfter = now - c.awaySince; c.awaySince = null; }
  if (state === 'active') c.stuck += dt;
  out.stuck = c.stuck;
  return out;
}
