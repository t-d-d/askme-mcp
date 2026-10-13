/// <reference types="vite/client" />

// Each is public, as Vite builds it into the page.
interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}
