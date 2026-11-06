'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/tickets', label: 'Tickets' },
  { href: '/', label: 'Connections' },
  { href: '/settings', label: 'Settings' },
];

/** Sidebar and page frame. Runs join the nav in M3–M5. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname().replace(/\.html$/, '').replace(/\/$/, '') || '/';
  return (
    <div className="aw-shell">
      <aside className="aw-side">
        <div className="aw-brand">
          <span className="aw-brand-tile" aria-hidden="true">W</span>
          <span>AI Worker</span>
        </div>
        <nav className="aw-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="aw-nav-item" aria-current={path === n.href ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="aw-main">{children}</main>
    </div>
  );
}
