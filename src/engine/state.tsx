import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import { sfx } from '../audio/sfx';
import { CASE_ID, EPI_START, EVIDENCE_TREE, INITIAL_OWNED, PERSONS, type NoCulprit } from '../data/case';
import { TEAM_GREET } from '../data/investigations';
import type { PersonId } from '../data/types';
import { emptyMemo, type Memo } from './memo';
import { PROACTIVE_AFTER, proactiveJob, proactivePick, tickJobs, type TeamJob } from './investigation';
import { observe, track } from './telemetry';
import { BACK_SUMMARY_AFTER, newStuckClock, presence, tickStuck } from './presence';
import { docTitle } from './lookup';
import { ACTIVE_SAVE_KEY } from '../data/active';
import { josa } from './josa';

/** 용의자 탭은 하나를 공유하고 ref만 바뀐다. 자료 탭은 왼쪽 폴더마다 하나를 공유한다. 수사팀 탭은 하나다 */
export type TabType = 'person' | 'doc' | 'report' | 'team' | 'notepad';
export interface Tab { key: string; type: TabType; ref?: string }

export interface ChatMsg {
  id: string;
  role: 'me' | 'them' | 'note';
  text: string;
  record?: string;
  /** 여러 주제에 답한 경우 주제별 문단 */
  parts?: { text: string; source?: string }[];
  /** 응답 종류 (막힘 횟수를 세는 데 쓴다) */
  kind?: string;
  /** 수사 수첩 힌트 */
  hint?: boolean;
  /** 기록 줄의 보조 설명 (새 자료의 확보 경위 등) */
  sub?: string;
  /** 이 답에서 답한 주제 */
  facts?: string[];
  /** 형사의 말: 응답을 기다리는 중(pending)이거나 응답을 받지 못했다(failed). 성공하면 지운다 */
  status?: 'pending' | 'failed';
  /** 응답을 받지 못한 이유 (화면에 짧게 보여 준다) */
  error?: string;
  /** 인물의 답: 거짓말 없이 근거를 보고 바로 털어놓은 진술 (정정이 아니다) */
  volunteer?: boolean;
  /** 형사의 말: 맞댄 상대의 말(문장 ID)과 함께 첨부한 근거 */
  pin?: string;
  attached?: string[];
  /** 수사팀의 말: 함께 보여 줄 자료 (눌러서 연다) */
  docs?: string[];
  /** 수사팀의 말: 이 말로 시작한 조사 */
  job?: string;
}

/** 수사팀 대화와 진행 중인 조사 (한 번에 하나) */
export interface TeamState {
  chat: ChatMsg[];
  /** 진행 중인 조사 (여러 건) */
  jobs: TeamJob[];
  /** 끝난 조사 ID */
  done: string[];
  /** 아직 읽지 않은 결과가 있다 (수사팀 탭을 열면 지운다) */
  unread?: boolean;
}

/** 조사 결과 도착 알림 (바로 읽기 / 나중에 읽기) */
export interface Notice { id: number; title: string; docs: string[] }

/** 용의자 답변 도착 알림: 답을 기다리는 동안 다른 화면으로 옮겼을 때 */
export interface ReplyNotice { id: number; person: PersonId; text: string }

/** 지도 위 말: 사람별로 (시각, 위치) 기록. 시각은 하루 기준 분, 위치는 평면도 좌표 */
export type PawnId = 'V' | PersonId;
export interface PawnKey { t: number; x: number; y: number }
export interface MapPawns { time: number; keys: Partial<Record<PawnId, PawnKey[]>> }

/** t 시각의 말 위치: t 이전의 가장 최근 기록, 없으면 가장 이른 기록 */
export function pawnAt(keys: PawnKey[] | undefined, t: number): PawnKey | null {
  if (!keys?.length) return null;
  let best: PawnKey | null = null;
  for (const k of keys) if (k.t <= t) best = k;
  return best ?? keys[0];
}

/** 1번 문항의 답: 용의자 한 명, 또는 범인이 없다는 결론 */
export type CulpritChoice = PersonId | NoCulprit;

export interface ReportDraft {
  culprit?: CulpritChoice;
  answers: Record<string, string>;
  /** (예전 방식) 확정한 문항 수. 지금은 쓰지 않는다 */
  locked?: number;
}

