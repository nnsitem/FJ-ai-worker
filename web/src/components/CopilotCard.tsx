'use client';

import { useCallback, useEffect, useState } from 'react';
import { CopilotIcon } from './icons';
import { LinkOpener } from './LinkOpener';
import { bridge, call, type CopilotAccount, type Settings } from '@/lib/bridge';

const HOSTS = ['*.githubcopilot.com'];

/**
 * GitHub Copilot, the second engine a task can run on — its own sign-in
 * (core/src/copilot.ts), apart from any Copilot on this machine: Copilot's
 * browser sign-in (a link to open in the company's browser), or a
 * fine-grained token with Copilot access pasted in.
 */
export function CopilotCard() {
  const [account, setAccount] = useState<CopilotAccount | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await call('getSettings'));
      setAccount(await call('copilotAccount'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once on opening
    void load();
  }, [load]);

  useEffect(
    () =>
      bridge().onCopilotLogin((ev) => {
        setLink(null);
        setBusy(false);
        if (ev.kind === 'done') {
          setAccount(ev.account);
          if (!ev.account.loggedIn && ev.account.message) setError(ev.account.message);
        } else setError(ev.message);
      }),
    [],
  );

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await call('copilotLogin'));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const cancel = async () => {
    await call('copilotCancelLogin').catch(() => {});
    setLink(null);
    setBusy(false);
  };

  const run = async (fn: () => Promise<CopilotAccount>) => {
    setBusy(true);
    setError(null);
    try {
      const a = await fn();
      setAccount(a);
      if (!a.loggedIn && a.message) setError(a.message);
      setToken('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const viaVpn = !!settings && HOSTS.every((h) => settings.proxy.hosts.includes(h));
  const setViaVpn = async (on: boolean) => {
    if (!settings) return;
    const hosts = on ? [...new Set([...settings.proxy.hosts, ...HOSTS])] : settings.proxy.hosts.filter((h) => !HOSTS.includes(h));
    setSettings(await call('saveSettings', { proxy: { hosts } }));
    // The runtime takes its routing when it starts: the next call starts it again with the new one.
    await run(() => call('copilotAccount'));
  };

  const tone = !account ? undefined : account.loggedIn ? 'ok' : 'warn';
  const label = !account ? 'Checking…' : account.loggedIn ? 'Signed in' : 'Not signed in';

  return (
    <section className="ao-status-card ao-conn-card">
      <h3>
        <span className="ao-conn-icon"><CopilotIcon size={17} /></span>
        GitHub Copilot
        <span className="ao-badge" data-tone={tone}>{label}</span>
      </h3>
      <p>
        A second AI for tasks: pick Claude or Copilot under a task&apos;s message box. Copilot gets the same rules — files only in the task&apos;s folder, no commits or pushes — and the same workflow.
      </p>
      {account?.loggedIn && (
        <div className="ao-who">
          <div>
            <strong>{account.login ? `@${account.login}` : 'Signed in'}</strong>
            <span className="ao-soft">{account.how === 'token' || account.how === 'env' ? 'With a token' : account.how ?? ''}</span>
          </div>
        </div>
      )}
      {link && (
        <div className="ao-task-panel-field">
          <p className="ao-soft ao-small-note">Open this link, sign in with the company&apos;s GitHub account and authorise Copilot — this card updates by itself.</p>
          <LinkOpener url={link} />
        </div>
      )}
      {!account?.loggedIn && !link && tokenOpen && (
        <>
          <label className="ao-task-panel-field">
            <span className="ao-task-panel-label">Token with Copilot access</span>
            <input className="ao-task-input ao-mono-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_… (fine-grained, Copilot Requests permission)" />
          </label>
          <p className="ao-soft ao-small-note">
            On GitHub: Settings › Developer settings › Fine-grained tokens › Generate — under Account permissions give <b>Copilot Requests</b> read access. Classic tokens (ghp_…) are refused by Copilot.
          </p>
        </>
      )}
      <label className="ao-pipe-check">
        <input type="checkbox" checked={viaVpn} disabled={!settings || busy} onChange={(e) => void setViaVpn(e.target.checked)} />
        <span>
          Through the VPN
          <small>For an organisation that only lets its own network use Copilot.</small>
        </span>
      </label>
      <div className="ao-status-actions">
        {account?.loggedIn ? (
          <button type="button" className="ao-btn-secondary" disabled={busy} onClick={() => void run(() => call('copilotSignOut'))}>
            Sign out
          </button>
        ) : link ? (
          <button type="button" className="ao-btn-secondary" onClick={() => void cancel()}>
            Cancel sign-in
          </button>
        ) : tokenOpen ? (
          <>
            <button type="button" className="ao-btn-primary" disabled={busy || !token.trim()} onClick={() => void run(() => call('copilotSetToken', token))}>
              {busy ? 'Checking…' : 'Use this token'}
            </button>
            <button type="button" className="ao-btn-secondary" disabled={busy} onClick={() => setTokenOpen(false)}>
              Back
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ao-btn-primary" disabled={busy} onClick={() => void signIn()}>
              {busy ? 'Starting…' : 'Sign in to Copilot'}
            </button>
            <button type="button" className="ao-btn-secondary" disabled={busy} onClick={() => setTokenOpen(true)}>
              Use a token instead
            </button>
          </>
        )}
        <button type="button" className="ao-btn-secondary" disabled={busy} onClick={() => void load()}>
          Check again
        </button>
      </div>
      {error && <p className="ao-task-panel-error">{error}</p>}
    </section>
  );
}
