/**
 * A library agent's avatar: its initials on a colour picked by a hash of its
 * name, so an agent keeps its colour across syncs. The Agents page shows it
 * at 38px (CSS); the role picker passes `size`.
 */

// The app's own accent hues.
const TILE_TONES = ['amber', 'blue', 'violet', 'green', 'red', 'accent', 'teal'] as const;

export function tileTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_TONES[h % TILE_TONES.length];
}

export function initials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function AgentTile({ name, size }: { name: string; size?: number }) {
  return (
    <span
      className="ao-agent-tile"
      data-tone={tileTone(name)}
      style={
        size
          ? {
              width: size,
              height: size,
              fontSize: Math.max(7, Math.round(size * 0.36)),
              borderRadius: Math.round(size * 0.26),
            }
          : undefined
      }
    >
      {initials(name)}
    </span>
  );
}
