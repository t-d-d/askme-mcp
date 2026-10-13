// Slides between screens with view transitions. The motion is in base.css.
import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";

export const layers = { list: 0, card: 1, rules: 1, connect: 2 } as const;

// Each screen sets this as it draws, since a card's address can show the
// list, as when its ask has gone.
let drawn: number = layers.list;

export function useLayer(layer: number): void {
  useLayoutEffect(() => {
    drawn = layer;
  });
}

let underWay: ViewTransition | null = null;

let held: (() => void)[] | null = null;

// browserMoved: the browser has drawn its own movement, as a phone's may on
// Back. A change in the frame before the browser has pictured the old screen
// joins the slide, so the picture shows the screen as it was before either.
// While a slide runs, taps go to the browser's pictures of the screens,
// whatever the page's styles say.
export function slide(change: () => void, browserMoved = false): void {
  if (held !== null) {
    held.push(change);
    if (browserMoved) underWay?.skipTransition();
    return;
  }
  if (
    browserMoved ||
    underWay !== null ||
    !("startViewTransition" in document) ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    change();
    return;
  }
  const from = drawn;
  const root = document.documentElement;
  const changes = [change];
  held = changes;
  // The browser takes the new screen's picture as soon as this returns.
  const transition = document.startViewTransition(() => {
    held = null;
    flushSync(() => {
      for (const each of changes) each();
    });
    if (drawn > from) root.dataset.slide = "in";
    else if (drawn < from) root.dataset.slide = "out";
    else transition.skipTransition();
  });
  underWay = transition;
  const done = () => {
    underWay = null;
    delete root.dataset.slide;
  };
  void transition.finished.then(done, done);
}
