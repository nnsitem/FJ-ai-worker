'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ProjectLinks } from '@/components/ProjectLinks';
import { BranchIcon, ClaudeIcon, GithubIcon, InfoIcon, VpnIcon } from '@/components/icons';
import { call, type AppInfo, type Settings } from '@/lib/bridge';

type Category = 'projects' | 'vpn' | 'github' | 'claude' | 'about';

const CATEGORIES: { id: Category; label: string; icon: ReactNode; sub: string }[] = [
  { id: 'projects', label: 'Projects', icon: <BranchIcon size={16} />, sub: 'Which GitHub repo each Jira project’s tickets are fixed in.' },
  { id: 'vpn', label: 'VPN', icon: <VpnIcon size={16} />, sub: 'The tunnel GitHub is reached through, and the script that opens it.' },
  { id: 'github', label: 'GitHub', icon: <GithubIcon size={16} />, sub: 'How “Sign in with GitHub” finds the company’s OAuth App.' },
  { id: 'claude', label: 'Claude', icon: <ClaudeIcon size={16} />, sub: 'The company Claude account runs start under.' },
];
const ABOUT = { id: 'about' as const, label: 'About', icon: <InfoIcon size={16} />, sub: 'This copy of FJ AI Worker.' };

/** Settings, as AI Office's: a category nav panel beside the content, a category at a time. */
export default function SettingsPage() {
  const [category, setCategory] = useState<Category>('projects');
  const [s, setS] = useState<Settings | null>(null);
  const [hosts, setHosts] = useState('');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  const edit = (next: Settings) => {
    setS(next);
    setDirty(true);
  };

  const save = async () => {
    if (!s) return;
    setError(null);
    try {
      const next = await call('saveSettings', {
        proxy: { host: s.proxy.host, port: s.proxy.port, hosts: hosts.split(/[\s,]+/) },
        vpnScript: s.vpnScript,
        caFile: s.caFile,
        github: s.github,
        claude: s.claude,
        projects: s.projects,
      });
      setS(next);
      setHosts(next.proxy.hosts.join('\n'));
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cat = category === 'about' ? ABOUT : CATEGORIES.find((c) => c.id === category)!;

  return (
    <div className="ao-settings-shell">
      <nav className="ao-settings-nav" aria-label="Settings">
        <h1 className="ao-settings-nav-title">Settings</h1>
        <div className="ao-nav-group">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" className="ao-nav-item" data-active={category === c.id} onClick={() => setCategory(c.id)}>
              {c.icon}
              {c.label}
            </button>
          ))}
        </div>
        <div className="ao-nav-group ao-settings-nav-info">
          <button type="button" className="ao-nav-item" data-active={category === 'about'} onClick={() => setCategory('about')}>
            {ABOUT.icon}
            {ABOUT.label}
          </button>
          <p className="ao-settings-nav-version">FJ AI Worker {info ? `v${info.version}` : ''}</p>
        </div>
      </nav>

      <div className="ao-settings-content">
        <div className="ao-settings-content-inner">
          <header className="ao-library-head">
            <div>
              <h2>{cat.label}</h2>
              <p>{cat.sub}</p>
            </div>
            {error && <span className="ao-task-panel-error">{error}</span>}
            {category !== 'about' && s && (
              <button type="button" className="ao-btn-primary ao-library-sync" onClick={() => void save()} disabled={!dirty && !saved}>
                {saved ? 'Saved' : dirty ? 'Save changes' : 'Saved'}
              </button>
            )}
          </header>

          {!s && category !== 'about' && !error && <p className="ao-soft">Loading…</p>}

          {s && category === 'projects' && (
            <div className="ao-status-card">
              <h3>Jira project → GitHub repo</h3>
              <p>A ticket from a linked project is fixed in its repo. Both fields suggest from Jira and GitHub once they&apos;re connected.</p>
              <ProjectLinks links={s.projects} onChange={(projects) => edit({ ...s, projects })} />
            </div>
          )}

          {s && category === 'vpn' && (
            <>
              <div className="ao-status-card">
                <h3>Tunnel</h3>
                <div className="ao-task-panel-grid" data-cols="2">
                  <label className="ao-task-panel-field">
                    <span className="ao-task-panel-label">Tunnel host</span>
                    <input className="ao-task-input ao-mono-input" value={s.proxy.host} onChange={(e) => edit({ ...s, proxy: { ...s.proxy, host: e.target.value } })} />
                  </label>
                  <label className="ao-task-panel-field">
                    <span className="ao-task-panel-label">SOCKS port</span>
                    <input
                      className="ao-task-input ao-mono-input"
                      inputMode="numeric"
                      value={s.proxy.port}
                      onChange={(e) => edit({ ...s, proxy: { ...s.proxy, port: Number(e.target.value.replace(/\D/g, '')) || 0 } })}
                    />
                  </label>
                </div>
                <label className="ao-task-panel-field">
                  <span className="ao-task-panel-label">Hosts through the tunnel</span>
                  <textarea
                    className="ao-task-input ao-task-textarea ao-mono-input"
                    value={hosts}
                    onChange={(e) => {
                      setHosts(e.target.value);
                      setDirty(true);
                    }}
                  />
                  <small className="ao-field-note">
                    One per line; <code>*.example.com</code> covers its subdomains. Everything else goes direct.
                  </small>
                </label>
              </div>
              <div className="ao-status-card">
                <h3>Script and certificate</h3>
                <label className="ao-task-panel-field">
                  <span className="ao-task-panel-label">VPN script</span>
                  <input className="ao-task-input ao-mono-input" value={s.vpnScript} onChange={(e) => edit({ ...s, vpnScript: e.target.value })} />
                  <small className="ao-field-note">Offered on Connections and in the top bar when the tunnel is down.</small>
                </label>
                <label className="ao-task-panel-field">
                  <span className="ao-task-panel-label">VPN certificate (PEM)</span>
                  <input className="ao-task-input ao-mono-input" value={s.caFile} onChange={(e) => edit({ ...s, caFile: e.target.value })} />
                  <small className="ao-field-note">The VPN re-signs GitHub&apos;s certificate; Claude and other Node tools are told to trust this one too.</small>
                </label>
              </div>
            </>
          )}

          {s && category === 'github' && (
            <div className="ao-status-card">
              <h3>OAuth App</h3>
              <label className="ao-task-panel-field">
                <span className="ao-task-panel-label">Client id</span>
                <input className="ao-task-input ao-mono-input" value={s.github.clientId} onChange={(e) => edit({ ...s, github: { clientId: e.target.value.trim() } })} placeholder="Ov23li…" />
                <small className="ao-field-note">For “Sign in with GitHub”: an OAuth App with Device Flow enabled. Not needed for a pasted token or gh’s sign-in.</small>
              </label>
            </div>
          )}

          {s && category === 'claude' && (
            <div className="ao-status-card">
              <h3>Company account</h3>
              <label className="ao-task-panel-field">
                <span className="ao-task-panel-label">Email</span>
                <input className="ao-task-input" type="email" value={s.claude.expectedEmail} onChange={(e) => edit({ ...s, claude: { expectedEmail: e.target.value } })} placeholder="name@gmail.com" />
                <small className="ao-field-note">Runs only start under this account; it also fills the sign-in page.</small>
              </label>
              {info && (
                <p className="ao-field-note">
                  Claude config folder: <code>{info.claudeConfigDir}</code>
                </p>
              )}
            </div>
          )}

          {category === 'about' && (
            <div className="ao-status-card">
              <h3>
                <span className="ao-logo-tile ao-logo-fj" aria-hidden="true">
                  FJ
                </span>
                FJ AI Worker
                {info && <span className="ao-badge">v{info.version}</span>}
              </h3>
              <p>Jira tickets fixed by Claude Code, through to a GitHub pull request.</p>
              {info && (
                <p className="ao-field-note">
                  {info.platform} · Claude config <code>{info.claudeConfigDir}</code>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
