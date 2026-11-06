'use client';

import { useCallback, useEffect, useState } from 'react';
import { Panel } from '@/components/Panel';
import { TerminalView } from '@/components/TerminalView';
import { AddIcon, TerminalIcon, VpnIcon } from '@/components/icons';
import { bridge, call, type TerminalInfo } from '@/lib/bridge';

/**
 * Terminals inside the app: the VPN script (so its sign-in and errors show
 * here), and a shell of your own. Leaving the page keeps them running.
 */
export default function TerminalPage() {
  const [terms, setTerms] = useState<TerminalInfo[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await call('termList');
    setTerms(list);
    // The newest one, unless one is already open.
    setActiveId((cur) => (cur && list.some((t) => t.id === cur) ? cur : (list.at(-1)?.id ?? null)));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list, then kept in step with the app's terminals
    void refresh();
    return bridge().onTerminal((ev) => {
      if (ev.kind !== 'data') void refresh();
    });
  }, [refresh]);

  const open = async (kind: 'shell' | 'vpn') => {
    setError(null);
    try {
      const t = await call('termOpen', kind);
      await refresh();
      setActiveId(t.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const close = async (id: string) => {
    await call('termClose', id);
    if (activeId === id) setActiveId(null);
    await refresh();
  };

  return (
    <Panel
      title="Terminal"
      sub="The VPN script and your own shell, inside the app"
      actions={
        <>
          {error && <span className="aw-error">{error}</span>}
          <button type="button" className="aw-btn" data-primary onClick={() => open('vpn')}>
            <VpnIcon size={15} /> Connect VPN
          </button>
          <button type="button" className="aw-btn" onClick={() => open('shell')}>
            <AddIcon size={15} /> New terminal
          </button>
        </>
      }
    >
      {terms && terms.length > 0 && (
        <div className="aw-term-tabs" role="tablist">
          {terms.map((t) => (
            <div key={t.id} className="aw-term-tab" role="tab" tabIndex={0} aria-selected={t.id === activeId} onClick={() => setActiveId(t.id)} onKeyDown={(e) => e.key === 'Enter' && setActiveId(t.id)}>
              <span className="aw-term-dot" data-running={t.running || undefined} />
              {t.title}
              {!t.running && <span className="aw-muted"> · ended{t.exitCode ? ` (${t.exitCode})` : ''}</span>}
              <button type="button" className="aw-term-x" aria-label={`Close ${t.title}`} onClick={(e) => (e.stopPropagation(), void close(t.id))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="aw-term-area">
        {terms?.map((t) => <TerminalView key={t.id} id={t.id} active={t.id === activeId} />)}
        {terms && terms.length === 0 && (
          <div className="aw-empty">
            <TerminalIcon size={28} />
            No terminal open. Connect the VPN, or open a terminal of your own.
          </div>
        )}
      </div>
    </Panel>
  );
}
