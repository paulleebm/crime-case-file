import { GOLD_SAVE_KEY } from '../data/active';

// 세이브 링크: 저장된 진행 기록을 압축해 주소의 #save= 뒤에 담는다.
// # 뒤는 서버로 가지 않으므로 길이 제한이나 서버 기록을 걱정하지 않아도 된다.

export const SAVE_SLOTS = [
  { key: GOLD_SAVE_KEY, label: '호텔 로베르 집무실 사건', path: '/' },
] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];

const HASH = '#save=';

interface Payload { k: string; d: string; t: number }
export interface ImportedSave { slot: SaveSlot; data: string; savedAt: number }

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function readSlot(slot: SaveSlot): string | null {
  try { return localStorage.getItem(slot.key); } catch { return null; }
}

/** 이 칸의 저장 기록을 세이브 링크로 만든다. 저장이 없으면 null */
export async function makeSaveLink(slot: SaveSlot): Promise<string | null> {
  const data = readSlot(slot);
  if (!data) return null;
  const payload: Payload = { k: slot.key, d: data, t: Date.now() };
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'));
  return `${location.origin}${slot.path}${HASH}${toBase64Url(packed)}`;
}

/** 링크(또는 주소의 # 부분)에서 세이브를 꺼낸다. 망가졌거나 모르는 칸이면 null */
export async function parseSaveLink(text: string): Promise<ImportedSave | null> {
  const at = text.indexOf(HASH);
  if (at < 0) return null;
  try {
    const bytes = await pipe(fromBase64Url(text.slice(at + HASH.length).trim()), new DecompressionStream('deflate-raw'));
    const p = JSON.parse(new TextDecoder().decode(bytes)) as Payload;
    const slot = SAVE_SLOTS.find((s) => s.key === p.k);
    if (!slot || typeof p.d !== 'string') return null;
    const s = JSON.parse(p.d);
    if (s?.version !== 4 || typeof s.caseId !== 'string') return null;
    return { slot, data: p.d, savedAt: p.t };
  } catch {
    return null;
  }
}

export function hasSaveHash() {
  return location.hash.startsWith(HASH);
}

/** 세이브를 이 기기에 쓰고 그 사건으로 들어간다 (주소의 #save= 는 남기지 않는다) */
export function applySave(imp: ImportedSave) {
  localStorage.setItem(imp.slot.key, imp.data);
  location.replace(imp.slot.path === '/' ? '/?view=episodes' : imp.slot.path);
}

/** 주소에서 #save= 를 지운다 (새로고침해도 다시 덮어쓰지 않게) */
export function dropSaveHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

/** 짧은 진행 요약: 확보 자료 수, 상태 */
export function describeSave(data: string | null): string {
  if (!data) return '저장 없음';
  try {
    const s = JSON.parse(data) as { owned?: string[]; result?: { grade?: string }; screen?: string };
    const status = s.result ? (s.result.grade === 'wrong' ? '오인 종결' : '해결') : s.screen === 'title' || s.screen === 'episodes' ? '시작 전' : '수사 중';
    return `${status} · 기록 ${s.owned?.length ?? 0}건`;
  } catch {
    return '읽을 수 없는 저장';
  }
}
