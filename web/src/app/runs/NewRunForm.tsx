'use client';

import { useEffect, useState } from 'react';
import { call, type RepoSummary, type Run, type Settings } from '@/lib/bridge';

/**
 * A run from a ticket typed in by hand (until Jira is allowed): its key,
 * title and description pasted from Jira, and the repo to work in.
 */
export function NewRunForm({ onCreated, onCancel }: { onCreated: (r: Run) => void; onCancel: () => void }) {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [repo, setRepo] = useState('');
  const [repoTouched, setRepoTouched] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('getSettings').then(setSettings).catch(() => {});
    call('githubAllRepos').then(setRepos).catch(() => {});
  }, []);

  const cleanKey = key.trim().toUpperCase();
  // The project's linked repo (Settings › Projects), until one is picked by hand.
  const linked = settings?.projects.find((p) => cleanKey.startsWith(`${p.jiraKey}-`))?.repo ?? '';
  const repoValue = repoTouched ? repo : repo || linked;
  const url = settings?.jira.site && /^[A-Z][A-Z0-9_]+-\d+$/.test(cleanKey) ? `${settings.jira.site}/browse/${cleanKey}` : null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await call('runsCreate', { ticket: { key: cleanKey, title, description, url }, repo: repoValue, autoApprove }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="aw-run">
      <h2>New run</h2>
      <p className="aw-muted">Copy the ticket from Jira. Claude reads the repo, then writes a plan for you to check before any code changes.</p>
      <div className="aw-grid-key">
        <label className="aw-field">
          <span>Ticket key</span>
          <input className="aw-input aw-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="BF9-123" autoFocus />
        </label>
        <label className="aw-field">
          <span>Title</span>
          <input className="aw-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The ticket’s summary" />
        </label>
      </div>
      <label className="aw-field">
        <span>Description</span>
        <textarea className="aw-textarea aw-textarea-tall" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste the ticket’s description — steps to reproduce, expected and actual behaviour, acceptance criteria…" />
      </label>
      <label className="aw-field">
        <span>Repo</span>
        <input
          className="aw-input aw-mono"
          list="aw-run-repos"
          value={repoValue}
          onChange={(e) => {
            setRepoTouched(true);
            setRepo(e.target.value);
          }}
          placeholder="owner/repo"
        />
        <datalist id="aw-run-repos">
          {repos.map((r) => (
            <option key={r.fullName} value={r.fullName} />
          ))}
        </datalist>
        {linked && !repoTouched && <small>Linked to {cleanKey.split('-')[0]} in Settings › Projects.</small>}
      </label>
      <label className="aw-check">
        <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
        <span>Skip the plan review <span className="aw-muted">— go on as soon as the plan is written (step 3)</span></span>
      </label>
      <div className="aw-row">
        <button type="button" className="aw-btn" data-primary disabled={busy || !cleanKey || !repoValue.trim() || (!title.trim() && !description.trim())} onClick={start}>
          {busy ? 'Starting…' : 'Start'}
        </button>
        <button type="button" className="aw-btn" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="aw-error">{error}</p>}
    </div>
  );
}