export interface ReportResult {
  grade: 'perfect' | 'solved' | 'insufficient' | 'wrong';
  culpritOk: boolean;
  correct: Record<string, boolean>;
  /** 서술형 문항별 판정 (정답·부분 정답·오답) */
  verdicts?: Record<string, 'correct' | 'partial' | 'wrong'>;
  /** 서술형 문항별 채점관의 한 줄 */
  comments?: Record<string, string>;
  /** AI에 닿지 못해 낱말로 채점했다 */
  local?: boolean;
  /** (예전 방식) 확정까지 간 문항 수 */
  reached?: number;
}

export interface GameState {
  version: 4;
  caseId: string;
  screen: 'title' | 'episodes' | 'briefing' | 'hub' | 'result' | 'epilogue' | 'afterword';
  owned: string[];
  unseen: string[];
  done: string[];
  chats: Record<PersonId, ChatMsg[]>;
  /** 난이도: 근거가 되는 문장에 밑줄을 긋는다 (켜면 쉬움) */
  underline?: boolean;
  /** 힌트: 단계별로 몇 단계까지 펼쳤는지, 모두 몇 번 펼쳤는지 */
  hints?: { seen: Record<string, number>; uses: number };
  pawns: MapPawns;
  tabs: Tab[];
  active: string;
  /** 오른쪽 창에 띄운 탭 (좌우 분할) */
  split: string | null;
  report: ReportDraft;
  result?: ReportResult;
  toast?: { id: number; text: string };
  /** 논점(지적 ID)별로 앞서 제시해 둔 근거. 다음 말의 근거와 합쳐 판정한다 */
  pressed?: Record<string, string[]>;
  /** 용의자별 상황 메모의 저장 부분 (AI가 직접 쓴 답, 보여 준 근거) */
  memos?: Partial<Record<PersonId, Memo>>;
  /** 정정 진술마다 그때 받아들여진 근거 (진술 이력에 보여 준다) */
  basis?: Record<string, string[]>;
  /** 거짓말을 하기 전에 근거를 보고 바로 털어놓은 진술 (진술서에서 정정이 아니라 진술로 보인다) */
  volunteered?: string[];
  /** 근거 트레이: 자료를 읽다 모아 둔 근거 (자료·근거 문장·진술). 대화창으로 끌어 첨부한다 */
  tray?: string[];
  /** 용의자별로 다음 말에 첨부한 근거와, 그 근거를 맞댈 상대의 말 하나 (보내면 비운다) */
  drafts?: Partial<Record<PersonId, Draft>>;
  team: TeamState;
  notice?: Notice | null;
  /** 다른 화면에 있는 동안 도착한 용의자 답변 알림 */
  replyNotice?: ReplyNotice | null;
  /** 아직 보지 않은 답변이 있는 용의자 (그 사람 대화창을 열면 지운다) */
  replyUnread?: PersonId[];
  /** 마지막으로 새 자료·진술을 얻은 때 (수사팀이 먼저 나설지 정한다) */
  progressAt?: number;
  /** 수사팀이 마지막으로 먼저 나선 때 */
  proactiveAt?: number;
  /** AI가 면담 대화를 읽고 정리한 진술서 (사람별). 없으면 정해 둔 문장으로 만든 진술서를 보여 준다 */
  statements?: Partial<Record<PersonId, AiStatement>>;
  /** AI 힌트 기록 (같은 말을 되풀이하지 않게 다음 힌트에 넘긴다) */
  hintLog?: HintNote[];
  /** 지금 보여 주는 힌트. 새로고침을 누르기 전까지 그대로 남는다 */
  hintCurrent?: CurrentHint;
  /** 왼쪽 메뉴 메모장에 플레이어가 적은 글 */
  notepad?: string;
}


/** AI가 정리한 진술서 한 줄 */
export interface StatementLine {
  text: string;
  /** claim 주장 · fact 인정한 사실 · revised 앞선 말을 바꿈 · added 근거를 보고 처음 털어놓음 */
  kind: 'claim' | 'fact' | 'revised' | 'added';
  /** revised일 때 앞서 한 말 */
  was?: string;
  /** 같은 내용의 근거 문장 ID (눌러서 근거 트레이에 담는다) */
  cite?: string[];
}
export interface AiStatement {
  sections: { title: string; lines: StatementLine[] }[];
  /** 이 진술서를 만들 때 읽은 대화 수 (이보다 대화가 늘면 다시 정리한다) */
  upto: number;
  at: number;
  /** 만들 때의 인정·철회 상태 (statementBasis). 이것이 바뀌면 진술서 전체를 다시 쓴다 */
  basis?: string;
}
export interface HintNote { at: number; title: string; hint: string; detail: string; key: string }
/** 힌트 창에 남아 있는 힌트 (더 자세히를 펼쳤는지까지) */
export interface CurrentHint { title: string; hint: string; detail: string; key: string; local?: boolean; detailShown?: boolean }

