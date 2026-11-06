'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { bridge, call } from '@/lib/bridge';
import { openTask } from '@/lib/open';
import { requestDock } from '@/lib/terminal-dock';
import { ClaudeIcon, DockIcon, GithubIcon, PlusIcon, SearchIcon, VpnIcon } from './icons';
import { SearchDialog } from './SearchDialog';

type Tone = 'ok' | 'warn' | 'bad' | undefined;
type Part = { tone: Tone; state: string; detail: string | null };
type Readiness = { vpn: Part; github: Part; claude: Part; checkedAt: Date | null; check: () => void };

const CHECKING: Part = { tone: undefined, state: 'Checking…', detail: null };

/** Where the VPN, GitHub and Claude stand — checked every 30s, when a terminal (the VPN script) ends, and on demand. */
function useReadiness(): Readiness {
  const [vpn, setVpn] = useState<Part>(CHECKING);
  const [github, setGithub] = useState<Part>(CHECKING);
  const [claude, setClaude] = useState<Part>(CHECKING);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const check = async () => {
      const [v, s] = await Promise.all([call('vpnStatus').catch(() => null), call('getSettings').catch(() => null)]);
      if (!live) return;
      const where = s ? `${s.proxy.host}:${s.proxy.port}` : 'the tunnel';
      setVpn(
        !v
          ? { tone: 'bad', state: 'Couldn’t check', detail: null }
          : v.github
            ? { tone: 'ok', state: 'Connected', detail: `Tunnel on ${where}, GitHub answering through it` }
            : v.tunnel
              ? { tone: 'warn', state: 'Tunnel open, GitHub not answering', detail: v.error ?? null }
              : { tone: 'bad', state: 'Not connected', detail: `Nothing on ${where} — run the VPN script` },
      );
      const g = v?.github ? await call('githubState').catch(() => null) : null;
      if (live)
        setGithub(
          !v?.github
            ? { tone: undefined, state: 'Waiting for the VPN', detail: null }
            : g?.signedIn
              ? { tone: 'ok', state: 'Signed in', detail: `@${g.user.login}${g.scopes.length ? ` · ${g.scopes.join(', ')}` : ''}` }
              : { tone: 'warn', state: 'Not signed in', detail: 'Sign in under Connections' },
        );
      const c = await call('claudeAccount').catch(() => null);
      if (live)
        setClaude(
          !c
            ? { tone: 'bad', state: 'Couldn’t check', detail: null }
            : c.ok
              ? { tone: 'ok', state: 'Signed in', detail: [c.email, c.orgName].filter(Boolean).join(' · ') || null }
              : c.loggedIn
                ? { tone: 'bad', state: 'Wrong account', detail: `${c.email} — not ${c.expectedEmail}` }
                : { tone: 'warn', state: 'Not signed in', detail: 'Sign in under Connections' },
        );
      if (live) setCheckedAt(new Date());
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
  }, [n]);
  return { vpn, github, claude, checkedAt, check: () => setN((x) => x + 1) };
}

const PARTS = [
  { key: 'vpn', label: 'VPN', icon: VpnIcon },
  { key: 'github', label: 'GitHub', icon: GithubIcon },
  { key: 'claude', label: 'Claude', icon: ClaudeIcon },
] as const;

/**
 * One pill for the three: green when all are ready, else what isn't. It
 * opens the whole picture — each one's state and detail — with what to do.
 */
function ReadinessPill({ ready }: { ready: Readiness }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const parts = PARTS.map((p) => ({ ...p, part: ready[p.key] }));
  const tones = parts.map((p) => p.part.tone);
  const checking = tones.every((t) => t === undefined) && !ready.checkedAt;
  const notOk = parts.filter((p) => p.part.tone !== 'ok' && !(p.key === 'github' && ready.vpn.tone !== 'ok'));
  const tone: Tone = checking ? undefined : tones.includes('bad') ? 'bad' : notOk.length ? 'warn' : 'ok';
  const label = checking ? 'Checking…' : notOk.length === 0 ? 'All connected' : ready.vpn.tone !== 'ok' ? 'VPN not connected' : `${notOk.map((p) => p.label).join(', ')} not ready`;

  return (
    <div className="ao-ready" ref={root}>
      <button type="button" className="ao-status-pill ao-ready-pill" data-tone={tone} onClick={() => setOpen((v) => !v)} aria-expanded={open} title="VPN, GitHub and Claude">
        <span className="ao-ready-dot" data-tone={tone} />
        {label}
      </button>
      {open && (
        <div className="ao-pipe-menu ao-ready-menu" role="dialog" aria-label="Connections">
          <p className="ao-ready-title">Connections</p>
          <ul className="ao-ready-list">
            {parts.map(({ key, label: name, icon: Icon, part }) => (
              <li key={key}>
                <span className="ao-ready-icon">
                  <Icon size={15} />
                </span>
                <span className="ao-ready-text">
                  <span className="ao-ready-name">
                    {name}
                    <span className="ao-ready-state" data-tone={part.tone}>
                      <span className="ao-ready-dot" data-tone={part.tone} />
                      {part.state}
                    </span>
                  </span>
                  {part.detail && <span className="ao-ready-detail">{part.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="ao-ready-actions">
            {ready.vpn.tone !== 'ok' && (
              <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => (requestDock({ action: 'open', start: 'vpn' }), setOpen(false))}>
                <VpnIcon size={13} /> Connect VPN
              </button>
            )}
            <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={ready.check}>Check again</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => (router.push('/'), setOpen(false))}>Open Connections</button>
          </div>
          {ready.checkedAt && <p className="ao-ready-when">Checked {ready.checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}
        </div>
      )}
    </div>
  );
}

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
        <ReadinessPill ready={ready} />
        {ready.vpn.tone !== 'ok' && ready.vpn.tone !== undefined && (
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
