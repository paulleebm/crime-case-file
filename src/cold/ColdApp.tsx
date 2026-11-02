import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Box, PencilDefs } from '../sketch/components';
import {
  ACCUSABLE, accuse, ask, canSummonSuspect, clockText, deserialize, endDay, evidenceById, hoursLeftToday,
  leave, markSeen, newGame, personById, present, questionStates, raining, runOrder, SAVE_KEY, serialize, topicsOf,
  visibleActions, visiblePersons, type ColdState,
} from './engine';
import { interpretOrder, MAX_ORDER_INPUT } from './order';
import { interpretTalk, MAX_TALK_INPUT } from './talk';
import { talkTurn } from './talkParse';
import { CASE_NO, CASE_TITLE, ENDINGS, EVIDENCE, INTRO, JIA_BUNDLES } from './twiceDead';
import type { ActionCat, Folder } from './types';
import './cold.css';

// 미제 사건 수사 게임 뼈대 화면 (/cold). 수사 지시는 반장에게 말로 하고(AI 해석, 안 되면 낱말로), 메뉴로도 끝까지 플레이할 수 있다.

type Screen = 'title' | 'intro' | 'hub';

function loadSave(): ColdState | null {
  try { return deserialize(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function writeSave(s: ColdState) {
  try { localStorage.setItem(SAVE_KEY, serialize(s)); } catch { /* 저장이 막힌 환경에서도 플레이는 계속된다 */ }
}

export default function ColdApp() {
  const [screen, setScreen] = useState<Screen>('title');
  const [state, setState] = useState<ColdState>(newGame);
  const saved = useMemo(loadSave, [screen]);

  const start = () => { const s = newGame(); setState(s); writeSave(s); setScreen('intro'); };
  const resume = () => { if (saved) { setState(saved); setScreen('hub'); } };

  return (
    <div className="cold-root">
      <PencilDefs />
      {screen === 'title' && <Title onStart={start} onResume={saved ? resume : undefined} />}
      {screen === 'intro' && <Intro onDone={() => setScreen('hub')} />}
      {screen === 'hub' && (state.ending
        ? <Ending state={state} onTitle={() => setScreen('title')} />
        : <Hub state={state} setState={setState} onTitle={() => setScreen('title')} />)}
    </div>
  );
}

function Title({ onStart, onResume }: { onStart: () => void; onResume?: () => void }) {
  return (
    <div className="center-screen">
      <Box mode="double" seed="cold-title" className="card cold-title">
        <div className="code">미해결 사건 파일 · 개발판</div>
        <h1 className="doc-font">{CASE_TITLE}</h1>
        <div className="code">{CASE_NO}</div>
        <p className="cold-lines doc-font">{'2006년 12월, 동해안의 작은 항구.\n3년 전에 죽은 남자가, 다시 죽은 채 발견됐다.'}</p>
        <div className="cover-actions">
          <Box as="button" seed="cold-new" className="btn" onClick={onStart}>새로 시작</Box>
          {onResume && <Box as="button" seed="cold-resume" className="btn" onClick={onResume}>이어 하기</Box>}
        </div>
      </Box>
    </div>
  );
}

function Intro({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const slide = INTRO[i];
  const next = () => (i + 1 < INTRO.length ? setI(i + 1) : onDone());
  return (
    <div className="center-screen" onClick={next}>
      <Box mode="double" seed={`intro${i}`} className="card cold-slide">
        <div className="code">{slide.caption}</div>
        <p className="cold-lines doc-font">{slide.lines}</p>
        <div className="cold-slide-foot">
          <span className="muted">{i + 1} / {INTRO.length} · 누르면 다음</span>
          <button className="link" onClick={(e) => { e.stopPropagation(); onDone(); }}>건너뛰기</button>
        </div>
      </Box>
    </div>
  );
}

type Tab = '지시' | '자료' | '조사실' | '일지';

function Hub({ state, setState, onTitle }: { state: ColdState; setState: Dispatch<SetStateAction<ColdState>>; onTitle: () => void }) {
  const [tab, setTab] = useState<Tab>('지시');
  const [doc, setDoc] = useState<string | null>('E01');
  const [accusing, setAccusing] = useState(false);

  useEffect(() => { if (state.session) setTab('조사실'); }, [state.session?.person, state.session === null]);

  const run = ([n]: [ColdState, unknown]) => setState(n);
  /** 메뉴·관계자 목록에서 고른 것도 반장과의 대화에 남긴다 */
  const pick = (text: string, id: string, opts = {}) => setState((s) => runOrder(s, text, { kind: 'order', ids: [id], reply: '' }, opts));
  const finishDay = () => { const n = endDay(state); writeSave(n); setState(n); setTab('지시'); };
  const openDoc = (id: string) => { setDoc(id); setTab('자료'); setState(markSeen(state, id)); };

  return (
    <div className="hub cold-hub">
      <Box mode="double" seed="cold-tb" className="card cold-titlebar">
        <button className="link" onClick={onTitle}>처음으로</button>
        <div><span className="k">사건</span> {CASE_TITLE}</div>
        <div className="mono">{clockText(state.clock)}</div>
        <div className="muted">{raining(state) ? '비' : '맑음 · 12-13(수) 14시부터 비'} · 오늘 남은 시간 {Math.max(0, hoursLeftToday(state))}시간</div>
        <Box as="button" seed="cold-end" className="btn" onClick={finishDay}>하루 마치기 (저장)</Box>
        <Box as="button" seed="cold-acc" className="btn" onClick={() => setAccusing(true)}>송치</Box>
      </Box>
      <div className="hub-main cold-main">
        <Box seed="cold-side" className="panel card scroll">
          <Questions state={state} />
          <div className="sec">관계자</div>
          {visiblePersons(state).map((p) => (
            <PersonRow key={p.id} state={state} id={p.id} onSummon={(opts) => { pick(`${p.name}${opts.suspect ? ' 피의자로' : ''} ${p.deep ? '소환' : '찾아가기'}`, `P:${p.id}`, opts); }} />
          ))}
        </Box>
        <Box seed="cold-work" className="panel card cold-work">
          <div className="tabs">
            {(['지시', '자료', '조사실', '일지'] as Tab[]).map((t) => (
              <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                <span className="tab-label">{t === '지시' ? '수사 지시' : t === '자료' ? `자료함 ${state.unseen.length ? `(새 ${state.unseen.length})` : ''}` : t === '조사실' ? `조사실${state.session ? ' ●' : ''}` : '수사 일지'}</span>
              </button>
            ))}
          </div>
          {tab === '지시' && <Orders state={state} setState={setState} onPick={pick} />}
          {tab === '자료' && <Docs state={state} doc={doc} onOpen={openDoc} />}
          {tab === '조사실' && <Room state={state} setState={setState} onAsk={(t) => run(ask(state, t))} onPresent={(e) => run(present(state, e))} onLeave={() => setState(leave(state))} />}
          {tab === '일지' && <div className="docview">{state.journal.map((j, i) => <div key={i} className="mono cold-journal">{j}</div>)}</div>}
        </Box>
      </div>
      {state.morning && <Morning lines={state.morning} onClose={() => setState({ ...state, morning: null })} />}
      {accusing && <Accuse state={state} onCancel={() => setAccusing(false)} onAccuse={(p, c) => { const n = accuse(state, p, c); writeSave(n); setState(n); }} />}
    </div>
  );
}

function Questions({ state }: { state: ColdState }) {
  return (
    <>
      <div className="sec first">의문 수첩</div>
      {questionStates(state).map((q) => (
        <div key={q.id} className={`cold-q ${q.state}`}>
          <div><span className="mono">{q.id}</span> {q.title} <span className="cold-q-mark">{q.state === '증거' ? '해결' : q.state === '진술' ? '진술로 확인' : ''}</span></div>
          {q.state !== '미해결' && <div className="muted cold-q-a">{q.answer}</div>}
        </div>
      ))}
    </>
  );
}

function PersonRow({ state, id, onSummon }: { state: ColdState; id: string; onSummon: (o: { suspect?: boolean; withGrandma?: boolean }) => void }) {
  const p = personById.get(id)!;
  const [grandma, setGrandma] = useState(true);
  const on = state.session?.person === id;
  const visited = state.visited.includes(id);
  return (
    <div className={`cold-person ${on ? 'on' : ''}`}>
      <div><b>{p.name}</b> <span className="muted">{p.role}</span></div>
      <div className="cold-person-actions">
        <button className="link" disabled={on} onClick={() => onSummon({ withGrandma: id === 'JA' && grandma })}>
          {p.deep ? '참고인 소환' : visited ? '다시 찾아가기' : '찾아가기'} ({p.hours}시간)
        </button>
        {id === 'JA' && (
          <>
            <button className="link" disabled={on || !canSummonSuspect(state, 'JA')} title="그날 밤 현장에 있었다는 근거 두 개 필요" onClick={() => onSummon({ suspect: true, withGrandma: grandma })}>피의자로 소환</button>
            <label className="cold-check"><input type="checkbox" checked={grandma} onChange={(e) => setGrandma(e.target.checked)} /> 할머니 동석</label>
          </>
        )}
      </div>
    </div>
  );
}

const CATS: ActionCat[] = ['현장', '감정', '기록', '탐문', '영장'];

function Orders({ state, setState, onPick }: { state: ColdState; setState: Dispatch<SetStateAction<ColdState>>; onPick: (text: string, id: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [via, setVia] = useState<'ai' | 'words' | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.orders.length, busy]);
  const acts = visibleActions(state);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    setBusy(true);
    const order = await interpretOrder(t, state, state.orders);
    setVia(order.via);
    const opts = { suspect: /피의자/.test(t), withGrandma: !/(혼자|따로|할머니 없이|할머니 빼고|단독)/.test(t) };
    setState((s) => runOrder(s, t, order, opts));
    setBusy(false);
  };

  return (
    <div className="cold-orders-wrap">
      <div className="chat-body">
        {state.orders.map((l, i) => (
          <div key={i} className={`cold-msg ${l.who === '나' ? 'me' : ''}`}>
            <div className="code">{l.who}</div>
            <div className="cold-lines">{l.text}</div>
          </div>
        ))}
        {busy && <div className="cold-msg"><div className="code">반장</div><div className="muted">…</div></div>}
        <div ref={end} />
      </div>
      <div className="cold-order-input">
        {state.pending.length > 0 && (
          <div className="muted cold-pending">기다리는 결과: {[...new Set(state.pending.map((p) => `${evidenceById.get(p.id)?.title ?? p.id} (${clockText(p.at).slice(0, 8)})`))].join(' · ')}</div>
        )}
        <div className="cold-order-row">
          <textarea
            value={text} maxLength={MAX_ORDER_INPUT} rows={2} placeholder="반장에게 지시한다. 예: 방파제 쪽 좀 훑어 봐 / 옆집 할머니한테 그날 밤 소리 들었는지 물어봐"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          />
          <Box as="button" seed="cold-send" className="btn" onClick={() => void send()}>{busy ? '…' : '지시'}</Box>
        </div>
        {via === 'words' && <div className="muted cold-via">AI에 닿지 않아 낱말로 알아들었다.</div>}
        <details className="cold-menu">
          <summary>메뉴에서 고르기</summary>
          {CATS.map((c) => {
            const list = acts.filter((a) => a.cat === c);
            if (!list.length) return null;
            return (
              <div key={c}>
                <div className="sec">{c}</div>
                {list.map((a) => (
                  <button key={a.id} className="item cold-act" onClick={() => onPick(a.label, a.id)}>
                    <span>{a.label}</span>
                    <span className="muted mono">{a.hours ? `${a.hours}시간` : ''}{a.wait ? ` · 결과 ${a.wait >= 24 ? `${a.wait / 24}일` : `${a.wait}시간`}` : ''}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </details>
      </div>
    </div>
  );
}

const FOLDERS: Folder[] = ['첫 회의', '현장', '감정', '기록', '진술'];

function Docs({ state, doc, onOpen }: { state: ColdState; doc: string | null; onOpen: (id: string) => void }) {
  const owned = EVIDENCE.filter((e) => state.have.includes(e.id));
  const cur = doc && state.have.includes(doc) ? evidenceById.get(doc) : undefined;
  return (
    <div className="cold-docs">
      <div className="cold-doclist scroll">
        {FOLDERS.map((f) => {
          const items = owned.filter((e) => e.folder === f);
          if (!items.length) return null;
          return (
            <div key={f}>
              <div className="sec">{f}</div>
              {items.map((e) => (
                <button key={e.id} className={`item ${cur?.id === e.id ? 'on' : ''}`} onClick={() => onOpen(e.id)}>
                  <span className="t">{e.title}</span>
                  {state.unseen.includes(e.id) && <span className="badge-new">새 자료</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="docview">
        {cur ? (
          <>
            <h3 className="doc-title">{cur.title}</h3>
            <div className="doc-meta">{cur.id} · {cur.folder}</div>
            <p className="cold-lines">{cur.body}</p>
          </>
        ) : <div className="empty">왼쪽에서 자료를 고르세요.</div>}
      </div>
    </div>
  );
}

function Room({ state, setState, onAsk, onPresent, onLeave }: { state: ColdState; setState: Dispatch<SetStateAction<ColdState>>; onAsk: (t: string) => void; onPresent: (e: string) => void; onLeave: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [noAi, setNoAi] = useState(false);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.session?.log.length, busy]);
  const send = async () => {
    const t = text.trim();
    if (!t || busy || !state.session) return;
    setText('');
    setBusy(true);
    const turn = await interpretTalk(t, state);
    setNoAi(turn.via === 'none');
    if (turn.via === 'none') setText(t); // 못 보낸 말은 입력칸에 돌려놓는다
    else setState((s) => (s.session?.person === state.session?.person ? talkTurn(s, t, turn) : s));
    setBusy(false);
  };
  const sess = state.session;
  if (!sess) return <div className="empty">왼쪽 관계자 목록에서 소환하거나 찾아가세요.</div>;
  const p = personById.get(sess.person)!;
  const evs = EVIDENCE.filter((e) => state.have.includes(e.id) && e.id !== 'E20s');
  return (
    <div className="cold-room">
      <div className="chat-head">
        <b>{p.name}</b><span className="muted">{p.role}{sess.suspect ? ' · 피의자' : ''}{sess.withGrandma ? ' · 할머니 동석' : ''}</span>
        <button className="link" style={{ marginLeft: 'auto' }} onClick={onLeave}>조사 마치기</button>
      </div>
      <div className="chat-body">
        {sess.log.map((l, i) => (
          <div key={i} className={`cold-msg ${l.who === '나' ? 'me' : ''}`}>
            <div className="code">{l.who}</div>
            <div className="cold-lines">{l.text}</div>
          </div>
        ))}
        {busy && <div className="cold-msg"><div className="code">{p.name}</div><div className="muted">…</div></div>}
        <div ref={end} />
      </div>
      <div className="cold-room-menu">
        <div className="cold-order-row">
          <textarea
            value={text} maxLength={MAX_TALK_INPUT} rows={2} placeholder={`${p.name}에게 묻는다. 자료에 적힌 내용을 들이밀어도 된다.`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          />
          <Box as="button" seed="cold-talk-send" className="btn" onClick={() => void send()}>{busy ? '…' : '말하기'}</Box>
        </div>
        {noAi && <div className="muted cold-via">AI에 닿지 않았다. 아래 질문 버튼과 자료 내밀기로 이어 가세요.</div>}
        <div className="sec">예비 · 질문 버튼</div>
        <div className="cold-chips">
          {topicsOf(state).map((t) => <button key={t.id} className="action-chip sheet" onClick={() => onAsk(t.id)}>{t.label}</button>)}
        </div>
        <div className="sec">예비 · 자료 내밀기</div>
        <select value="" onChange={(e) => e.target.value && onPresent(e.target.value)}>
          <option value="">자료 고르기…</option>
          {evs.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
      </div>
    </div>
  );
}

function Morning({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  return (
    <div className="cold-modal" onClick={onClose}>
      <Box mode="double" seed="cold-morning" className="card cold-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="code">아침 보고 · 반장</div>
        {lines.map((l, i) => <p key={i} className="cold-lines">{l}</p>)}
        <Box as="button" seed="cold-morning-ok" className="btn" onClick={onClose}>알겠어</Box>
      </Box>
    </div>
  );
}

function Accuse({ state, onCancel, onAccuse }: { state: ColdState; onCancel: () => void; onAccuse: (p: string, c: '폭행치사' | '살인') => void }) {
  const [who, setWho] = useState('');
  const [charge, setCharge] = useState<'폭행치사' | '살인'>('살인');
  return (
    <div className="cold-modal" onClick={onCancel}>
      <Box mode="double" seed="cold-accuse" className="card cold-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="code">송치 의견서</div>
        <p className="cold-lines">{'송치하면 수사가 끝나고 결말로 넘어간다.\n되돌릴 수 없다.'}</p>
        <label className="cold-field">피의자
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">고르기…</option>
            {ACCUSABLE.map((id) => <option key={id} value={id}>{personById.get(id)!.name}</option>)}
          </select>
        </label>
        <label className="cold-field">죄명
          <select value={charge} onChange={(e) => setCharge(e.target.value as '폭행치사' | '살인')}>
            <option value="살인">살인</option>
            <option value="폭행치사">폭행치사</option>
          </select>
        </label>
        {who === 'JA' && (
          <div className="muted cold-lines">{'송치에 필요한 근거 묶음\n' + JIA_BUNDLES.map((b) => `· ${b.title}`).join('\n')}</div>
        )}
        <div className="cover-actions">
          <Box as="button" seed="cold-acc-go" className="btn" onClick={() => who && onAccuse(who, charge)}>송치한다</Box>
          <Box as="button" seed="cold-acc-no" className="btn" onClick={onCancel}>아직</Box>
        </div>
        <div className="muted mono">{clockText(state.clock)}</div>
      </Box>
    </div>
  );
}

function Ending({ state, onTitle }: { state: ColdState; onTitle: () => void }) {
  const e = state.ending!;
  const main = ENDINGS[e.key];
  const extra = e.key === 'solved' ? ENDINGS[e.told ? 'solvedTold' : 'solvedUntold'] : null;
  return (
    <div className="center-screen">
      <Box mode="double" seed="cold-ending" className="card cold-ending">
        <div className="code">결말</div>
        <h2 className="doc-font">{main.title}</h2>
        <p className="cold-lines doc-font">{main.lines}</p>
        {extra && <p className="cold-lines doc-font">{extra.lines}</p>}
        <div className="sec">의문 다시 보기</div>
        {e.questions.map((q) => (
          <div key={q.id} className={`cold-q ${q.state}`}>
            <div><span className="mono">{q.id}</span> {q.title} <span className="cold-q-mark">{q.state === '증거' ? '해결' : q.state === '진술' ? '진술로만 확인' : '끝내 확인하지 않은 것'}</span></div>
            {q.state !== '미해결' && <div className="muted cold-q-a">{q.answer}</div>}
          </div>
        ))}
        {e.side.length > 0 && (<><div className="sec">함께 밝힌 사건</div>{e.side.map((s) => <div key={s}>· {s}</div>)}</>)}
        <p className="cold-lines doc-font cold-card">{ENDINGS.card.lines}</p>
        <div className="muted mono">수사 {e.days}일 · 송치 {e.accused ? `${personById.get(e.accused)!.name} (${e.charge})` : '없음'}</div>
        <div className="cover-actions"><Box as="button" seed="cold-end-title" className="btn" onClick={onTitle}>처음으로</Box></div>
      </Box>
    </div>
  );
}
