import { useState } from 'react';
import { CASE_NO, CASE_TITLE, EVIDENCE_TREE, PERSONS, personOf } from '../data/case';
import type { PersonId } from '../data/types';
import { docTitle, evidenceById, statementById } from '../engine/lookup';
import { folderOf, persist, useGame, type Tab } from '../engine/state';
import { HomeIcon } from './CoverArt';
import { ArtIcon } from './ArtIcon';
import { Box, Portrait } from '../sketch/components';
import { DocView } from './DocView';
import { MapView } from './MapView';
import { PersonView } from './PersonView';
import { ReportView } from './Report';
import { HintButton } from './HintButton';
import { RadioControl } from './RadioControl';
import { BriefingDoc } from './BriefingDoc';
import { TraySection } from './EvidenceTray';
import { JobBar, TeamIcon, TeamNotice, TeamView } from './TeamView';
import { ReplyNotice } from './ReplyNotice';
import { NotepadView } from './NotepadView';

export function Hub() {
  return (
    <div className="hub">
      <TitleBlock />
      <div className="hub-main">
        <Sidebar />
        <Workspace />
      </div>
      {/* 도착 알림은 우상단에 바로 띄운다 */}
      <TeamNotice />
      <ReplyNotice />
    </div>
  );
}

function TitleBlock() {
  const { state, dispatch } = useGame();
  const nEv = state.owned.filter((id) => evidenceById.has(id)).length;
  const home = () => { persist(state); dispatch({ type: 'screen', screen: 'title' }); };
  return (
    <Box mode="double" className="titleblock card" seed="titleblock">
      <Box seed="tb0" className="tb-home">
        <Box as="button" className="home-btn" seed="home-btn" title="처음 화면으로 (수사 내용은 저장된다)" aria-label="처음 화면으로" onClick={home}><HomeIcon size={24} /></Box>
      </Box>
      <Box seed="tb1"><span className="k">사건명</span><span className="case">{CASE_TITLE}</span></Box>
      <Box seed="tb2" className="tb-no"><span className="k">사건 번호</span><span className="v">{CASE_NO}</span></Box>
      <Box seed="tb5" className="tb-count"><span className="k">확보 자료</span><span className="v">{nEv}건</span></Box>
      <Box seed="tb6" className="tb-radio"><RadioControl /></Box>
      <Box seed="tb7" className="tb-hint">
        <HintButton />
      </Box>
    </Box>
  );
}

const docTab = (id: string): Omit<Tab, 'key'> => ({ type: 'doc', ref: id });
const docName = docTitle;

function isActiveDoc(active: Tab | undefined, id: string) {
  return !!active && active.type === 'doc' && active.ref === id;
}

