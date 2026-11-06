'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bridge, call, type AgentActivity as Activity, type Run } from '@/lib/bridge';
import { openTask } from '@/lib/open';
import { useLibrary } from '@/lib/use-library';
import { AgentsIcon, PlusIcon } from './icons';
import { Picker } from './Picker';

/** "42s", "3m 05s", "1h 12m". */
export function elapsed(fromIso: string, toIso: string | null, now: number): string {
  const s = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : now) - Date.parse(fromIso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** A popover anchored on its button, closed by a click outside or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node) && !(e.target as Element)?.closest?.('.ao-picker-menu')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, root };
}

/** One agent's row: who, doing what, for how long. */
function AgentRow({ name, kind, status, what, detail, since, until, now }: { name: string; kind: string; status: Activity['status']; what: ReactNode; detail?: string | null; since: string; until: string | null; now: number }) {
  return (
    <li className="ao-agents-row" data-status={status}>
      <span className="ao-agents-dot" data-status={status} />
      <span className="ao-agents-text">
        <span className="ao-agents-name">
          {name}
          <span className="ao-agents-kind">{kind}</span>
          <span className="ao-agents-time">{elapsed(since, until, now)}</span>
        </span>
        <span className="ao-agents-what">{what}</span>
        {detail && <span className="ao-agents-detail">{detail}</span>}
      </span>
    </li>
  );
}

/**
 * The agents working on a task: the turn's main agent (and the step it's
 * on), and the subagents Claude started — running ones first, then the
 * latest that finished.
 */
export function TaskAgents({ run }: { run: Run }) {
  const { open, setOpen, root } = usePopover();
  const running = run.agents.filter((a) => a.status === 'running');
  const now = useNow(open && (run.running || running.length > 0));
  const recent = run.agents.filter((a) => a.status !== 'running').slice(-8).reverse();
  const busy = (run.current ? 1 : 0) + running.length;
  return (
    <div className="ao-agents" ref={root}>
      <button type="button" className="ao-btn-secondary ao-btn-compact ao-agents-btn" data-busy={busy > 0 || undefined} onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Agents working on this task">
        <AgentsIcon size={13} />
        {busy > 0 ? `${busy} working` : 'Agents'}
      </button>
      {open && (
        <div className="ao-pipe-menu ao-agents-menu" role="dialog" aria-label="Agents on this task">
          <p className="ao-agents-title">Agents on this task</p>
          <ul className="ao-agents-list">
            {run.current ? (
              <AgentRow
                name={run.current.agent}
                kind="main"
                status="running"
                what={`${run.current.step}${run.current.model ? ` · ${run.current.model}` : ''}`}
                since={run.current.startedAt}
                until={null}
                now={now}
              />
            ) : (
              <li className="ao-agents-empty">Nothing running — the next message or step starts it.</li>
            )}
            {running.map((a) => (
              <AgentRow key={a.id} name={a.name} kind="subagent" status={a.status} what={a.description || a.step} detail={a.lastTool ? `${a.lastTool} · ${a.toolUses} step${a.toolUses === 1 ? '' : 's'}` : null} since={a.startedAt} until={a.endedAt} now={now} />
            ))}
          </ul>
          {recent.length > 0 && (
            <>
              <p className="ao-agents-sub">Earlier subagents</p>
              <ul className="ao-agents-list">
                {recent.map((a) => (
                  <AgentRow key={a.id} name={a.name} kind={a.step} status={a.status} what={a.description} detail={`${a.toolUses} step${a.toolUses === 1 ? '' : 's'}`} since={a.startedAt} until={a.endedAt} now={now} />
                ))}
              </ul>
            </>
          )}
          <p className="ao-pipe-menu-note">Claude starts subagents itself when a job splits up well — or ask for one with Run an agent, under the message box.</p>
        </div>
      )}
    </div>
  );
}

