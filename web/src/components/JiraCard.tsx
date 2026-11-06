'use client';

import { useCallback, useEffect, useState } from 'react';
import { call, type JiraState, type Settings } from '@/lib/bridge';

const hostOf = (site: string) => {
  try {
    return new URL(/^https?:\/\//.test(site) ? site : `https://${site}`).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Jira Cloud: site, email and an API token, checked against Jira before
 * they're kept. "Through the VPN" adds the site to the tunnel's hosts, for a
 * site that only lets company addresses in.
 */
export function JiraCard({ vpnUp }: { vpnUp: boolean }) {
  const [state, setState] = useState<JiraState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await call('getSettings');
      setSettings(s);
      setSite((v) => v || s.jira.site);
      setEmail((v) => v || s.jira.email);
      setState(await call('jiraState'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setState((st) => st ?? { connected: false, site: '', email: '' });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once on opening
    void load();
  }, [load]);

  const host = hostOf(site || settings?.jira.site || '');
  const viaVpn = !!host && !!settings?.proxy.hosts.includes(host);

  const setViaVpn = async (on: boolean) => {
    if (!settings || !host) return;
    const hosts = on ? [...settings.proxy.hosts, host] : settings.proxy.hosts.filter((h) => h !== host);
    setSettings(await call('saveSettings', { proxy: { hosts } }));
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await call('jiraConnect', { site, email, token }));
      setToken('');
      setEditing(false);
      setSettings(await call('getSettings'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await call('jiraDisconnect');
    setState({ connected: false, site, email });
  };

  const connected = state?.connected === true;
  const showForm = !connected || editing;

  return (
    <section className="aw-card">
      <div className="aw-card-head">
        <h2>Jira</h2>
        <span className="aw-pill" data-tone={!state ? undefined : connected ? 'ok' : error ? 'bad' : 'warn'}>
          {!state ? 'Checking…' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {state?.connected && !editing && (
        <div className="aw-who">
          {/* eslint-disable-next-line @next/next/no-img-element -- a remote avatar in a static export */}
          {state.user.avatarUrl && <img src={state.user.avatarUrl} alt="" />}
          <div>
            <strong>{state.user.displayName}</strong>
            <span className="aw-muted">{state.user.email ?? email} · {hostOf(state.site)}</span>
          </div>
        </div>
      )}

      {showForm && (
        <>
          <label className="aw-field">
            <span>Site</span>
            <input className="aw-input aw-mono" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://your-site.atlassian.net" />
          </label>
          <label className="aw-field">
            <span>Email</span>
            <input className="aw-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </label>
          <label className="aw-field">
            <span>API token</span>
            <input
              className="aw-input aw-mono"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={connected ? 'Leave empty to keep the current one' : 'From id.atlassian.com › Security › API tokens'}
            />
          </label>
        </>
      )}

      <label className="aw-check">
        <input type="checkbox" checked={viaVpn} disabled={!host} onChange={(e) => void setViaVpn(e.target.checked)} />
        <span>Through the VPN <span className="aw-muted">— when the site only lets company network addresses in{viaVpn && !vpnUp ? ' (the VPN is down)' : ''}</span></span>
      </label>

      <div className="aw-row">
        {showForm ? (
          <>
            <button type="button" className="aw-btn" data-primary disabled={busy || !site.trim() || !email.trim() || (!connected && !token.trim())} onClick={connect}>
              {busy ? 'Checking…' : connected ? 'Save' : 'Connect'}
            </button>
            {editing && <button type="button" className="aw-btn" onClick={() => setEditing(false)}>Cancel</button>}
          </>
        ) : (
          <>
            <button type="button" className="aw-btn" onClick={() => setEditing(true)}>Change</button>
            <button type="button" className="aw-btn" data-danger onClick={disconnect}>Disconnect</button>
          </>
        )}
      </div>
      {error && <p className="aw-error">{error}</p>}
    </section>
  );
}
