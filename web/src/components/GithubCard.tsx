'use client';

import { useCallback, useEffect, useState } from 'react';
import { LinkOpener } from './LinkOpener';
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
    <section className="aw-card">
      <div className="aw-card-head">
        <h2>GitHub</h2>
        <span className="aw-pill" data-tone={signedIn ? 'ok' : vpnUp ? 'warn' : undefined}>
          {signedIn ? 'Signed in' : vpnUp ? 'Not signed in' : 'Waiting for the VPN'}
        </span>
      </div>

      {state?.signedIn ? (
        <>
          <div className="aw-who">
            {/* eslint-disable-next-line @next/next/no-img-element -- a remote avatar in a static export */}
            <img src={state.user.avatarUrl} alt="" />
            <div>
              <strong>{state.user.name ?? state.user.login}</strong>
              <span className="aw-muted">@{state.user.login}{state.scopes.length > 0 && ` · ${state.scopes.join(', ')}`}</span>
            </div>
          </div>
          {reposError && <p className="aw-error">{reposError}</p>}
          {repos && (
            <>
              <p className="aw-muted">{repos.length} repositories reachable{repos.length === 50 && ' (first 50)'}</p>
              <ul className="aw-list">
                {repos.slice(0, 8).map((r) => (
                  <li key={r.fullName}>
                    <span className="aw-mono">{r.fullName}</span>
                    {r.private && <span className="aw-pill">private</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="aw-row">
            <button type="button" className="aw-btn" data-danger onClick={signOut}>Sign out</button>
          </div>
        </>
      ) : device ? (
        <>
          <p>Open this link in the browser signed in to the company GitHub, and enter the code:</p>
          <div className="aw-code">{device.userCode}</div>
          <LinkOpener url={device.verificationUri} />
          <div className="aw-row">
            <span className="aw-muted">Waiting for GitHub…</span>
            <button type="button" className="aw-btn" onClick={() => void call('githubDeviceCancel')}>Cancel</button>
          </div>
        </>
      ) : pasting ? (
        <>
          <label className="aw-field">
            <span>Personal access token</span>
            <input className="aw-input aw-mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus placeholder="ghp_… or github_pat_…" />
            <small>Scopes: repo, read:org. If the organisation uses SSO, authorise the token for it on GitHub.</small>
          </label>
          <div className="aw-row">
            <button type="button" className="aw-btn" data-primary disabled={busy || !token.trim()} onClick={() => run(() => call('githubUseToken', token))}>
              {busy ? 'Checking…' : 'Use this token'}
            </button>
            <button type="button" className="aw-btn" onClick={() => setPasting(false)}>Back</button>
          </div>
        </>
      ) : (
        <div className="aw-row">
          <button type="button" className="aw-btn" data-primary disabled={!vpnUp || busy} onClick={startDevice}>Sign in with GitHub</button>
          <button type="button" className="aw-btn" disabled={!vpnUp || busy} onClick={() => setPasting(true)}>Paste a token</button>
          <button type="button" className="aw-btn" disabled={!vpnUp || busy} onClick={() => run(() => call('githubFromGh'))}>Use gh’s sign-in</button>
        </div>
      )}
      {error && <p className="aw-error">{error}</p>}
    </section>
  );
}
