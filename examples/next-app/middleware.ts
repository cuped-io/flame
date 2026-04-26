import { createCupedMiddleware } from '@cuped-io/flame-edge/next';

/**
 * Edge middleware that resolves the user's experiment assignments
 * before the page renders, signs them into a cookie, and writes
 * Set-Cookie. Server components later read the same cookie to seed
 * `<CupedProvider prehydrated={...}>`.
 *
 * The two env vars must be set:
 *   - CUPED_DSN              — your project DSN (server-side only)
 *   - CUPED_COOKIE_SECRET    — long random string for HMAC signing
 *
 * See README.md for full setup.
 */
export default createCupedMiddleware({
  dsn: process.env.CUPED_DSN!,
  secret: process.env.CUPED_COOKIE_SECRET!,
});

export const config = {
  // Skip static assets, API routes, and Next internals.
  matcher: ['/((?!_next/static|_next/image|api/|favicon.ico).*)'],
};
