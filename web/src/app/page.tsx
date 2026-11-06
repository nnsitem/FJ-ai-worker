'use client';

import { useCallback, useState } from 'react';
import { VpnCard } from '@/components/VpnCard';
import { GithubCard } from '@/components/GithubCard';
import { ClaudeCard } from '@/components/ClaudeCard';
import { JiraCard } from '@/components/JiraCard';
import type { VpnStatus } from '@/lib/bridge';

export default function ConnectionsPage() {
  const [vpnUp, setVpnUp] = useState(false);
  const onVpn = useCallback((s: VpnStatus) => setVpnUp(s.github), []);
  return (
    <div className="aw-page">
      <h1>Connections</h1>
      <p className="aw-lede">What AI Worker needs before it can work a ticket.</p>
      <VpnCard onChange={onVpn} />
      <GithubCard vpnUp={vpnUp} />
      <JiraCard vpnUp={vpnUp} />
      <ClaudeCard />
    </div>
  );
}
