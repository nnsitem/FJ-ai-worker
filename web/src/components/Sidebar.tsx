'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import { GROUP_LABELS, NAV_ITEMS, routeOf, type NavItem } from '@/lib/nav-items';
import {
  AgentsIcon,
  ArtifactIcon,
  BoardIcon,
  CollapseIcon,
  ConnectionsIcon,
  ExpandIcon,
  PipelineIcon,
  SettingsIcon,
  TicketsIcon,
} from './icons';

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  '/tasks': BoardIcon,
  '/workflow': PipelineIcon,
  '/artifacts': ArtifactIcon,
  '/tickets': TicketsIcon,
  '/agents': AgentsIcon,
  '/': ConnectionsIcon,
  '/settings': SettingsIcon,
};

/** The sidebar collapsed to icons — a per-machine preference. */
const COLLAPSED_PREF = 'aw.sidebarCollapsed';

/**
 * AI Office's sidebar (components/Sidebar.tsx): the brand tile, the pages in
 * groups, Settings at the foot; collapsible to icons.
 */
export function Sidebar() {
  const path = routeOf(usePathname());
  // Read on mount: the static export's HTML is the full sidebar, and
  // hydration must match it.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered preference, once
      setCollapsed(localStorage.getItem(COLLAPSED_PREF) === '1');
    } catch {
      // a per-machine nicety only
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_PREF, c ? '0' : '1');
      } catch {
        // a per-machine nicety only
      }
      return !c;
    });

  const renderItem = (item: NavItem) => {
    const Icon = ICONS[item.href];
    return (
      <Link
        key={item.href}
        href={item.href}
        className="ao-nav-item"
        data-active={path === item.href}
        aria-current={path === item.href ? 'page' : undefined}
        // Collapsed, the name is only a tooltip away.
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
      >
        <Icon size={17} />
        <span>{item.label}</span>
      </Link>
    );
  };

  const renderGroup = (group: NavItem['group'], extraClass?: string) => {
    const label = GROUP_LABELS[group];
    return (
      <div className={`ao-nav-group${extraClass ? ` ${extraClass}` : ''}`}>
        {label && <p className="ao-nav-group-label">{label}</p>}
        {NAV_ITEMS.filter((n) => n.group === group).map(renderItem)}
      </div>
    );
  };

  return (
    <nav className="ao-sidebar" data-collapsed={collapsed || undefined}>
      <div className="ao-sidebar-header">
        <span className="ao-logo-tile ao-logo-fj" aria-hidden="true">
          FJ
        </span>
        <span className="ao-sidebar-brand">FJ AI WORKER</span>
        <button
          type="button"
          className="ao-icon-btn ao-sidebar-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ExpandIcon size={15} /> : <CollapseIcon size={15} />}
        </button>
      </div>

      {/* The pages scroll on a short window; the brand above and Settings below stay put. */}
      <div className="ao-sidebar-scroll">
        {renderGroup('work')}
        {renderGroup('setup')}
      </div>

      {renderGroup('bottom', 'ao-sidebar-bottom')}
    </nav>
  );
}
