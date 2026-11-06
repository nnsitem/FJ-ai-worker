'use client';

import type { Run } from '@/lib/bridge';
import { currentStep } from '../tasks/steps';

export type MinimapColumn = { id: string; label: string; short: string };

/**
 * The whole workflow at a glance: a block per step, in its colour, and a dot
 * per task in it — pulsing while Claude works, ringed when it waits for you.
 * A dot opens its task; a block brings its column into view.
 */
export function Minimap({
  columns,
  runs,
  columnOf,
  selected,
  onPick,
}: {
  columns: MinimapColumn[];
  runs: Run[];
  columnOf: (r: Run) => string;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const showColumn = (id: string) => document.querySelector(`.ao-wf-columns [data-col="${id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  const total = runs.length;
  return (
    <div className="ao-minimap" role="navigation" aria-label="Where every task is">
      {columns.map((col) => {
        const here = runs.filter((r) => columnOf(r) === col.id);
        const shown = here.slice(0, 18);
        return (
          <div key={col.id} className="ao-minimap-step" data-step={col.id} data-empty={here.length === 0 || undefined} style={{ flexGrow: 1 + (total ? (here.length / total) * 4 : 0) }}>
            <button type="button" className="ao-minimap-head" onClick={() => showColumn(col.id)} title={`${col.label} — ${here.length} task${here.length === 1 ? '' : 's'}`}>
              <span className="ao-minimap-label">{col.short}</span>
              <span className="ao-minimap-count">{here.length}</span>
            </button>
            <div className="ao-minimap-bar" />
            <div className="ao-minimap-dots">
              {shown.map((r) => {
                const cur = currentStep(r);
                const waiting = !r.running && r.workflowStarted && (!!r.error || cur?.state === 'waiting');
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="ao-minimap-dot"
                    data-running={r.running || undefined}
                    data-waiting={waiting || undefined}
                    data-error={r.error ? true : undefined}
                    aria-current={r.id === selected || undefined}
                    onClick={() => onPick(r.id)}
                    title={`${r.ticket.key ? `${r.ticket.key} · ` : ''}${r.ticket.title || 'New task'}${r.running ? ' — working' : waiting ? ' — waiting for you' : ''}`}
                  />
                );
              })}
              {here.length > shown.length && <span className="ao-minimap-more">+{here.length - shown.length}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