/** Asks for a library agent (or a general-purpose one) to do a job inside the task, as a subagent of its conversation. */
export function RunAgentButton({ run, disabled }: { run: Run; disabled: boolean }) {
  const { open, setOpen, root } = usePopover();
  const { library } = useLibrary();
  const [agent, setAgent] = useState('general-purpose');
  const [job, setJob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setError(null);
    try {
      await call(
        'runsSend',
        run.id,
        `Use the Agent tool with subagent_type "${agent}" for this job, wait for it to finish, then tell me briefly what it found or did:\n\n${job.trim()}`,
      );
      setJob('');
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="ao-agents" ref={root}>
      <button type="button" className="ao-status-folder" disabled={disabled} onClick={() => setOpen((v) => !v)} title="Have an agent do a job in this task">
        <PlusIcon size={12} />
        <span>Run an agent</span>
      </button>
      {open && (
        <div className="ao-pipe-menu ao-agents-menu ao-agents-run" role="dialog" aria-label="Run an agent">
          <p className="ao-agents-title">Run an agent in this task</p>
          <Picker<string>
            value={agent}
            onChange={setAgent}
            placement="up"
            ariaLabel="Agent"
            options={[{ value: 'general-purpose', label: 'General-purpose' }, ...(library?.agents ?? []).map((a) => ({ value: a.name, label: a.name }))]}
          />
          <textarea className="ao-task-input ao-agents-job" value={job} onChange={(e) => setJob(e.target.value)} placeholder="What should it do? e.g. Find every caller of PurchaseService.approve and list what each passes" autoFocus />
          <div className="ao-pipe-panel-actions">
            <button type="button" className="ao-btn-primary ao-btn-compact" disabled={!job.trim()} onClick={() => void send()}>
              Run
            </button>
          </div>
          {error && <p className="ao-task-panel-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** The top bar's count of everything working — every task's main agent and subagents — and the list of them. */
export function RunningAgents() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const { open, setOpen, root } = usePopover();
  useEffect(() => {
    call('runsList').then(setRuns).catch(() => {});
    return bridge().onRun((run) =>
      setRuns((rs) => ('deleted' in run ? rs.filter((r) => r.id !== run.id) : rs.some((r) => r.id === run.id) ? rs.map((r) => (r.id === run.id ? run : r)) : [run, ...rs])),
    );
  }, []);
  const working = useMemo(() => runs.filter((r) => r.current || r.agents.some((a) => a.status === 'running')), [runs]);
  const count = working.reduce((n, r) => n + (r.current ? 1 : 0) + r.agents.filter((a) => a.status === 'running').length, 0);
  const now = useNow(open && count > 0);
  return (
    <div className="ao-agents" ref={root}>
      <button type="button" className="ao-status-pill ao-running-pill" data-busy={count > 0 || undefined} onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Agents working now">
        <span className="ao-live-dot" data-busy={count > 0} />
        {count > 0 ? `${count} agent${count === 1 ? '' : 's'} working` : 'Idle'}
      </button>
      {open && (
        <div className="ao-pipe-menu ao-agents-menu ao-running-menu" role="dialog" aria-label="Agents working now">
          <p className="ao-agents-title">Working now</p>
          {working.length === 0 && <p className="ao-agents-empty">No agent is working.</p>}
          {working.map((r) => (
            <section key={r.id} className="ao-running-task">
              <button type="button" className="ao-running-task-head" onClick={() => (openTask(r.id, router), setOpen(false))}>
                {r.ticket.key && <span className="ao-mono-dim">{r.ticket.key}</span>}
                <span>{r.ticket.title || 'New task'}</span>
              </button>
              <ul className="ao-agents-list">
                {r.current && <AgentRow name={r.current.agent} kind="main" status="running" what={`${r.current.step}${r.current.model ? ` · ${r.current.model}` : ''}`} since={r.current.startedAt} until={null} now={now} />}
                {r.agents
                  .filter((a) => a.status === 'running')
                  .map((a) => (
                    <AgentRow key={a.id} name={a.name} kind="subagent" status={a.status} what={a.description || a.step} detail={a.lastTool} since={a.startedAt} until={null} now={now} />
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
