import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import '../src/styles.css';
import { GameProvider, newGame, useGame, type GameState } from '../src/engine/state';
import { PencilDefs } from '../src/sketch/components';

/** 이야기마다 원하는 게임 상태를 넣어 둔다 (parameters.game: 새 게임 상태를 고치는 함수) */
function GameSetup({ setup, children }: { setup?: (s: GameState) => GameState; children: React.ReactNode }) {
  const { dispatch } = useGame();
  const [ready, setReady] = useState(!setup);
  useEffect(() => {
    if (setup) { dispatch({ type: 'load', state: setup({ ...newGame(), screen: 'hub' }) }); setReady(true); }
  }, [dispatch, setup]);
  return ready ? <>{children}</> : null;
}

const withGame: Decorator = (Story, ctx) => (
  <GameProvider>
    <PencilDefs />
    <GameSetup setup={ctx.parameters.game}>
      <div style={{ padding: 16, background: 'var(--paper) var(--noise)', minHeight: '100%' }}>
        <Story />
      </div>
    </GameSetup>
  </GameProvider>
);

const preview: Preview = {
  decorators: [withGame],
  parameters: {
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'todo' },
  },
};

export default preview;