function Sidebar() {
  const { state, dispatch } = useGame();
  const owned = new Set(state.owned);
  const unseen = new Set(state.unseen);
  const active = state.tabs.find((t) => t.key === state.active);

  return (
    // 테두리는 바깥 틀에 그리고, 목록만 안쪽에서 스크롤한다 (스크롤하면 테두리가 함께 밀려 깨지지 않게)
    <Box className="panel card sidebar-frame" seed="sidebar">
      <div className="sidebar-people">
      <div className="sec first">용의자</div>
      {(Object.keys(PERSONS) as PersonId[]).map((p) => {
        const hasNew = state.unseen.some((id) => personOf(id) === p && !!statementById.get(id)?.revises);
        const on = active?.type === 'person' && active.ref === p;
        const replied = (state.replyUnread ?? []).includes(p);
        return (
          <Box as="button" key={p} mode={on ? 'dash' : 'single'} seed={`ps${p}${on}`} className={`person ${on ? 'on' : ''} ${replied ? 'alert' : ''}`} onClick={() => dispatch({ type: 'openTab', tab: { type: 'person', ref: p } })}>
            <Portrait person={p} />
            <div style={{ flex: 1 }}>
              <div className="nm">{PERSONS[p].name}</div>
              {replied ? <div className="rl team-arrived">● 답변 도착</div> : <div className="rl">{PERSONS[p].tag}</div>}
            </div>
            {hasNew && <span className="badge-new">정정</span>}
          </Box>
        );
      })}

      <div className="sec">수사팀</div>
      {(() => {
        const on = active?.type === 'team';
        return (
          <Box as="button" mode={on ? 'dash' : 'single'} seed={`team${on}`} className={`person team-entry ${on ? 'on' : ''} ${state.team.unread ? 'alert' : ''}`} onClick={() => dispatch({ type: 'openTab', tab: { type: 'team' } })}>
            <TeamIcon />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">수사팀</div>
              {state.team.jobs.length ? <JobBar compact /> : state.team.unread ? <div className="rl team-arrived">● 결과 도착</div> : <div className="rl">원본 조회 · 감정 요청</div>}
            </div>
          </Box>
        );
      })()}

      </div>
      <div className="sidebar-scroll">
      <div className="sec first">자료</div>
      <div className="tree">
        {EVIDENCE_TREE.map((g) => {
          const items = g.items.filter((id) => id === 'BRIEF' || id === 'GT-MAP' || owned.has(id));
          if (!items.length) return null;
          return (
            <div key={g.folder} className="tree-folder">
              <div className="tree-name">{g.folder}</div>
              {items.map((id, i) => (
                <button key={id} className={`tree-item ${isActiveDoc(active, id) ? 'on' : ''}`} onClick={() => dispatch({ type: 'openTab', tab: docTab(id) })}>
                  <span className="tree-line">{i === items.length - 1 ? '└' : '├'}</span>
                  <span className="t">{docName(id)}</span>
                  {unseen.has(id) && <span className="badge-new">새 자료</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      </div>
      <div className="sidebar-tools">
      <TraySection />
      <button className={`tree-item report-item notepad-item ${active?.type === 'notepad' ? 'on' : ''}`} onClick={() => dispatch({ type: 'openTab', tab: { type: 'notepad' } })}>
        <span className="t">메모장</span>
      </button>
      <button className={`tree-item report-item last ${active?.type === 'report' ? 'on' : ''}`} onClick={() => dispatch({ type: 'openTab', tab: { type: 'report' } })}>
        <span className="t">사건 재구성 · 제출</span>
        {state.result && <span className="badge-new">제출됨</span>}
      </button>
      {/* 난이도(근거 문장 밑줄) 옵션은 당분간 숨긴다. 밑줄은 늘 켜 둔다 (state.underline, 'underline' 동작은 남겨 둔다) */}
      </div>
    </Box>
  );
}

function tabTitle(t: Tab): string {
  switch (t.type) {
    case 'person': return `용의자 · ${PERSONS[t.ref as PersonId].name}`;
    case 'doc': return `${folderOf(t.ref!)} · ${docName(t.ref!)}`;
    case 'report': return '사건 재구성';
    case 'team': return '수사팀';
    case 'notepad': return '메모장';
  }
}

/** 폴더 탭: 위쪽에 같은 폴더의 자료 목록, 아래에 고른 자료 */
function FolderDoc({ id }: { id: string }) {
  const { state, dispatch } = useGame();
  const owned = new Set(state.owned);
  const unseen = new Set(state.unseen);
  const items = EVIDENCE_TREE.find((g) => g.items.includes(id))?.items.filter((x) => x === 'BRIEF' || x === 'GT-MAP' || owned.has(x)) ?? [id];
  return (
    <div className="folder-doc">
      {items.length > 1 && (
        <div className="folder-strip">
          <span className="folder-strip-name code">{folderOf(id)}</span>
          {items.map((x) => (
            <Box as="button" key={x} mode={x === id ? 'double' : 'dash'} seed={`chip${x}${x === id}`} className={`folder-chip ${x === id ? 'on' : ''}`} onClick={() => dispatch({ type: 'openTab', tab: docTab(x) })}>
              {docName(x)}
              {unseen.has(x) && <span className="badge-new">새 자료</span>}
            </Box>
          ))}
        </div>
      )}
      <div className="folder-body">
        {id === 'BRIEF' ? <div className="docview"><BriefingDoc /></div> : id === 'GT-MAP' ? <MapView /> : <DocView key={id} id={id} />}
      </div>
    </div>
  );
}

const TAB_MIME = 'application/x-tab';
type Side = 'left' | 'right' | 'full';
const SIDE_LABEL: Record<Side, string> = { left: '왼쪽', right: '오른쪽', full: '전체' };

function TabBody({ tab }: { tab: Tab | undefined }) {
  if (!tab) return <div className="empty">왼쪽에서 용의자나 자료를 여세요.</div>;
  switch (tab.type) {
    case 'person': return <PersonView key={tab.ref} person={tab.ref as PersonId} />;
    case 'doc': return <FolderDoc id={tab.ref!} />;
    case 'report': return <ReportView />;
    case 'team': return <TeamView />;
    case 'notepad': return <NotepadView />;
  }
}

function Workspace() {
  const { state, dispatch } = useGame();
  const active = state.tabs.find((t) => t.key === state.active);
  const split = state.split ? state.tabs.find((t) => t.key === state.split) : undefined;
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const endDrag = () => { setDragKey(null); setInsertAt(null); setSide(null); };
  const isTab = (e: React.DragEvent) => e.dataTransfer.types.includes(TAB_MIME);

  return (
    <Box className="workspace card" seed="workspace">
      <div className="tabs" onDragOver={(e) => { if (isTab(e)) e.preventDefault(); }} onDrop={(e) => {
        if (!isTab(e) || insertAt === null) return;
        e.preventDefault();
        dispatch({ type: 'moveTab', key: e.dataTransfer.getData(TAB_MIME), index: insertAt });
        endDrag();
      }}>
        {state.tabs.map((t, i) => {
          const on = t.key === state.active || t.key === state.split;
          return (
            <Box
              key={t.key}
              mode={on ? 'single' : 'dash'}
              seed={`tab${t.key}${on}`}
              className={`tab ${on ? 'on' : ''} ${dragKey === t.key ? 'dragging' : ''}`}
              draggable
              title={tabTitle(t)}
              onDragStart={(e) => { e.dataTransfer.setData(TAB_MIME, t.key); e.dataTransfer.effectAllowed = 'move'; setDragKey(t.key); }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                if (!isTab(e)) return;
                e.preventDefault();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setInsertAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
                setSide(null);
              }}
              onClick={() => dispatch({ type: 'activate', key: t.key })}
            >
              {dragKey && insertAt === i && <span className="tab-insert" style={{ left: -3 }} />}
              {dragKey && insertAt === i + 1 && i === state.tabs.length - 1 && <span className="tab-insert" style={{ right: -3 }} />}
              {split && t.key === state.active && <span className="code">◧</span>}
              {split && t.key === state.split && <span className="code">◨</span>}
              <span className="tab-label">{tabTitle(t)}</span>
              <span className="x" title="닫기" onClick={(e) => { e.stopPropagation(); dispatch({ type: 'closeTab', key: t.key }); }}><ArtIcon name="close" size={12} /></span>
            </Box>
          );
        })}
        {split && <button className="btn small split-off" onClick={() => dispatch({ type: 'split', key: null })}>분할 해제</button>}
      </div>
      {/* 용의자 탭은 진술서와 대화창 두 칸이라, 다른 탭과 나란히 놓으면 2:1로 넓게 잡는다 */}
      <div className={`panes ${split ? 'split' : ''} ${split && active?.type === 'person' && split.type !== 'person' ? 'wide-left' : ''} ${split?.type === 'person' && active?.type !== 'person' ? 'wide-right' : ''}`}>
        <div className="pane"><TabBody tab={active} /></div>
        {split && <div className="pane"><TabBody tab={split} /></div>}
        {dragKey && (
          <div
            className="snap-layer"
            onDragOver={(e) => {
              if (!isTab(e)) return;
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const x = (e.clientX - r.left) / r.width;
              setSide(x < 0.33 ? 'left' : x > 0.67 ? 'right' : 'full');
              setInsertAt(null);
            }}
            onDragLeave={() => setSide(null)}
            onDrop={(e) => {
              if (!isTab(e) || !side) return;
              e.preventDefault();
              dispatch({ type: 'place', key: e.dataTransfer.getData(TAB_MIME), side });
              endDrag();
            }}
          >
            {side && (
              <Box mode="dash" seed={`snap${side}`} className="snap-preview" style={side === 'left' ? { left: 8, width: 'calc(50% - 12px)' } : side === 'right' ? { right: 8, width: 'calc(50% - 12px)' } : { left: 8, right: 8 }}>
                <span>{SIDE_LABEL[side]}</span>
              </Box>
            )}
          </div>
        )}
      </div>
    </Box>
  );
}
