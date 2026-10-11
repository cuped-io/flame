import { hydrateRoot } from 'react-dom/client';
import { App } from './App';

// ?hydrateDelay=ms holds hydration back, so flame applies BEFORE React takes
// over (the other order from the default, where React usually wins the race
// against flame's network round trip).
const delay = Number(new URLSearchParams(location.search).get('hydrateDelay') ?? 0);
setTimeout(() => {
  hydrateRoot(document.getElementById('root')!, <App />, {
    onRecoverableError: (error) => {
      (window as unknown as { __hydrationErrors: string[] }).__hydrationErrors.push(String(error));
    },
  });
  (window as unknown as { __hydrated: boolean }).__hydrated = true;
}, delay);
