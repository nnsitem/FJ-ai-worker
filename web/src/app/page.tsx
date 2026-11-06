'use client';

import { useCallback, useState } from 'react';
import { Panel } from '@/components/Panel';
import { VpnCard } from '@/components/VpnCard';
import { GithubCard } from '@/components/GithubCard';
import { ClaudeCard } from '@/components/ClaudeCard';
import { JiraCard } from '@/components/JiraCard';
import type { VpnStatus } from '@/lib/bridge';

export default function ConnectionsPage() {
  const [vpnUp, setVpnUp] = useState(false);
  const onVpn = useCallback((s: VpnStatus) => setVpnUp(s.github), []);
  return (
    <Panel title="Connections" sub="What FJ AI Worker needs before it can work a ticket">
      <div className="aw-panel-body">
        <div className="aw-page-inner">
          <VpnCard onChange={onVpn} />
          <GithubCard vpnUp={vpnUp} />
          <ClaudeCard />
          <JiraCard vpnUp={vpnUp} />
        </div>
      </div>
    </Panel>
  );
}
