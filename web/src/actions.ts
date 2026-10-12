import type { Speak } from "./speech";

// What the person can do to an ask from the list or its open card.
export interface AskActions {
  // Reads text aloud. Undefined where the browser has no speech.
  speak: Speak | undefined;
  // The person followed one of the ask's links.
  markOpened: (id: string) => void;
  dismiss: (id: string) => void;
}
