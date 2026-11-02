import { useGame } from '../engine/state';
import { Box } from '../sketch/components';

export function Toast() {
  const { state } = useGame();
  if (!state.toast) return null;
  return (
    <Box key={state.toast.id} mode="double" className="toast" seed={String(state.toast.id)}>
      {state.toast.text}
    </Box>
  );
}
