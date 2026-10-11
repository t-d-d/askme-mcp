import { useAuth } from "./auth";
import { SignedIn } from "./SignedIn";
import { SignedOut } from "./SignedOut";

// Nothing shows until Clerk says who is signed in, so a signed-in person
// never sees the signed-out page flash past.
export function App() {
  const auth = useAuth();
  switch (auth.status) {
    case "loading":
      return null;
    case "signed-out":
      return <SignedOut onSignIn={auth.signIn} onSignUp={auth.signUp} />;
    case "signed-in":
      return <SignedIn />;
  }
}
