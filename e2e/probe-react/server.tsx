import { renderToString } from 'react-dom/server';
import { App } from './App';

// One bundle for the app and the renderer, so both use one copy of React.
export function render(): string {
  return renderToString(<App />);
}
