import { CASE_NO, CASE_SUBTITLE, CASE_TITLE } from './hotelCase';

// 「미해결 사건 파일」 에피소드 목록. 사건 하나가 에피소드 하나다.
// 지금은 첫 사건만 플레이할 수 있다. 다음 사건은 자료(case.ts 등)를 에피소드별로 나눈 뒤 ready를 켠다.

export const GAME_TITLE = '미해결 사건 파일';
export const GAME_TITLE_EN = 'UNSOLVED CASE FILES';

export interface Episode {
  id: string;
  no: string;
  title: string;
  subtitle: string;
  caseNo?: string;
  blurb: string;
  /** 정사각형 표지 그림 이름 (CoverArt) */
  art: string;
  ready: boolean;
}

export const EPISODES: Episode[] = [
  {
    id: 'gold-trophy', no: '01', title: CASE_TITLE, subtitle: CASE_SUBTITLE, caseNo: CASE_NO, art: 'discovery', ready: true,
    blurb: '아들의 휴대폰에 아버지의 문자 한 통이 도착했다.\n분노한 아들은 곧장 호텔 집무실로 올라갔다.\n그리고 잠기지 않은 화장실 문 너머에, 회장이 쓰러져 있었다.',
  },
  { id: 'ep02', no: '02', title: '봉인된 파일', subtitle: '준비 중', art: 'sealed', ready: false, blurb: '다음 사건 기록을 정리하고 있다.' },
  { id: 'ep03', no: '03', title: '봉인된 파일', subtitle: '준비 중', art: 'sealed', ready: false, blurb: '다음 사건 기록을 정리하고 있다.' },
];
