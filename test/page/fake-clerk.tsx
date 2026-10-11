// A stand-in for Clerk in the browser tier (ADR 9). The gate is offline, so
// test/page-server.ts builds the page with this in place of
// web/src/clerk.tsx. A test signs in by putting a session token in local
// storage before the page loads, and reads which of Clerk's screens the
// page asked for from session storage.
import { useMemo, type ReactNode } from "react";
import { AuthContext, type Auth } from "../../web/src/auth";
import { askedForKey, sessionKey } from "./keys";

export function ClerkAuth({ children }: { children: ReactNode }) {
  const auth = useMemo<Auth>(() => {
    const token = localStorage.getItem(sessionKey);
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
  }, []);
  return <AuthContext value={auth}>{children}</AuthContext>;
}
