'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/bridge';

let vpnBrowser: Promise<boolean> | null = null;

/**
 * A sign-in link, never opened by itself: the person's default browser is
 * usually signed in to their own accounts, not the company's. Copy it, open
 * it in the VPN script's Edge, or in the default browser after all.
 */
export function LinkOpener({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [edge, setEdge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    vpnBrowser ??= call('appInfo').then((i) => i.vpnBrowser).catch(() => false);
    let live = true;
    void vpnBrowser.then((v) => live && setEdge(v));
    return () => {
      live = false;
    };
  }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const open = async (how: 'openInVpnBrowser' | 'openExternal') => {
    setError(null);
    try {
      await call(how, url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="ao-link-opener">
      <input className="ao-task-input ao-mono-input" value={url} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Sign-in link" />
      <div className="ao-status-actions">
        <button type="button" className="ao-btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        {edge && <button type="button" className="ao-btn-secondary" onClick={() => open('openInVpnBrowser')}>Open in VPN Edge</button>}
        <button type="button" className="ao-btn-secondary" onClick={() => open('openExternal')}>Open in default browser</button>
      </div>
      {error && <p className="ao-task-panel-error">{error}</p>}
    </div>
  );
}
