'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { bridge, call } from '@/lib/bridge';
import { AgentsIcon, ArtifactsIcon, ConnectionsIcon, PanelIcon, RunsIcon, SettingsIcon, TicketsIcon, VpnIcon, WorkflowIcon } from './icons';
import { TerminalDock } from './TerminalDock';
import { requestDock } from '@/lib/terminal-dock';

type Item = { href: string; label: string; icon: ComponentType<{ size?: number }> };

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: 'Work',
    items: [
      { href: '/tasks', label: 'Tasks', icon: RunsIcon },
      { href: '/workflow', label: 'Workflow', icon: WorkflowIcon },
      { href: '/artifacts', label: 'Artifacts', icon: ArtifactsIcon },
      { href: '/tickets', label: 'Tickets', icon: TicketsIcon },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/agents', label: 'Agents & skills', icon: AgentsIcon },
      { href: '/', label: 'Connections', icon: ConnectionsIcon },
    ],
  },
];
const BOTTOM: Item = { href: '/settings', label: 'Settings', icon: SettingsIcon };
const ALL = [...GROUPS.flatMap((g) => g.items), BOTTOM];

type Tone = 'ok' | 'warn' | 'bad' | undefined;

/** The top bar's three readiness chips, checked every 30s; each opens Connections. */
function useReadiness() {
  const [vpn, setVpn] = useState<Tone>(undefined);
  const [github, setGithub] = useState<Tone>(undefined);
  const [claude, setClaude] = useState<Tone>(undefined);
  useEffect(() => {
    let live = true;
    const check = async () => {
      const v = await call('vpnStatus').catch(() => null);
      if (!live) return;
      setVpn(!v ? 'bad' : v.github ? 'ok' : v.tunnel ? 'warn' : 'bad');
      const g = v?.github ? await call('githubState').catch(() => null) : null;
      if (live) setGithub(!v?.github ? undefined : g?.signedIn ? 'ok' : 'warn');
      const c = await call('claudeAccount').catch(() => null);
      if (live) setClaude(!c ? 'bad' : c.ok ? 'ok' : c.loggedIn ? 'bad' : 'warn');
    };
    void check();
    const t = setInterval(() => void check(), 30000);
    // The VPN script finishing (terminal panel) is the moment to look again.
    const off = bridge().onTerminal((ev) => {
      if (ev.kind === 'exit') void check();
    });
    return () => {
      live = false;
      clearInterval(t);
      off();
    };
  }, []);
  return { vpn, github, claude };
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname().replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const here = ALL.find((i) => i.href === path);
  const ready = useReadiness();
  const [version, setVersion] = useState('');

  useEffect(() => {
    call('appInfo').then((i) => setVersion(i.version)).catch(() => {});
  }, []);

  const navItem = (i: Item) => (
    <Link key={i.href} href={i.href} className="aw-nav-item" aria-current={path === i.href ? 'page' : undefined}>
      <i.icon size={17} />
      {i.label}
    </Link>
  );

  return (
    <div className="aw-root">
      <header className="aw-topbar">
        <span className="aw-topbar-title">{here?.label ?? ''}</span>
        <span className="aw-topbar-spacer" />
        {(
          [
            ['VPN', ready.vpn],
            ['GitHub', ready.github],
            ['Claude', ready.claude],
          ] as const
        ).map(([label, tone]) => (
          <Link key={label} href="/" className="aw-chip" data-tone={tone} title={`${label} — see Connections`}>
            <span className="aw-chip-dot" />
            {label}
          </Link>
        ))}
        {ready.vpn !== 'ok' && ready.vpn !== undefined && (
          <button type="button" className="aw-btn aw-topbar-btn" data-primary onClick={() => requestDock({ action: 'open', start: 'vpn' })}>
            <VpnIcon size={14} /> Connect VPN
          </button>
        )}
        <button
          type="button"
          className="aw-topbar-icon"
          onClick={() => requestDock({ action: 'toggle' })}
          title="Terminal (Ctrl+`)"
          aria-label="Show or hide the terminal"
        >
          <PanelIcon size={16} />
        </button>
      </header>
      <div className="aw-body">
        <aside className="aw-sidebar">
          <div className="aw-sidebar-header">
            <span className="aw-logo" aria-hidden="true">FJ</span>
            <span className="aw-brand">FJ AI WORKER</span>
          </div>
          <nav className="aw-nav-scroll">
            {GROUPS.map((g) => (
              <div key={g.label} className="aw-nav-group">
                <div className="aw-nav-label">{g.label}</div>
                {g.items.map(navItem)}
              </div>
            ))}
          </nav>
          <div className="aw-sidebar-bottom">
            <div className="aw-nav-group">{navItem(BOTTOM)}</div>
            {version && <div className="aw-version">v{version}</div>}
          </div>
        </aside>
        <div className="aw-main-col">
          <main className="aw-content">{children}</main>
          <TerminalDock />
        </div>
      </div>
    </div>
  );
}
