/**
 * The consent rules (flame#18; design revised 2026-10-11, on the issue).
 *
 * Before consent flame does nothing: no ID, no storage, no network. Browser
 * privacy signals (GPC, Do Not Track) keep flame off. The visitor's choice
 * is stored under `flame_consent` once made, so a consenting visitor's later
 * pages start with no swap and a refusal sticks on later pages.
 */

/** Where flame stands on the visitor's consent. */
export type ConsentState =
  /** `requireConsent` is off and nothing withholds it: flame runs as before. */
  | 'not_required'
  /** `requireConsent` is on and the visitor has not chosen yet. */
  | 'pending'
  | 'granted'
  | 'denied'
  /** A browser privacy signal (GPC or Do Not Track) keeps flame off. */
  | 'blocked_by_signal';

export type PrivacySignal = 'Global Privacy Control' | 'Do Not Track';

/**
 * Counsel-gated: whether a browser privacy signal beats a site's explicit
 * consent(true). Built "signal wins", the safer default, since GPC is a
 * legally binding opt-out in some US states.
 */
export const SIGNAL_OVERRIDES_CONSENT = true;

const CONSENT_KEY = 'flame_consent';

/** The privacy signal the visitor's browser sends, if any. */
export function privacySignal(): PrivacySignal | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl === true) return 'Global Privacy Control';
  if (nav.doNotTrack === '1') return 'Do Not Track';
  return null;
}

function readStoredConsent(): 'granted' | 'denied' | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function storeConsent(choice: 'granted' | 'denied'): void {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // No storage: the choice lasts for this page only.
  }
}

/**
 * The state at init. A signal keeps flame off whatever the posture; a saved
 * choice stands next (a refusal must stick even where consent is not
 * required); otherwise the posture decides.
 */
export function initialConsentState(requireConsent: boolean): ConsentState {
  if (privacySignal()) return 'blocked_by_signal';
  const stored = readStoredConsent();
  if (stored) return stored;
  return requireConsent ? 'pending' : 'not_required';
}

/** Whether flame may store, assign and track in this state. */
export function consentAllowsRunning(state: ConsentState): boolean {
  return state === 'granted' || state === 'not_required';
}
