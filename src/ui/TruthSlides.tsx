import { useCallback, useEffect, useState } from 'react';
import { CONFESSION, PLACES, TRUTH_TRACKS } from '../data/case';
import { TRUTH_SLIDES, type TruthSlide } from '../data/truthSlides';
import { useGame, type PawnId } from '../engine/state';
import { Box } from '../sketch/components';
import { FloorPlan, PAWNS, WalkingPawn, roomCenter } from './MapView';

// 진상 해설 슬라이드쇼 (2026-10-16). 장면 그림이 있으면 그림을, 없으면 그 시각의 집무실 평면도와 사람 위치를 보여 준다.
// 마지막 장은 무엇이 사건을 풀었는지 정리하는 글이다. ◀ ▶ 버튼과 키보드 화살표로 넘긴다.

/** src/assets/truth/<file>.(jpg|png|webp) — 사용자가 만든 장면 그림 */
const FILES = import.meta.glob('../assets/truth/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const imageOf = (file: string) => Object.entries(FILES).find(([p]) => p.split('/').pop()!.replace(/\.\w+$/, '') === file)?.[1];

/** 회장이 숨진 뒤 (20:31, 19:40부터 51분) */
const VICTIM_DOWN = 51;

/** t분의 장소: 그보다 앞선 기록 가운데 마지막 */
function placeAt(id: PawnId, t: number): string {
  const keys = TRUTH_TRACKS[id].keys;
  let place = keys[0][1];
  for (const [at, p] of keys) if (at <= t) place = p;
  return place;
}

/** 그림이 없을 때: 그 시각의 평면도. 집무실 안 사람은 말로, 밖에 있는 사람은 아래에 장소를 적는다 */
function PlanScene({ slide }: { slide: TruthSlide }) {
  const inside: { id: PawnId; label: string; xy: [number, number] }[] = [];
  const outside: { label: string; place: string }[] = [];
  for (const p of PAWNS) {
    const place = placeAt(p.id, slide.at);
    const spot = slide.spots?.[p.id];
    if (spot || place === 'office' || place === 'bath') inside.push({ id: p.id, label: p.label, xy: spot ?? roomCenter(place) });
    else outside.push({ label: p.label, place: slide.where?.[p.id] ?? PLACES[place] ?? place });
  }
  return (
    <div className="truth-plan">
      <div className="pawn-map truth-plan-map">
        <FloorPlan scene={false} />
        {inside.map(({ id, label, xy }) => (
          <WalkingPawn key={id} id={id} label={label} x={xy[0]} y={xy[1]} size={34}
            className={`epi-pawn ${id === 'V' && slide.at >= VICTIM_DOWN ? 'gone' : ''}`} dashed={id === 'V' && slide.at >= VICTIM_DOWN} />
        ))}
      </div>
      {outside.length > 0 && (
        <div className="epi-outside">
          <span className="muted">그 시각 집무실 밖</span>
          {outside.map((o) => <span key={o.label} className="epi-out-item">{o.label} · {o.place}</span>)}
        </div>
      )}
    </div>
  );
}

function Summary({ confessed }: { confessed: boolean }) {
  return (
    <div className="truth-summary">
      <h4 className="epi-sub">무엇이 사건을 풀었나</h4>
      <p className="doc-font">처음에는 9시 10분 문자와 9시 26분 신고 사이에 범행이 있었던 것처럼 보였다.<br />그 시간 태준과 민아는 회의 중이었고, 화가 나 올라간 사람은 준서였다.</p>
      <p className="doc-font">그러나 흉기인 트로피는 8시 55분부터 매입점에 인수되어 계속 보관되었다.<br />9시 10분 이후에는 그 물건으로 집무실에서 공격할 수 없었다.<br />문자는 예약 발송이었고, 등록은 8시 48분 집무실 책상 위 휴대폰에서 이루어졌다.</p>
      <p className="doc-font">집무실 문 기록에는 이름이 없었다.<br />태준은 8시 45분에 나왔다고 했지만, 민아는 8시 47분에 이미 1층 매입점에 있었다.<br />8시 45분과 46분은 민아의 출입이었고, 8시 50분에 문을 열고 나간 사람은 태준이었다.<br />그 시각 준서와 민아는 매입점에 있었고, 회장은 이미 숨진 뒤였다.</p>
      <p className="doc-font">{confessed ? '정확한 타격 순간과 정리 경위는 태준의 최종 진술에서 드러났다.' : '수사 중에는 태준의 자백을 받지 못했다.\n정확한 타격 순간과 정리 경위는 재수사에서 확인되었다.'}</p>
    </div>
  );
}

/** 진상 해설: 장면을 한 장씩 넘겨 본다 */
export function Epilogue() {
  const { state, dispatch } = useGame();
  const confessed = state.owned.includes(CONFESSION);
  const total = TRUTH_SLIDES.length + 1; // 마지막은 정리 글
  const [i, setI] = useState(0);
  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(total - 1, x + d))), [total]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go]);
  // 다음 장 그림을 미리 받아 둔다
  useEffect(() => {
    const next = TRUTH_SLIDES[i + 1] && imageOf(TRUTH_SLIDES[i + 1].file);
    if (next) new Image().src = next;
  }, [i]);
  const slide = TRUTH_SLIDES[i] as TruthSlide | undefined;
  const img = slide && imageOf(slide.file);
  return (
    <div className="center-screen">
      <Box mode="double" className="card-scrolls afterword card truth-show" seed="truth-show">
        <div className="card-scroll">
          <div className="truth-head">
            <div className="code">진상 해설</div>
            <div className="code">{i + 1} / {total}</div>
          </div>
          {i === 0 && <p className="afterword-lead">{confessed ? `자료와 문태준의 최종 진술을 합쳐 그날 저녁을 다시 그렸다.` : '확보한 자료에, 보고서 제출 뒤 재수사에서 확인된 사실을 더해 그날 저녁을 다시 그렸다.'}</p>}
          {slide ? (
            <>
              <div className="truth-time mono">{slide.time}</div>
              <div className={`truth-stage ${img ? 'has-img' : 'sheet'}`}>
                {img ? <img src={img} alt={slide.caption.split('\n')[0]} className="truth-img seamless-art" /> : <PlanScene slide={slide} />}
              </div>
              <p className="truth-caption" style={{ whiteSpace: 'pre-line' }}>{slide.caption}</p>
            </>
          ) : (
            <Summary confessed={confessed} />
          )}
          <div className="truth-nav">
            <Box as="button" className="btn" seed="tr-prev" disabled={i === 0} onClick={() => go(-1)}>◀ 이전</Box>
            <div className="truth-dots" role="tablist" aria-label="장면">
              {Array.from({ length: total }, (_, k) => (
                <button key={k} role="tab" aria-selected={k === i} aria-label={`${k + 1}번째 장면`} className={`truth-dot ${k === i ? 'on' : ''}`} onClick={() => setI(k)} />
              ))}
            </div>
            <Box as="button" mode={i < total - 1 ? 'double' : undefined} className="btn" seed="tr-next" disabled={i === total - 1} onClick={() => go(1)}>다음 ▶</Box>
          </div>
          <div className="cover-actions">
            <Box as="button" className="btn" seed="ep-after" onClick={() => dispatch({ type: 'screen', screen: 'afterword' })}>사건 이후</Box>
            <Box as="button" className="btn" seed="ep-back" onClick={() => dispatch({ type: 'screen', screen: 'result' })}>결과로</Box>
          </div>
        </div>
      </Box>
    </div>
  );
}

