'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AgentModelPickers } from '@/components/AgentModelPickers';
import { LinkOpener } from '@/components/LinkOpener';
import { CloseIcon, PanelIcon, TrashIcon, WorkflowIcon } from '@/components/icons';
import { call, type ManualTicket, type RepoSummary, type Run } from '@/lib/bridge';
import { OPEN_TASK_KEY } from '@/lib/models';
import { Conversation } from './Conversation';
import { ChangesCard } from './RunWork';
import { currentStep, STEP_LABELS } from './steps';

const SSO = /https:\/\/github\.com\/\S+\/sso\S*/;
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/**
 * One task, as an AI Office session: its title, the conversation, the box to
 * write in and — under it — the status bar where its agent, model and folder
 * are picked; the Changes panel beside it on demand. Its workflow is shown on
 * the Workflow page; here, only where it stands.
 */
export function TaskView({ run, onClose, onDeleted }: { run: Run; onClose: () => void; onDeleted: () => void }) {
  const router = useRouter();
  const [changesOpen, setChangesOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = run.ticket;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toWorkflow = () => {
    try {
      sessionStorage.setItem(OPEN_TASK_KEY, run.id);
    } catch {
      // the board opens without a card picked
    }
    router.push('/workflow');
  };

  const cur = currentStep(run);
  const started = run.sessionId != null;

  return (
    <>
      <header className="aw-panel-head aw-detail-head">
        <div className="aw-detail-heading">
          {renaming ? (
            <input
              className="aw-input aw-compact"
              defaultValue={t.title}
              autoFocus
              onFocus={(e) => e.target.select()}
              onBlur={(e) => (setRenaming(false), void act(() => call('runsSetTicket', run.id, { title: e.target.value })))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <h2 className="aw-detail-title" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {t.key && <span className="aw-mono aw-muted">{t.key} </span>}
              {t.title || 'New task'}
            </h2>
          )}
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="aw-btn aw-compact" onClick={() => setTicketOpen((v) => !v)} aria-expanded={ticketOpen}>
          {t.key || 'Ticket'}
        </button>
        {run.workflowStarted ? (
          <button type="button" className="aw-chip aw-wf-chip" onClick={toWorkflow} title="Open on the Workflow page">
            <WorkflowIcon size={13} />
            {cur ? `${cur.index + 1}. ${STEP_LABELS[cur.index].short}` : 'Finished'}
          </button>
        ) : (
          <button type="button" className="aw-btn aw-compact" disabled={run.running} onClick={() => void act(async () => (await call('runsStartWorkflow', run.id), toWorkflow()))} title="Carry it through the seven steps">
            <WorkflowIcon size={13} /> Run workflow
          </button>
        )}
        <button type="button" className="aw-icon-btn" data-active={changesOpen || undefined} onClick={() => setChangesOpen((v) => !v)} aria-label="File changes" title={changesOpen ? 'Close file changes' : 'Open file changes'}>
          <PanelIcon size={15} />
        </button>
        <button
          type="button"
          className="aw-icon-btn"
          aria-label="Delete the task"
          title="Delete the task"
          onClick={() => {
            const what = run.source === 'repo' ? 'Its checkout goes too.' : 'Its folder stays.';
            if (window.confirm(`Delete this task? ${what}`)) void act(async () => (await call('runsDelete', run.id), onDeleted()));
          }}
        >
          <TrashIcon size={15} />
        </button>
        <button type="button" className="aw-icon-btn" onClick={onClose} aria-label="Close" title="Close">
          <CloseIcon size={15} />
        </button>
      </header>

      {ticketOpen && <TicketForm ticket={t} onSave={(p) => void act(async () => (await call('runsSetTicket', run.id, p), setTicketOpen(false)))} onCancel={() => setTicketOpen(false)} />}

      {(run.error || error) && (
        <div className="aw-task-errors">
          {run.error && <p className="aw-error">{run.error.replace(/:\s*https:\/\/\S+$/, '')}</p>}
          {run.error && SSO.test(run.error) && <LinkOpener url={SSO.exec(run.error)![0]} />}
          {error && <p className="aw-error">{error}</p>}
        </div>
      )}

      <div className="aw-detail-body" data-changes={changesOpen || undefined}>
        <div className="aw-chat-pane">
          <Conversation
            run={run}
            statusbar={
              <div className="aw-statusbar">
                <span className="aw-claude-mark" title="Claude — the company account" aria-label="Claude">C</span>
                <span className="aw-dot-sep">·</span>
                <AgentModelPickers agent={run.agent} model={run.model} disabled={run.running} onChange={(o) => void act(() => call('runsSetOptions', run.id, o))} />
                <span className="aw-dot-sep">·</span>
                <PlacePicker run={run} locked={started || run.running} onError={setError} />
                {run.branch && (
                  <>
                    <span className="aw-dot-sep">·</span>
                    <span className="aw-mono aw-status-branch" title={run.branch}>⎇ {run.branch}</span>
                  </>
                )}
              </div>
            }
          />
        </div>
        {changesOpen && (
          <aside className="aw-changes-pane">
            <div className="aw-row aw-changes-head">
              <strong>Changes</strong>
              <span style={{ flex: 1 }} />
              <button type="button" className="aw-btn aw-compact" onClick={() => void act(() => call('runsOpenFolder', run.id, 'vscode'))}>VS Code</button>
              <button type="button" className="aw-btn aw-compact" onClick={() => void act(() => call('runsOpenFolder', run.id, 'folder'))}>Folder</button>
            </div>
            <div className="aw-side-body">
              {run.source === 'none' ? <p className="aw-muted aw-small">Pick where the task works first.</p> : <ChangesCard run={run} />}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}

/** Where the task works, picked in the status bar as a session's folder is: a company repo, or a folder here. */
function PlacePicker({ run, locked, onError }: { run: Run; locked: boolean; onError: (e: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState(run.repo);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    call('githubAllRepos').then(setRepos).catch(() => {});
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const set = async (place: { repo?: string; folder?: string }) => {
    onError(null);
    try {
      await call('runsSetPlace', run.id, place);
      setOpen(false);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const pickFolder = async () => {
    const f = await call('pickFolder', 'The folder this task works in');
    if (f) await set({ folder: f });
  };

  const label = run.source === 'repo' ? run.repo : run.source === 'folder' ? baseName(run.folder ?? '') : 'Choose where it works';
  return (
    <span className="aw-place" ref={box}>
      <button
        type="button"
        className="aw-status-folder"
        data-set={run.source !== 'none' || undefined}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
        title={locked ? `${run.source === 'repo' ? run.repo : run.folder} — fixed once Claude has worked in it` : 'A company repo, or a folder on this computer'}
      >
        {run.source === 'repo' ? '⎇' : '📁'} {label}
      </button>
      {open && (
        <div className="aw-popover" role="dialog" aria-label="Where it works">
          <strong className="aw-small">Company repo</strong>
          <div className="aw-row aw-nowrap">
            <input className="aw-input aw-compact aw-mono" list="aw-place-repos" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" autoFocus />
            <button type="button" className="aw-btn aw-compact" data-primary disabled={!repo.trim()} onClick={() => void set({ repo })}>Use</button>
          </div>
          <datalist id="aw-place-repos">
            {repos.map((r) => (
              <option key={r.fullName} value={r.fullName} />
            ))}
          </datalist>
          <small className="aw-muted">Cloned through the VPN into a checkout of the task&apos;s own.</small>
          <hr className="aw-divider" />
          <strong className="aw-small">Folder on this computer</strong>
          <button type="button" className="aw-btn aw-compact" onClick={() => void pickFolder()}>Choose a folder…</button>
        </div>
      )}
    </span>
  );
}

/** The task's ticket, copied from Jira: key, title, description, link. */
function TicketForm({ ticket, onSave, onCancel }: { ticket: ManualTicket; onSave: (t: Partial<ManualTicket>) => void; onCancel: () => void }) {
  const [key, setKey] = useState(ticket.key);
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [url, setUrl] = useState(ticket.url ?? '');
  return (
    <div className="aw-ticket-form">
      <div className="aw-grid-key">
        <label className="aw-field">
          <span>Ticket key</span>
          <input className="aw-input aw-compact aw-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="BF9-123" />
        </label>
        <label className="aw-field">
          <span>Title</span>
          <input className="aw-input aw-compact" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <label className="aw-field">
        <span>Description <small>— what the workflow works from; pasted from Jira</small></span>
        <textarea className="aw-textarea aw-ticket-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="aw-field">
        <span>Link</span>
        <input className="aw-input aw-compact aw-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/browse/BF9-123" />
      </label>
      <div className="aw-row">
        <button type="button" className="aw-btn aw-compact" data-primary onClick={() => onSave({ key, title, description, url })}>Save</button>
        <button type="button" className="aw-btn aw-compact" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
