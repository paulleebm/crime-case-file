import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { aiProxy } from './dev/aiProxy';

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), aiProxy()],
  // App Check 디버그 토큰은 개발 서버에서만 넣는다. 배포 번들에는 빈 문자열이 들어간다.
  // (VITE_ 변수로 두면 import.meta.env 객체째 번들에 실려 토큰이 공개된다)
  define: { __APPCHECK_DEBUG_TOKEN__: JSON.stringify(command === 'serve' ? loadEnv(mode, process.cwd(), '').APPCHECK_DEBUG_TOKEN ?? '' : '') },
  server: { port: Number(process.env.PORT) || 5173, strictPort: false },
  // Firebase 모듈은 동적 import라 개발 서버가 따로따로 사전 번들링하면
  // @firebase/app이 두 벌 생겨 App Check와 AI Logic이 서로를 못 찾는다. 처음부터 함께 묶는다.
  optimizeDeps: { include: ['firebase/app', 'firebase/ai', 'firebase/app-check', 'firebase/auth'] },
}));
