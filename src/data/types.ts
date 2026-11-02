export type PersonId = 'A' | 'B' | 'C';

/** 소유 조건. all 은 모두, any 는 하나 이상. ID는 자료·진술·사실·방문 지점(P:...)·요청(R-..) 모두 가능 */
export interface Cond {
  all?: string[];
  any?: string[];
}

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'table'; head?: string[]; rows: string[][] }
  | { type: 'log'; lines: string[] }
  | { type: 'sketch'; name: string; caption?: string }
  /** 감식 사진 (캔버스로 그린 실사풍 사진. src/assets/evidence/<name>.png가 있으면 그 파일) */
  | { type: 'photo'; name: string; caption?: string }
  | { type: 'cuts'; cuts: { time: string; sketch: string; text: string }[] };

export interface Evidence {
  id: string;
  title: string;
  kind: 'plan' | 'report' | 'log' | 'photo' | 'recording' | 'testimony' | 'search';
  /** AI에게 보내는 한 줄 요약. 플레이어가 이미 볼 수 있는 내용만 담는다 */
  summary: string;
  body: Block[];
  initial?: boolean;
  /** 대화로 얻는 자료의 확보 경위 한 줄 (영장 집행, 임의 제출 등) */
  obtained?: string;
}

export interface Statement {
  id: string;
  person: PersonId;
  text: string;
  /** 원 진술 (진술서 본문). 처음엔 없고, 진술서 칸이 하나라도 채워지면 생긴다 */
  initial?: boolean;
  /** 이 진술이 수정·보충하는 이전 진술 */
  revises?: string;
  /** 이 진술이 나오면 진술서에서 정정(두 줄) 처리할 근거 문장 ID */
  strikes?: string[];
  /**
   * 정정되는 순간 대화창에서 하는 짧은 말: 이번에 새로 인정한 것, 숨긴 이유, 아직 남은 방어만.
   * 진술서에는 text가 항목별 현재 진술로 정리된다. 없으면 text를 그대로 말한다 (최종 자백).
   */
  say?: string;
  /** text의 근거 문장 가운데 근거로 인정받은 사실 (진술서에서 진술인의 주장과 구분해 표시한다) */
  admits?: string[];
}

/**
 * 자유 질문에 대한 미리 작성된 답변.
 * 같은 주제라도 수사 단계마다 답이 다를 수 있으므로 cond(이때부터)와 until(이때까지)로 구간을 나눈다.
 * 같은 topicKey를 가진 답변들은 한 주제의 단계별 버전이다.
 */
export interface Fact {
  id: string;
  person: PersonId;
  /** 단계별 버전을 묶는 주제 키. AI에게는 현재 유효한 버전 하나만 보인다 */
  topicKey?: string;
  /** AI가 질문과 맞출 때 쓰는 주제 설명 */
  topic: string;
  /** AI가 없을 때 쓰는 키워드 */
  keywords: string[];
  answer: string;
  /** 같은 내용을 다르게 말하는 답. 물을 때마다 이 중 하나를 고른다 (근거 문장은 같은 글자로 넣는다) */
  alt?: string[];
  /** 같은 답을 다시 물었을 때. 없으면 인물의 again 대사 + 짧은 answer */
  again?: string;
  cond?: Cond;
  /** 이 조건을 만족하면 더는 이 답을 쓰지 않는다 */
  until?: Cond;
  reveals?: string[];
  /** 사건과 관련 있어 진술 기록부에 남기는가 */
  record: boolean;
}

export interface Challenge {
  id: string;
  person: PersonId;
  targets: string[];
  conflict: 'time_overlap' | 'movement' | 'sightline' | 'statement_mismatch' | 'record_mismatch' | 'physical';
  /**
   * 이 지적이 깨는 거짓 문장들 (진술서 근거 문장 ID 또는 기록되는 답변 ID).
   * 플레이어가 이 중 하나를 정확히 짚어야 한다. 자료만 언급해서는 진술이 바뀌지 않는다.
   */
  lies: string[];
  /** 대체 가능한 근거 조합들. 하나라도 모두 갖추면 성공 */
  requires: string[][];
  reveals: string[];
  /** 이 지적이 통하면 함께 끝나는 지적 (자백하면 남은 곁가지 거짓말도 더 버티지 않는다) */
  closes?: string[];
  /** 결과로 보여 줄 대사. 없으면 공개되는 첫 진술 원문 */
  reply?: string;
  /**
   * 맞는 문장을 짚었지만 근거가 일부만 맞을 때의 반박. has를 모두 들었으면 이 말로 버틴다.
   * 앞에 적은 것부터 고른다. 무엇이 더 필요한지 플레이어가 짐작할 수 있게 쓴다.
   */
  partial?: { has: string[]; reply: string; feedback?: string }[];
  /** 통한 뒤 수사 수첩에 남기는 한 줄 (다음에 무엇을 확인할지 짐작할 여지를 준다. 답을 말하지 않는다) */
  note?: string;
  /** 이 지적은 같은 논점의 중간 단계다. 통하면 쓴 근거가 바로 다음 지적(새 변명을 겨냥하는 지적)으로 이어진다 */
  carry?: boolean;
}

