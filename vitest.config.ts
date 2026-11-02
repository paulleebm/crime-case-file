/// <reference types="vitest/config" />
// 스토리북 이야기를 브라우저에서 테스트할 때만 쓴다 (npm run test-storybook).
// 게임 로직 테스트는 tests/*.test.ts (npm test, node:test)로 따로 돈다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: { __APPCHECK_DEBUG_TOKEN__: '""' },
  test: {
    projects: [{
      extends: true,
      plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
      test: { name: 'storybook', browser: { enabled: true, headless: true, provider: playwright({}), instances: [{ browser: 'chromium' }] } },
    }],
  },
});
