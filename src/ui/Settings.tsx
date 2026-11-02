import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applySave, describeSave, dropSaveHash, makeSaveLink, parseSaveLink, readSlot, SAVE_SLOTS, type ImportedSave, type SaveSlot } from '../engine/saveLink';
import { Box, Ink, PencilDefs } from '../sketch/components';
import { circle, hashSeed, line, rng, type Stroke } from '../sketch/sketch';
import { RadioControl } from './RadioControl';

/** 연필로 그린 톱니바퀴 */
function GearIcon({ size = 22 }: { size?: number }) {
  const strokes = useMemo(() => {
    const o: Stroke[] = [];
    const r = rng(hashSeed('gear-icon'));
    const op = { os: 1, w: 1.4, j: 0.3 };
    circle(o, r, 12, 12, 6.2, op);
    circle(o, r, 12, 12, 2.4, { ...op, w: 1.1 });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      line(o, r, 12 + Math.cos(a) * 6.4, 12 + Math.sin(a) * 6.4, 12 + Math.cos(a) * 9.4, 12 + Math.sin(a) * 9.4, { ...op, os: 0.3, w: 1.8 });
    }
    return o;
  }, []);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      <Ink strokes={strokes} />
    </svg>
  );
}

const fmtTime = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 표지 우상단 설정: 소리, 세이브 링크 만들기·불러오기 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [imp, setImp] = useState<ImportedSave | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="settings" ref={ref}>
      <Box as="button" className="home-btn settings-btn" seed="settings-btn" title="설정" aria-label="설정" aria-expanded={open} onClick={() => setOpen((v) => !v)}><GearIcon size={24} /></Box>
      {open && (
        <Box mode="double" className="settings-panel card" seed="settings-panel">
          <Section title="소리"><RadioControl /></Section>
          <Section title="세이브 링크 만들기">
            <p className="settings-note">링크를 열면 그 기기에서 이 진행 상태로 이어서 할 수 있습니다.<br />링크를 열 때마다 진행이 링크의 상태로 맞춰집니다.</p>
            {SAVE_SLOTS.map((slot) => <ExportRow key={slot.key} slot={slot} />)}
          </Section>
          <Section title="세이브 링크 불러오기"><ImportRow onParsed={(v) => { setOpen(false); setImp(v); }} /></Section>
        </Box>
      )}
      {imp && <SaveImportDialog imp={imp} onCancel={() => setImp(null)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-sec">
      <div className="settings-h">{title}</div>
      {children}
    </div>
  );
}

function ExportRow({ slot }: { slot: SaveSlot }) {
  const [data] = useState(() => readSlot(slot));
  const [msg, setMsg] = useState('');
  // 클립보드를 쓸 수 없으면 링크를 칸에 띄워 직접 복사하게 한다
  const [manual, setManual] = useState('');
  const copy = async () => {
    const link = await makeSaveLink(slot).catch(() => null);
    if (!link) { setMsg('링크를 만들지 못했습니다'); return; }
    if (await writeClipboard(link)) { setMsg('복사했습니다'); setManual(''); return; }
    setMsg('아래 링크를 직접 복사하세요');
    setManual(link);
  };
  return (
    <>
      <div className="settings-row">
        <div className="settings-slot">
          <span>{slot.label}</span>
          <span className="code">{msg || describeSave(data)}</span>
        </div>
        <Box as="button" className="btn small" seed={`copy-${slot.key}`} disabled={!data} onClick={copy}>링크 복사</Box>
      </div>
      {manual && (
        <Box className="settings-input" seed={`manual-${slot.key}`}>
          <input readOnly value={manual} autoFocus onFocus={(e) => e.currentTarget.select()} />
        </Box>
      )}
    </>
  );
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 권한이 막힌 창에서는 예전 방식으로 한 번 더 시도한다
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function ImportRow({ onParsed }: { onParsed: (imp: ImportedSave) => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const load = async () => {
    const imp = await parseSaveLink(text);
    if (!imp) { setErr('세이브 링크를 읽을 수 없습니다'); return; }
    setErr('');
    onParsed(imp);
  };
  return (
    <>
      <div className="settings-row">
        <Box className="settings-input" seed="settings-input">
          <input value={text} placeholder="세이브 링크를 붙여 넣으세요" onChange={(e) => { setText(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
        </Box>
        <Box as="button" className="btn small" seed="settings-load" disabled={!text.trim()} onClick={load}>불러오기</Box>
      </div>
      {err && <div className="settings-err">{err}</div>}
    </>
  );
}

/** 세이브를 쓰기 전에 확인한다. 이 기기에 다른 진행이 있으면 덮어쓸지 묻는다 */
export function SaveImportDialog({ imp, onCancel }: { imp: ImportedSave; onCancel: () => void }) {
  const current = readSlot(imp.slot);
  const same = current === imp.data;
  const write = () => {
    try { applySave(imp); } catch { onCancel(); }
  };
  return (
    <div className="settings-overlay">
      <Box mode="double" className="settings-dialog card" seed="save-import">
        <h3>세이브 링크 불러오기</h3>
        <p>{imp.slot.label}</p>
        <div className="settings-compare">
          <span className="k">링크의 기록</span><span>{describeSave(imp.data)} · {fmtTime(imp.savedAt)} 저장</span>
          <span className="k">이 기기의 기록</span><span>{same ? '링크와 같음' : describeSave(current)}</span>
        </div>
        {current && !same && <p className="settings-warn">이 기기의 진행은 지워지고 링크의 기록으로 바뀝니다.<br />되돌릴 수 없습니다.</p>}
        <div className="cover-actions" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <Box as="button" className="btn" seed="imp-no" onClick={onCancel}>{current && !same ? '이 기기 기록 유지' : '취소'}</Box>
          <Box as="button" mode="double" className="btn" seed="imp-yes" onClick={write}>{current && !same ? '링크 기록으로 덮어쓰기' : '이어서 하기'}</Box>
        </div>
      </Box>
    </div>
  );
}

/** 주소에 #save= 가 붙어 들어왔을 때 게임보다 먼저 띄운다 */
export function SaveLinkGate({ children }: { children: ReactNode }) {
  const [imp, setImp] = useState<ImportedSave | null | 'loading' | 'bad'>('loading');
  useEffect(() => {
    void parseSaveLink(location.hash).then((v) => {
      if (v && !readSlot(v.slot)) { applySave(v); return; }
      setImp(v ?? 'bad');
    });
  }, []);
  const skip = () => { dropSaveHash(); setImp(null); };
  if (imp === null) return <>{children}</>;
  if (imp === 'loading') return null;
  return (
    <>
      <PencilDefs />
      {imp === 'bad' ? (
        <div className="settings-overlay">
          <Box mode="double" className="settings-dialog card" seed="save-bad">
            <h3>세이브 링크를 읽을 수 없습니다</h3>
            <p>링크가 잘렸거나 망가졌습니다.<br />이 기기의 기록으로 시작합니다.</p>
            <div className="cover-actions" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
              <Box as="button" mode="double" className="btn" seed="bad-ok" onClick={skip}>확인</Box>
            </div>
          </Box>
        </div>
      ) : <SaveImportDialog imp={imp} onCancel={skip} />}
    </>
  );
}
