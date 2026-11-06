/**
 * Which AI is working on a session, as its mark: Claude's starburst or the
 * OpenAI knot (Codex). Sized by the surrounding CSS (.ao-agent-mark), or by
 * `size` where there is none (the agent picker).
 */
export function AgentLogo({ provider, size }: { provider: 'claude' | 'codex'; size?: number }) {
  if (provider === 'claude')
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <g stroke="#D97757" strokeWidth="2.6" strokeLinecap="round">
          {[0, 30, 60, 90, 120, 150].map((a) => (
            <line key={a} x1="12" y1="2.5" x2="12" y2="21.5" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7">
        {[0, 60, 120].map((a) => (
          <rect key={a} x="7" y="2.5" width="10" height="19" rx="5" transform={`rotate(${a} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

export const ClaudeLogo = ({ size }: { size?: number }) => <AgentLogo provider="claude" size={size} />;
export const CodexLogo = ({ size }: { size?: number }) => <AgentLogo provider="codex" size={size} />;
