/**
 * Opening the terminal panel (components/TerminalDock.tsx) from anywhere:
 * show it, optionally starting a terminal in it (the VPN script, or a shell).
 */
export const DOCK_EVENT = 'aw:terminal-dock';

export type DockRequest = { action: 'toggle' } | { action: 'open'; start?: 'vpn' | 'shell' };

export function requestDock(req: DockRequest): void {
  window.dispatchEvent(new CustomEvent<DockRequest>(DOCK_EVENT, { detail: req }));
}
