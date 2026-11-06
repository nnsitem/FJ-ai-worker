'use client';

import { useEffect, useState } from 'react';
import { call, type AppInfo, type Settings } from '@/lib/bridge';

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [hosts, setHosts] = useState('');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('getSettings')
      .then((v) => {
        setS(v);
        setHosts(v.proxy.hosts.join('\n'));
      })
      .catch((e) => setError((e as Error).message));
    call('appInfo').then(setInfo).catch(() => {});
  }, []);

  if (!s) return <div className="aw-page">{error && <p className="aw-error">{error}</p>}</div>;

  const save = async () => {
    setError(null);
    try {
      const next = await call('saveSettings', {
        proxy: { host: s.proxy.host, port: s.proxy.port, hosts: hosts.split(/[\s,]+/) },
        vpnScript: s.vpnScript,
        caFile: s.caFile,
        github: s.github,
        claude: s.claude,
      });
      setS(next);
      setHosts(next.proxy.hosts.join('\n'));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="aw-page">
      <h1>Settings</h1>

      <section className="aw-card">
        <div className="aw-card-head"><h2>VPN</h2></div>
        <div className="aw-grid-2">
          <label className="aw-field">
            <span>Tunnel host</span>
            <input className="aw-input aw-mono" value={s.proxy.host} onChange={(e) => setS({ ...s, proxy: { ...s.proxy, host: e.target.value } })} />
          </label>
          <label className="aw-field">
            <span>SOCKS port</span>
            <input className="aw-input aw-mono" inputMode="numeric" value={s.proxy.port} onChange={(e) => setS({ ...s, proxy: { ...s.proxy, port: Number(e.target.value.replace(/\D/g, '')) || 0 } })} />
          </label>
        </div>
        <label className="aw-field">
          <span>Hosts through the tunnel</span>
          <textarea className="aw-textarea" value={hosts} onChange={(e) => setHosts(e.target.value)} />
          <small>One per line; <code>*.example.com</code> covers its subdomains. Everything else goes direct.</small>
        </label>
        <label className="aw-field">
          <span>VPN script</span>
          <input className="aw-input aw-mono" value={s.vpnScript} onChange={(e) => setS({ ...s, vpnScript: e.target.value })} />
          <small>Offered on Connections when the tunnel is down.</small>
        </label>
        <label className="aw-field">
          <span>VPN certificate (PEM)</span>
          <input className="aw-input aw-mono" value={s.caFile} onChange={(e) => setS({ ...s, caFile: e.target.value })} />
          <small>The VPN re-signs GitHub&apos;s certificate; Claude and other Node tools are told to trust this one too.</small>
        </label>
      </section>

      <section className="aw-card">
        <div className="aw-card-head"><h2>GitHub</h2></div>
        <label className="aw-field">
          <span>OAuth App client id</span>
          <input className="aw-input aw-mono" value={s.github.clientId} onChange={(e) => setS({ ...s, github: { clientId: e.target.value.trim() } })} placeholder="Ov23li…" />
          <small>For “Sign in with GitHub”: an OAuth App with Device Flow enabled. Not needed for a pasted token or gh’s sign-in.</small>
        </label>
      </section>

      <section className="aw-card">
        <div className="aw-card-head"><h2>Claude</h2></div>
        <label className="aw-field">
          <span>Company account email</span>
          <input className="aw-input" type="email" value={s.claude.expectedEmail} onChange={(e) => setS({ ...s, claude: { expectedEmail: e.target.value } })} placeholder="name@gmail.com" />
          <small>Runs only start under this account; it also fills the sign-in page.</small>
        </label>
        {info && <p className="aw-muted">Claude config folder: <code>{info.claudeConfigDir}</code></p>}
      </section>

      <div className="aw-row">
        <button type="button" className="aw-btn" data-primary onClick={save}>{saved ? 'Saved' : 'Save'}</button>
        {error && <span className="aw-error">{error}</span>}
      </div>
      {info && <p className="aw-muted">AI Worker {info.version}</p>}
    </div>
  );
}
