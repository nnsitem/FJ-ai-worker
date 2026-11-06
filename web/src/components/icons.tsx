// Icons from the Solar set (Bold Duotone), through @solar-icons/react — the
// same set and the same mappings as AI Office's components/icons.tsx. Named
// for what they do; each maps to one glyph. They draw with currentColor, so
// they take their control's colour.

import type { ComponentType } from 'react';
import {
  AddCircleIcon as SolarAddCircle,
  AltArrowDownIcon as SolarAltArrowDown,
  AltArrowLeftIcon as SolarAltArrowLeft,
  AltArrowRightIcon as SolarAltArrowRight,
  AltArrowUpIcon as SolarAltArrowUp,
  ArrowLeftIcon as SolarArrowLeft,
  ArrowUpIcon as SolarArrowUp,
  Book2Icon as SolarBook2,
  ChatRoundDotsIcon as SolarChatRoundDots,
  CheckCircleIcon as SolarCheckCircle,
  CheckIcon as SolarCheck,
  ClipboardListIcon as SolarClipboardList,
  CloseCircleIcon as SolarCloseCircle,
  CloseIcon as SolarClose,
  CodeIcon as SolarCode,
  CodeSquareIcon as SolarCodeSquare,
  DocumentsIcon as SolarDocuments,
  DoubleAltArrowLeftIcon as SolarDoubleLeft,
  DoubleAltArrowRightIcon as SolarDoubleRight,
  EyeIcon as SolarEye,
  FileTextIcon as SolarFileText,
  FolderIcon as SolarFolder,
  FolderWithFilesIcon as SolarFolderWithFiles,
  GitBranchIcon as SolarGitBranch,
  InfoCircleIcon as SolarInfoCircle,
  KanbanIcon as SolarKanban,
  LinkRoundIcon as SolarLinkRound,
  ListIcon as SolarList,
  MagnifierIcon as SolarMagnifier,
  PenIcon as SolarPen,
  PlayCircleIcon as SolarPlayCircle,
  PlugCircleIcon as SolarPlugCircle,
  RefreshIcon as SolarRefresh,
  SettingsIcon as SolarSettings,
  ShieldNetworkIcon as SolarShieldNetwork,
  SidebarMinimalisticIcon as SolarSidebarMinimalistic,
  SquareBottomDownIcon as SolarSquareBottomDown,
  TableIcon as SolarTable,
  TicketIcon as SolarTicket,
  TrashBinMinimalisticIcon as SolarTrashBinMinimalistic,
  Tuning2Icon as SolarTuning2,
  UsersGroupTwoRoundedIcon as SolarUsersGroupTwoRounded,
  Widget4Icon as SolarWidget4,
} from '@solar-icons/react/bold-duotone';

type IconProps = { size?: number };
type SolarIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

function solar(Glyph: SolarIcon) {
  function Icon({ size = 16 }: IconProps) {
    return <Glyph size={size} aria-hidden />;
  }
  return Icon;
}

/* ---------- navigation (AI Office's own glyphs for its counterparts) ---------- */

/** solar:widget-4 — Tasks nav (AI Office's Sessions). */
export const BoardIcon = solar(SolarWidget4);
/** solar:kanban — Workflow nav (AI Office's Agents Board). */
export const PipelineIcon = solar(SolarKanban);
/** solar:documents — Artifacts nav. */
export const ArtifactIcon = solar(SolarDocuments);
/** solar:clipboard-list — Tickets nav. */
export const TicketsIcon = solar(SolarClipboardList);
/** solar:users-group-two-rounded — Agents & skills nav, an agent. */
export const AgentsIcon = solar(SolarUsersGroupTwoRounded);
/** solar:plug-circle — Connections nav (AI Office's Integrations). */
export const ConnectionsIcon = solar(SolarPlugCircle);
/** solar:settings — Settings nav. */
export const SettingsIcon = solar(SolarSettings);
/** solar:double-alt-arrow-left / -right — collapse and expand the sidebar. */
export const CollapseIcon = solar(SolarDoubleLeft);
export const ExpandIcon = solar(SolarDoubleRight);

/* ---------- things ---------- */

/** solar:shield-network — the VPN. */
export const VpnIcon = solar(SolarShieldNetwork);
/** solar:code-square — GitHub; tool calls. */
export const GithubIcon = solar(SolarCodeSquare);
export const ToolIcon = solar(SolarCodeSquare);
/** solar:chat-round-dots — Claude. */
export const ClaudeIcon = solar(SolarChatRoundDots);
/** solar:ticket — Jira, a ticket. */
export const JiraIcon = solar(SolarTicket);
/** solar:book-2 — Skills. */
export const BookIcon = solar(SolarBook2);
/** solar:folder-with-files — Project context. */
export const ProjectIcon = solar(SolarFolderWithFiles);
/** solar:folder — a folder. */
export const FolderIcon = solar(SolarFolder);
/** solar:file-text — a file. */
export const FileIcon = solar(SolarFileText);
/** solar:git-branch — a branch, a repo. */
export const BranchIcon = solar(SolarGitBranch);
/** solar:code — a terminal; a file's source. */
export const TerminalIcon = solar(SolarCode);
export const CodeIcon = solar(SolarCode);
/** solar:table — a table. */
export const TableIcon = solar(SolarTable);
/** solar:link-round — open elsewhere. */
export const LinkIcon = solar(SolarLinkRound);

/* ---------- actions ---------- */

/** solar:magnifier — search fields. */
export const SearchIcon = solar(SolarMagnifier);
/** solar:add-circle — new task, add. */
export const PlusIcon = solar(SolarAddCircle);
/** solar:play-circle — run the workflow. */
export const PlayIcon = solar(SolarPlayCircle);
/** solar:arrow-up — send a message. */
export const SendIcon = solar(SolarArrowUp);
/** solar:close — close a panel, clear a field. */
export const CloseIcon = solar(SolarClose);
/** solar:trash-bin-minimalistic — delete. */
export const TrashIcon = solar(SolarTrashBinMinimalistic);
/** solar:pen — rename, edit. */
export const EditIcon = solar(SolarPen);
/** solar:eye — preview. */
export const EyeIcon = solar(SolarEye);
/** solar:refresh — check again. */
export const RefreshIcon = solar(SolarRefresh);
/** solar:tuning-2 — step settings (AI Office's StageSettings). */
export const SlidersIcon = solar(SolarTuning2);
/** solar:sidebar-minimalistic — show / hide a panel. */
export const PanelIcon = solar(SolarSidebarMinimalistic);
/** solar:square-bottom-down — the terminal panel under the page. */
export const DockIcon = solar(SolarSquareBottomDown);
/** solar:widget-4 / list — Cards and List view toggles. */
export const GridIcon = solar(SolarWidget4);
export const ListIcon = solar(SolarList);
/** solar:arrow-left — back. */
export const BackIcon = solar(SolarArrowLeft);

/* ---------- marks ---------- */

/** solar:check — a plain tick. */
export const CheckMarkIcon = solar(SolarCheck);
/** solar:check-circle — done, a successful step. */
export const CheckIcon = solar(SolarCheckCircle);
/** solar:close-circle — a failed step. */
export const ErrorIcon = solar(SolarCloseCircle);
/** solar:info-circle — About. */
export const InfoIcon = solar(SolarInfoCircle);
/** solar:alt-arrow-* — disclosure. */
export const ChevronRight = solar(SolarAltArrowRight);
export const ChevronLeft = solar(SolarAltArrowLeft);
export const ChevronUp = solar(SolarAltArrowUp);
export const ChevronDown = solar(SolarAltArrowDown);