export interface Draft { evidence: string[]; pin?: string }

/** 한 번에 첨부할 수 있는 근거 수 (맞댈 상대의 말은 따로 하나) */
export const MAX_ATTACH = 4;

// 사건마다 저장 키를 따로 둔다. 이전 사건(bellua-text-save-v1)의 저장은 지우지 않고 그대로 둔다.
const SAVE_KEY = ACTIVE_SAVE_KEY;
export const PERSON_TAB = 'person';

/** 지금 이 용의자의 대화창을 보고 있는가 (왼쪽이든 오른쪽 창이든) */
export function viewingPerson(s: Pick<GameState, 'screen' | 'active' | 'split' | 'tabs'>, person: PersonId): boolean {
  return s.screen === 'hub' && (s.active === PERSON_TAB || s.split === PERSON_TAB) && s.tabs.find((t) => t.key === PERSON_TAB)?.ref === person;
}

function freshChats(): Record<PersonId, ChatMsg[]> {
  const out = {} as Record<PersonId, ChatMsg[]>;
  (Object.keys(PERSONS) as PersonId[]).forEach((p) => {
    out[p] = [{ id: `${p}-greet`, role: 'them', text: PERSONS[p].lines.greet }];
  });
  return out;
}

export function freshTeam(): TeamState {
  return { chat: [{ id: 'team-greet', role: 'them', text: TEAM_GREET }], jobs: [], done: [] };
}

export function newGame(): GameState {
  return {
    version: 4,
    caseId: CASE_ID,
    screen: 'hub',
    owned: [...INITIAL_OWNED],
    unseen: [],
    done: [],
    chats: freshChats(),
    underline: true,
    pawns: { time: EPI_START, keys: {} },
    tabs: [{ key: folderKey('BRIEF'), type: 'doc', ref: 'BRIEF' }],
    active: folderKey('BRIEF'),
    split: null,
    report: { answers: {} },
    team: freshTeam(),
    notice: null,
    progressAt: Date.now(),
  };
}

export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (s.version !== 4 || s.caseId !== CASE_ID) return null;
    const keep = (k: string | null) => (k && s.tabs.some((t) => t.key === k) ? k : null);
    const owned = [...s.owned, ...INITIAL_OWNED.filter((id) => !s.owned.includes(id))];
    // 저장할 때 응답을 기다리던 말은 그 요청이 끊겼으므로 "응답을 받지 못함"으로 남긴다 (다시 보낼 수 있다)
    const cut = (m: ChatMsg): ChatMsg => (m.status === 'pending' ? { ...m, status: 'failed', error: '새로고침으로 요청이 끊겼다' } : m);
    const chats = Object.fromEntries(Object.entries(s.chats).map(([p, msgs]) => [p, msgs.map(cut)])) as GameState['chats'];
    const team = { ...freshTeam(), ...(s.team ?? {}) };
    if (!Array.isArray(team.jobs)) team.jobs = [];
    // 진행 중인 조사는 그대로 둔다. 시간이 지났으면 수사를 다시 열자마자 결과가 들어온다
    return { ...s, owned, chats, team: { ...team, chat: team.chat.map(cut) }, active: keep(s.active) ?? s.tabs[0]?.key ?? '', split: keep(s.split), underline: true, notice: null, replyNotice: null, progressAt: Date.now() };
  } catch {
    return null;
  }
}

/** 지금 상태를 바로 저장한다 (홈으로 나갈 때 마지막 변경을 잃지 않게) */
export function persist(s: GameState) {
  try {
    const { toast: _t, ...rest } = s;
    localStorage.setItem(SAVE_KEY, JSON.stringify(rest));
  } catch {
    /* 저장 실패는 무시 */
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* noop */ }
}

