import { cookies } from 'next/headers';
import { readPrehydratedForServerComponent } from '@cuped-io/flame-edge/next';
import { Providers } from './providers';
import './globals.css';

export const metadata = {
  title: 'cuped.io zero-flash SSR demo',
  description: 'Next.js example app exercising @cuped-io/flame-edge + @cuped-io/flame-react.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the cookie set by middleware (it puts a newly signed one on
  // this request too). With no valid cookie, or before this runtime has
  // its rules copy, this returns null and the browser picks.
  const prehydrated = await readPrehydratedForServerComponent(await cookies(), {
    dsn: process.env.CUPED_DSN!,
    secret: process.env.CUPED_COOKIE_SECRET!,
  });

  return (
    <html lang="en">
      <body>
        <Providers prehydrated={prehydrated ?? undefined}>{children}</Providers>
      </body>
    </html>
  );
}
