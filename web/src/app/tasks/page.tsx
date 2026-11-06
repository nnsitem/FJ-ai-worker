'use client';

import { useEffect, useState } from 'react';
import { Panel } from '@/components/Panel';
import { AddIcon, RunsIcon } from '@/components/icons';
import { bridge, call, type Run } from '@/lib/bridge';
import { NEW_TASK_AGENT_KEY, OPEN_TASK_KEY } from '@/lib/models';
import { NewTaskForm } from './NewTaskForm';
import { TaskView } from './TaskView';
import { currentStep, STATE_TONE, STEP_LABELS } from './steps';

/** Tasks: the list, and the open one — its conversation with Claude and its workflow. */
export default function TasksPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** An agent card's "Start a task": the new task's agent. */
  const [presetAgent, setPresetAgent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let wanted: string | null = null;
    let withAgent: string | null = null;
    try {
      wanted = sessionStorage.getItem(OPEN_TASK_KEY);
      withAgent = sessionStorage.getItem(NEW_TASK_AGENT_KEY);
      sessionStorage.removeItem(OPEN_TASK_KEY);
      sessionStorage.removeItem(NEW_TASK_AGENT_KEY);
    } catch {
      // opened without a wish
    }
    if (withAgent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the page that sent us here
      setPresetAgent(withAgent);
      setCreating(true);
    }
    call('runsList')
      .then((r) => {
        setRuns(r);
        if (withAgent) return;
        if (wanted && r.some((x) => x.id === wanted)) setOpenId(wanted);
        else if (r.length === 0) setCreating(true);
        else setOpenId(r[0].id);
      })
      .catch((e) => setError((e as Error).message));
    return bridge().onRun((run) =>
      setRuns((rs) => {
        if (!rs) return rs;
        if ('deleted' in run) return rs.filter((r) => r.id !== run.id);
        const i = rs.findIndex((r) => r.id === run.id);
        return i < 0 ? [run, ...rs] : rs.map((r) => (r.id === run.id ? run : r));
      }),
    );
  }, []);

  const open = runs?.find((r) => r.id === openId) ?? null;

  return (
    <div className="aw-split aw-split-tasks">
      <Panel
        title="Tasks"
        actions={
          <button type="button" className="aw-btn" data-primary onClick={() => (setCreating(true), setOpenId(null))}>
            <AddIcon size={15} /> New task
          </button>
        }
      >
        <div className="aw-panel-body">
          {error && <p className="aw-error aw-pad">{error}</p>}
          {runs && runs.length === 0 && <p className="aw-muted aw-pad">No tasks yet.</p>}
          <ul className="aw-rows">
            {runs?.map((r) => {
              const cur = currentStep(r);
              return (
                <li key={r.id}>
                  <button type="button" className="aw-row-btn" aria-current={r.id === openId || undefined} onClick={() => (setOpenId(r.id), setCreating(false))}>
                    <span className="aw-row-key">{r.ticket.key || (r.running ? '●' : '·')}</span>
                    <span className="aw-row-title">{r.ticket.title || r.ticket.description.slice(0, 80)}</span>
                    {!r.workflowStarted ? (
                      <span className="aw-pill" data-tone={r.running ? 'info' : undefined}>{r.running ? 'Working' : 'Chat'}</span>
                    ) : cur ? (
                      <span className="aw-pill" data-tone={r.running ? 'info' : STATE_TONE[cur.state]}>
                        {cur.index + 1}. {STEP_LABELS[cur.index].short}
                      </span>
                    ) : (
                      <span className="aw-pill" data-tone="ok">Finished</span>
                    )}
                    <span className="aw-row-meta">
                      {r.source === 'repo' ? r.repo : (r.folder ?? '').split(/[\\/]/).pop()}
                      {r.error ? ' · needs you' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Panel>
      <section className="aw-panel">
        {creating ? (
          <div className="aw-panel-body">
            <NewTaskForm
              presetAgent={presetAgent}
              onCreated={(r) => (setCreating(false), setOpenId(r.id), setRuns((rs) => (rs?.some((x) => x.id === r.id) ? rs : [r, ...(rs ?? [])])))}
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : open ? (
          <TaskView key={open.id} run={open} onDeleted={() => setOpenId(null)} />
        ) : (
          <div className="aw-empty">
            <RunsIcon size={28} />
            Pick a task, or start a new one.
          </div>
        )}
      </section>
    </div>
  );
}
