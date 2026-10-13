import type { Speak } from "./speech";

export interface AskActions {
  speak: Speak | undefined;
  markOpened: (id: string) => void;
  dismiss: (id: string) => void;
}
