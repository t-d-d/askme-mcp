// Clerk supplies this in production (clerk.tsx). The browser tests supply a
// stand-in, because the gate cannot reach Clerk (ADR 9).
import { createContext, useContext } from "react";

export interface Auth {
  status: "loading" | "signed-out" | "signed-in";
  getToken: () => Promise<string | null>;
  email: string | null;
  signIn: () => void;
  signUp: () => void;
  signOut: () => void;
}

export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (auth === null) throw new Error("The page has no sign-in provider.");
  return auth;
}
