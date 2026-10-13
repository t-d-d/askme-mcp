import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Asks } from "./Asks";
import { Connect } from "./Connect";
import { Rules } from "./Rules";
import { cardIn, screenIn, type AskFirst, type Screen } from "./screen";
import { slide } from "./slide";
import { useDismissing, type Dismissing } from "./useDismissing";

const historyIndex = (): number | null =>
  "navigation" in window
    ? (window.navigation.currentEntry?.index ?? null)
    : null;

// The page is static files with no router (ADR 5), so the screen is named
// in the address's fragment.
function useScreen(): {
  screen: Screen;
  card: string | null;
  askFirst: AskFirst;
} {
  const [hash, setHash] = useState(() => window.location.hash);
  const question = useRef<string | null>(null);
  useEffect(() => {
    // The page sets the scroll itself. The list keeps its own place
    // (useListPlace.ts), and every other screen starts at the top.
    const restoring = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    let at = historyIndex();
    let returning = false;
    // Set when the browser drew its own transition, as a phone's may on a
    // swipe Back, so the page does not move the screen a second time.
    let browserDrew: string | null = null;
    const traverse = (event: PopStateEvent) => {
      browserDrew = event.hasUAVisualTransition ? window.location.href : null;
    };
    // hashchange comes after the fragment has changed. If the person stays,
    // go back to the entry they were on, so the history is left as it was,
    // or where the browser cannot say where that is, push the old address.
    const follow = (event: HashChangeEvent) => {
      const browserMoved = browserDrew === event.newURL;
      browserDrew = null;
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
      // Read the address when the slide runs, which may be a moment later.
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

// A new cache for each sign-in, so nothing one account loaded can show to
// the next, and the next one's first poll carries no version.
export function SignedIn() {
  const [queries] = useState(newQueries);
  const { screen, card, askFirst } = useScreen();
  // Above the screens, so a dismissal sent as the list goes, and its note if
  // it fails, outlive the list.
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
