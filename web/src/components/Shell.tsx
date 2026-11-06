'use client';

import { useEffect, type ReactNode } from 'react';
import { call } from '@/lib/bridge';
import { Sidebar } from './Sidebar';
import { TerminalDock } from './TerminalDock';
import { TopBar } from './TopBar';

/**
 * AI Office's shell ((shell)/layout.tsx): the top bar over the sidebar and the
 * page. Under the page, the terminal panel (TerminalDock), as in VS Code.
 */
export function Shell({ children }: { children: ReactNode }) {
  // Only macOS draws its window buttons over the top bar (shell.css reads it).
  useEffect(() => {
    call('appInfo')
      .then((i) => (document.documentElement.dataset.platform = i.platform))
      .catch(() => {});
  }, []);

  return (
    <div className="ao-shell-root">
      <TopBar />
      <div className="ao-shell-body">
        <Sidebar />
        <div className="ao-content ao-content-stack">
          <div className="ao-page">{children}</div>
          <TerminalDock />
        </div>
      </div>
    </div>
  );
}
