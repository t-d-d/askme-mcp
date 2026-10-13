// Moving between screens (docs/design.md, "Movement"). A screen that sits
// higher slides in from the right over the one it opens from, and slides out
// to the right to show the one under it. The browser draws a picture of each
// screen and moves the pictures (base.css), so nothing on either screen moves
// by itself.
import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";

// How high each screen sits: the list at the foot, an ask's card and the
// rules over it, and Connect your agents, which the rules link to, over the
// rules.
export const layers = { list: 0, card: 1, rules: 1, connect: 2 } as const;

// The layer of the screen drawn last. A card's address can show the list,
// as when its ask has gone, so each screen says what it is as it is drawn.
let drawn: number = layers.list;

export function useLayer(layer: number): void {
  useLayoutEffect(() => {
    drawn = layer;
  });
}

// The slide under way, if one is.
let underWay: ViewTransition | null = null;

// Makes a change that may draw another screen, sliding if it does. The
// change is made at once when the person's device asks for reduced motion,
// when the browser cannot draw the pictures, and when it has drawn its own
// movement already, as a phone's browser may on Back. A change while a slide
// is under way is made at once too, and shows as part of that slide.
//
// The page cannot be tapped while the screens move. Taps go to the pictures,
// whatever the page's styles say.
export function slide(change: () => void, browserMoved = false): void {
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
  // The browser draws the new screen's picture once the change returns, so
  // React draws it at once.
  const transition = document.startViewTransition(() => {
    flushSync(change);
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
