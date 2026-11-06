'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// The least either side of the divider may take, as a share of the window —
// and the width every panel opens at.
const MIN_SHARE = 0.3;

// Until the window can be measured (the static export's HTML), a width in
// the region of 30% of the default 1280px window.
const FALLBACK_WIDTH = 384;

/**
 * A detail panel beside a board, resized by dragging the divider between
 * them (`.ao-resizer`) — the Sessions, Team, Workload and Artifacts pages'
 * side panels all work this way.
 *
 * Neither side may shrink below 30% of the WINDOW (MIN_SHARE). The board
 * (left) fills whatever the panel (right) leaves, so bounding the panel's
 * width to [30% window, board − gap − 30% window] keeps both at ≥30%. The
 * width is clamped again whenever the window resizes.
 *
 * A panel opens at that minimum every time: call `resetWidth()` when it
 * opens. Dragging it wider lasts until it's closed; nothing is remembered.
 *
 * Attach `boardRef` to the element holding both the board and the panel —
 * its width is what the bounds are measured against.
 */
export function usePanelResize(minPx = 0) {
  const boardRef = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  const bounds = useCallback(() => {
    const el = boardRef.current;
    const boardW = el?.clientWidth ?? window.innerWidth;
    // The row's gap sits between board and panel; left out, the board could
    // be dragged a gap's width under its floor.
    const gap = el ? parseFloat(getComputedStyle(el).columnGap) || 0 : 0;
    // FJ AI Worker: a panel may ask for more than the share (a task's conversation).
    const floor = Math.max(window.innerWidth * MIN_SHARE, Math.min(minPx, window.innerWidth * 0.5));
    return { min: floor, max: Math.max(floor, boardW - gap - floor) };
  }, [minPx]);

  const clampTo = useCallback(
    (w: number) => {
      const { min, max } = bounds();
      return Math.min(max, Math.max(min, w));
    },
    [bounds]
  );

  /** Back to the minimum — what a panel opens at. */
  const resetWidth = useCallback(() => setWidth(bounds().min), [bounds]);

  // Measured on mount rather than in a lazy initializer: the static export's
  // HTML has the fallback, and hydration must match it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetWidth();
    const onResize = () => setWidth((w) => clampTo(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resetWidth, clampTo]);

  // Drag the divider: the panel grows as the pointer moves left.
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: MouseEvent) => setWidth(clampTo(startW + (startX - ev.clientX)));
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [width, clampTo]
  );

  return { boardRef, width, startResize, resetWidth };
}
