'use client';

import { useExperiment, Experiment, useObserve } from '@cuped-io/flame-react';

const EXPERIMENT_ID = process.env.NEXT_PUBLIC_CUPED_EXPERIMENT_ID ?? '';

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '4rem 1.5rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>cuped.io zero-flash SSR demo</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Open the browser DevTools and view the page source — the variant rendered server-side
        should match what's painted on screen, with no flash of the control between them.
      </p>

      <Section title="useExperiment hook">
        <HookExample />
      </Section>

      <Section title="<Experiment> component (declarative)">
        <ComponentExample />
      </Section>

      <Section title="useObserve">
        <ObserveExample />
      </Section>

      <Diagnostics />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2
        style={{
          fontSize: '0.85rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#888',
          marginBottom: '0.75rem',
        }}
      >
        {title}
      </h2>
      <div
        style={{
          padding: '1.25rem',
          background: '#f6f7f9',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
        }}
      >
        {children}
      </div>
    </section>
  );
}

function HookExample() {
  const { variant, isLoading } = useExperiment(EXPERIMENT_ID);
  if (!EXPERIMENT_ID) return <NoExperimentWarning />;
  if (isLoading) return <span style={{ color: '#888' }}>Loading…</span>;
  if (!variant) return <span style={{ color: '#888' }}>No assignment</span>;
  return (
    <div>
      <p style={{ margin: 0 }}>
        Assigned variant: <strong>{variant.name}</strong>{' '}
        <span style={{ color: '#888' }}>({variant.id})</span>
      </p>
      <p style={{ margin: '0.5rem 0 0', color: '#888' }}>
        is_control: <code>{String(variant.is_control)}</code>
      </p>
    </div>
  );
}

function ComponentExample() {
  if (!EXPERIMENT_ID) return <NoExperimentWarning />;
  return (
    <Experiment
      id={EXPERIMENT_ID}
      variants={{
        control: <Pill color="#2563eb" label="control branch (blue)" />,
        treatment: <Pill color="#10b981" label="treatment branch (green)" />,
      }}
      fallback={<Pill color="#9ca3af" label="loading…" />}
    />
  );
}

function ObserveExample() {
  const observe = useObserve();
  return (
    <button
      onClick={() => {
        observe('demo_button_clicked', { source: 'next-example' });
        // eslint-disable-next-line no-alert
        alert('observation queued — check the network tab for /observations');
      }}
      style={{
        padding: '0.5rem 1rem',
        background: '#0f172a',
        color: 'white',
        border: 0,
        borderRadius: '0.375rem',
        cursor: 'pointer',
      }}
    >
      Fire observation
    </button>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.5rem 1rem',
        background: color,
        color: 'white',
        borderRadius: '999px',
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function NoExperimentWarning() {
  return (
    <p style={{ color: '#b45309', margin: 0 }}>
      Set <code>NEXT_PUBLIC_CUPED_EXPERIMENT_ID</code> in <code>.env.local</code> to point at a
      running experiment in your project.
    </p>
  );
}

function Diagnostics() {
  return (
    <details style={{ marginTop: '3rem', color: '#666' }}>
      <summary style={{ cursor: 'pointer' }}>What to verify</summary>
      <ol style={{ marginTop: '1rem', lineHeight: 1.7 }}>
        <li>
          <strong>View page source</strong> (Ctrl+U / ⌘+U). The HTML returned by the server should
          contain the assigned variant's text/markup — not a generic placeholder. That's the proof
          that SSR resolution worked.
        </li>
        <li>
          <strong>Check the cookie.</strong> Application tab → Cookies →{' '}
          <code>cuped_state</code>. Long base64url-encoded value, signed with HMAC-SHA256.
        </li>
        <li>
          <strong>Reload.</strong> Network tab should not show an{' '}
          <code>/experiments/active</code> or <code>/assign</code> call from the middleware on
          repeat visits — the cookie short-circuits cold resolution.
        </li>
        <li>
          <strong>Tamper with the cookie.</strong> Edit a single character in the value. Reload —
          middleware should re-resolve and write a fresh cookie. Page renders correctly.
        </li>
      </ol>
    </details>
  );
}
