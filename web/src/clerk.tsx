// Sign-in through Clerk (ADR 6). Sign-up and sign-in happen on Clerk's own
// screens, so at the 100-account limit of a development instance it is
// Clerk's screen that refuses a sign-up. The page only asks Clerk who is
// signed in, and for a session token to send to its API.
import { ClerkProvider, useAuth as useClerkAuth, useClerk } from "@clerk/react";
import { useMemo, type ReactNode } from "react";
import { z } from "zod";
import { AuthContext, type Auth } from "./auth";

// Clerk's publishable key, set when the page is built. It is public.
const publishableKey = z
  .string({ error: "Build the page with VITE_CLERK_PUBLISHABLE_KEY set." })
  .regex(/^pk_(?:test|live)_/u, {
    error: "VITE_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key.",
  })
  .parse(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function FromClerk({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const clerk = useClerk();
  const auth = useMemo<Auth>(
    () => ({
      status: !isLoaded ? "loading" : isSignedIn ? "signed-in" : "signed-out",
      getToken: () => getToken(),
      signIn: () => {
        void clerk.redirectToSignIn();
      },
      signUp: () => {
        void clerk.redirectToSignUp();
      },
    }),
    [isLoaded, isSignedIn, getToken, clerk],
  );
  return <AuthContext value={auth}>{children}</AuthContext>;
}

export function ClerkAuth({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <FromClerk>{children}</FromClerk>
    </ClerkProvider>
  );
}
