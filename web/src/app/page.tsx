'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ClaudeCard } from '@/components/ClaudeCard';
import { GithubCard } from '@/components/GithubCard';
import { JiraCard } from '@/components/JiraCard';
import { CopilotCard } from '@/components/CopilotCard';
import { VpnCard } from '@/components/VpnCard';
import { ClaudeIcon, ConnectionsIcon, CopilotIcon, GithubIcon, JiraIcon, VpnIcon } from '@/components/icons';
import { call, type VpnStatus } from '@/lib/bridge';

type View = 'all' | 'vpn' | 'github' | 'claude' | 'copilot' | 'jira';
type Tone = 'ok' | 'warn' | 'bad' | undefined;

/** Where each connection stands, for the nav's dots — read on opening and every 30s. */
function useTones(vpnUp: boolean) {
  const [tones, setTones] = useState<Record<Exclude<View, 'all' | 'vpn'>, Tone>>({ github: undefined, claude: undefined, copilot: undefined, jira: undefined });
  useEffect(() => {
    let live = true;
    const check = async () => {
      const [g, c, j, cp] = await Promise.all([
        vpnUp ? call('githubState').catch(() => null) : Promise.resolve(null),
        call('claudeAccount').catch(() => null),
        call('jiraState').catch(() => null),
        call('copilotAccount').catch(() => null),
      ]);
      if (!live) return;
      setTones({
        github: !vpnUp ? undefined : g?.signedIn ? 'ok' : 'warn',
        claude: !c ? 'bad' : c.ok ? 'ok' : c.loggedIn ? 'bad' : 'warn',
        jira: !j ? undefined : j.connected ? 'ok' : 'warn',
        // Copilot is optional: grey until signed in.
        copilot: cp?.loggedIn ? 'ok' : undefined,
      });
    };
    void check();
    const t = setInterval(() => void check(), 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [vpnUp]);
  return tones;
}

/**
 * Connections, laid out as AI Office's Settings (settings-shell: a category
 * nav panel beside the content): what FJ AI Worker needs before it can work a
 * ticket — the VPN, GitHub, Claude and Jira — together or one at a time.
 */
export default function ConnectionsPage() {
  const [view, setView] = useState<View>('all');
  const [vpn, setVpn] = useState<VpnStatus | null>(null);
  const onVpn = useCallback((s: VpnStatus) => setVpn(s), []);
  const vpnUp = !!vpn?.github;
  const tones = useTones(vpnUp);
  const vpnTone: Tone = !vpn ? undefined : vpn.github ? 'ok' : vpn.tunnel ? 'warn' : 'bad';

  const items: { id: View; label: string; icon: ReactNode; tone?: Tone }[] = [
    { id: 'all', label: 'All connections', icon: <ConnectionsIcon size={16} /> },
    { id: 'vpn', label: 'VPN', icon: <VpnIcon size={16} />, tone: vpnTone },
    { id: 'github', label: 'GitHub', icon: <GithubIcon size={16} />, tone: tones.github },
    { id: 'claude', label: 'Claude', icon: <ClaudeIcon size={16} />, tone: tones.claude },
    { id: 'copilot', label: 'Copilot', icon: <CopilotIcon size={16} />, tone: tones.copilot },
    { id: 'jira', label: 'Jira', icon: <JiraIcon size={16} />, tone: tones.jira },
  ];
  const shown = (id: View) => view === 'all' || view === id;

  return (
    <div className="ao-settings-shell">
      <nav className="ao-settings-nav" aria-label="Connections">
        <h1 className="ao-settings-nav-title">Connections</h1>
        <div className="ao-nav-group">
          {items.map((i) => (
            <button key={i.id} type="button" className="ao-nav-item" data-active={view === i.id} onClick={() => setView(i.id)}>
              {i.icon}
              {i.label}
              {i.id !== 'all' && <span className="ao-ready-dot ao-nav-ready" data-tone={i.tone} />}
            </button>
          ))}
        </div>
      </nav>

      <div className="ao-settings-content">
        <div className="ao-settings-content-inner">
          <div className="ao-settings-header">
            <h2>{items.find((i) => i.id === view)!.label}</h2>
            <p>What FJ AI Worker needs before it can work a ticket — GitHub through the VPN, Claude (or Copilot) and Jira.</p>
          </div>
          {/* The VPN card stays mounted: GitHub and Jira read whether the tunnel is up from it. */}
          <div className="ao-status-card-slot" hidden={!shown('vpn')}>
            <VpnCard onChange={onVpn} />
          </div>
          {shown('github') && <GithubCard vpnUp={vpnUp} />}
          {shown('claude') && <ClaudeCard />}
          {shown('copilot') && <CopilotCard />}
          {shown('jira') && <JiraCard vpnUp={vpnUp} />}
        </div>
      </div>
    </div>
  );
}
