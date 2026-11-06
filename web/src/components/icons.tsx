// Icons from the Solar set (Bold Duotone), through @solar-icons/react — the
// same set as AI Office. Named for what they do; each maps to one glyph.
// They draw with currentColor, so they take their control's colour.

import type { ComponentType } from 'react';
import {
  ClipboardListIcon as SolarClipboardList,
  PlugCircleIcon as SolarPlugCircle,
  PlayCircleIcon as SolarPlayCircle,
  SettingsIcon as SolarSettings,
  ShieldNetworkIcon as SolarShieldNetwork,
  CodeSquareIcon as SolarCodeSquare,
  ChatRoundDotsIcon as SolarChat,
  TicketIcon as SolarTicket,
  AddCircleIcon as SolarAddCircle,
  CodeIcon as SolarCode,
} from '@solar-icons/react/bold-duotone';

type IconProps = { size?: number };
type SolarIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

function solar(Glyph: SolarIcon) {
  function Icon({ size = 16 }: IconProps) {
    return <Glyph size={size} aria-hidden />;
  }
  return Icon;
}

export const RunsIcon = solar(SolarPlayCircle);
export const TicketsIcon = solar(SolarClipboardList);
export const ConnectionsIcon = solar(SolarPlugCircle);
export const SettingsIcon = solar(SolarSettings);
export const VpnIcon = solar(SolarShieldNetwork);
export const GithubIcon = solar(SolarCodeSquare);
export const ClaudeIcon = solar(SolarChat);
export const JiraIcon = solar(SolarTicket);
export const AddIcon = solar(SolarAddCircle);
export const TerminalIcon = solar(SolarCode);
