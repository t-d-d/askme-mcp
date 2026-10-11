// Who is signed in, as the page sees it. Clerk supplies it in production
// (clerk.tsx). The browser tests build the page with a stand-in of the same
// shape, because the gate cannot reach Clerk (ADR 9).
import { createContext, useContext } from "react";

export interface Auth {
  status: "loading" | "signed-out" | "signed-in";
  // A current session token for the page's API, or null when signed out.
  getToken: () => Promise<string | null>;
  // Each sends the person to Clerk's own screen, which sends them back.
  signIn: () => void;
  signUp: () => void;
}

export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (auth === null) throw new Error("The page has no sign-in provider.");
  return auth;
}
