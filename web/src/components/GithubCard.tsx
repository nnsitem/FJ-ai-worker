'use client';

import { useCallback, useEffect, useState } from 'react';
import { LinkOpener } from './LinkOpener';
import { GithubIcon } from './icons';
import { call, type DeviceCode, type GithubState, type RepoSummary } from '@/lib/bridge';

/**
 * Signing in to GitHub: the device flow (the company's OAuth App), a token
 * pasted in, or gh's own sign-in. Signed in, the repos it reaches — M1's
 * proof that the token and the tunnel both work.
 */
export function GithubCard({ vpnUp }: { vpnUp: boolean }) {
  const [state, setState] = useState<GithubState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [pasting, setPasting] = useState(false);
  const [token, setToken] = useState('');
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await call('githubState'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the sign-in once the tunnel is up
    if (vpnUp) void load();
  }, [vpnUp, load]);

  useEffect(() => {
    if (!state?.signedIn) return;
    let live = true;
    call('githubRepos')
      .then((r) => live && (setRepos(r), setReposError(null)))
      .catch((e) => live && setReposError((e as Error).message));
    return () => {
      live = false;
    };
  }, [state]);

  const run = async (fn: () => Promise<GithubState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
      setPasting(false);
      setToken('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setDevice(null);
    }
  };

  const startDevice = async () => {
    setError(null);
    try {
      const d = await call('githubDeviceStart');
      // Not opened by itself — the default browser is likely the person's own GitHub.
      setDevice(d);
      await run(() => call('githubDeviceFinish'));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const signOut = async () => {
    await call('githubSignOut');
    setState({ signedIn: false });
    setRepos(null);
  };

  const signedIn = state?.signedIn === true;

  return (
    <section className="ao-status-card ao-conn-card">
      <h3>
          <span className="ao-conn-icon"><GithubIcon size={17} /></span>
          GitHub
          <span className="ao-badge" data-tone={signedIn ? 'ok' : vpnUp ? 'warn' : undefined}>
          {signedIn ? 'Signed in' : vpnUp ? 'Not signed in' : 'Waiting for the VPN'}
        </span>
      </h3>

      {state?.signedIn ? (
        <>
          <div className="ao-who">
            {/* eslint-disable-next-line @next/next/no-img-element -- a remote avatar in a static export */}
            <img src={state.user.avatarUrl} alt="" />
            <div>
              <strong>{state.user.name ?? state.user.login}</strong>
              <span className="ao-soft">@{state.user.login}{state.scopes.length > 0 && ` · ${state.scopes.join(', ')}`}</span>
            </div>
          </div>
          {reposError && <p className="ao-task-panel-error">{reposError}</p>}
          {repos && (
            <>
              <p>{repos.length} repositories reachable{repos.length === 50 && ' (first 50)'}</p>
              <ul className="ao-conn-list">
                {repos.slice(0, 8).map((r) => (
                  <li key={r.fullName}>
                    <span className="ao-mono">{r.fullName}</span>
                    {r.private && <span className="ao-tag">private</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="ao-status-actions">
            <button type="button" className="ao-btn-danger" onClick={signOut}>Sign out</button>
          </div>
        </>
      ) : device ? (
        <>
          <p>Open this link in the browser signed in to the company GitHub, and enter the code:</p>
          <div className="ao-device-code">{device.userCode}</div>
          <LinkOpener url={device.verificationUri} />
          <div className="ao-status-actions">
            <span className="ao-soft">Waiting for GitHub…</span>
            <button type="button" className="ao-btn-secondary" onClick={() => void call('githubDeviceCancel')}>Cancel</button>
          </div>
        </>
      ) : pasting ? (
        <>
          <label className="ao-task-panel-field">
            <span className="ao-task-panel-label">Personal access token</span>
            <input className="ao-task-input ao-mono-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus placeholder="ghp_… or github_pat_…" />
            <small className="ao-field-note">Scopes: repo, read:org. If the organisation uses SSO, authorise the token for it on GitHub.</small>
          </label>
          <div className="ao-status-actions">
            <button type="button" className="ao-btn-primary" disabled={busy || !token.trim()} onClick={() => run(() => call('githubUseToken', token))}>
              {busy ? 'Checking…' : 'Use this token'}
            </button>
            <button type="button" className="ao-btn-secondary" onClick={() => setPasting(false)}>Back</button>
          </div>
        </>
      ) : (
        <div className="ao-status-actions">
          <button type="button" className="ao-btn-primary" disabled={!vpnUp || busy} onClick={startDevice}>Sign in with GitHub</button>
          <button type="button" className="ao-btn-secondary" disabled={!vpnUp || busy} onClick={() => setPasting(true)}>Paste a token</button>
          <button type="button" className="ao-btn-secondary" disabled={!vpnUp || busy} onClick={() => run(() => call('githubFromGh'))}>Use gh’s sign-in</button>
        </div>
      )}
      {error && <p className="ao-task-panel-error">{error}</p>}
    </section>
  );
}
