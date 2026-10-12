// Swiping a card or a row sideways dismisses it (docs/design.md, "The open
// card"). The element follows the finger, and goes once it has travelled a
// good way. A shorter drag puts it back. A drag that starts up or down is a
// scroll, and is left to the browser.
//
// Where the element is while it follows the finger is data from the
// gesture, so it is set on the element itself (ADR 14). The rest is in the
// element's stylesheet: touch-action, and the movement back, which marks
// the drag with a data-dragging attribute.
import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

// How far, in pixels, the pointer moves before the page decides whether
// the person is swiping or scrolling.
const decideAfterPx = 8;

// The share of its width an element must travel to be dismissed.
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
  // A swipe ends with a click on whatever it started on. It is not a tap,
  // so the click is stopped before it follows a link.
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
