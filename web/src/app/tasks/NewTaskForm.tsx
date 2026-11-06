'use client';

import { useEffect, useState } from 'react';
import { AgentModelPickers } from '@/components/AgentModelPickers';
import { call, type RepoSummary, type Run, type Settings } from '@/lib/bridge';

/**
 * A new task: what it is (a ticket copied from Jira, or just a name), where
 * it works — a company repo or a folder on this machine — and with which
 * agent and model. Its workflow starts now, or later from the task.
 */
export function NewTaskForm({ onCreated, onCancel, presetAgent }: { onCreated: (r: Run) => void; onCancel: () => void; presetAgent?: string | null }) {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [where, setWhere] = useState<'repo' | 'folder'>('repo');
  const [repo, setRepo] = useState('');
  const [repoTouched, setRepoTouched] = useState(false);
  const [folder, setFolder] = useState('');
  /** undefined: the default agent (Agents & skills), until picked. */
  const [agentPick, setAgent] = useState<string | null | undefined>(presetAgent ?? undefined);
  const [model, setModel] = useState<string | null>(null);
  const [testCommand, setTestCommand] = useState<string | null>(null);
  const [rounds, setRounds] = useState<number | null>(null);
  const [startNow, setStartNow] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('getSettings').then(setSettings).catch(() => {});
    call('githubAllRepos').then(setRepos).catch(() => {});
  }, []);

  const agent = agentPick !== undefined ? agentPick : (settings?.defaultAgent ?? null);
  const cleanKey = key.trim().toUpperCase();
  // The project's linked repo (Settings › Projects), until one is picked by hand.
  const linked = settings?.projects.find((p) => cleanKey.startsWith(`${p.jiraKey}-`))?.repo ?? '';
  const repoValue = repoTouched ? repo : repo || linked;
  const testValue = testCommand ?? (where === 'repo' ? settings?.repos[repoValue.trim()]?.testCommand : '') ?? '';
  const roundsValue = rounds ?? settings?.workflow.test.rounds ?? 3;
  const url = settings?.jira.site && /^[A-Z][A-Z0-9_]+-\d+$/.test(cleanKey) ? `${settings.jira.site}/browse/${cleanKey}` : null;
  const placeOk = where === 'repo' ? !!repoValue.trim() : !!folder;

  const pickFolder = async () => {
    const f = await call('pickFolder', 'The folder this task works in');
    if (f) setFolder(f);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await call('runsCreate', {
          ticket: { key: cleanKey, title, description, url },
          ...(where === 'repo' ? { repo: repoValue } : { folder }),
          agent,
          model,
          testCommand: testValue,
          maxRounds: roundsValue,
          startWorkflow: startNow,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="aw-detail aw-new-task">
      <h2>New task</h2>
      <div className="aw-grid-key">
        <label className="aw-field">
          <span>Ticket key <small>(optional)</small></span>
          <input className="aw-input aw-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="BF9-123" autoFocus />
        </label>
        <label className="aw-field">
          <span>Title</span>
          <input className="aw-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the task is" />
        </label>
      </div>
      <label className="aw-field">
        <span>Description</span>
        <textarea className="aw-textarea aw-textarea-tall" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste the ticket from Jira — steps to reproduce, expected and actual behaviour, acceptance criteria…" />
      </label>

      <div className="aw-field">
        <span>Works in</span>
        <div className="aw-segmented" role="tablist">
          <button type="button" role="tab" aria-selected={where === 'repo'} onClick={() => setWhere('repo')}>Company repo</button>
          <button type="button" role="tab" aria-selected={where === 'folder'} onClick={() => setWhere('folder')}>Folder on this computer</button>
        </div>
        {where === 'repo' ? (
          <>
            <input
              className="aw-input aw-mono"
              list="aw-task-repos"
              value={repoValue}
              onChange={(e) => {
                setRepoTouched(true);
                setRepo(e.target.value);
              }}
              placeholder="owner/repo"
            />
            <datalist id="aw-task-repos">
              {repos.map((r) => (
                <option key={r.fullName} value={r.fullName} />
              ))}
            </datalist>
            <small>Cloned through the VPN into a checkout of the task&apos;s own{linked && !repoTouched ? ` — linked to ${cleanKey.split('-')[0]} in Settings` : ''}.</small>
          </>
        ) : (
          <>
            <div className="aw-row aw-nowrap">
              <input className="aw-input aw-mono" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Users/you/Workspace/project" />
              <button type="button" className="aw-btn" onClick={() => void pickFolder()}>Choose…</button>
            </div>
            <small>Claude works in the folder as it is; the fix makes a branch there when it&apos;s a git repo.</small>
          </>
        )}
      </div>

      <div className="aw-field">
        <span>Agent and model</span>
        <div className="aw-row">
          <AgentModelPickers agent={agent} model={model} onChange={(o) => ('agent' in o ? setAgent(o.agent ?? null) : setModel(o.model ?? null))} />
        </div>
        <small>For talking to Claude, and for workflow steps with none set on the Workflow page.</small>
      </div>

      <details className="aw-more">
        <summary>Tests (step 5)</summary>
        <div className="aw-grid-rounds">
          <label className="aw-field">
            <span>Test command</span>
            <input className="aw-input aw-mono" value={testValue} onChange={(e) => setTestCommand(e.target.value)} placeholder="e.g. npm test — empty: Claude finds and runs the tests" />
          </label>
          <label className="aw-field">
            <span>Rounds</span>
            <input className="aw-input" type="number" min={1} max={10} value={roundsValue} onChange={(e) => setRounds(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
        </div>
      </details>

      <label className="aw-check">
        <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
        <span>Run the workflow now <span className="aw-muted">— off: just talk to Claude first, and run it from the task later</span></span>
      </label>
      <div className="aw-row">
        <button type="button" className="aw-btn" data-primary disabled={busy || (!cleanKey && !title.trim()) || !placeOk} onClick={create}>
          {busy ? 'Creating…' : 'Create task'}
        </button>
        <button type="button" className="aw-btn" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="aw-error">{error}</p>}
    </div>
  );
}
