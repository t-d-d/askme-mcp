// Sign-up happens on Clerk's own screens, so at a development instance's
// 100-account limit it is Clerk, not this page, that refuses it.
import {
  ClerkProvider,
  useAuth as useClerkAuth,
  useClerk,
  useUser,
} from "@clerk/react";
import { useMemo, type ReactNode } from "react";
import { z } from "zod";
import { AuthContext, type Auth } from "./auth";

// The publishable key is public, so it is safe in the built page.
const publishableKey = z
  .string({ error: "Build the page with VITE_CLERK_PUBLISHABLE_KEY set." })
  .regex(/^pk_(?:test|live)_/u, {
    error: "VITE_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key.",
  })
  .parse(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function FromClerk({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const auth = useMemo<Auth>(
    () => ({
      status: !isLoaded ? "loading" : isSignedIn ? "signed-in" : "signed-out",
      getToken: () => getToken(),
      email,
      signIn: () => {
        void clerk.redirectToSignIn();
      },
      signUp: () => {
        void clerk.redirectToSignUp();
      },
      // Given a callback, Clerk runs it in place of sending the browser to
      // its after-sign-out address, so the page is not loaded again.
      signOut: () => {
        void clerk.signOut(() => undefined);
      },
    }),
    [isLoaded, isSignedIn, getToken, email, clerk],
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
