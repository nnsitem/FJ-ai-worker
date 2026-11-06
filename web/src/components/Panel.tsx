import type { ReactNode } from 'react';

/** A framed content panel: its header (title, a line under it, actions) and a scrolling body. */
export function Panel({
  title,
  sub,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`aw-panel${className ? ` ${className}` : ''}`}>
      <header className="aw-panel-head">
        <div className="aw-panel-head-text">
          <h1 className="aw-panel-title">{title}</h1>
          {sub && <p className="aw-panel-sub">{sub}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
