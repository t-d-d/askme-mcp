// The drag's position is set on the element as data from the gesture
// (ADR 14). touch-action and the slide back are in the stylesheet, which
// keys on data-dragging.
import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

const decideAfterPx = 8;

const dismissShare = 0.35;

interface Drag {
  pointer: number;
  x: number;
  y: number;
  swiping: boolean;
}

export interface Swipe {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  // A swipe ends with a click on what it started on, which must not follow
  // a link.
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

const putBack = (element: HTMLElement) => {
  delete element.dataset.dragging;
  element.style.removeProperty("translate");
};

// The element that is swiped must be keyed by its ask, so that the next
// ask never inherits where a dismissed one was left.
export function useSwipe(onSwiped: () => void): Swipe {
  const drag = useRef<Drag | null>(null);
  const swiped = useRef(false);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    swiped.current = false;
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      swiping: false,
    };
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (current?.pointer !== event.pointerId) return;
    const element = event.currentTarget;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.swiping) {
      if (Math.abs(dy) > decideAfterPx && Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (Math.abs(dx) <= decideAfterPx) return;
      current.swiping = true;
      element.setPointerCapture(event.pointerId);
      element.dataset.dragging = "";
      window.getSelection()?.removeAllRanges();
    }
    element.style.setProperty("translate", `${String(dx)}px 0`);
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (current?.pointer !== event.pointerId) return;
      drag.current = null;
      if (!current.swiping) return;
      swiped.current = true;
      const element = event.currentTarget;
      const travelled = Math.abs(event.clientX - current.x);
      // A dismissed element stays where the finger left it until the list
      // drops it, so it does not slide back first.
      if (travelled >= element.offsetWidth * dismissShare) onSwiped();
      else putBack(element);
    },
    [onSwiped],
  );

  const onPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    putBack(event.currentTarget);
  }, []);

  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!swiped.current) return;
    swiped.current = false;
    // A keyboard click (detail 0) never ends a swipe, and a touch swipe that
    // went back may leave no click to clear swiped.
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  };
}
