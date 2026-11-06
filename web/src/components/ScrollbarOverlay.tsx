'use client';

import { useEffect, useRef } from 'react';

/**
 * App-wide overlay scrollbars.
 *
 * Native scrollbars are hidden everywhere (globals.css) because a classic
 * Chromium scrollbar always reserves its track — it narrows every list it
 * sits in, even at rest — and `overflow: overlay`, which used to avoid that,
 * is gone from Chromium. Instead this draws one thin thumb per axis, floating
 * over the edge of whichever element is scrolling: it appears when that
 * element scrolls (wheel, trackpad, keyboard, programmatic), fades out
 * shortly after, and can be grabbed and dragged while it's showing.
 *
 * One listener for the whole document — `scroll` doesn't bubble but it can be
 * captured — so no scroll container needs wiring of its own.
 */

const THICKNESS = 5; // px, the thumb's short side
const INSET = 2; // px, gap between thumb and the element's edge
const MIN_THUMB = 28; // px, so a very long list still has something to grab
const HIDE_AFTER = 900; // ms after the last scroll or drag

type Axis = 'y' | 'x';

/** The part of `el` actually on screen — intersected with every ancestor
 *  that clips (overflow ≠ visible), so a column scrolled half out of the
 *  board's track doesn't draw its thumb over the next panel. */
function visibleRect(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  let top = r.top;
  let left = r.left;
  let right = r.right;
  let bottom = r.bottom;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const pr = p.getBoundingClientRect();
    top = Math.max(top, pr.top);
    left = Math.max(left, pr.left);
    right = Math.min(right, pr.right);
    bottom = Math.min(bottom, pr.bottom);
  }
  if (right <= left || bottom <= top) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

export function ScrollbarOverlay() {
  const yRef = useRef<HTMLDivElement | null>(null);
  const xRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const thumbs: Record<Axis, HTMLDivElement | null> = { y: yRef.current, x: xRef.current };
    let target: Element | null = null;
    let hideTimer: number | undefined;
    let frame = 0;
    let dragging: { axis: Axis; start: number; startScroll: number; ratio: number } | null = null;

    const hide = () => {
      if (dragging) return;
      thumbs.y?.removeAttribute('data-visible');
      thumbs.x?.removeAttribute('data-visible');
    };

    const scheduleHide = () => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, HIDE_AFTER);
    };

    const place = () => {
      frame = 0;
      const el = target;
      if (!el || !el.isConnected) return hide();
      const box = el.getBoundingClientRect();
      const vis = visibleRect(el);

      const y = thumbs.y;
      if (y) {
        const range = el.scrollHeight - el.clientHeight;
        // Only when the element's own right edge is on screen — otherwise the
        // thumb would float over whatever is clipping it.
        if (range > 0 && vis && box.right <= vis.right + 0.5) {
          const track = el.clientHeight - INSET * 2;
          const size = Math.max(MIN_THUMB, (el.clientHeight / el.scrollHeight) * track);
          const top = box.top + INSET + (el.scrollTop / range) * (track - size);
          y.style.transform = `translate(${box.right - INSET - THICKNESS}px, ${top}px)`;
          y.style.height = `${size}px`;
          y.setAttribute('data-visible', '');
        } else {
          y.removeAttribute('data-visible');
        }
      }

      const x = thumbs.x;
      if (x) {
        const range = el.scrollWidth - el.clientWidth;
        if (range > 0 && vis && box.bottom <= vis.bottom + 0.5) {
          const track = el.clientWidth - INSET * 2;
          const size = Math.max(MIN_THUMB, (el.clientWidth / el.scrollWidth) * track);
          const left = box.left + INSET + (el.scrollLeft / range) * (track - size);
          x.style.transform = `translate(${left}px, ${box.bottom - INSET - THICKNESS}px)`;
          x.style.width = `${size}px`;
          x.setAttribute('data-visible', '');
        } else {
          x.removeAttribute('data-visible');
        }
      }
    };

    const onScroll = (e: Event) => {
      const el = e.target;
      // The document itself never scrolls in this app (the shell is fixed to
      // the viewport); every real scroller is an element.
      if (!(el instanceof Element)) return;
      target = el;
      if (!frame) frame = requestAnimationFrame(place);
      scheduleHide();
    };

    // Dragging a thumb: pointer travel along the track maps to scroll offset
    // by the same ratio the thumb's position was derived from.
    const onPointerDown = (axis: Axis) => (e: PointerEvent) => {
      const el = target;
      const thumb = thumbs[axis];
      if (!el || !thumb) return;
      e.preventDefault();
      thumb.setPointerCapture(e.pointerId);
      const client = axis === 'y' ? el.clientHeight : el.clientWidth;
      const scroll = axis === 'y' ? el.scrollHeight : el.scrollWidth;
      const size = axis === 'y' ? thumb.offsetHeight : thumb.offsetWidth;
      const track = client - INSET * 2 - size;
      dragging = {
        axis,
        start: axis === 'y' ? e.clientY : e.clientX,
        startScroll: axis === 'y' ? el.scrollTop : el.scrollLeft,
        ratio: track > 0 ? (scroll - client) / track : 0,
      };
      thumb.setAttribute('data-dragging', '');
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || !target) return;
      const delta = (dragging.axis === 'y' ? e.clientY : e.clientX) - dragging.start;
      const next = dragging.startScroll + delta * dragging.ratio;
      if (dragging.axis === 'y') target.scrollTop = next;
      else target.scrollLeft = next;
    };

    const onPointerUp = () => {
      if (!dragging) return;
      thumbs[dragging.axis]?.removeAttribute('data-dragging');
      dragging = null;
      scheduleHide();
    };

    // Keep the thumb up while the pointer rests on it, so it can be grabbed.
    const onEnter = () => window.clearTimeout(hideTimer);
    const onLeave = () => scheduleHide();

    const downY = onPointerDown('y');
    const downX = onPointerDown('x');
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    for (const [thumb, down] of [
      [thumbs.y, downY],
      [thumbs.x, downX],
    ] as const) {
      thumb?.addEventListener('pointerdown', down);
      thumb?.addEventListener('pointermove', onPointerMove);
      thumb?.addEventListener('pointerup', onPointerUp);
      thumb?.addEventListener('pointercancel', onPointerUp);
      thumb?.addEventListener('pointerenter', onEnter);
      thumb?.addEventListener('pointerleave', onLeave);
    }

    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.clearTimeout(hideTimer);
      if (frame) cancelAnimationFrame(frame);
      for (const [thumb, down] of [
        [thumbs.y, downY],
        [thumbs.x, downX],
      ] as const) {
        thumb?.removeEventListener('pointerdown', down);
        thumb?.removeEventListener('pointermove', onPointerMove);
        thumb?.removeEventListener('pointerup', onPointerUp);
        thumb?.removeEventListener('pointercancel', onPointerUp);
        thumb?.removeEventListener('pointerenter', onEnter);
        thumb?.removeEventListener('pointerleave', onLeave);
      }
    };
  }, []);

  return (
    <>
      <div ref={yRef} className="ao-overlay-thumb" data-axis="y" aria-hidden="true" />
      <div ref={xRef} className="ao-overlay-thumb" data-axis="x" aria-hidden="true" />
    </>
  );
}
