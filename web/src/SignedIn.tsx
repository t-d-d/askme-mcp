import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Asks } from "./Asks";
import { Connect } from "./Connect";
import { Rules } from "./Rules";
import { cardIn, screenIn, type AskFirst, type Screen } from "./screen";
import { slide } from "./slide";
import { useDismissing, type Dismissing } from "./useDismissing";

// Where this page's entry sits in the history, where the browser can say.
const historyIndex = (): number | null =>
  "navigation" in window
    ? (window.navigation.currentEntry?.index ?? null)
    : null;

// The page is static files with no router (ADR 5), so its screens are
// named in the address's fragment: #connect, #rules, and anything else for
// the list, with #ask/<id> opening one ask's card over it. Links between
// them are real links, and Back works. "All asks" goes back to the list
// rather than adding it to the history again (toList.ts).
//
// Each screen starts at the top. The list and its cards are one screen,
// which keeps the list's place itself (useListPlace.ts), so the browser
// keeps none of its own for Back. A screen that sits higher than the one
// it opens from slides in, and slides out as it goes (slide.ts).
function useScreen(): {
  screen: Screen;
  card: string | null;
  askFirst: AskFirst;
} {
  const [hash, setHash] = useState(() => window.location.hash);
  const question = useRef<string | null>(null);
  useEffect(() => {
    const restoring = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    let at = historyIndex();
    let returning = false;
    // The address a traversal of the history has reached, when the browser
    // drew its own movement on the way, as a phone's browser may when the
    // person swipes Back. The page does not move the screen a second time.
    let drawn: string | null = null;
    const traverse = (event: PopStateEvent) => {
      drawn = event.hasUAVisualTransition ? window.location.href : null;
    };
    // A link, Back or a typed address has changed the fragment before the
    // page hears of it. If the person stays, the page goes back to the
    // entry they were on, so the history is left as it was. A browser that
    // cannot say where that entry is gets the old address as a new entry.
    const follow = (event: HashChangeEvent) => {
      const browserMoved = drawn === event.newURL;
      drawn = null;
      if (returning) {
        returning = false;
        return;
      }
      const here = historyIndex();
      if (question.current !== null && !window.confirm(question.current)) {
        if (at !== null && here !== null && at !== here) {
          returning = true;
          window.history.go(at - here);
        } else {
          window.history.pushState(null, "", event.oldURL);
          at = historyIndex();
        }
        return;
      }
      at = here;
      const left = screenIn(new URL(event.oldURL).hash);
      // The address is read as the screen changes, which a slide holds back
      // a moment.
      slide(() => {
        setHash(window.location.hash);
        if (screenIn(window.location.hash) !== left) window.scrollTo(0, 0);
      }, browserMoved);
    };
    window.addEventListener("popstate", traverse);
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("popstate", traverse);
      window.removeEventListener("hashchange", follow);
      window.history.scrollRestoration = restoring;
    };
  }, []);
  const askFirst = useCallback<AskFirst>((asked) => {
    question.current = asked;
  }, []);
  return { screen: screenIn(hash), card: cardIn(hash), askFirst };
}

// A failed load shows at once, and the page's own timers try again, so
// nothing is retried behind its back.
const newQueries = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Each time someone signs in, the page loads into a cache of its own, which
// goes when they sign out. Nothing one account loaded can show to the next,
// and the next one's first poll carries no version.
export function SignedIn() {
  const [queries] = useState(newQueries);
  const { screen, card, askFirst } = useScreen();
  // Kept above the screens, so a dismissal sent as the list goes, and the
  // note if it fails, outlive the list (dismissing.ts).
  const dismissing = useDismissing(screen === "asks");
  return (
    <QueryClientProvider client={queries}>
      <Shown
        screen={screen}
        card={card}
        askFirst={askFirst}
        dismissing={dismissing}
      />
    </QueryClientProvider>
  );
}

// The list and an open card are one screen, so the list keeps its tab
// while a card is open.
function Shown({
  screen,
  card,
  askFirst,
  dismissing,
}: {
  screen: Screen;
  card: string | null;
  askFirst: AskFirst;
  dismissing: Dismissing;
}) {
  switch (screen) {
    case "asks":
      return <Asks card={card} dismissing={dismissing} />;
    case "connect":
      return <Connect />;
    case "rules":
      return <Rules askFirst={askFirst} />;
  }
}
