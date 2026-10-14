// The ask agentAsk is, in the shape the store takes, so a new field on NewAsk
// is added in one place. Kept out of asks.ts, which the page's unit tests
// import, so the page's type check does not reach the service.
import type { NewAsk } from "../service/src/store/store";
import { agentAsk } from "./asks";

// A valid ask with only the fields the store requires, unless more says
// otherwise.
export function storeAsk(more: Partial<NewAsk> = {}): NewAsk {
  return {
    summary: agentAsk.summary,
    area: agentAsk.area,
    spokenDetail: agentAsk.spoken_detail,
    ...more,
  };
}
