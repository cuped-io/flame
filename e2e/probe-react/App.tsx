import { useState } from 'react';

// A React page the script tag runs on (flame#39). The headline is React-owned
// markup that exp_script_tag's text change targets (#target-text).
export function App() {
  const [count, setCount] = useState(0);
  const [view, setView] = useState<'home' | 'other'>('home');
  const [title, setTitle] = useState('Original headline');

  return (
    <main>
      {view === 'home' ? (
        <section>
          <h1 id="target-text">{title}</h1>
          <div id="target-html">Original markup</div>
        </section>
      ) : (
        <section id="other-view">Another page</section>
      )}
      <p id="count">Clicks: {count}</p>
      <button id="rerender" onClick={() => setCount((c) => c + 1)}>
        Unrelated re-render
      </button>
      <button id="same-title" onClick={() => setTitle('Original headline')}>
        Re-render headline (same value)
      </button>
      <button id="navigate" onClick={() => setView((v) => (v === 'home' ? 'other' : 'home'))}>
        Client-side navigate
      </button>
    </main>
  );
}
