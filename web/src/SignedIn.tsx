import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Asks } from "./Asks";
import { Connect } from "./Connect";

// The page is static files with no router (ADR 5), so its screens are
// named in the address's fragment: #connect, and anything else for the
// list. Links between them are real links, and Back works.
function useScreen(): "asks" | "connect" {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const follow = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
    };
  }, []);
  return hash === "#connect" ? "connect" : "asks";
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
  return (
    <QueryClientProvider client={queries}>
      {useScreen() === "connect" ? <Connect /> : <Asks />}
    </QueryClientProvider>
  );
}
