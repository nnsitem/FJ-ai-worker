import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Shell } from '@/components/Shell';
import { ScrollbarOverlay } from '@/components/ScrollbarOverlay';
import { THEME_BOOT } from '@/lib/theme';
// AI Office's design system, in its own order: tokens, the shell, the boards,
// then each page's sheet. FJ AI Worker's own pieces come last (worker.css).
import './globals.css';
import './styles/shell.css';
import './styles/board.css';
import './styles/team.css';
import './styles/agents-board.css';
import './styles/artifacts.css';
import './styles/agents.css';
import './styles/worker.css';

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
  title: 'FJ AI Worker',
  description: 'Jira tickets fixed by Claude Code, through to a GitHub pull request.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lineSeed.variable} suppressHydrationWarning>
      <head>
        {/* Light or dark before the first paint — lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Shell>{children}</Shell>
        <ScrollbarOverlay />
      </body>
    </html>
  );
}
