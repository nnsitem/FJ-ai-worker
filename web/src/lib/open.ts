import { OPEN_TASK_KEY } from './models';

/**
 * Opening a task or an artifact from anywhere (the top bar's search and New
 * task, a Workflow card, an artifact's "Open task"). The wish is parked in
 * sessionStorage for a page that mounts after the navigation, and announced
 * for one that is already showing — whichever page it is, it takes it.
 */
export const OPEN_TASK_EVENT = 'aw:open-task';
export const OPEN_ARTIFACT_EVENT = 'aw:open-artifact';
export const OPEN_ARTIFACT_KEY = 'aw.openArtifact';

type Router = { push: (href: string) => void };

function park(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // the page opens without it
  }
}

/** Reads (and clears) what was parked for this page. */
export function takeParked(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return v;
  } catch {
    return null;
  }
}

export function openTask(id: string, router: Router): void {
  park(OPEN_TASK_KEY, id);
  window.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: id }));
  router.push('/tasks');
}

export function openArtifact(id: string, router: Router): void {
  park(OPEN_ARTIFACT_KEY, id);
  window.dispatchEvent(new CustomEvent(OPEN_ARTIFACT_EVENT, { detail: id }));
  router.push('/artifacts');
}