export type Action =
  | { type: 'load'; state: GameState }
  | { type: 'screen'; screen: GameState['screen'] }
  | { type: 'openTab'; tab: Omit<Tab, 'key'> }
  | { type: 'closeTab'; key: string }
  | { type: 'activate'; key: string }
  | { type: 'moveTab'; key: string; index: number }
  | { type: 'split'; key: string | null }
  | { type: 'place'; key: string; side: 'left' | 'right' | 'full' }
  | { type: 'chat'; person: PersonId; msg: ChatMsg }
  | { type: 'chatPatch'; person: PersonId; id: string; patch: Partial<ChatMsg> }
  | { type: 'basis'; id: string; ids: string[] }
  | { type: 'reveal'; ids: string[]; toast?: string }
  | { type: 'seen'; id: string }
  | { type: 'done'; id: string }
  | { type: 'pawnTime'; t: number }
  | { type: 'pawnPlace'; who: PawnId; t: number; x: number; y: number }
  | { type: 'pawnClear'; who: PawnId; t?: number }
  | { type: 'report'; patch: Partial<ReportDraft> }
  | { type: 'result'; result: ReportResult }
  | { type: 'toast'; text: string }
  | { type: 'underline'; on: boolean }
  | { type: 'hint'; key: string }
  | { type: 'press'; add: Record<string, string[]> }
  | { type: 'unpress'; cid: string; id: string }
  | { type: 'volunteer'; id: string }
  | { type: 'trayAdd'; id: string }
  | { type: 'trayRemove'; id: string }
  | { type: 'attach'; person: PersonId; id: string }
  | { type: 'pin'; person: PersonId; id?: string }
  | { type: 'detach'; person: PersonId; id?: string }
  | { type: 'memo'; person: PersonId; written?: { q: string; a: string; casual?: boolean }; shown?: string[] }
  | { type: 'teamChat'; msg: ChatMsg }
  | { type: 'teamPatch'; id: string; patch: Partial<ChatMsg> }
  | { type: 'teamStart'; jobs: TeamJob[] }
  | { type: 'teamDeliver'; jobId: string }
  | { type: 'teamRead' }
  | { type: 'notice'; notice: Notice | null }
  | { type: 'replyArrived'; person: PersonId; text: string }
  | { type: 'replyNotice'; notice: ReplyNotice | null }
  | { type: 'proactive'; job: TeamJob }
  | { type: 'welcomeBack'; docs: string[] }
  | { type: 'statement'; person: PersonId; statement: AiStatement }
  | { type: 'hintNote'; note: HintNote }
  | { type: 'hintSet'; hint: CurrentHint | null }
  | { type: 'notepad'; text: string };

/** 자료가 들어 있는 왼쪽 폴더 이름 */
export const folderOf = (id: string) => EVIDENCE_TREE.find((g) => g.items.includes(id))?.folder ?? '자료';
export const folderKey = (id: string) => `folder:${folderOf(id)}`;

