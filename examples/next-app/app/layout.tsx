import { cookies } from 'next/headers';
import { readPrehydratedForServerComponent } from '@cuped-io/flame-edge/next';
import { Providers } from './providers';
import './globals.css';

export const metadata = {
  title: 'cuped.io zero-flash SSR demo',
  description: 'Next.js example app exercising @cuped-io/flame-edge + @cuped-io/flame-react.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the cookie set by middleware. If it's missing or invalid
  // (first visit, expired, tampered), this returns null and the
  // provider falls back to client-side init.
  const prehydrated = await readPrehydratedForServerComponent(
    await cookies(),
    process.env.CUPED_COOKIE_SECRET!
  );

  return (
    <html lang="en">
      <body>
        <Providers prehydrated={prehydrated ?? undefined}>{children}</Providers>
      </body>
    </html>
  );
}
