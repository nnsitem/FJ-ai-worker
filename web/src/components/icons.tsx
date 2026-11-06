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
  TrashBinTrashIcon as SolarTrash,
  AltArrowUpIcon as SolarUp,
  AltArrowDownIcon as SolarDown,
  CloseIcon as SolarClose,
  UsersGroupRoundedIcon as SolarAgents,
  DocumentsIcon as SolarDocuments,
  Widget4Icon as SolarBoard,
  ChatRoundLineIcon as SolarChatLine,
  BookBookmarkIcon as SolarSkills,
  FolderWithFilesIcon as SolarProject,
  SquareBottomDownIcon as SolarPanel,
} from '@solar-icons/react/bold-duotone';

type IconProps = { size?: number };
type SolarIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

function solar(Glyph: SolarIcon) {
  function Icon({ size = 16 }: IconProps) {
    return <Glyph size={size} aria-hidden />;
  }
  return Icon;
}

/** Tasks (a conversation each). */
export const RunsIcon = solar(SolarChatLine);
export const PlayIcon = solar(SolarPlayCircle);
export const WorkflowIcon = solar(SolarBoard);
export const ArtifactsIcon = solar(SolarDocuments);
export const AgentsIcon = solar(SolarAgents);
export const TicketsIcon = solar(SolarClipboardList);
export const ConnectionsIcon = solar(SolarPlugCircle);
export const SettingsIcon = solar(SolarSettings);
export const VpnIcon = solar(SolarShieldNetwork);
export const GithubIcon = solar(SolarCodeSquare);
export const ClaudeIcon = solar(SolarChat);
export const JiraIcon = solar(SolarTicket);
export const AddIcon = solar(SolarAddCircle);
export const TerminalIcon = solar(SolarCode);
export const TrashIcon = solar(SolarTrash);
export const ChevronUpIcon = solar(SolarUp);
export const ChevronDownIcon = solar(SolarDown);
export const CloseIcon = solar(SolarClose);
/** The panel toggle in the top bar. */
export const PanelIcon = solar(SolarPanel);
export const SkillsIcon = solar(SolarSkills);
export const ProjectIcon = solar(SolarProject);
