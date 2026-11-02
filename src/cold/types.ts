// 미제 사건 수사 게임(cold-case 브랜치)의 공통 형식. 사건 하나가 이 형식의 자료 묶음 하나다.
// 기준 문서: design/twice-dead-case.md, design/twice-dead-flow.md

/** 조건. all은 모두, any는 [n, 목록]에서 n개 이상, none은 하나도 없어야 한다. 항목은 자료 ID나 상태 표시(대문자 낱말). */
export interface Cond {
  all?: string[];
  any?: [number, string[]];
  none?: string[];
}

export type Folder = '첫 회의' | '현장' | '감정' | '기록' | '진술';

export interface EvidenceDoc {
  id: string;
  title: string;
  folder: Folder;
  /** 문장마다 줄을 바꾼다. 빈 줄은 문단 구분 */
  body: string;
}

export type ActionCat = '현장' | '감정' | '기록' | '탐문' | '영장';

export interface Action {
  id: string;
  cat: ActionCat;
  label: string;
  /** 게임 속 근무 시간 */
  hours: number;
  /** 결과가 오기까지 달력 시간. 없으면 바로 나온다 */
  wait?: number;
  /** 메뉴에 보이는 조건 (선행 자료) */
  show?: Cond;
  /** 실행할 수 있는 조건. 안 되면 reason을 반장이 말한다 */
  need?: Cond;
  reason?: string;
  gives: string[];
  /** 비가 오기 전(12-13 14:00)에 했을 때만 주는 것 */
  beforeRain?: string[];
  /** 요청했을 때 반장의 말 */
  say: string;
}

/** 대사 한 줄. cond가 맞는 첫 줄을 쓴다 */
export interface Line {
  cond?: Cond;
  text: string;
  gives?: string[];
  /** 인물 대신 이 이름으로 보인다 (장면 서술은 '조사실') */
  who?: string;
}

export interface Topic {
  id: string;
  label: string;
  show?: Cond;
  lines: Line[];
}

/** 자료를 내밀었을 때의 반응. ev 중 하나를 내밀고 cond가 맞으면 쓴다. 이미 gives를 다 가졌으면 건너뛴다 */
export interface Present {
  ev: string[];
  cond?: Cond;
  text: string;
  gives: string[];
  who?: string;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  /** 깊은 조사 인물(소환)인지, 짧은 탐문 인물인지 */
  deep: boolean;
  /** 소환·방문에 드는 게임 속 시간 */
  hours: number;
  show?: Cond;
  first: string;
  topics: Topic[];
  presents?: Present[];
  /** 맞는 반응이 없을 때 */
  shrug: string;
}

export interface Question {
  id: string;
  title: string;
  /** 증거로 확인되는 조건들(하나라도) */
  proof: Cond[];
  /** 진술로 확인되는 조건 */
  stated?: Cond;
  answer: string;
}

export interface Slide {
  caption: string;
  lines: string;
}
