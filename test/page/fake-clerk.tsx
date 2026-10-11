// A stand-in for Clerk in the browser tier (ADR 9). The gate is offline, so
// test/page-server.ts builds the page with this in place of
// web/src/clerk.tsx. A test signs in by putting a session token in local
// storage before the page loads, and reads which of Clerk's screens the
// page asked for from session storage. A test signs in or out later by
// changing the token and sending sessionChangedEvent.
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AuthContext, type Auth } from "../../web/src/auth";
import { askedForKey, sessionChangedEvent, sessionKey } from "./keys";

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
      signIn: () => {
        sessionStorage.setItem(askedForKey, "sign-in");
      },
      signUp: () => {
        sessionStorage.setItem(askedForKey, "sign-up");
      },
    };
  }, [token]);
  return <AuthContext value={auth}>{children}</AuthContext>;
}
