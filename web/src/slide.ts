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

// The changes a slide holds while the browser draws the picture of the
// screen being left, in the order they came, or null when no slide waits.
let held: (() => void)[] | null = null;

// Makes a change that may draw another screen, sliding if it does. The
// change is made at once when the person's device asks for reduced motion,
// when the browser cannot draw the pictures, and when it has drawn its own
// movement already, as a phone's browser may on Back. A change while a slide
// is under way is made at once too, and shows as part of that slide.
//
// A slide holds its change for about a frame, until the browser has drawn
// the picture of the screen being left. A change that comes in that frame
// joins the slide and is held behind it, so the changes are made in the
// order they came and the picture shows the screen as it was before either.
//
// The page cannot be tapped while the screens move. Taps go to the pictures,
// whatever the page's styles say.
export function slide(change: () => void, browserMoved = false): void {
  if (held !== null) {
    held.push(change);
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
  // The browser draws the new screen's picture once the changes return, so
  // React draws them at once, and the slide's direction is worked out from
  // the screen they leave drawn.
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
