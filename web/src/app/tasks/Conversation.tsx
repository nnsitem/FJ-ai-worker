'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { call, type Run, type RunEvent } from '@/lib/bridge';

type Block =
  | { kind: 'you' | 'text' | 'system' | 'error'; event: RunEvent }
  /** Consecutive tool calls, folded into one line as in AI Office's sessions. */
  | { kind: 'tools'; events: RunEvent[] };

function blocks(events: RunEvent[]): Block[] {
  const out: Block[] = [];
  for (const e of events) {
    const last = out.at(-1);
    if (e.kind === 'tool') {
      if (last?.kind === 'tools') last.events.push(e);
      else out.push({ kind: 'tools', events: [e] });
    } else out.push({ kind: e.kind, event: e });
  }
  return out;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The task's conversation with Claude — the workflow's steps and the person's own messages — and the box to write in. */
export function Conversation({ run, statusbar }: { run: Run; statusbar?: ReactNode }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follows new messages while the person is at the bottom; leaves them be when they've scrolled up.
  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: 'end' });
  }, [run.events.length, run.running]);

  const send = async () => {
    const msg = text.trim();
    if (!msg || run.running) return;
    setError(null);
    try {
      await call('runsSend', run.id, msg);
      setText('');
      stick.current = true;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const list = blocks(run.events);

  return (
    <div className="aw-convo">
      <div
        ref={scroller}
        className="aw-convo-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {list.length === 0 && !run.running && (
          <div className="aw-empty">
            {run.source === 'none'
              ? 'Pick where this task works (under the message box), then tell Claude what it is about — paste the ticket, or describe it.'
              : 'Tell Claude what this task is about — or press Run workflow to carry its ticket through the seven steps.'}
          </div>
        )}
        {list.map((b, i) =>
          b.kind === 'tools' ? (
            <details key={i} className="aw-msg-tools">
              <summary>
                {b.events.length} step{b.events.length === 1 ? '' : 's'} · <span className="aw-mono">{b.events.at(-1)!.text.slice(0, 90)}</span>
              </summary>
              {b.events.map((e, j) => (
                <div key={j} className="aw-mono">{e.text}</div>
              ))}
            </details>
          ) : b.kind === 'you' ? (
            <div key={i} className="aw-msg aw-msg-you">
              <div className="aw-msg-bubble">{b.event.text}</div>
              <span className="aw-msg-time">{time(b.event.at)}</span>
            </div>
          ) : b.kind === 'text' ? (
            <div key={i} className="aw-msg aw-msg-claude">
              <span className="aw-msg-who">Claude</span>
              <div className="aw-prose">{b.event.text}</div>
            </div>
          ) : (
            <div key={i} className="aw-msg-note" data-kind={b.kind}>
              {b.event.text}
            </div>
          ),
        )}
        {run.running && (
          <div className="aw-thinking" aria-live="polite">
            <span /> <span /> <span /> Working…
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="aw-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="aw-composer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={run.running ? 'Claude is working on this task…' : run.sessionId ? 'Send a follow-up…' : 'Message Claude to start…'}
          rows={1}
        />
        <div className="aw-composer-bar">
          <span style={{ flex: 1 }} />
          {run.running ? (
            <button type="button" className="aw-send aw-send-stop" onClick={() => void call('runsStop', run.id)} aria-label="Stop" title="Stop">
              <span className="aw-stop-square" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="aw-send" disabled={!text.trim()} aria-label="Send" title="Send (Enter)">
              ↑
            </button>
          )}
        </div>
      </form>
      {error && <p className="aw-error aw-composer-error">{error}</p>}
      {statusbar}
    </div>
  );
}
