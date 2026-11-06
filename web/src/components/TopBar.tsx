'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { bridge, call } from '@/lib/bridge';
import { openTask } from '@/lib/open';
import { requestDock } from '@/lib/terminal-dock';
import { DockIcon, PlusIcon, SearchIcon, VpnIcon } from './icons';
import { SearchDialog } from './SearchDialog';

type Tone = 'ok' | 'warn' | 'bad' | undefined;

/** The top bar's three readiness pills, checked every 30s; each opens Connections. */
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

const TONE_TEXT: Record<NonNullable<Tone>, string> = { ok: 'ready', warn: 'needs attention', bad: 'not ready' };

/**
 * AI Office's top bar (components/TopBar.tsx): the left slot left empty for
 * the macOS window buttons; in the centre the search (⌘K) and New task; on the
 * right where things stand — the VPN, GitHub and Claude — and the terminal.
 */
export function TopBar() {
  const router = useRouter();
  const ready = useReadiness();
  const [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mac, setMac] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the platform, known only in the browser
    setMac(/Mac/.test(navigator.platform));
    const onDown = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, []);

  // A blank draft: where it works, its agent and the first message are picked in its own conversation.
  const newTask = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const settings = await call('getSettings');
      const t = await call('runsCreate', { ticket: { key: '', title: '', description: '', url: null }, agent: settings.defaultAgent, draft: true });
      openTask(t.id, router);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="ao-topbar">
      {/* Left slot stays empty: on macOS the window's traffic lights sit here. */}
      <span />

      <div className="ao-command-group">
        <button type="button" className="ao-command" onClick={() => setSearchOpen(true)} aria-label="Search tasks and pages">
          <SearchIcon size={15} />
          <span className="ao-command-placeholder">Search tasks…</span>
          <kbd className="ao-kbd" suppressHydrationWarning>
            {mac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
        <button type="button" className="ao-btn-primary ao-btn-compact ao-btn-brand" onClick={() => void newTask()} disabled={busy} title={error ?? 'A new blank task'}>
          <PlusIcon size={14} />
          <span>New task</span>
        </button>
      </div>

      <div className="ao-topbar-status">
        {error && <span className="ao-topbar-error" title={error}>Couldn’t create the task</span>}
        {(
          [
            ['VPN', ready.vpn],
            ['GitHub', ready.github],
            ['Claude', ready.claude],
          ] as const
        ).map(([label, tone]) => (
          <Link key={label} href="/" className="ao-status-pill ao-ready-pill" title={`${label} ${tone ? TONE_TEXT[tone] : '— checking'} · Connections`}>
            <span className="ao-ready-dot" data-tone={tone} />
            {label}
          </Link>
        ))}
        {ready.vpn !== 'ok' && ready.vpn !== undefined && (
          <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => requestDock({ action: 'open', start: 'vpn' })}>
            <VpnIcon size={14} /> Connect VPN
          </button>
        )}
        <button
          type="button"
          className="ao-icon-btn ao-topbar-icon"
          onClick={() => requestDock({ action: 'toggle' })}
          title="Terminal (Ctrl+`)"
          aria-label="Show or hide the terminal"
        >
          <DockIcon size={16} />
        </button>
      </div>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
