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
export const ToolIcon = solar(SolarCodeSquare);
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

/* ---------- brand marks (Simple Icons, CC0) ---------- */

function brand(d: string, fill: string) {
  function Icon({ size = 16 }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-hidden>
        <path d={d} />
      </svg>
    );
  }
  return Icon;
}

/** GitHub mark. */
export const GithubIcon = brand(
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  'currentColor',
);

/** Claude mark. */
export const ClaudeIcon = brand(
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  '#D97757',
);

/** GitHub Copilot mark. */
export const CopilotIcon = brand(
  'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z',
  'currentColor',
);

/** Jira mark. */
export const JiraIcon = brand(
  'M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z',
  '#2684FF',
);
