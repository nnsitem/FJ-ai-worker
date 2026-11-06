import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Shell } from '@/components/Shell';
import './globals.css';

// LINE Seed Sans TH (SIL OFL 1.1, fonts/line-seed/OFL.txt): Thai and Latin,
// bundled so nothing is fetched.
const lineSeed = localFont({
  src: [
    { path: './fonts/line-seed/LINESeedSansTH_W_Rg.woff2', weight: '400', style: 'normal' },
    { path: './fonts/line-seed/LINESeedSansTH_W_Bd.woff2', weight: '700', style: 'normal' },
    { path: './fonts/line-seed/LINESeedSansTH_W_XBd.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-line-seed',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AI Worker',
  description: 'Jira tickets fixed by Claude Code, through to a GitHub pull request.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lineSeed.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
