'use client';

import { useEffect, useState } from 'react';
import { bridge, call, type Run } from '@/lib/bridge';
import { NewRunForm } from './NewRunForm';
import { RunPanel } from './RunPanel';
import { currentStep, STATE_TONE, STEP_LABELS } from './steps';

/** Runs: each ticket being worked, and the open one beside the list. */
export default function RunsPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('runsList')
      .then((r) => {
        setRuns(r);
        if (r.length === 0) setCreating(true);
      })
      .catch((e) => setError((e as Error).message));
    return bridge().onRun((run) =>
      setRuns((rs) => {
        if (!rs) return rs;
        const i = rs.findIndex((r) => r.id === run.id);
        return i < 0 ? [run, ...rs] : rs.map((r) => (r.id === run.id ? run : r));
      }),
    );
  }, []);

  const open = runs?.find((r) => r.id === openId) ?? null;

  return (
    <div className="aw-tickets">
      <div className="aw-tickets-list">
        <div className="aw-tickets-head">
          <div className="aw-row">
            <h1 style={{ flex: 1 }}>Runs</h1>
            <button type="button" className="aw-btn" data-primary onClick={() => (setCreating(true), setOpenId(null))}>New run</button>
          </div>
        </div>
        {error && <p className="aw-error aw-pad">{error}</p>}
        {runs && runs.length === 0 && <p className="aw-muted aw-pad">No runs yet.</p>}
        <ul className="aw-ticket-rows">
          {runs?.map((r) => {
            const cur = currentStep(r);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="aw-ticket-row"
                  aria-current={r.id === openId || undefined}
                  onClick={() => (setOpenId(r.id), setCreating(false))}
                >
                  <span className="aw-ticket-key aw-mono">{r.ticket.key}</span>
                  <span className="aw-ticket-summary">{r.ticket.title || r.ticket.description.slice(0, 80)}</span>
                  {cur ? (
                    <span className="aw-pill" data-tone={r.running ? 'info' : STATE_TONE[cur.state]}>
                      {cur.index + 1}. {STEP_LABELS[cur.index].label}
                    </span>
                  ) : (
                    <span className="aw-pill" data-tone="ok">Finished</span>
                  )}
                  <span className="aw-ticket-meta">{r.repo}{r.error ? ' · failed' : r.running ? ' · working' : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="aw-tickets-detail">
        {creating ? (
          <NewRunForm onCreated={(r) => (setCreating(false), setOpenId(r.id), setRuns((rs) => (rs?.some((x) => x.id === r.id) ? rs : [r, ...(rs ?? [])])))} onCancel={() => setCreating(false)} />
        ) : open ? (
          <RunPanel key={open.id} run={open} onDeleted={() => (setOpenId(null), setRuns((rs) => rs?.filter((r) => r.id !== open.id) ?? null))} />
        ) : (
          <p className="aw-muted aw-pad">Pick a run, or start a new one.</p>
        )}
      </div>
    </div>
  );
}
