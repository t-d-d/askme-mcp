import { useEffect, useState } from "react";
import { signInWaitMs, useAuth } from "./auth";
import { SignedIn } from "./SignedIn";
import { SignedOut } from "./SignedOut";
import { Stopped } from "./Stopped";

// Nothing shows until Clerk says who is signed in, so a signed-in person
// never sees the signed-out page flash past. If Clerk has not said by the
// time limit, as when its host is slow or blocked, the page says so.
export function App() {
  const auth = useAuth();
  const loading = auth.status === "loading";
  const [waitedTooLong, waitTooLong] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const limit = setTimeout(() => {
      waitTooLong(true);
    }, signInWaitMs);
    return () => {
      clearTimeout(limit);
    };
  }, [loading]);
  switch (auth.status) {
    case "loading":
      return waitedTooLong ? <Stopped words="Sign-in couldn't load." /> : null;
    case "signed-out":
      return <SignedOut onSignIn={auth.signIn} onSignUp={auth.signUp} />;
    case "signed-in":
      return <SignedIn />;
  }
}
