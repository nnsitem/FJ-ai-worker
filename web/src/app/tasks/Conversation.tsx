'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CheckIcon, ChevronRight, SendIcon, ToolIcon } from '@/components/icons';
import { call, type Run, type RunEvent } from '@/lib/bridge';
import { Markdown } from '@/lib/markdown';

type Block =
  | { kind: 'message'; index: number; event: RunEvent }
  /** A run of tool calls, folded into one group as in AI Office's sessions. */
  | { kind: 'tools'; index: number; events: RunEvent[] };

function blocks(events: RunEvent[]): Block[] {
  const out: Block[] = [];
  events.forEach((e, index) => {
    const last = out.at(-1);
    if (e.kind === 'tool') {
      if (last?.kind === 'tools') last.events.push(e);
      else out.push({ kind: 'tools', index, events: [e] });
    } else out.push({ kind: 'message', index, event: e });
  });
  return out;
}

/** A tool line from the run ("Read src/x.ts", "$ npm test") as AI Office's step: its name, then what it was on. */
function toolSummary(text: string): { name: string; target: string } {
  if (text.startsWith('$ ')) return { name: 'Bash', target: text.slice(2) };
  const i = text.indexOf(' ');
  return i < 0 ? { name: text, target: '' } : { name: text.slice(0, i), target: text.slice(i + 1) };
}

/** AI Office's MessageRow, for this app's events: you, Claude's text, the app's notes and errors. */
function MessageRow({ event }: { event: RunEvent }) {
  // The app's own short notes — a step done, a branch made — as a quiet line in the flow.
  if (event.kind === 'system' && event.text.length <= 220) {
    return (
      <div className="ao-msg-note">
        <span className="ao-msg-note-dot" aria-hidden="true" />
        <span>{event.text}</span>
      </div>
    );
  }
  const kind = event.kind === 'you' ? 'user' : event.kind;
  return (
    <div className="ao-msg" data-kind={kind}>
      {kind !== 'user' && kind !== 'text' && <p className="ao-msg-role">{kind}</p>}
      {/* What you wrote shows as typed; only Claude's replies are Markdown. */}
      {kind === 'user' ? <p className="ao-msg-text">{event.text}</p> : <Markdown text={event.text} />}
    </div>
  );
}

/**
 * One collapsible group for a run of tool calls — collapsed even while it's
 * the live tail; its summary line's spinner says something is happening.
 */
function ToolGroup({ events, running }: { events: RunEvent[]; running: boolean }) {
  const current = running ? toolSummary(events.at(-1)!.text) : null;
  return (
    <details className="ao-tool-group">
      <summary className="ao-tool-group-summary">
        <span className="ao-tool-group-chevron">
          <ChevronRight size={11} />
        </span>
        {current ? (
          <>
            <span className="ao-spinner" />
            <span className="ao-tool-group-label">Running {current.name}…</span>
          </>
        ) : (
          <>
            <ToolIcon size={12} />
            <span className="ao-tool-group-label">
              {events.length} tool call{events.length === 1 ? '' : 's'}
            </span>
          </>
        )}
      </summary>
      <div className="ao-tool-group-steps">
        {events.map((e, i) => {
          const { name, target } = toolSummary(e.text);
          const live = running && i === events.length - 1;
          return (
            <details key={i} className="ao-tool-step">
              <summary className="ao-tool-step-summary">
                {live ? <span className="ao-spinner" /> : <CheckIcon size={13} />}
                <span className="ao-tool-name">{name}</span>
                <span className="ao-tool-target">{target || '—'}</span>
              </summary>
              <pre className="ao-tool-detail">
                {e.text}
                {`\n\n${new Date(e.at).toLocaleTimeString()}`}
              </pre>
            </details>
          );
        })}
      </div>
    </details>
  );
}

function ThinkingIndicator() {
  return (
    <div className="ao-thinking">
      <span className="ao-spinner" />
      <span>Working…</span>
    </div>
  );
}

/** The task's conversation with Claude — the workflow's steps and your own messages. */
export function Transcript({ run }: { run: Run }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follows new messages while you're at the bottom; leaves you be when you've scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [run.events.length, run.running]);

  const list = blocks(run.events);
  const last = list.at(-1);

  return (
    <div
      ref={scroller}
      className="ao-transcript-scroll"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="ao-transcript">
        {list.length === 0 && !run.running && (
          <p className="ao-empty">
            {run.source === 'none'
              ? 'Pick where this task works (under the message box), then tell Claude what it is about — paste the ticket, or describe it.'
              : 'Tell Claude what this task is about — or press Run workflow to carry its ticket through the seven steps.'}
          </p>
        )}
        {list.map((b) =>
          b.kind === 'tools' ? (
            <ToolGroup key={b.index} events={b.events} running={run.running && b === last} />
          ) : (
            <MessageRow key={b.index} event={b.event} />
          ),
        )}
        {run.running && last?.kind !== 'tools' && <ThinkingIndicator />}
      </div>
    </div>
  );
}

/** AI Office's composer: the message grows upward; Send, or Stop while Claude works. */
export function Composer({ run }: { run: Run }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Grows with the message, to the cap in board.css.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = async () => {
    const msg = text.trim();
    if (!msg || run.running || sending) return;
    setError(null);
    setSending(true);
    try {
      await call('runsSend', run.id, msg);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form
      className="ao-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {error && <p className="ao-attach-error">{error}</p>}
      <textarea
        ref={input}
        className="ao-composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={run.running || sending}
        placeholder={run.running ? 'Claude is working on this task…' : run.sessionId ? 'Send a follow-up…' : 'Message Claude to start…'}
        rows={1}
      />
      <div className="ao-composer-bar">
        <div className="ao-spacer" />
        {run.running ? (
          <button type="button" className="ao-send ao-send-stop" onClick={() => void call('runsStop', run.id)} aria-label="Stop" title="Stop Claude">
            <span className="ao-stop-square" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="ao-send" disabled={sending || !text.trim()} aria-label="Send" title="Send (Enter)">
            <SendIcon size={15} />
          </button>
        )}
      </div>
    </form>
  );
}
