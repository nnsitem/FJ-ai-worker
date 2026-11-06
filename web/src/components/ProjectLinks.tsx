'use client';

import { useEffect, useState } from 'react';
import { PlusIcon, TrashIcon } from './icons';
import { call, type JiraProject, type ProjectLink, type RepoSummary } from '@/lib/bridge';

/**
 * Which repo each Jira project's tickets are fixed in. Both fields suggest
 * from Jira's projects and the repos GitHub reaches, and take anything typed
 * when either isn't connected yet.
 */
export function ProjectLinks({ links, onChange }: { links: ProjectLink[]; onChange: (links: ProjectLink[]) => void }) {
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);

  useEffect(() => {
    call('jiraProjects').then(setProjects).catch(() => {});
    call('githubAllRepos').then(setRepos).catch(() => {});
  }, []);

  const set = (i: number, patch: Partial<ProjectLink>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="ao-links">
      {links.length === 0 && <p className="ao-soft">No projects linked yet.</p>}
      {links.map((l, i) => (
        <div key={i} className="ao-link-row">
          <input
            className="ao-task-input ao-mono-input"
            list="ao-jira-projects"
            value={l.jiraKey}
            onChange={(e) => set(i, { jiraKey: e.target.value.toUpperCase() })}
            placeholder="Jira project, e.g. BF9"
            aria-label="Jira project key"
          />
          <span className="ao-soft" aria-hidden="true">→</span>
          <input
            className="ao-task-input ao-mono-input"
            list="ao-github-repos"
            value={l.repo}
            onChange={(e) => set(i, { repo: e.target.value })}
            placeholder="owner/repo"
            aria-label="GitHub repo"
          />
          <button type="button" className="ao-icon-btn" onClick={() => onChange(links.filter((_, j) => j !== i))} aria-label="Remove" title="Remove">
            <TrashIcon size={14} />
          </button>
        </div>
      ))}
      <div className="ao-status-actions">
        <button type="button" className="ao-btn-secondary" onClick={() => onChange([...links, { jiraKey: '', repo: '' }])}>
          <PlusIcon size={13} /> Link a project
        </button>
      </div>
      <datalist id="ao-jira-projects">
        {projects.map((p) => (
          <option key={p.key} value={p.key}>{p.name}</option>
        ))}
      </datalist>
      <datalist id="ao-github-repos">
        {repos.map((r) => (
          <option key={r.fullName} value={r.fullName} />
        ))}
      </datalist>
    </div>
  );
}
