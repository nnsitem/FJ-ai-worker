'use client';

import { useCallback, useEffect, useState } from 'react';
import { VpnIcon } from './icons';
import { call, type VpnStatus } from '@/lib/bridge';
import { requestDock } from '@/lib/terminal-dock';

/** The VPN tunnel GitHub goes through: up, and GitHub answering through it. */
export function VpnCard({ onChange }: { onChange?: (s: VpnStatus) => void }) {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const s = await call('vpnStatus');
      setStatus(s);
      onChange?.(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, [onChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a check on opening, and every 30s
    void check();
    const t = setInterval(() => void check(), 30000);
    return () => clearInterval(t);
  }, [check]);

  // The script in the app's terminal panel, where its sign-in and errors
  // show; the tunnel takes a few seconds to come up.
  const connect = () => {
    requestDock({ action: 'open', start: 'vpn' });
    setTimeout(() => void check(), 8000);
  };

  const openScript = async () => {
    setError(null);
    try {
      await call('openVpnScript');
      setTimeout(() => void check(), 6000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const tone = !status ? undefined : status.github ? 'ok' : status.tunnel ? 'warn' : 'bad';
  const label = !status ? 'Checking…' : status.github ? 'Connected' : status.tunnel ? 'Tunnel open, GitHub not reachable' : 'Not connected';

  return (
    <section className="aw-card">
      <div className="aw-card-head">
        <span className="aw-card-icon"><VpnIcon size={17} /></span>
        <h2>VPN</h2>
        <span className="aw-pill" data-tone={tone}>{label}</span>
      </div>
      <p className="aw-muted">GitHub is reached through the company VPN tunnel. Jira and Claude go direct.</p>
      {status?.error && !status.github && <p className="aw-error">{status.error}</p>}
      {error && <p className="aw-error">{error}</p>}
      <div className="aw-row">
        {!status?.github && (
          <>
            <button type="button" className="aw-btn" data-primary onClick={connect}>
              Connect VPN
            </button>
            <button type="button" className="aw-btn" onClick={openScript}>
              Open in the Terminal app
            </button>
          </>
        )}
        <button type="button" className="aw-btn" onClick={() => void check()} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </section>
  );
}
