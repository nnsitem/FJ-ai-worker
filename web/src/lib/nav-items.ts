/** The app's pages — the sidebar's links and the search's "Pages", from one list. */
export interface NavItem {
  href: string;
  label: string;
  group: 'work' | 'setup' | 'bottom';
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/tasks', label: 'Tasks', group: 'work' },
  { href: '/workflow', label: 'Workflow', group: 'work' },
  { href: '/artifacts', label: 'Artifacts', group: 'work' },
  { href: '/tickets', label: 'Tickets', group: 'work' },
  { href: '/agents', label: 'Agents & skills', group: 'setup' },
  { href: '/', label: 'Connections', group: 'setup' },
  { href: '/settings', label: 'Settings', group: 'bottom' },
];

export const GROUP_LABELS: Partial<Record<NavItem['group'], string>> = {
  work: 'Work',
  setup: 'Setup',
};

/** The route as the sidebar names it: the static export's `.html` and a trailing slash dropped. */
export const routeOf = (pathname: string) => pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