export interface Room {
  id: string;
  name: string;
  rect: [number, number, number, number]; // x, y, w, h (평면도 좌표)
  label: [number, number];
  /** 평면도에 이름을 쓰지 않는 구역 (작은 표지로 이미 표시된 곳) */
  noLabel?: boolean;
}

/** 평면도 위 구역 사이 통로. via는 a에서 b로 갈 때 거치는 점 (문, 엘리베이터 승강로 등) */
export interface MapLink {
  a: string;
  b: string;
  via: [number, number][];
}

/** 사건 재구성의 서술형 문항 (육하원칙). 플레이어는 글로 답하고, 요점을 몇 개 담았는지로 채점한다 */
export interface ReportPoint {
  id: string;
  /** 채점 기준이 되는 요점 (AI 채점관에게 준다) */
  text: string;
  /** AI가 없을 때 쓰는 낱말. 하나라도 있으면 그 요점을 담은 것으로 본다 */
  keywords: string[];
}
export interface ReportQuestion {
  id: string;
  /** 육하원칙 표시 (언제·어디서·무엇을·어떻게·왜) */
  w: string;
  q: string;
  /** 이 칸에 무엇을 쓰면 되는지 (답을 알려 주지 않는다). 입력란 위에 작게 보인다 */
  guide?: string;
  /** 채점 뒤 보여 줄 모범 답 */
  model: string;
  points: ReportPoint[];
  /** 이만큼 요점을 담으면 정답. 하나라도 담으면 부분 정답 */
  need: number;
  /** 이 문항의 답이 어디서 나오는지 (근거 지도·채점 해설용) */
  source: string;
}

export interface Person {
  id: PersonId;
  name: string;
  role: string;
  age: number;
  tag: string;
  demeanor: string;
  /** AI 해석기에 주는 말투 설명 */
  voice: string;
  /** 목록에 없는 사소한 질문에 AI가 답할 때 쓰는 공개 신상. 사건 사실과 숨기는 비밀은 넣지 않는다 */
  profile: string;
  lines: {
    greet: string;
    nearMiss: string[];
    irrelevant: string[];
    unknown: string[];
    clarify: string[];
    repeat: string[];
    offtopic: string[];
    /** 같은 질문을 다시 받았을 때 답 앞에 붙는 말 */
    again: string[];
    /** 지적과 다른 질문이 한꺼번에 들어왔을 때 덧붙이는 말 */
    oneAtATime: string[];
    /** 앞서 내민 근거와 지금 말이 합쳐져 진술이 무너질 때 정정 앞에 붙이는 말 */
    combine: string[];
    /** 근거는 들었는데 어느 말을 반박하는지 모를 때 되묻는 말. {opts}에 최근에 한 말들이 들어간다 */
    askWhich: string[];
    /** 해석이 불확실할 때 확인하는 말. {claim}에 짚은 말, {ev}에 근거 이름이 들어간다 */
    askConfirm: string[];
    /** 되물었는데 형사가 그만두었을 때 */
    askDropped: string[];
    /** 방금 한 답의 세부(시각·이유·모습 등)를 캐물었는데 정해 둔 답이 없을 때. 모른다·기억나지 않는다는 말만 한다 */
    noDetail: string[];
    /** 방금 한 답을 바로 또 물었을 때. 같은 말을 되풀이하지 않고 더 할 말이 없다고 한다 */
    noMore: string[];
    /** 처음부터 다시 말해 달라고 할 때 앞에 붙이는 말 */
    restate: string[];
    /** 질문이 너무 많을 때(4개 이상) 덧붙이는 말 */
    tooMany: string[];
    /** 여러 질문 중 일부는 답할 수 없을 때 덧붙이는 말 */
    unknownPart: string[];
    /** 숨기던 것을 모두 털어놓은 뒤 또 추궁받았을 때 */
    settled: string[];
    /** 근거를 한꺼번에 잔뜩 늘어놓았을 때 */
    scatter: string[];
  };
}
