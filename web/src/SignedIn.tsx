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

export function SignedIn() {
  return useScreen() === "connect" ? <Connect /> : <Asks />;
}
