import { useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import { firebaseConfig } from '../firebaseConfig';

// Google 로그인과 이용권 상태. 화면 어디서나 useAccount()로 읽는다.
// 이용권 판정은 서버(/api/me)가 한다. 브라우저는 그 결과를 보여 주기만 한다.

/**
 * 결제·로그인을 켤지. 지금은 로컬 개발 서버에서만 켠다 (배포 서버에는 결제 API가 아직 없다).
 * 배포용 결제 서버를 붙인 뒤에 배포에서도 켠다.
 */
export const PAYWALL_ON: boolean = !!import.meta.env?.DEV;

export interface Access { email: string; admin: boolean; free: boolean; paid: boolean; full: boolean; price: number }

export type AccountState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: { uid: string; email: string; name: string; photo?: string }; access: Access | null; error?: string };

let state: AccountState = { status: 'loading' };
const listeners = new Set<() => void>();
function set(s: AccountState) { state = s; for (const f of listeners) f(); }

let current: User | null = null;
let authMod: Promise<{ auth: import('firebase/auth').Auth; mod: typeof import('firebase/auth') }> | null = null;

async function authBackend() {
  authMod ??= (async () => {
    const { getApp, getApps, initializeApp } = await import('firebase/app');
    const mod = await import('firebase/auth');
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = mod.getAuth(app);
    mod.onAuthStateChanged(auth, (u) => {
      current = u;
      if (!u) { set({ status: 'signed-out' }); return; }
      set({ status: 'signed-in', user: userOf(u), access: null });
      void refreshAccess();
    });
    return { auth, mod };
  })();
  return authMod;
}

const userOf = (u: User) => ({ uid: u.uid, email: u.email ?? '', name: u.displayName ?? u.email ?? '', photo: u.photoURL ?? undefined });

/** 로그인했으면 'Bearer <ID 토큰>', 아니면 null. 로그인 확인이 끝나기 전이면 끝날 때까지 기다린다 */
export async function authHeader(): Promise<string | null> {
  if (typeof window === 'undefined' || !PAYWALL_ON) return null;
  const { auth } = await authBackend();
  await auth.authStateReady();
  const u = auth.currentUser;
  return u ? `Bearer ${await u.getIdToken()}` : null;
}

/** 로그인이 필요한 API 호출 */
export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const auth = await authHeader();
  const r = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const j = await r.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!r.ok) throw Object.assign(new Error(j.message ?? j.error ?? `HTTP ${r.status}`), { code: j.error, status: r.status });
  return j;
}

export async function refreshAccess() {
  if (!current) return;
  const uid = current.uid;
  try {
    const access = await api<Access>('/api/me');
    if (current?.uid === uid) set({ status: 'signed-in', user: userOf(current), access });
  } catch (e) {
    if (current?.uid === uid) set({ status: 'signed-in', user: userOf(current), access: null, error: (e as Error).message });
  }
}

export async function signInWithGoogle() {
  const { auth, mod } = await authBackend();
  const provider = new mod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await mod.signInWithPopup(auth, provider);
}

export async function signOutAccount() {
  const { auth, mod } = await authBackend();
  await mod.signOut(auth);
}

function subscribe(f: () => void) {
  listeners.add(f);
  void authBackend();
  return () => { listeners.delete(f); };
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
