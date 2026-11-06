'use client';

import { useCallback, useEffect, useState } from 'react';
import { LinkOpener } from './LinkOpener';
import { ClaudeIcon } from './icons';
import { bridge, call, type ClaudeAccount } from '@/lib/bridge';

/**
 * The company's Claude account, kept apart from the person's own Claude Code
 * (its own config folder — core/src/claude-account.ts). Sign-in opens in a
 * private window of the app's; or, if Google won't sign in there, the link
 * goes to any browser and the code it ends on is pasted back.
 */
export function ClaudeCard() {
  const [account, setAccount] = useState<ClaudeAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Sign-in under way: its link, and whether the code is pasted by hand. */
  const [pending, setPending] = useState<{ url: string; manual: boolean } | null>(null);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    try {
      setAccount(await call('claudeAccount'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once on opening
    void load();
    return bridge().onClaudeLogin((ev) => {
      setBusy(false);
      if (ev.kind === 'done') {
        setAccount(ev.account);
        setPending(null);
      } else if (ev.kind === 'error') setError(ev.error);
      // Closed without finishing: the sign-in stays open for a pasted code.
      else setPending((p) => (p ? { ...p, manual: true } : p));
    });
  }, [load]);

  const start = async (inWindow: boolean) => {
    setError(null);
    setBusy(inWindow);
    try {
      const { url } = await call('claudeLogin', inWindow);
      setPending({ url, manual: !inWindow });
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setAccount(await call('claudeSubmitCode', code));
      setPending(null);
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await call('claudeCancelLogin');
    setPending(null);
    setBusy(false);
  };

  const signOut = async () => {
    setError(null);
    try {
      setAccount(await call('claudeLogout'));
    } catch (e) {
      setError((e as Error).message);
    }
  };


  const wrongAccount = account?.loggedIn && !account.ok;
  const tone = !account ? undefined : account.ok ? 'ok' : account.loggedIn ? 'bad' : 'warn';
  const label = !account ? 'Checking…' : account.ok ? 'Company account' : wrongAccount ? 'Wrong account' : 'Not signed in';

  return (
    <section className="ao-status-card ao-conn-card">
      <h3>
          <span className="ao-conn-icon"><ClaudeIcon size={17} /></span>
          Claude
          <span className="ao-badge" data-tone={tone}>{label}</span>
      </h3>
      <p>
        FJ AI Worker&apos;s own Claude sign-in. Claude Code in your terminal, and any other app, keep their own account.
      </p>

      {account?.loggedIn && (
        <div className="ao-who">
          <div>
            <strong>{account.email}</strong>
            <span className="ao-soft">
              {[account.orgName, account.subscriptionType && `Claude ${account.subscriptionType}`].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>
      )}
      {wrongAccount && (
        <p className="ao-task-panel-error">
          This isn&apos;t the company account ({account.expectedEmail}). Sign out and sign in with it — runs won&apos;t start until then.
        </p>
      )}

      {pending ? (
        pending.manual ? (
          <>
            <p>Open the link in a browser signed in to the company Gmail, sign in, then paste the code the page shows.</p>
            <LinkOpener url={pending.url} />
            <label className="ao-task-panel-field">
              <span className="ao-task-panel-label">Code</span>
              <input className="ao-task-input ao-mono-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code here" />
            </label>
            <div className="ao-status-actions">
              <button type="button" className="ao-btn-primary" disabled={busy || !code.trim()} onClick={submit}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <button type="button" className="ao-btn-secondary" onClick={cancel}>Cancel</button>
            </div>
          </>
        ) : (
          <div className="ao-status-actions">
            <span className="ao-soft">Finish signing in in the Claude window…</span>
            <button type="button" className="ao-link-btn" onClick={() => setPending({ ...pending, manual: true })}>Use another browser</button>
            <button type="button" className="ao-btn-secondary" onClick={cancel}>Cancel</button>
          </div>
        )
      ) : (
        <div className="ao-status-actions">
          {!account?.loggedIn ? (
            <>
              <button type="button" className="ao-btn-primary" disabled={busy} onClick={() => start(true)}>Sign in to Claude</button>
              <button type="button" className="ao-btn-secondary" disabled={busy} onClick={() => start(false)}>Sign in with a link</button>
            </>
          ) : (
            <button type="button" className="ao-btn-danger" onClick={signOut}>Sign out</button>
          )}
          <button type="button" className="ao-btn-secondary" onClick={() => void load()}>Check again</button>
        </div>
      )}
      {error && <p className="ao-task-panel-error">{error}</p>}
    </section>
  );
}
