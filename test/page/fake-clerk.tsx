// test/page-server.ts builds the page with this in place of
// web/src/clerk.tsx.
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AuthContext, type Auth } from "../../web/src/auth";
import { askedForKey, emailKey, sessionChangedEvent, sessionKey } from "./keys";

const subscribe = (changed: () => void) => {
  window.addEventListener(sessionChangedEvent, changed);
  return () => {
    window.removeEventListener(sessionChangedEvent, changed);
  };
};

const currentToken = () => localStorage.getItem(sessionKey);

export function ClerkAuth({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribe, currentToken);
  const auth = useMemo<Auth>(() => {
    return {
      status: token === null ? "signed-out" : "signed-in",
      getToken: () => Promise.resolve(token),
      email: token === null ? null : localStorage.getItem(emailKey),
      signIn: () => {
        sessionStorage.setItem(askedForKey, "sign-in");
      },
      signUp: () => {
        sessionStorage.setItem(askedForKey, "sign-up");
      },
      signOut: () => {
        sessionStorage.setItem(askedForKey, "sign-out");
        localStorage.removeItem(sessionKey);
        window.dispatchEvent(new Event(sessionChangedEvent));
      },
    };
  }, [token]);
  return <AuthContext value={auth}>{children}</AuthContext>;
}
