import { SampleTopCard } from "./SampleTopCard";
import styles from "./SignedOut.module.css";

// The page a visitor sees before signing in: what askme is, a way in, a
// picture of an ask, and the demo notice. Sign-up and sign-in happen on
// Clerk's own screens.
export function SignedOut({
  onSignIn,
  onSignUp,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <span className={styles.wordmark}>askme</span>
        <button className={styles.signIn} type="button" onClick={onSignIn}>
          Sign in
        </button>
      </header>
      <main>
        <div className={styles.intro}>
          <h1 className={styles.headline}>
            Your agents ask here. You decide what gets through.
          </h1>
          <p className={styles.about}>
            One place where all your AI agents ask for your input, sorted by
            rules you write in plain English.
          </p>
          <button className={styles.signUp} type="button" onClick={onSignUp}>
            Sign up
          </button>
        </div>
        <SampleTopCard />
      </main>
      <footer className={styles.footer}>
        <p className={styles.notice}>
          This is a demo. Every ask is deleted after a month, and sign-ups stop
          at 100 accounts.
        </p>
      </footer>
    </div>
  );
}
