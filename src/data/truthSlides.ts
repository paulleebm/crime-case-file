import type { PawnId } from '../engine/state';

// 진상 해설 슬라이드쇼 (2026-10-16). 장면 그림은 design/evidence-production/truth-slideshow-prompts.md의 프롬프트로 만든다.
// 그림 파일(src/assets/truth/<file>.jpg|png|webp)이 있으면 그 그림을, 없으면 그 시각의 집무실 평면도와 사람 위치를 보여 준다.
// 자막은 문장마다 줄을 바꾼다.

export interface TruthSlide {
  /** 그림 파일 이름 (확장자 없이) */
  file: string;
  /** 화면에 보이는 시각 */
  time: string;
  /** 평면도로 대신 보여 줄 때의 시각 (19:40부터 센 분, TRUTH_TRACKS 기준) */
  at: number;
  caption: string;
  /** 평면도에서 이 장면에 맞게 옮겨 놓을 자리 (평면도 좌표). 없으면 방 가운데 */
  spots?: Partial<Record<PawnId, [number, number]>>;
  /** 집무실 밖에 있는 사람의 장소를 더 정확히 적을 때 */
  where?: Partial<Record<PawnId, string>>;
}

/** 평면도 위 자리 */
const DESK: [number, number] = [560, 150];
const CENTER: [number, number] = [526, 290];
const SHELF: [number, number] = [610, 340];
const BATH_DOOR: [number, number] = [360, 236];
const BATH: [number, number] = [300, 150];
/** 화장실 안에 숨은 태준 (회장과 겹치지 않게) */
const HIDE: [number, number] = [368, 112];
const IN_FRONT_OF_DESK: [number, number] = [560, 226];

const HOTEL_TRUTH_SLIDES: TruthSlide[] = [
  { file: 'truth-01-call', time: '19:50', at: 10, where: { A: '1층 로비 카페', V: '호텔 밖 (변호사 상담 뒤)', C: '호텔 안 (업무 중)' },
    caption: '19시 50분. 준서는 아버지에게 보증금을 부탁했다.\n아버지는 변호사를 만나 뒷일을 정리해 뒀다고만 했다.\n현금 대신 받은 것은 집무실의 금 트로피였다.' },
  { file: 'truth-02-card', time: '20:15', at: 35, where: { V: '호텔 밖 (돌아오는 중)', C: '호텔 안 (업무 중)' },
    caption: '20시 15분, 로비.\n준서는 민아에게 자기 방문 카드를 건넸다.\n민아는 계약 종료 통보를 받은 지 닷새째였다.' },
  { file: 'truth-03-report', time: '20:30', at: 50, spots: { V: DESK, C: IN_FRONT_OF_DESK },
    caption: '20시 30분.\n태준이 집무실에 들어왔다.\n회장은 운영비 6,400만원이 어디로 갔는지 물었다.' },
  { file: 'truth-04-blow', time: '20:31', at: 51, spots: { V: CENTER, C: [560, 250] },
    caption: '회장이 자리를 나와 태준을 지나 출입문으로 향했다.\n태준은 뒤에서 트로피 받침으로 뒤통수를 한 번 쳤다.\n회장은 집무실 중앙에 쓰러졌다. 계획한 일이 아니었다.' },
  { file: 'truth-05-wipe', time: '20:32~20:44', at: 64, spots: { V: BATH, C: BATH_DOOR },
    caption: '태준은 중앙에 쓰러진 회장을 화장실로 옮기고 보이는 피를 닦았다.\n트로피도 손수건으로 닦아 감싸 쥐고 제자리에 올려 두었다.\n20시 45분, 그는 화장실 문 바로 앞에서 바닥을 마저 닦고 있었다.' },
  { file: 'truth-06-hide', time: '20:45', at: 65, spots: { V: BATH, C: HIDE, B: [480, 400] },
    caption: '그때 출입문에서 카드 소리가 났다.\n태준은 한 걸음 물러나 화장실 문을 닫았다.' },
  { file: 'truth-07-empty-room', time: '20:45~20:46', at: 65, spots: { V: BATH, C: HIDE, B: SHELF },
    caption: '민아는 빈 방인 줄 알았다.\n"회장님, 준서 씨 부탁으로 트로피 가져가겠습니다."\n대답은 없었다. 그녀는 1분 만에 트로피만 들고 나갔다.' },
  { file: 'truth-08-shop', time: '20:47~20:55', at: 67, spots: { V: BATH, C: HIDE },
    caption: '20시 47분, 민아는 이미 1층 매입점에 있었다.\n트로피는 카운터에 올려졌고, 직원은 장갑을 끼고 받았다.\n그 순간부터 흉기는 매입점 안에 있었다.' },
  { file: 'truth-09-schedule', time: '20:48', at: 68, spots: { V: BATH, C: DESK },
    caption: '흉기가 들려 나가자 태준은 크게 당황했다.\n그리고 이 상황을 아들에게 뒤집을 방법을 떠올렸다.\n20시 48분, 회장의 휴대폰에 9시 10분 문자가 예약됐다.' },
  { file: 'truth-10-leave', time: '20:50', at: 70, spots: { V: BATH },
    caption: '20시 50분, 문을 열고 나간 사람은 태준이었다.\n문 기록에는 이름이 남지 않는다.\n그는 나중에 8시 45분에 나왔다고 말했다.' },
  { file: 'truth-11-meeting', time: '21:00', at: 80, spots: { V: BATH },
    caption: '9시, 태준은 회의를 주관했다.\n민아는 그 자리에서 자료와 음료를 챙겼다.\n같은 시각, 아래층의 준서에게 문자가 도착하기를 그는 기다렸다.' },
  { file: 'truth-12-text', time: '21:10', at: 90, spots: { V: BATH },
    caption: '9시 10분, 준서의 휴대폰에 아버지의 문자가 왔다.\n"생각해 보니 트로피도 못 주겠다. 당장 다시 가져와."\n태준은 준서가 트로피를 들고 올라오기를 바랐다. 트로피는 이미 매입점 금고에 있었다.' },
  { file: 'truth-13-found', time: '21:23', at: 103, spots: { V: BATH, A: BATH_DOOR },
    caption: '9시 23분, 준서는 빈손으로 집무실에 올라갔다.\n화장실 문을 열었을 때, 아버지는 이미 한 시간 가까이 그곳에 있었다.\n9시 26분, 신고가 접수됐다.' },
];

export const TRUTH_SLIDES = HOTEL_TRUTH_SLIDES;