/** 용의자 탭은 PERSON_TAB 하나, 자료 탭은 폴더마다 하나, 나머지는 종류 */
export const tabKey = (t: Omit<Tab, 'key'>) => (t.type === 'person' ? PERSON_TAB : t.type === 'doc' && t.ref ? folderKey(t.ref) : t.ref ? `${t.type}:${t.ref}` : t.type);
let uid = 0;
export const newKey = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'load': return a.state;
    case 'screen': return { ...s, screen: a.screen };
    case 'openTab': {
      const key = tabKey(a.tab);
      const exists = s.tabs.some((t) => t.key === key);
      const tabs = exists ? s.tabs.map((t) => (t.key === key ? { ...t, ref: a.tab.ref } : t)) : [...s.tabs, { ...a.tab, key }];
      // 이미 오른쪽 창에 떠 있으면 그대로 두고, 아니면 왼쪽(주) 창에 연다
      const team = a.tab.type === 'team' ? { ...s.team, unread: false } : s.team;
      // 그 사람 대화창을 열면 답변 도착 표시와 알림을 지운다
      const seen = a.tab.type === 'person' && a.tab.ref ? { replyUnread: (s.replyUnread ?? []).filter((p) => p !== a.tab.ref), replyNotice: s.replyNotice?.person === a.tab.ref ? null : s.replyNotice } : {};
      if (s.split === key) return { ...s, tabs, team, ...seen };
      return { ...s, tabs, active: key, team, ...seen };
    }
    case 'closeTab': {
      const i = s.tabs.findIndex((t) => t.key === a.key);
      const tabs = s.tabs.filter((t) => t.key !== a.key);
      let active = s.active, split = s.split;
      if (split === a.key) split = null;
      if (active === a.key) { active = split ?? tabs[Math.max(0, i - 1)]?.key ?? ''; if (split === active) split = null; }
      return { ...s, tabs, active, split };
    }
    case 'activate': return s.split === a.key ? s : { ...s, active: a.key };
    case 'split': return { ...s, split: a.key === s.active ? null : a.key };
    case 'place': {
      // 윈도우 창 분할처럼 탭을 왼쪽/오른쪽 절반 또는 전체에 놓는다
      if (a.side === 'full') return { ...s, active: a.key, split: null };
      const other = s.tabs.filter((t) => t.key !== a.key).slice(-1)[0]?.key ?? null;
      let L: string | null = s.active, R: string | null = s.split;
      if (a.side === 'left') {
        if (R === a.key) R = L === a.key ? null : L;
        else if (!R) R = L !== a.key ? L : null;
        L = a.key;
      } else {
        if (L === a.key) L = R ?? other;
        R = a.key;
      }
      if (!L) return s;
      return { ...s, active: L, split: R === L ? null : R };
    }
    case 'moveTab': {
      const from = s.tabs.findIndex((t) => t.key === a.key);
      if (from < 0) return s;
      const tabs = [...s.tabs];
      const [t] = tabs.splice(from, 1);
      tabs.splice(a.index > from ? a.index - 1 : a.index, 0, t);
      return { ...s, tabs };
    }
    case 'chat': return { ...s, chats: { ...s.chats, [a.person]: [...s.chats[a.person], a.msg] } };
    case 'chatPatch': {
      const msgs = s.chats[a.person].map((m) => {
        if (m.id !== a.id) return m;
        const next = { ...m, ...a.patch };
        // undefined로 넘긴 칸은 지운다 (상태 표시를 없앨 때)
        for (const k of Object.keys(a.patch) as (keyof ChatMsg)[]) if (a.patch[k] === undefined) delete next[k];
        return next;
      });
      return { ...s, chats: { ...s.chats, [a.person]: msgs } };
    }
    case 'basis': return s.basis?.[a.id] ? s : { ...s, basis: { ...(s.basis ?? {}), [a.id]: a.ids } };
    case 'reveal': {
      const ids = a.ids.filter((id) => !s.owned.includes(id));
      if (!ids.length) return s;
      return {
        ...s,
        owned: [...s.owned, ...ids],
        unseen: [...s.unseen, ...ids],
        progressAt: Date.now(),
        toast: a.toast ? { id: Date.now(), text: a.toast } : s.toast,
      };
    }
    case 'seen': return s.unseen.includes(a.id) ? { ...s, unseen: s.unseen.filter((x) => x !== a.id) } : s;
    case 'done': return s.done.includes(a.id) ? s : { ...s, done: [...s.done, a.id] };
    case 'pawnTime': return { ...s, pawns: { ...s.pawns, time: a.t } };
    case 'pawnPlace': {
      const keys = (s.pawns.keys[a.who] ?? []).filter((k) => k.t !== a.t);
      keys.push({ t: a.t, x: a.x, y: a.y });
      keys.sort((p, q) => p.t - q.t);
      return { ...s, pawns: { ...s.pawns, keys: { ...s.pawns.keys, [a.who]: keys } } };
    }
    case 'pawnClear': {
      const keys = a.t === undefined ? [] : (s.pawns.keys[a.who] ?? []).filter((k) => k.t !== a.t);
      return { ...s, pawns: { ...s.pawns, keys: { ...s.pawns.keys, [a.who]: keys } } };
    }
    case 'report': return { ...s, report: { ...s.report, ...a.patch, answers: { ...s.report.answers, ...(a.patch.answers ?? {}) } } };
    case 'result': return { ...s, result: a.result, screen: 'result' };
    case 'toast': return { ...s, toast: { id: Date.now(), text: a.text } };
    case 'underline': return { ...s, underline: a.on };
    case 'press': {
      const pressed = { ...(s.pressed ?? {}) };
      for (const [cid, ids] of Object.entries(a.add)) pressed[cid] = [...new Set([...(pressed[cid] ?? []), ...ids])];
      return { ...s, pressed };
    }
    case 'memo': {
      const cur = s.memos?.[a.person] ?? emptyMemo();
      const next: Memo = {
        written: a.written ? [...cur.written, a.written].slice(-30) : cur.written,
        shown: a.shown ? [...new Set([...cur.shown, ...a.shown])] : cur.shown,
      };
      return { ...s, memos: { ...(s.memos ?? {}), [a.person]: next } };
    }
    case 'volunteer': return (s.volunteered ?? []).includes(a.id) ? s : { ...s, volunteered: [...(s.volunteered ?? []), a.id] };
    case 'trayAdd': return (s.tray ?? []).includes(a.id) ? s : { ...s, tray: [...(s.tray ?? []), a.id] };
    case 'trayRemove': return { ...s, tray: (s.tray ?? []).filter((x) => x !== a.id) };
    case 'attach': {
      const d = s.drafts?.[a.person] ?? { evidence: [] };
      if (d.evidence.includes(a.id) || d.evidence.length >= MAX_ATTACH) return s;
      // 대화창에 첨부한 근거는 트레이에서 뺀다 (첨부를 빼면 트레이로 돌아온다)
      return { ...s, tray: (s.tray ?? []).filter((x) => x !== a.id), drafts: { ...(s.drafts ?? {}), [a.person]: { ...d, evidence: [...d.evidence, a.id] } } };
    }
    case 'pin': {
      const d = s.drafts?.[a.person] ?? { evidence: [] };
      return { ...s, drafts: { ...(s.drafts ?? {}), [a.person]: { evidence: d.evidence, ...(a.id ? { pin: a.id } : {}) } } };
    }
    case 'detach': {
      const d = s.drafts?.[a.person] ?? { evidence: [] };
      const next: Draft = a.id ? { ...d, evidence: d.evidence.filter((x) => x !== a.id) } : { evidence: [] };
      const back = a.id && d.evidence.includes(a.id) && !(s.tray ?? []).includes(a.id) ? { tray: [...(s.tray ?? []), a.id] } : {};
      return { ...s, ...back, drafts: { ...(s.drafts ?? {}), [a.person]: next } };
    }
    case 'unpress': return { ...s, pressed: { ...(s.pressed ?? {}), [a.cid]: (s.pressed?.[a.cid] ?? []).filter((x) => x !== a.id) } };
    case 'hint': {
      const h = s.hints ?? { seen: {}, uses: 0 };
      return { ...s, hints: { seen: { ...h.seen, [a.key]: (h.seen[a.key] ?? 0) + 1 }, uses: h.uses + 1 } };
    }
    case 'teamChat': return { ...s, team: { ...s.team, chat: [...s.team.chat, a.msg] } };
    case 'teamPatch': {
      const chat = s.team.chat.map((m) => {
        if (m.id !== a.id) return m;
        const next = { ...m, ...a.patch };
        for (const k of Object.keys(a.patch) as (keyof ChatMsg)[]) if (a.patch[k] === undefined) delete next[k];
        return next;
      });
      return { ...s, team: { ...s.team, chat } };
    }
    case 'teamStart': {
      // 같은 조사를 두 번 시작하지 않는다
      const jobs = a.jobs.filter((j) => !s.team.jobs.some((x) => x.inv === j.inv));
      return jobs.length ? { ...s, team: { ...s.team, jobs: [...s.team.jobs, ...jobs] } } : s;
    }
    case 'teamDeliver': {
      // 같은 조사는 한 번만 반영한다 (다시 불려도 자료·기록이 두 번 생기지 않는다)
      const job = s.team.jobs.find((j) => j.id === a.jobId);
      if (!job) return s;
      // 조사하다 함께 나온 자료도 같이 넘긴다 (이미 다른 길로 받은 것은 빼고)
      const extra = (job.bonus ?? []).filter((id) => !s.owned.includes(id) && !job.outputs.includes(id));
      const docs = [...job.outputs, ...extra];
      const fresh = docs.filter((id) => !s.owned.includes(id));
      const typeOf = (k: string | null) => s.tabs.find((t) => t.key === k)?.type;
      const onTeam = typeOf(s.active) === 'team' || typeOf(s.split) === 'team';
      const found = extra.length ? `\n조사하면서 ${extra.map(docTitle).join(', ')}도 함께 확인돼 같이 넣었습니다.` : '';
      const lead = job.proactive ? `수사관님, 혹시 도움이 될까 해서 ${josa(job.label, '을/를')} 먼저 확인해 뒀습니다.` : `${job.label} 결과가 들어왔습니다.`;
      const msg: ChatMsg = {
        id: `r-${job.id}`, role: 'them', job: job.id, docs, kind: 'result',
        text: `${lead}\n자료함에 ${fresh.length || docs.length}건을 넣었습니다.${found}`,
      };
      // 아직 닫지 않은 알림이 있으면 함께 보여 준다
      const prev = s.notice;
      // 제목의 건수는 아래 목록에 보이는 자료 수와 같게 센다
      const merged = prev ? [...new Set([...prev.docs, ...docs])] : docs;
      const notice: Notice = prev ? { id: Date.now(), title: `수사 결과 ${merged.length}건`, docs: merged } : { id: Date.now(), title: job.label, docs };
      return {
        ...s,
        owned: [...s.owned, ...fresh],
        unseen: [...s.unseen, ...fresh],
        progressAt: fresh.length ? Date.now() : s.progressAt,
        team: { chat: [...s.team.chat, msg], jobs: s.team.jobs.filter((j) => j.id !== job.id), done: [...new Set([...s.team.done, job.inv])], unread: !onTeam },
        notice,
      };
    }
    case 'teamRead': return s.team.unread ? { ...s, team: { ...s.team, unread: false } } : s;
    case 'notice': return { ...s, notice: a.notice };
    case 'replyArrived': return { ...s, replyNotice: { id: Date.now(), person: a.person, text: a.text }, replyUnread: [...new Set([...(s.replyUnread ?? []), a.person])] };
    case 'replyNotice': return { ...s, replyNotice: a.notice };
    case 'proactive': return s.team.jobs.length ? s : { ...s, proactiveAt: Date.now(), team: { ...s.team, jobs: [a.job] } };
    case 'statement': {
      // 더 오래된 대화로 만든 진술서가 늦게 도착하면 버린다
      const cur = s.statements?.[a.person];
      if (cur && cur.upto > a.statement.upto) return s;
      return { ...s, statements: { ...(s.statements ?? {}), [a.person]: a.statement } };
    }
    case 'hintNote': return { ...s, hintLog: [...(s.hintLog ?? []), a.note].slice(-8) };
    case 'hintSet': return { ...s, hintCurrent: a.hint ?? undefined };
    case 'notepad': return { ...s, notepad: a.text };
    case 'welcomeBack': {
      // 자리를 비운 사이 들어온 결과를 한 번에 정리한다. 무엇부터 볼지는 먼저 들어온 것 하나만 권한다
      const docs = a.docs.filter((id) => s.unseen.includes(id));
      if (!docs.length) return s;
      const typeOf = (k: string | null) => s.tabs.find((t) => t.key === k)?.type;
      const onTeam = typeOf(s.active) === 'team' || typeOf(s.split) === 'team';
      const msg: ChatMsg = {
        id: newKey('back'), role: 'them', docs, kind: 'result',
        text: `돌아오셨군요.\n자리를 비우신 사이 자료 ${docs.length}건이 들어왔습니다.\n먼저 ${docTitle(docs[0])}부터 보시면 됩니다.`,
      };
      return { ...s, team: { ...s.team, chat: [...s.team.chat, msg], unread: !onTeam } };
    }
  }
}

/** getState: 비동기 작업(AI 응답 대기)이 끝났을 때 그 순간의 최신 상태를 읽는다. 화면을 옮겨도 작업은 이어진다 */
export type GameCtx = { state: GameState; dispatch: Dispatch<Action>; getState: () => GameState };
type CtxValue = GameCtx | null;
// 개발 중 자료 파일을 고치면 이 모듈이 다시 실행된다. 컨텍스트를 새로 만들면 화면과 Provider가 서로 다른 컨텍스트를 보게 되므로 하나를 계속 쓴다.
const holder = globalThis as unknown as { __gameCtx?: ReturnType<typeof createContext<CtxValue>> };
const Ctx = (holder.__gameCtx ??= createContext<CtxValue>(null));

/** 동작마다 어울리는 효과음 */
function soundFor(a: Action) {
  switch (a.type) {
    case 'openTab': case 'activate': return sfx.paper();
    case 'screen': return a.screen === 'hub' || a.screen === 'briefing' || a.screen === 'epilogue' || a.screen === 'episodes' || a.screen === 'afterword' ? sfx.paper() : undefined;
    case 'underline': case 'attach': case 'pin': case 'trayAdd': return sfx.pencil();
    case 'detach': case 'trayRemove': return sfx.eraser();
    case 'hint': return sfx.paper();
    case 'chat': case 'teamChat': return a.msg.role === 'me' ? sfx.type() : a.msg.role === 'them' ? sfx.reply() : undefined;
    case 'teamStart': return sfx.dispatch();
    case 'teamDeliver': return sfx.arrive();
    case 'replyArrived': return sfx.ding();
    case 'reveal': return a.toast ? sfx.stamp() : undefined;
    case 'pawnPlace': return sfx.note();
    case 'pawnClear': return sfx.eraser();
    case 'result': {
      sfx.submit();
      const marks = 1 + Object.keys(a.result.correct).length;
      window.setTimeout(() => sfx.grade(marks), 900);
      return;
    }
  }
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, () => ({ ...newGame(), screen: 'title' as const }));
  const latest = useRef(state);
  // 디스패치 직후에도 최신 상태를 읽을 수 있게 리듀서를 바로 적용해 둔다 (React는 다음 렌더에서 같은 결과를 낸다)
  const dispatch = useCallback<Dispatch<Action>>((a) => {
    soundFor(a);
    const before = latest.current;
    latest.current = reducer(before, a);
    try { observe(a, before, latest.current); } catch { /* 기록 실패는 게임을 막지 않는다 */ }
    rawDispatch(a);
  }, []);
  const getState = useCallback(() => latest.current, []);
  useEffect(() => {
    if (state.screen === 'title' || state.screen === 'episodes') return;
    const t = setTimeout(() => persist(state), 300);
    return () => clearTimeout(t);
  }, [state]);
  // 수사팀 조사: 정한 시간이 지나면 결과가 들어온다 (다른 화면을 보고 있어도. 표지에 있으면 수사를 다시 열 때 들어온다)
  useEffect(() => {
    const clock = newStuckClock();
    let seen = { progress: latest.current.progressAt, proactive: latest.current.proactiveAt };
    // 자리를 비우기 시작할 때 아직 읽지 않았던 자료 (돌아왔을 때 그사이 들어온 것만 알려 준다)
    let unseenAtLeave: string[] = [];
    const id = window.setInterval(() => {
      const s = latest.current;
      const now = Date.now();
      // 새 자료·진술이 생겼거나 수사팀이 먼저 나섰으면 막힌 시간을 처음부터 다시 센다
      if (s.progressAt !== seen.progress || s.proactiveAt !== seen.proactive) {
        clock.stuck = 0;
        seen = { progress: s.progressAt, proactive: s.proactiveAt };
      }
      if (s.screen === 'hub' && !s.result) {
        const t = tickStuck(clock, presence(now), now);
        if (t.left) { unseenAtLeave = [...s.unseen]; track('away', { stuck: Math.round(t.stuck / 1000), unseen: s.unseen.length }); }
        if (t.backAfter !== undefined) {
          const arrived = s.unseen.filter((x) => !unseenAtLeave.includes(x));
          track('back', { awayMs: t.backAfter, arrived: arrived.length });
          if (t.backAfter >= BACK_SUMMARY_AFTER && arrived.length) dispatch({ type: 'welcomeBack', docs: arrived });
        }
        // 헤매는 중(앞에 있으면서 진전이 없음)일 때만 수사팀이 먼저 나선다. 자리를 비운 동안은 나서지 않는다
        if (!s.team?.jobs?.length && t.stuck >= PROACTIVE_AFTER) {
          const owned = new Set(s.owned);
          const pick = proactivePick(owned, s.team.jobs);
          if (pick) {
            track('proactive', { inv: pick, stuck: Math.round(t.stuck / 1000) });
            dispatch({ type: 'proactive', job: proactiveJob(pick, owned, now) });
          }
        }
      } else clock.mark = now;
      if (!s.team?.jobs?.length || s.screen === 'title' || s.screen === 'episodes') return;
      for (const id of tickJobs(s.team.jobs)) dispatch({ type: 'teamDeliver', jobId: id });
    }, 500);
    return () => window.clearInterval(id);
  }, [dispatch]);
  const value = useMemo(() => ({ state, dispatch, getState }), [state, dispatch, getState]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGame() {
  const v = useContext(Ctx);
  if (!v) throw new Error('GameProvider missing');
  return v;
}

/** 진상 해설의 시작 시각(19:40)부터 센 분을 시각으로 */
export function hhmm(min: number): string {
  const t = (EPI_START + min) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
